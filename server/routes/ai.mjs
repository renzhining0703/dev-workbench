/**
 * AI 面板路由：
 *   POST /api/ai/context        → bearer（签发签名 context_id，上下文最小化落库）
 *   POST /api/ai/chat           → bearer（校验 context 归属/有效期，转发 OpenClaw agent turn）
 *   GET  /api/ai/context/:id    → agent token（小朵凭签名 id 换取最小化上下文）
 *
 * AI_CONTEXT_SECRET / AI_AGENT_TOKEN 未配置时：前两个接口返回 503（同 push 503 口径）。
 * gateway 永远只在本机 loopback，由后端经 openclaw CLI 调用，不对外暴露。
 */
import { Router } from 'express'
import { randomBytes } from 'node:crypto'
import {
  CONTEXT_ID_RE,
  newContextId,
  signContextId,
  verifyContextId,
  safeTokenEqual,
} from '../lib/context-signing.mjs'
import {
  runAgentTurn,
  AgentError,
  AgentCancelledError,
  createActivityMonitor,
} from '../lib/agent-client.mjs'

const isAiConfigured = (config) =>
  Boolean(config.aiContextSecret && config.aiAgentToken)

/** 恒等于字符串，缺省空串 */
const str = (v) => (typeof v === 'string' ? v : '')

/** 挑字段：只保留白名单键，忽略其余 */
function pickFields(obj, keys) {
  const out = {}
  for (const k of keys) {
    if (obj?.[k] !== undefined && obj?.[k] !== null && obj?.[k] !== '') out[k] = obj[k]
  }
  return out
}

/**
 * 最小化上下文：丢弃 UI 原始对象的一切非白名单字段。
 * 需求只留 id/名称/项目/分支/状态/类型/PRD 链接/备注(≤500)/项目关联，
 * 待办只留 id/内容(≤200)/日期/完成态/优先级/关联需求，选中内容截断到 4000 字。
 */
export function minimizeContext(body) {
  const ctx = { capturedAt: new Date().toISOString() }
  const r = body?.requirement
  if (r && typeof r === 'object' && !Array.isArray(r)) {
    const req = pickFields(r, ['id', 'name', 'project', 'branch', 'status', 'type', 'prdUrl'])
    if (str(r.remark).trim()) req.remark = str(r.remark).slice(0, 500)
    if (Array.isArray(r.projects)) {
      req.projects = r.projects
        .filter((p) => p && typeof p === 'object')
        .slice(0, 6)
        .map((p) => pickFields(p, ['project', 'publishModule', 'publishedAt']))
    }
    if (Object.keys(req).length > 0) ctx.requirement = req
  }
  const t = body?.todo
  if (t && typeof t === 'object' && !Array.isArray(t)) {
    const todo = pickFields(t, ['id', 'content', 'date', 'done', 'priority', 'requirementId'])
    if (typeof todo.content === 'string') todo.content = todo.content.slice(0, 200)
    if (Object.keys(todo).length > 0) ctx.todo = todo
  }
  if (str(body?.project).trim()) ctx.project = str(body.project).slice(0, 120)
  if (str(body?.branch).trim()) ctx.branch = str(body.branch).slice(0, 120)
  if (str(body?.selection).trim()) ctx.selection = str(body.selection).slice(0, 4000)
  return ctx
}

/** 面板用户名 → agent 会话键（只留安全字符，防注入 session id） */
function sessionKeyFor(username) {
  const safe = str(username).replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 40)
  return `wb-ui-${safe || 'anonymous'}`
}

/** 面板消息 → agent 提示词（上下文只给签名 id，明文由 agent 主动换取） */
function composePanelMessage({ username, nickname, text, contextId }) {
  const lines = [
    '【工作台面板消息】',
    `用户：${username}（${nickname}）`,
  ]
  if (contextId) {
    lines.push(
      `上下文：${contextId}（含当前需求/项目/分支/选中内容，用 /root/.openclaw/workspace/scripts/wb-context-fetch.sh 获取；30 分钟内有效，多次可读）`,
    )
  }
  lines.push(
    '面板执行约束：这是一次性 CLI 会话，禁止 sessions_spawn / sessions_yield；代码审查由当前 Agent 按现有只读 diff 规范直接完成并返回最终结果。',
    '工具结果约束：以工具实际返回的 content 为准；禁止把文本结果描述成图片、附件或通道故障。服务端会读取本轮会话日志校验，矛盾回复会被拦截并触发无工具纠错。',
    '正文：',
    text,
  )
  return lines.join('\n')
}

/** 简易滑动窗口限流（内存版：pm2 重启即清零，够面板场景用） */
function createRateLimiter(limitPerMin) {
  const hits = new Map()
  return (key) => {
    const now = Date.now()
    const arr = (hits.get(key) ?? []).filter((t) => now - t < 60000)
    if (arr.length >= limitPerMin) {
      hits.set(key, arr)
      return false
    }
    arr.push(now)
    hits.set(key, arr)
    return true
  }
}

export function createAiRouter({ config, aiStore, requireAuth, runAgentTurnFn = runAgentTurn }) {
  const router = Router()
  const allowChat = createRateLimiter(config.aiChatRatePerMin ?? 10)
  const chatJobs = new Map()

  /** 清理已结束超过 15 分钟的任务，避免内存结果无限增长 */
  const gcChatJobs = () => {
    const cutoff = Date.now() - 15 * 60000
    for (const [id, job] of chatJobs) {
      if (job.status !== 'running' && job.updatedAt < cutoff) chatJobs.delete(id)
    }
  }

  /** 后台执行 agent turn，结果暂存内存供短轮询读取；附带取消信号与执行阶段监视 */
  const runChatJob = async (job, args) => {
    const controller = new AbortController()
    job.cancel = () => controller.abort()
    const monitor = createActivityMonitor({ sessionKey: args.sessionKey })
    job.monitor = monitor
    try {
      const { reply } = await runAgentTurnFn({ ...args, signal: controller.signal })
      job.reply = reply
      job.status = 'done'
    } catch (err) {
      if (err instanceof AgentCancelledError) {
        job.status = 'cancelled'
        console.info('[ai] chat job cancelled:', job.id)
      } else if (err instanceof AgentError) {
        job.status = 'error'
        job.statusCode = err.name === 'AgentTimeoutError' ? 504 : 503
        if (err.name === 'AgentEmptyReplyError') job.error = 'agent reply empty'
        else if (err.name === 'AgentReplyValidationError') job.error = 'agent reply invalid'
        else job.error = 'agent unavailable'
        console.error('[ai] agent turn failed:', err.message)
      } else {
        job.status = 'error'
        job.statusCode = 500
        job.error = 'internal error'
        console.error('[ai] chat job error:', err)
      }
    } finally {
      monitor.stop()
      job.updatedAt = Date.now()
    }
  }

  /** 签发签名上下文 id（需登录；空上下文拒绝） */
  router.post('/context', requireAuth, (req, res) => {
    if (!isAiConfigured(config)) {
      return res.status(503).json({
        ok: false,
        error: 'ai not configured',
        hint: '服务端未配置 AI_CONTEXT_SECRET / AI_AGENT_TOKEN（server/data/env.local）',
      })
    }
    const ctx = minimizeContext(req.body)
    const hasContent = Boolean(ctx.requirement || ctx.todo || ctx.project || ctx.branch || ctx.selection)
    if (!hasContent) {
      return res.status(400).json({ ok: false, error: 'empty context' })
    }
    // 惰性 GC：清理过期超 24h 的旧行
    const cutoff = new Date(Date.now() - 24 * 3600 * 1000).toISOString()
    aiStore.removeExpiredBefore(cutoff)

    const id = newContextId()
    const now = new Date()
    const expiresAt = new Date(now.getTime() + (config.aiContextTtlMinutes ?? 30) * 60000).toISOString()
    aiStore.insert({
      id,
      username: req.user.username,
      payload: ctx,
      signature: signContextId(config.aiContextSecret, id),
      createdAt: now.toISOString(),
      expiresAt,
    })
    res.status(200).json({ ok: true, data: { contextId: id, expiresAt } })
  })

  /** agent 凭签名 id 换取最小化上下文（agent token 鉴权，可重复读取） */
  router.get('/context/:id', (req, res) => {
    if (!isAiConfigured(config)) {
      return res.status(503).json({ ok: false, error: 'ai not configured' })
    }
    if (!safeTokenEqual(req.headers.authorization?.replace(/^Bearer\s+/i, ''), config.aiAgentToken)) {
      return res.status(401).json({ ok: false, error: 'invalid agent token' })
    }
    const id = req.params.id
    if (!CONTEXT_ID_RE.test(id)) {
      return res.status(400).json({ ok: false, error: 'invalid context id' })
    }
    const row = aiStore.get(id)
    if (!row || !verifyContextId(config.aiContextSecret, id, row.signature)) {
      return res.status(404).json({ ok: false, error: 'context not found' })
    }
    if (new Date(row.expiresAt).getTime() < Date.now()) {
      return res.status(410).json({ ok: false, error: 'context expired' })
    }
    aiStore.markFetched(id, new Date().toISOString())
    res.status(200).json({
      ok: true,
      data: { username: row.username, payload: row.payload, expiresAt: row.expiresAt },
    })
  })

  /** 创建面板对话任务并立即返回，避免长连接被浏览器或中间网络提前断开 */
  router.post('/chat', requireAuth, async (req, res) => {
    try {
      if (!isAiConfigured(config)) {
        return res.status(503).json({
          ok: false,
          error: 'ai not configured',
          hint: '服务端未配置 AI_CONTEXT_SECRET / AI_AGENT_TOKEN（server/data/env.local）',
        })
      }
      const text = str(req.body?.message).trim()
      if (!text || text.length > 4000) {
        return res.status(400).json({ ok: false, error: 'message required (1-4000 chars)' })
      }
      const contextId = str(req.body?.contextId)
      if (contextId) {
        if (!CONTEXT_ID_RE.test(contextId)) {
          return res.status(400).json({ ok: false, error: 'invalid context id' })
        }
        const row = aiStore.get(contextId)
        if (!row) return res.status(404).json({ ok: false, error: 'context not found' })
        if (row.username !== req.user.username) {
          return res.status(403).json({ ok: false, error: 'context owner mismatch' })
        }
        if (new Date(row.expiresAt).getTime() < Date.now()) {
          return res.status(410).json({ ok: false, error: 'context expired' })
        }
      }
      if (!allowChat(req.user.username)) {
        return res.status(429).json({ ok: false, error: 'too many requests' })
      }

      gcChatJobs()
      const id = `job-${randomBytes(16).toString('hex')}`
      const job = {
        id,
        username: req.user.username,
        contextId: contextId || undefined,
        status: 'running',
        statusCode: 200,
        reply: '',
        error: '',
        updatedAt: Date.now(),
      }
      chatJobs.set(id, job)
      const completion = runChatJob(job, {
        message: composePanelMessage({
          username: req.user.username,
          nickname: req.user.nickname,
          text,
          contextId: contextId || undefined,
        }),
        sessionKey: sessionKeyFor(req.user.username),
        timeoutMs: config.aiChatTimeoutMs ?? 300000,
        model: config.aiModel,
        openclawBin: config.aiOpenclawBin,
        pathPrefix: config.aiPathPrefix,
      })
      if (req.headers['x-ai-async'] === '1') {
        void completion
        return res.status(202).json({ ok: true, data: { jobId: id, status: 'running', contextId: job.contextId } })
      }

      // 兼容尚未刷新的旧版 PWA：无异步标记时保留原同步响应结构
      await completion
      if (job.status === 'cancelled') {
        return res.status(200).json({ ok: false, error: 'cancelled by user' })
      }
      if (job.status === 'error') {
        return res.status(job.statusCode).json({ ok: false, error: job.error })
      }
      res.status(200).json({ ok: true, data: { reply: job.reply, contextId: job.contextId } })
    } catch (err) {
      console.error('[ai] chat create error:', err)
      res.status(500).json({ ok: false, error: 'internal error' })
    }
  })

  /** 查询当前用户的对话任务；完成前返回 running 与执行阶段，完成后返回最终回复 */
  router.get('/chat/jobs/:id', requireAuth, (req, res) => {
    gcChatJobs()
    const job = chatJobs.get(req.params.id)
    if (!job) return res.status(404).json({ ok: false, error: 'chat job not found' })
    if (job.username !== req.user.username) {
      return res.status(403).json({ ok: false, error: 'chat job owner mismatch' })
    }
    res.setHeader('Cache-Control', 'no-store')
    const data = {
      jobId: job.id,
      status: job.status,
      contextId: job.contextId,
      reply: job.status === 'done' ? job.reply : undefined,
      phase: job.status === 'running' ? job.monitor?.phase() ?? 'waiting' : undefined,
    }
    if (job.status === 'error') {
      return res.status(job.statusCode).json({ ok: false, error: job.error, data })
    }
    res.status(200).json({ ok: true, data })
  })

  /** 取消当前用户的运行中任务：终止 agent 子进程，任务以 cancelled 收尾 */
  router.post('/chat/jobs/:id/cancel', requireAuth, (req, res) => {
    const job = chatJobs.get(req.params.id)
    if (!job) return res.status(404).json({ ok: false, error: 'chat job not found' })
    if (job.username !== req.user.username) {
      return res.status(403).json({ ok: false, error: 'chat job owner mismatch' })
    }
    if (job.status !== 'running') {
      return res.status(200).json({ ok: true, data: { jobId: job.id, status: job.status } })
    }
    job.cancel?.()
    job.status = 'cancelling'
    res.status(200).json({ ok: true, data: { jobId: job.id, status: 'cancelling' } })
  })

  return router
}
