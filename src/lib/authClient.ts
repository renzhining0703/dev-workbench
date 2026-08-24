/**
 * 认证 HTTP 客户端
 *
 * 调用 /api/auth/{register,login,logout,me}
 * - 401 / 其他错误抛 AuthError（含 status + message）
 * - 成功返回 AuthSession 子集
 */
import type { AuthSession } from './auth'
import { SYNC_API } from './syncConfig'

export class AuthError extends Error {
  status: number
  retryable: boolean
  constructor(message: string, status: number, retryable = false) {
    super(message)
    this.status = status
    this.retryable = retryable
  }
}

async function readJson(res: Response): Promise<{ ok: boolean; data?: unknown; error?: string }> {
  const text = await res.text()
  if (!text) return { ok: res.ok }
  try {
    return JSON.parse(text)
  } catch {
    return { ok: res.ok, error: 'invalid response' }
  }
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${SYNC_API}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'omit',
    body: JSON.stringify(body),
  })
  const json = await readJson(res)
  if (!res.ok || !json.ok) {
    // 401 → invalid credentials (登录/注册失败)；429 → 限流
    if (res.status === 429) {
      throw new AuthError('too many attempts', 429, true)
    }
    throw new AuthError(json.error ?? `http ${res.status}`, res.status)
  }
  return json.data as T
}

export interface AuthData {
  user: { username: string }
  token: string
}

export const authApi = {
  async register(args: { username: string; password: string; inviteCode?: string }): Promise<AuthData> {
    return postJson<AuthData>('/auth/register', args)
  },
  async login(args: { username: string; password: string }): Promise<AuthData> {
    return postJson<AuthData>('/auth/login', args)
  },
  async logout(token: string): Promise<void> {
    const res = await fetch(`${SYNC_API}/auth/logout`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      credentials: 'omit',
    })
    // 204 No Content
    if (res.status !== 204 && !res.ok) {
      // logout 失败不抛 —— 前端本就要清 session
      const json = await readJson(res).catch(() => null)
      console.warn('[auth] logout failed:', json?.error ?? res.status)
    }
  },
  /** 探测当前 token 是否还有效；返回 username 或 null */
  async me(token: string): Promise<{ username: string } | null> {
    const res = await fetch(`${SYNC_API}/auth/me`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
      credentials: 'omit',
    })
    if (res.status === 401) return null
    if (!res.ok) return null
    const json = await readJson(res)
    if (!json.ok || !json.data) return null
    return (json.data as { user: { username: string } }).user
  },
}

export type Session = AuthSession