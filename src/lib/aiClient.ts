/**
 * AI 面板 HTTP 客户端
 *
 * 调用 /api/ai/{context,chat}：
 * - context：发送前把「当前需求/项目/分支/选中内容」快照交给后端，换签名 context_id
 * - chat：带 context_id（可选）与正文创建后台任务，再短轮询读取小朵回复
 * 请求不再同步挂起等待模型，避免浏览器或中间网络提前断开长连接。
 * 错误统一抛 AiPanelError（message 已转成用户可读文案）。
 */
import { SYNC_API } from './syncConfig'
import type { Requirement, TodoItem } from '../types'

/** 面板随消息携带的最小化上下文（字段与服务端 minimizeContext 白名单对齐） */
export interface AiContextSnapshot {
  requirement?: {
    id: string
    name: string
    project: string
    branch: string
    status: string
    type?: string
    prdUrl?: string
    remark?: string
    projects?: { project: string; publishModule: string; publishedAt?: string | null }[]
  }
  todo?: {
    id: string
    content: string
    date: string
    done: boolean
    priority?: string
    requirementId?: string
  }
  project?: string
  branch?: string
  selection?: string
}

export class AiPanelError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

/** 读取响应文本并容错解析 JSON，非 JSON 错误页也能转成面板提示 */
async function readJson(res: Response): Promise<{ ok: boolean; data?: unknown; error?: string }> {
  const text = await res.text()
  if (!text) return { ok: res.ok }
  try {
    return JSON.parse(text)
  } catch {
    return { ok: res.ok, error: 'invalid response' }
  }
}

/** 状态码 → 面板可读文案 */
function errorText(status: number, raw?: string): string {
  if (status === 401) return '登录已过期，请重新登录'
  if (status === 403) return '无权读取该对话任务，请重新发送'
  if (status === 404) return '对话任务已失效，请重新发送'
  if (status === 429) return '发送太频繁，稍等片刻再试'
  if (status === 503) {
    if (raw === 'ai not configured') return '服务端未配置 AI 通道（env.local）'
    if (raw === 'agent reply empty') return '小朵本次未返回内容，请重新发送'
    if (raw === 'agent reply invalid') return '小朵回复未通过事实校验，请重新发送'
    return '小朵暂时不可用，稍后再试'
  }
  if (status === 504) return '小朵回复超时，请稍后再试'
  if (status === 410) return '上下文已过期，请重新发送'
  if (status === 500 || status === 502) return '服务连接暂时中断，请点击重试'
  return `请求失败（${status}）`
}

/** 发送鉴权请求并统一解析 JSON / 错误状态 */
async function request<T>(token: string, path: string, init: RequestInit): Promise<T> {
  const res = await fetch(`${SYNC_API}/ai${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...init.headers,
    },
    credentials: 'omit',
    cache: 'no-store',
  })
  const json = await readJson(res)
  if (!res.ok || !json.ok) {
    throw new AiPanelError(errorText(res.status, json.error), res.status)
  }
  return json.data as T
}

/** 提交 JSON POST 请求 */
function post<T>(token: string, path: string, body: unknown, signal?: AbortSignal): Promise<T> {
  return request<T>(token, path, { method: 'POST', body: JSON.stringify(body), signal })
}

/** 从需求对象抽取白名单字段（与后端裁剪口径一致，前端再裁一道减少传输） */
export function snapshotFromRequirement(r: Requirement): AiContextSnapshot['requirement'] {
  return {
    id: r.id,
    name: r.name,
    project: r.project,
    branch: r.branch,
    status: r.status,
    type: r.type,
    prdUrl: r.prdUrl,
    remark: r.remark,
    projects: r.projects,
  }
}

/** 从待办对象抽取白名单字段（与后端裁剪口径一致） */
export function snapshotFromTodo(t: TodoItem): AiContextSnapshot['todo'] {
  return {
    id: t.id,
    content: t.content,
    date: t.date,
    done: t.done,
    priority: t.priority,
    requirementId: t.requirementId,
  }
}

/** 签发签名上下文 id；空快照不请求，直接返回 null */
export async function createAiContext(
  token: string,
  snapshot: AiContextSnapshot,
  signal?: AbortSignal,
): Promise<{ contextId: string; expiresAt: string } | null> {
  const hasContent = Boolean(
    snapshot.requirement || snapshot.todo || snapshot.project || snapshot.branch || snapshot.selection,
  )
  if (!hasContent) return null
  return post<{ contextId: string; expiresAt: string }>(token, '/context', snapshot, signal)
}

interface AiChatJob {
  jobId: string
  status: 'running' | 'done' | 'error' | 'cancelled'
  contextId?: string
  reply?: string
  /** running 期间的执行阶段：waiting=等待模型 tooling=执行工具 composing=生成回复 */
  phase?: string
}

/** 聊天任务过程中的回调：拿到 jobId 后可取消，phase 用于状态文案 */
export interface AiChatHooks {
  onJobId?: (jobId: string) => void
  onPhase?: (phase: string) => void
}

/** 中止等待时抛出标准 AbortError，交由面板静默处理 */
function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
}

/** 创建聊天任务并短轮询结果；单次请求不再等待模型完整执行 */
export async function sendAiChat(
  token: string,
  args: { message: string; contextId?: string },
  signal?: AbortSignal,
  hooks: AiChatHooks = {},
): Promise<{ reply: string; contextId?: string }> {
  const job = await request<AiChatJob>(token, '/chat', {
    method: 'POST',
    headers: { 'X-AI-Async': '1' },
    body: JSON.stringify(args),
    signal,
  })
  hooks.onJobId?.(job.jobId)
  const deadline = Date.now() + 310000
  while (Date.now() < deadline) {
    throwIfAborted(signal)
    const current = await request<AiChatJob>(token, `/chat/jobs/${job.jobId}`, {
      method: 'GET',
      signal,
    })
    if (current.status === 'cancelled') throw new AiPanelError('用户已取消', 499)
    if (current.status === 'done') {
      if (!current.reply?.trim()) throw new AiPanelError('小朵返回了空回复，请重试', 503)
      return { reply: current.reply, contextId: current.contextId }
    }
    if (current.phase) hooks.onPhase?.(current.phase)
    await new Promise((resolve) => setTimeout(resolve, 800))
  }
  throw new AiPanelError('等待回复超时，请稍后重试', 504)
}

/** 取消运行中的聊天任务；返回服务端任务状态（cancelled / done / error 等） */
export async function cancelAiChat(token: string, jobId: string): Promise<string> {
  const data = await request<{ jobId: string; status: string }>(
    token,
    `/chat/jobs/${jobId}/cancel`,
    { method: 'POST', body: '{}' },
  )
  return data.status
}

/** 面板历史消息（与服务端同步的最小结构，本地 ChatMsg 的子集） */
export interface AiHistoryMessage {
  id: number
  role: 'user' | 'assistant'
  text: string
  ctxLabel?: string
  error?: boolean
  retryText?: string
}

export interface AiHistory {
  messages: AiHistoryMessage[]
  /** 服务端最近一次写入时间（ISO），作为跨端 LWW 基准 */
  updatedAt: string | null
}

/** 读取当前用户的面板历史（另一台设备最近的对话） */
export async function getAiHistory(token: string): Promise<AiHistory> {
  return request<AiHistory>(token, '/history', { method: 'GET' })
}

/** 覆盖保存面板历史，返回服务端写入时间 */
export async function saveAiHistory(token: string, messages: AiHistoryMessage[]): Promise<string> {
  const data = await request<{ updatedAt: string }>(token, '/history', {
    method: 'PUT',
    body: JSON.stringify({ messages }),
  })
  return data.updatedAt
}

/** 清除面板历史（清空会话时调用），返回服务端写入时间 */
export async function clearAiHistory(token: string): Promise<string> {
  const data = await request<{ updatedAt: string }>(token, '/history', { method: 'DELETE' })
  return data.updatedAt
}
