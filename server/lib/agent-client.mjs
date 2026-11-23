/**
 * OpenClaw agent CLI 调用客户端
 *
 * 通过本机 openclaw CLI 跑一个 agent turn（CLI 自己连 gateway loopback），
 * 工作台后端不直连 gateway 端口，gateway 也不对外网暴露。
 */
import { spawn } from 'node:child_process'
import { writeFile, unlink } from 'node:fs/promises'
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

/** 跑一个 agent turn，返回 { reply }；会话键决定历史延续 */
export async function runAgentTurn({ message, sessionKey, timeoutMs, openclawBin, pathPrefix }) {
  const msgFile = join(tmpdir(), `wb-msg-${randomBytes(8).toString('hex')}.txt`)
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
  return new Promise((resolve, reject) => {
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
    child.stdout.on('data', (d) => {
      stdout += d
    })
    child.stderr.on('data', (d) => {
      stderr += d
    })
    child.on('error', (err) => {
      clearTimeout(timer)
      reject(new AgentUnavailableError(`agent spawn failed: ${err.code ?? err.message}`))
    })
    child.on('close', () => {
      clearTimeout(timer)
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
      resolve({ reply })
    })
  })
}
