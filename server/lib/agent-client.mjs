/**
 * OpenClaw agent CLI 调用客户端
 *
 * 通过本机 openclaw CLI 跑一个 agent turn（CLI 自己连 gateway loopback），
 * 工作台后端不直连 gateway 端口，gateway 也不对外网暴露。
 */
import { spawn } from 'node:child_process'
import { writeFile, unlink, stat, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'

export class AgentError extends Error {
  constructor(message) {
    super(message)
    // 子类（Timeout/Unavailable/EmptyReply）依赖 name 区分状态码，必须显式设
    this.name = new.target.name
  }
}
/** CLI 不存在 / 非零退出 / 输出不可解析 */
export class AgentUnavailableError extends AgentError {}
/** 超时被杀 */
export class AgentTimeoutError extends AgentError {}
/** 正常退出但没有可提取的回复文本 */
export class AgentEmptyReplyError extends AgentError {}
/** 回复中的工具故障描述被本轮会话日志直接证伪 */
export class AgentReplyValidationError extends AgentError {}
/** 用户主动取消，运行中的 CLI 子进程已被终止 */
export class AgentCancelledError extends AgentError {}

const DEFAULT_SESSION_LOG_DIR = '/root/.openclaw/agents/main/sessions'
const EMPTY_TOOL_RESULTS = Object.freeze({ text: 0, image: 0, other: 0, total: 0 })

/** 统计会话日志增量中的工具结果类型；纠错时可附原文样本 */
export function summarizeToolResults(jsonl, includeText = false) {
  const summary = { ...EMPTY_TOOL_RESULTS }
  const textSamples = []
  const pushText = (text) => {
    summary.text += 1
    summary.total += 1
    if (includeText && textSamples.length < 30) textSamples.push(String(text ?? '').slice(0, 6000))
  }
  const visit = (content) => {
    if (typeof content === 'string') {
      pushText(content)
      return
    }
    if (!Array.isArray(content)) return
    for (const item of content) {
      if (item?.type === 'toolResult') {
        visit(item.content)
        continue
      }
      if (item?.type === 'text') pushText(item.text)
      else {
        if (item?.type === 'image') summary.image += 1
        else summary.other += 1
        summary.total += 1
      }
    }
  }
  for (const line of String(jsonl ?? '').split('\n')) {
    if (!line.trim()) continue
    try {
      const record = JSON.parse(line)
      if (record?.message?.role === 'toolResult') visit(record.message.content)
      else if (record?.type === 'toolResult') visit(record.toolResult?.content ?? record.content)
    } catch {
      // 并发写入可能留下半行；跳过该行，不能用不完整日志做故障判断
    }
  }
  return includeText ? { ...summary, textSamples } : summary
}

/** 判断回复是否断言工具结果不可读、被转成图片或读取通道故障 */
export function hasToolOutputFailureClaim(reply) {
  const text = String(reply ?? '')
  if (/(?:误述|错误回复|更正|纠正)[\s\S]{0,100}(?:图片|文本|通道)/.test(text)) return false
  return [
    /(?:工具输出|工具结果|读取通道|回传通道|渲染链路)[\s\S]{0,100}(?:坏了|异常|故障|只返回图片|变成[\s\S]{0,8}图片|转成[\s\S]{0,8}图片|渲染成[\s\S]{0,8}图片)/i,
    /(?:exec|read|echo)[\s\S]{0,80}(?:只返回|全变成|都变成|转成|渲染成)[\s\S]{0,20}图片/i,
    /模型侧拿到的是[\s\S]{0,40}see attached image/i,
    /(?:拿不到|没有|读不到|看不到|无法读取|不能读取)[\s\S]{0,30}(?:可读|结果正文|具体数值|工具结果|返回内容)/i,
    /返回给我的内容没有可读正文/i,
  ].some((pattern) => pattern.test(text))
}

/** 只有本轮结果全为文本时，才认定“全是图片/通道坏”的回复被日志证伪 */
export function unsupportedToolOutputClaim(reply, toolResults) {
  if (!toolResults?.total || toolResults.image > 0 || toolResults.text === 0) return false
  return hasToolOutputFailureClaim(reply)
}

/** 获取会话日志当前字节位置；日志不可读时不启用校验，也不影响原对话 */
async function sessionLogOffset(path) {
  try {
    return (await stat(path)).size
  } catch (err) {
    if (err?.code !== 'ENOENT') console.warn('[agent-client] session log stat failed:', err.message)
    return null
  }
}

/** 读取本次 turn 新增的日志并统计工具结果 */
async function readTurnToolResults(path, offset) {
  const buffer = await readFile(path)
  const start = offset <= buffer.length ? offset : 0
  return summarizeToolResults(buffer.subarray(start).toString('utf8'), true)
}

/** 从 CLI JSON 输出提取最终回复文本（兼容 payloads 为字符串或 {text} 形态） */
export function extractReplyText(data) {
  const payloads = data?.result?.payloads ?? data?.payloads
  if (!Array.isArray(payloads)) return ''
  const parts = payloads
    .map((p) => {
      if (typeof p === 'string') return p
      if (typeof p?.text === 'string') return p.text
      return ''
    })
    .filter((t) => t.trim().length > 0)
  return parts.join('\n').trim()
}

/** 会话日志路径；会话键消毒规则与 turn 执行保持一致 */
export function sessionLogPath(sessionKey, sessionLogDir = DEFAULT_SESSION_LOG_DIR) {
  const safe = String(sessionKey ?? '').replace(/[^a-zA-Z0-9._-]/g, '_')
  return join(sessionLogDir, `${safe}.jsonl`)
}

/** 从日志增量提取本轮活动信号：工具调用次数与最后一条事件时间 */
export function observeTurnActivity(jsonl) {
  let toolCalls = 0
  let lastEventAt = 0
  for (const line of String(jsonl ?? '').split('\n')) {
    if (!line.trim()) continue
    try {
      const record = JSON.parse(line)
      const ts = Date.parse(record?.timestamp ?? '')
      if (Number.isFinite(ts)) lastEventAt = Math.max(lastEventAt, ts)
      const message = record?.message
      if (message?.role === 'assistant' && Array.isArray(message.content)) {
        for (const item of message.content) if (item?.type === 'toolCall') toolCalls += 1
      }
    } catch {
      // 并发写入可能留下半行；活动监视只做展示，不据此下结论
    }
  }
  return { toolCalls, lastEventAt }
}

/** 活动信号 → 执行阶段：无工具调用=等待模型；10s 内有日志=执行工具；否则=生成回复 */
export function phaseFromActivity({ toolCalls, lastEventAt }, nowMs = Date.now()) {
  if (!toolCalls) return 'waiting'
  const idleMs = nowMs - (lastEventAt || nowMs)
  return idleMs < 10000 ? 'tooling' : 'composing'
}

/** 轮询会话日志增量的活动监视器；stop 后不再读取文件 */
export function createActivityMonitor({ sessionKey, sessionLogDir, intervalMs = 2000, readFileFn = readFile, statFn = stat } = {}) {
  const logPath = sessionLogPath(sessionKey, sessionLogDir)
  const state = { toolCalls: 0, lastEventAt: 0 }
  let offset = null
  const poll = async () => {
    try {
      if (offset === null) offset = (await statFn(logPath)).size
      const buffer = await readFileFn(logPath)
      if (buffer.length <= offset) return
      const activity = observeTurnActivity(buffer.subarray(offset).toString('utf8'))
      state.toolCalls += activity.toolCalls
      state.lastEventAt = Math.max(state.lastEventAt, activity.lastEventAt)
      offset = buffer.length
    } catch {
      // 日志暂不可读时保留上次状态，不影响任务本身
    }
  }
  const timer = setInterval(() => void poll(), intervalMs)
  void poll()
  return {
    phase: (nowMs = Date.now()) => phaseFromActivity(state, nowMs),
    stop: () => clearInterval(timer),
  }
}

/** 执行单次 CLI turn，并返回该轮会话日志里的工具结果统计；signal 中止时终止子进程 */
async function runAgentTurnOnce({ message, sessionKey, timeoutMs, openclawBin, pathPrefix, sessionLogDir, model, signal }) {
  const msgFile = join(tmpdir(), `wb-msg-${randomBytes(8).toString('hex')}.txt`)
  const logPath = sessionLogPath(sessionKey, sessionLogDir)
  const logOffset = await sessionLogOffset(logPath)
  await writeFile(msgFile, message, 'utf8')
  // CLI --timeout 单位秒；进程层超时另加 5s 余量兜底
  const cliTimeout = Math.max(10, Math.ceil(timeoutMs / 1000) - 5)
  const args = [
    'agent',
    '--agent',
    'main',
    '--session-id',
    sessionKey,
    '--message-file',
    msgFile,
    '--timeout',
    String(cliTimeout),
    '--json',
  ]
  if (model) args.push('--model', model)
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new AgentCancelledError('cancelled by user'))
    const child = spawn(openclawBin, args, {
      env: { ...process.env, PATH: `${pathPrefix}:${process.env.PATH ?? ''}` },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGKILL')
    }, timeoutMs)
    // 用户取消：直接杀掉 CLI 子进程，本轮按取消处理
    const onAbort = () => {
      clearTimeout(timer)
      child.kill('SIGKILL')
      reject(new AgentCancelledError('cancelled by user'))
    }
    signal?.addEventListener('abort', onAbort, { once: true })
    const removeAbortListener = () => signal?.removeEventListener('abort', onAbort)
    child.stdout.on('data', (d) => {
      stdout += d
    })
    child.stderr.on('data', (d) => {
      stderr += d
    })
    child.on('error', (err) => {
      clearTimeout(timer)
      removeAbortListener()
      reject(new AgentUnavailableError(`agent spawn failed: ${err.code ?? err.message}`))
    })
    child.on('close', async () => {
      clearTimeout(timer)
      removeAbortListener()
      // 消息临时文件无论成败都删（unlink 异步不阻塞返回）
      void unlink(msgFile).catch(() => {})
      if (timedOut) return reject(new AgentTimeoutError('agent turn timed out'))
      if (child.exitCode !== 0) {
        console.error('[agent-client] stderr tail:', stderr.slice(-500))
        return reject(new AgentUnavailableError(`agent exit ${child.exitCode}`))
      }
      let data
      try {
        data = JSON.parse(stdout.trim())
      } catch {
        console.error('[agent-client] stdout tail:', stdout.slice(-500))
        return reject(new AgentUnavailableError('agent output not json'))
      }
      const reply = extractReplyText(data)
      if (!reply) return reject(new AgentEmptyReplyError('agent reply empty'))
      let toolResults = { ...EMPTY_TOOL_RESULTS }
      if (logOffset !== null) {
        try {
          toolResults = await readTurnToolResults(logPath, logOffset)
        } catch (err) {
          console.warn('[agent-client] session log read failed:', err.message)
        }
      }
      resolve({ reply, toolResults })
    })
  })
}

/** 跑 agent turn；文本结果被误述为不可读时拦截，并附原文做一次无工具纠错 */
export async function runAgentTurn(options) {
  if (options.signal?.aborted) throw new AgentCancelledError('cancelled by user')
  const execute = options.turnRunner ?? runAgentTurnOnce
  const timeoutMs = options.timeoutMs ?? 300000
  const deadline = Date.now() + timeoutMs
  const first = await execute({ ...options, timeoutMs })
  if (!unsupportedToolOutputClaim(first.reply, first.toolResults)) return { reply: first.reply }

  console.warn(
    `[agent-client] blocked unsupported tool-output claim: ${options.sessionKey}; text=${first.toolResults.text}, image=${first.toolResults.image}`,
  )
  if (options.signal?.aborted) throw new AgentCancelledError('cancelled by user')
  const remainingMs = deadline - Date.now()
  if (remainingMs < 1000) throw new AgentTimeoutError('agent turn timed out before correction')
  const evidence = (first.toolResults.textSamples ?? []).join('\n--- 下一条工具结果 ---\n').slice(0, 24000)
  const correctionLines = [
    '【工作台服务端事实校验】你的上一轮回复已被拦截，尚未发送给用户。',
    `本会话日志显示：上一轮工具结果包含文本 ${first.toolResults.text} 条、图片 ${first.toolResults.image} 条。你关于“工具结果不可读/只返回图片/通道故障”的描述与日志矛盾。`,
    '请直接利用当前会话已经返回的文本结果以及下方原文，回答用户最初的问题。本轮不要调用任何工具，不要重复任何写操作，不要再讨论通道故障。',
    '若下方原文确实缺少回答所需数据，只说明具体缺哪个字段；禁止把文本结果描述成图片、附件或不可读内容。',
  ]
  if (evidence) correctionLines.push('【服务端从会话日志原样提取的工具文本】', evidence, '【工具文本结束】')
  const corrected = await execute({ ...options, message: correctionLines.join('\n'), timeoutMs: remainingMs })
  const correctedEvidence = corrected.toolResults?.total ? corrected.toolResults : first.toolResults
  if (unsupportedToolOutputClaim(corrected.reply, correctedEvidence)) {
    throw new AgentReplyValidationError('agent reply contradicted tool results twice')
  }
  return { reply: corrected.reply }
}
