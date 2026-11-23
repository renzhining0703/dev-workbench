/**
 * AI 面板测试：
 *  1) context-signing 纯函数（签名/校验/防篡改/恒定时间比较）
 *  2) minimizeContext 字段裁剪
 *  3) /api/ai/context 签发（鉴权/空上下文/签名落库/过期 GC）
 *  4) /api/ai/context/:id 换取（agent token/形态校验/过期 410/可重复读取）
 *  5) /api/ai/chat + /chat/jobs/:id（异步任务/限流/校验/归属/回复与异常回传）
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDatabase } from '../db.mjs'
import { UserStore } from '../store/users.mjs'
import { SessionStore } from '../store/sessions.mjs'
import { SnapshotStore } from '../store/snapshots.mjs'
import { AiContextStore } from '../store/ai-contexts.mjs'
import { createApp } from '../app.mjs'
import { genSalt, hashPassword } from '../lib/password.mjs'
import {
  newContextId,
  signContextId,
  verifyContextId,
  safeTokenEqual,
  CONTEXT_ID_RE,
} from '../lib/context-signing.mjs'
import { minimizeContext } from '../routes/ai.mjs'
import { AgentCancelledError, AgentEmptyReplyError, AgentReplyValidationError, AgentTimeoutError } from '../lib/agent-client.mjs'

/* ---------------- 1. context-signing ---------------- */

const SECRET = 'test-secret-0123456789abcdef'

test('context-signing：签发-校验闭环，篡改 id 或签名都不通过', () => {
  const id = newContextId()
  assert.match(id, CONTEXT_ID_RE)
  const sig = signContextId(SECRET, id)
  assert.ok(verifyContextId(SECRET, id, sig))
  assert.ok(!verifyContextId(SECRET, 'ctx-' + '0'.repeat(32), sig))
  assert.ok(!verifyContextId(SECRET, id, sig.replace(/^.{2}/, 'ff')))
  assert.ok(!verifyContextId('other-secret', id, sig))
})

test('context-signing：safeTokenEqual 恒定时间比较（空串/长度不等/一致）', () => {
  assert.ok(safeTokenEqual('tok123', 'tok123'))
  assert.ok(!safeTokenEqual('tok123', 'tok124'))
  assert.ok(!safeTokenEqual('tok123', 'tok1234'))
  assert.ok(!safeTokenEqual('', 'tok123'))
  assert.ok(!safeTokenEqual('tok123', ''))
})

/* ---------------- 2. minimizeContext ---------------- */

test('minimizeContext：只留白名单字段，备注/待办内容/选中内容截断', () => {
  const ctx = minimizeContext({
    requirement: {
      id: 'req-1',
      name: '登录改造',
      project: 'icare-health',
      branch: 'feature/20261123/REQ-02062',
      status: 'developing',
      type: 'normal',
      prdUrl: 'https://feishu.example/prd',
      remark: 'r'.repeat(600),
      devStartTime: '2026-11-01T00:00:00', // 非白名单，应丢弃
      secretField: 'nope',
      projects: [{ project: 'icare-health', publishModule: 'src/', publishedAt: null, extra: 1 }],
    },
    todo: { id: 't1', content: 'c'.repeat(300), date: '2026-11-23', done: false, priority: 'high', requirementId: 'req-1', junk: 'drop' },
    selection: 's'.repeat(5000),
    junk: 'drop',
  })
  assert.equal(ctx.requirement.id, 'req-1')
  assert.equal(ctx.requirement.remark.length, 500)
  assert.equal(ctx.selection.length, 4000)
  assert.equal(ctx.requirement.projects.length, 1)
  assert.equal(ctx.requirement.projects[0].publishModule, 'src/')
  assert.ok(!('secretField' in ctx.requirement))
  assert.ok(!('devStartTime' in ctx.requirement))
  assert.ok(!('extra' in ctx.requirement.projects[0]))
  assert.equal(ctx.todo.content.length, 200)
  assert.equal(ctx.todo.priority, 'high')
  assert.equal(ctx.todo.requirementId, 'req-1')
  assert.ok(!('junk' in ctx.todo))
  assert.ok(!('junk' in ctx))
  assert.ok(ctx.requirement.branch.includes('REQ-02062'))
})

test('minimizeContext：无任何内容 → 只有 capturedAt', () => {
  const ctx = minimizeContext({ junk: 1 })
  assert.ok(!ctx.requirement && !ctx.todo && !ctx.project && !ctx.branch && !ctx.selection)
})

/* ---------------- 3-5. 路由 ---------------- */

const AGENT_TOKEN = 'test-agent-token-0123456789'

function setupApp() {
  const tmp = mkdtempSync(join(tmpdir(), 'wb-ai-test-'))
  const db = openDatabase(join(tmp, 'test.db'))
  const userStore = new UserStore(db)
  const sessionStore = new SessionStore(db)
  const snapshotStore = new SnapshotStore(db)
  const aiStore = new AiContextStore(db)
  const app = createApp({
    config: {
      allowedOrigins: ['http://localhost:5173'],
      inviteCode: '',
      rateLimitPerMin: 100,
      aiContextSecret: SECRET,
      aiAgentToken: AGENT_TOKEN,
      aiContextTtlMinutes: 30,
      aiChatTimeoutMs: 5000,
      aiChatRatePerMin: 3,
      aiOpenclawBin: '/nonexistent/openclaw',
      aiPathPrefix: '/usr/bin',
    },
    userStore,
    sessionStore,
    snapshotStore,
    aiStore,
  }).listen(0)
  const base = `http://127.0.0.1:${app.address().port}`
  const cleanup = () =>
    new Promise((resolve) => {
      app.close(() => {
        db.close()
        rmSync(tmp, { recursive: true, force: true })
        resolve()
      })
    })
  return { base, cleanup, aiStore, userStore, sessionStore, db }
}

async function registerAndLogin(base, username, password) {
  await fetch(`${base}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  })
  const res = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  })
  const body = await res.json()
  assert.equal(res.status, 200, JSON.stringify(body))
  return body.data.token
}

/** 短轮询测试任务直到 done/error，返回最后一次响应与 JSON */
async function waitChatJob(base, auth, jobId) {
  for (let i = 0; i < 100; i++) {
    const res = await fetch(`${base}/api/ai/chat/jobs/${jobId}`, { headers: auth })
    const body = await res.json()
    if (res.status !== 200 || body.data?.status !== 'running') return { res, body }
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  assert.fail(`chat job did not settle: ${jobId}`)
}

test('ai 路由：未登录签发 401；登录后签发成功且签名/有效期正确', async () => {
  const { base, cleanup, aiStore } = setupApp()
  try {
    const empty = await fetch(`${base}/api/ai/context`, { method: 'POST', body: '{}' })
    assert.equal(empty.status, 401)

    const token = await registerAndLogin(base, 'alice', 'passw0rd-alice')
    const res = await fetch(`${base}/api/ai/context`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        requirement: { id: 'req-9', name: '需求甲', branch: 'dev/x' },
        selection: '选中文本',
      }),
    })
    assert.equal(res.status, 200)
    const { data } = await res.json()
    assert.match(data.contextId, CONTEXT_ID_RE)
    const row = aiStore.get(data.contextId)
    assert.equal(row.username, 'alice')
    assert.equal(row.payload.requirement.name, '需求甲')
    assert.equal(row.payload.selection, '选中文本')
    assert.ok(verifyContextId(SECRET, data.contextId, row.signature))
    const ttl = new Date(row.expiresAt).getTime() - new Date(row.createdAt).getTime()
    assert.ok(Math.abs(ttl - 30 * 60000) < 5000, `ttl=${ttl}`)
    assert.equal(data.expiresAt, row.expiresAt)
  } finally {
    await cleanup()
  }
})

test('ai 路由：空上下文 400；agent token 换取校验（无/错 token 401、坏 id 400、未知 id 404、正常可重复读取）', async () => {
  const { base, cleanup } = setupApp()
  try {
    const token = await registerAndLogin(base, 'bob', 'passw0rd-bob')
    const auth = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }

    const emptyRes = await fetch(`${base}/api/ai/context`, {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({ junk: true }),
    })
    assert.equal(emptyRes.status, 400)

    const ctxRes = await fetch(`${base}/api/ai/context`, {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({ project: 'icare-forms' }),
    })
    const { data } = await ctxRes.json()

    const noTok = await fetch(`${base}/api/ai/context/${data.contextId}`)
    assert.equal(noTok.status, 401)
    const badTok = await fetch(`${base}/api/ai/context/${data.contextId}`, {
      headers: { Authorization: 'Bearer wrong-token' },
    })
    assert.equal(badTok.status, 401)
    const badId = await fetch(`${base}/api/ai/context/not-a-context-id`, {
      headers: { Authorization: `Bearer ${AGENT_TOKEN}` },
    })
    assert.equal(badId.status, 400)
    const unknown = await fetch(`${base}/api/ai/context/${'ctx-' + '0'.repeat(32)}`, {
      headers: { Authorization: `Bearer ${AGENT_TOKEN}` },
    })
    assert.equal(unknown.status, 404)

    for (let i = 0; i < 2; i++) {
      const ok = await fetch(`${base}/api/ai/context/${data.contextId}`, {
        headers: { Authorization: `Bearer ${AGENT_TOKEN}` },
      })
      assert.equal(ok.status, 200)
      const { data: fetched } = await ok.json()
      assert.equal(fetched.username, 'bob')
      assert.equal(fetched.payload.project, 'icare-forms')
      assert.ok(fetched.expiresAt)
    }
  } finally {
    await cleanup()
  }
})

test('ai 路由：过期上下文换取 410；过期超 24h 在下次签发时被 GC', async () => {
  const { base, cleanup, aiStore, db } = setupApp()
  try {
    const token = await registerAndLogin(base, 'carol', 'passw0rd-carol')
    const auth = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }
    const { data } = await (
      await fetch(`${base}/api/ai/context`, {
        method: 'POST',
        headers: auth,
        body: JSON.stringify({ branch: 'release/a' }),
      })
    ).json()

    // 手动改成刚过期（直接 UPDATE，绕开主键冲突）
    const past = new Date(Date.now() - 60000).toISOString()
    db.prepare('UPDATE ai_contexts SET expires_at = ? WHERE id = ?').run(past, data.contextId)
    const expired = await fetch(`${base}/api/ai/context/${data.contextId}`, {
      headers: { Authorization: `Bearer ${AGENT_TOKEN}` },
    })
    assert.equal(expired.status, 410)

    // 再造一条过期超 24h 的，签发新上下文触发 GC
    const staleId = newContextId()
    const stale = new Date(Date.now() - 25 * 3600 * 1000).toISOString()
    aiStore.insert({
      id: staleId,
      username: 'carol',
      payload: { capturedAt: stale },
      signature: signContextId(SECRET, staleId),
      createdAt: stale,
      expiresAt: stale,
    })
    await fetch(`${base}/api/ai/context`, {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({ branch: 'release/b' }),
    })
    assert.equal(aiStore.get(staleId), null)
    // 刚过期的 1 分钟内不会被 GC（阈值 24h）
    assert.ok(aiStore.get(data.contextId))
  } finally {
    await cleanup()
  }
})

test('ai chat：限流 429 / 消息校验 400 / 上下文校验 400-404-403', async () => {
  const { base, cleanup } = setupApp()
  try {
    const token = await registerAndLogin(base, 'dave', 'passw0rd-dave')
    const auth = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }
    const chat = (body) =>
      fetch(`${base}/api/ai/chat`, {
        method: 'POST',
        headers: { ...auth, 'X-AI-Async': '1' },
        body: JSON.stringify(body),
      })

    assert.equal((await chat({ message: '' })).status, 400)
    assert.equal((await chat({ message: 'x'.repeat(4001) })).status, 400)
    assert.equal((await chat({ message: 'hi', contextId: 'bogus' })).status, 400)
    assert.equal((await chat({ message: 'hi', contextId: 'ctx-' + '0'.repeat(32) })).status, 404)

    // 他人的上下文 → 403
    const other = await registerAndLogin(base, 'erin', 'passw0rd-erin')
    const otherCtx = await (
      await fetch(`${base}/api/ai/context`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${other}` },
        body: JSON.stringify({ project: 'icare-magi-git' }),
      })
    ).json()
    assert.equal((await chat({ message: 'hi', contextId: otherCtx.data.contextId })).status, 403)

    // 无 runner 注入 → 任务先返回 202，再由查询接口回传 agent 不可用 503
    for (const message of ['first', 'second', 'third']) {
      const created = await chat({ message })
      assert.equal(created.status, 202)
      const createdBody = await created.json()
      const { res } = await waitChatJob(base, auth, createdBody.data.jobId)
      assert.equal(res.status, 503)
    }
    // 限流：aiChatRatePerMin=3，第 4 次有效请求 → 429
    assert.equal((await chat({ message: 'fourth' })).status, 429)
  } finally {
    await cleanup()
  }
})

test('ai chat（fake runner）：回复透传、消息协议含用户名/昵称/上下文 id、超时映射 504', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'wb-ai-test2-'))
  const db = openDatabase(join(tmp, 'test.db'))
  const seen = []
  let mode = 'ok'
  const fakeRunner = async (args) => {
    seen.push(args)
    if (mode === 'timeout') throw new AgentTimeoutError('timed out')
    if (mode === 'empty') throw new AgentEmptyReplyError('agent reply empty')
    if (mode === 'invalid') throw new AgentReplyValidationError('agent reply invalid')
    return { reply: `收到：${args.sessionKey}` }
  }
  const app = createApp({
    config: {
      allowedOrigins: [],
      inviteCode: '',
      rateLimitPerMin: 100,
      aiContextSecret: SECRET,
      aiAgentToken: AGENT_TOKEN,
      aiContextTtlMinutes: 30,
      aiChatTimeoutMs: 5000,
      aiChatRatePerMin: 10,
      aiModel: 'zhipu/glm-5.3-flash',
    },
    userStore: new UserStore(db),
    sessionStore: new SessionStore(db),
    snapshotStore: new SnapshotStore(db),
    aiStore: new AiContextStore(db),
    aiRunner: fakeRunner,
  }).listen(0)
  const base = `http://127.0.0.1:${app.address().port}`
  try {
    const token = await registerAndLogin(base, 'frank', 'passw0rd-frank')
    const auth = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }
    const ctx = await (
      await fetch(`${base}/api/ai/context`, {
        method: 'POST',
        headers: auth,
        body: JSON.stringify({ requirement: { id: 'req-7', name: '需求乙' } }),
      })
    ).json()

    const res = await fetch(`${base}/api/ai/chat`, {
      method: 'POST',
      headers: { ...auth, 'X-AI-Async': '1' },
      body: JSON.stringify({ message: '这个需求什么状态？', contextId: ctx.data.contextId }),
    })
    assert.equal(res.status, 202)
    const { data: created } = await res.json()
    assert.equal(created.status, 'running')
    assert.match(created.jobId, /^job-[a-f0-9]{32}$/)
    const { res: doneRes, body: doneBody } = await waitChatJob(base, auth, created.jobId)
    assert.equal(doneRes.status, 200)
    assert.equal(doneBody.data.status, 'done')
    assert.equal(doneBody.data.reply, '收到：wb-ui-frank')
    assert.equal(doneBody.data.contextId, ctx.data.contextId)

    // 任务归属隔离：其他登录用户不能读取该结果
    const other = await registerAndLogin(base, 'frank_peer', 'passw0rd-frank-peer')
    const forbidden = await fetch(`${base}/api/ai/chat/jobs/${created.jobId}`, {
      headers: { Authorization: `Bearer ${other}` },
    })
    assert.equal(forbidden.status, 403)

    assert.equal(seen.length, 1)
    const call = seen[0]
    assert.equal(call.sessionKey, 'wb-ui-frank')
    assert.equal(call.model, 'zhipu/glm-5.3-flash')
    assert.ok(call.message.includes('【工作台面板消息】'))
    assert.ok(call.message.includes('用户：frank'))
    assert.ok(call.message.includes(ctx.data.contextId))
    assert.ok(call.message.includes('禁止 sessions_spawn / sessions_yield'))
    assert.ok(call.message.includes('代码审查由当前 Agent'))
    assert.ok(call.message.includes('禁止把文本结果描述成图片'))
    assert.ok(call.message.includes('这个需求什么状态？'))

    // 超时 → 创建仍立即成功，查询任务时映射 504
    mode = 'timeout'
    const t = await fetch(`${base}/api/ai/chat`, {
      method: 'POST',
      headers: { ...auth, 'X-AI-Async': '1' },
      body: JSON.stringify({ message: '再来一条' }),
    })
    assert.equal(t.status, 202)
    const { data: timeoutJob } = await t.json()
    const { res: timeoutRes } = await waitChatJob(base, auth, timeoutJob.jobId)
    assert.equal(timeoutRes.status, 504)

    // 空回复单独透传错误类型，避免前端误报为普通服务不可用
    mode = 'empty'
    const empty = await fetch(`${base}/api/ai/chat`, {
      method: 'POST',
      headers: { ...auth, 'X-AI-Async': '1' },
      body: JSON.stringify({ message: '空回复场景' }),
    })
    assert.equal(empty.status, 202)
    const { data: emptyJob } = await empty.json()
    const { res: emptyRes, body: emptyBody } = await waitChatJob(base, auth, emptyJob.jobId)
    assert.equal(emptyRes.status, 503)
    assert.equal(emptyBody.error, 'agent reply empty')

    // 连续误述工具结果 → 明确返回事实校验失败，不能下发错误内容
    mode = 'invalid'
    const invalid = await fetch(`${base}/api/ai/chat`, {
      method: 'POST',
      headers: { ...auth, 'X-AI-Async': '1' },
      body: JSON.stringify({ message: '事实校验失败场景' }),
    })
    assert.equal(invalid.status, 202)
    const { data: invalidJob } = await invalid.json()
    const { res: invalidRes, body: invalidBody } = await waitChatJob(base, auth, invalidJob.jobId)
    assert.equal(invalidRes.status, 503)
    assert.equal(invalidBody.error, 'agent reply invalid')

    // 旧版 PWA 不带异步标记：仍返回原同步结构，避免部署切换期空白回复
    mode = 'ok'
    const legacy = await fetch(`${base}/api/ai/chat`, {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({ message: '旧版页面' }),
    })
    assert.equal(legacy.status, 200)
    const legacyBody = await legacy.json()
    assert.equal(legacyBody.data.reply, '收到：wb-ui-frank')
  } finally {
    await new Promise((resolve) => {
      app.close(() => {
        db.close()
        rmSync(tmp, { recursive: true, force: true })
        resolve()
      })
    })
  }
})

test('ai chat 取消：运行中任务可取消并返回 cancelled；归属校验与阶段字段同步验证', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'wb-ai-test3-'))
  const db = openDatabase(join(tmp, 'test.db'))
  // 挂起直到收到取消信号，模拟长任务
  const hangRunner = (args) => new Promise((resolve, reject) => {
    args.signal?.addEventListener('abort', () => reject(new AgentCancelledError('cancelled by user')), { once: true })
  })
  const app = createApp({
    config: {
      allowedOrigins: [],
      inviteCode: '',
      rateLimitPerMin: 100,
      aiContextSecret: SECRET,
      aiAgentToken: AGENT_TOKEN,
      aiContextTtlMinutes: 30,
      aiChatTimeoutMs: 30000,
      aiChatRatePerMin: 10,
      aiModel: 'custom_deepseek/deepseek-flash',
    },
    userStore: new UserStore(db),
    sessionStore: new SessionStore(db),
    snapshotStore: new SnapshotStore(db),
    aiStore: new AiContextStore(db),
    aiRunner: hangRunner,
  }).listen(0)
  const base = `http://127.0.0.1:${app.address().port}`
  try {
    const token = await registerAndLogin(base, 'gina', 'passw0rd-gina')
    const auth = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }

    const created = await fetch(`${base}/api/ai/chat`, {
      method: 'POST',
      headers: { ...auth, 'X-AI-Async': '1' },
      body: JSON.stringify({ message: '跑一个长任务' }),
    })
    assert.equal(created.status, 202)
    const { data: job } = await created.json()

    // running 期间：查询接口带 phase；取消接口归属校验通过
    const running = await fetch(`${base}/api/ai/chat/jobs/${job.jobId}`, { headers: auth })
    const runningBody = await running.json()
    assert.equal(runningBody.data.status, 'running')
    assert.equal(runningBody.data.phase, 'waiting')

    const other = await registerAndLogin(base, 'gina_peer', 'passw0rd-gina-peer')
    const forbidden = await fetch(`${base}/api/ai/chat/jobs/${job.jobId}/cancel`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${other}` },
    })
    assert.equal(forbidden.status, 403)

    const cancel = await fetch(`${base}/api/ai/chat/jobs/${job.jobId}/cancel`, {
      method: 'POST',
      headers: auth,
    })
    assert.equal(cancel.status, 200)
    const cancelBody = await cancel.json()
    assert.equal(cancelBody.data.status, 'cancelling')

    // 任务收尾为 cancelled：200 返回，不进 error 分支
    const { res, body } = await waitChatJob(base, auth, job.jobId)
    assert.equal(res.status, 200)
    assert.equal(body.data.status, 'cancelled')
    assert.equal(body.data.reply, undefined)

    // 取消已结束的任务：幂等返回当前状态
    const again = await fetch(`${base}/api/ai/chat/jobs/${job.jobId}/cancel`, { method: 'POST', headers: auth })
    assert.equal((await again.json()).data.status, 'cancelled')
  } finally {
    await new Promise((resolve) => {
      app.close(() => {
        db.close()
        rmSync(tmp, { recursive: true, force: true })
        resolve()
      })
    })
  }
})
