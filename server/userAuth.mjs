/**
 * Bearer 认证中间件：解析 Authorization: Bearer <token>，查 userStore，挂 req.user
 *
 * 失败一律 401 'invalid credentials'（与登录失败同口径，防枚举）
 */
import { send } from './auth.mjs'

export function requireUser(userStore) {
  return function check(req, res, next) {
    const header = req.headers.authorization ?? ''
    const m = /^Bearer\s+(.+)$/.exec(header.trim())
    const token = m?.[1]?.trim() ?? ''
    const user = token ? userStore.getByToken(token) : null
    if (!user) {
      send(res, 401, { ok: false, error: 'invalid credentials' })
      return
    }
    req.user = { username: user.username }
    req._authToken = token
    next()
  }
}