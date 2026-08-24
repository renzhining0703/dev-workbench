/**
 * 认证 HTTP 客户端
 *
 * 调用 /api/auth/{register,login,logout,me,config,change-password,reset-password}
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

  /**
   * 注册页探测：服务端是否要求邀请码。
   * 探测失败按「不要求」处理（提交时服务端仍会校验，只是错误提示晚一步）。
   */
  async config(): Promise<{ inviteRequired: boolean }> {
    try {
      const res = await fetch(`${SYNC_API}/auth/config`, { credentials: 'omit' })
      if (!res.ok) return { inviteRequired: false }
      const json = await readJson(res)
      if (!json.ok || !json.data) return { inviteRequired: false }
      return { inviteRequired: Boolean((json.data as { inviteRequired?: boolean }).inviteRequired) }
    } catch {
      return { inviteRequired: false }
    }
  },

  /** 登录态修改密码（204 成功；401 旧密码错误；429 限流） */
  async changePassword(token: string, args: { currentPassword: string; newPassword: string }): Promise<void> {
    const res = await fetch(`${SYNC_API}/auth/change-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      credentials: 'omit',
      body: JSON.stringify(args),
    })
    if (res.ok) return
    if (res.status === 429) throw new AuthError('too many attempts', 429, true)
    const json = await readJson(res)
    throw new AuthError(json.error ?? `http ${res.status}`, res.status)
  },

  /** 忘记密码重置（需要服务端配置邀请码；403 = 服务端未开启该通道） */
  async resetPassword(args: { username: string; inviteCode: string; newPassword: string }): Promise<void> {
    const res = await fetch(`${SYNC_API}/auth/reset-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'omit',
      body: JSON.stringify(args),
    })
    if (res.ok) return
    if (res.status === 429) throw new AuthError('too many attempts', 429, true)
    const json = await readJson(res)
    throw new AuthError(json.error ?? `http ${res.status}`, res.status)
  },
}

export type Session = AuthSession