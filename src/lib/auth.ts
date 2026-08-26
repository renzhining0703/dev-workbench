/**
 * 认证 session 持久化（localStorage）
 *
 * - key: dev-workbench:auth
 * - shape: { user: { username, nickname }, token: string, expiresAt: number }
 *
 * 注意：localStorage 可被同源脚本读取（XSS 风险）。
 * 项目无第三方脚本 + 无 dangerouslySetInnerHTML，安全模型够用。
 */

export interface AuthUser {
  username: string
  nickname: string
}

export interface AuthSession {
  user: AuthUser
  token: string
  /** 时间戳（ms）；仅用于「保持登录」勾选后写入过期时间，到期自动失效 */
  expiresAt: number
}

const KEY = 'dev-workbench:auth'
const DEFAULT_TTL_MS = 30 * 24 * 60 * 60 * 1000 // 30 天（保持登录）

export function loadAuth(): AuthSession | null {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    const obj = JSON.parse(raw) as Partial<AuthSession>
    if (
      !obj ||
      typeof obj.token !== 'string' ||
      !obj.user?.username ||
      typeof obj.expiresAt !== 'number'
    ) {
      return null
    }
    if (obj.expiresAt > 0 && obj.expiresAt < Date.now()) {
      localStorage.removeItem(KEY)
      return null
    }
    // 旧版本 session 无 nickname → 回退 username（后端同规则），避免 UI 层判空
    return {
      ...obj,
      user: { username: obj.user.username, nickname: obj.user.nickname || obj.user.username },
    } as AuthSession
  } catch {
    return null
  }
}

export function saveAuth(session: Omit<AuthSession, 'expiresAt'>, remember: boolean): AuthSession {
  const full: AuthSession = {
    user: session.user,
    token: session.token,
    expiresAt: remember ? Date.now() + DEFAULT_TTL_MS : 0,
  }
  localStorage.setItem(KEY, JSON.stringify(full))
  return full
}

export function clearAuth() {
  localStorage.removeItem(KEY)
}