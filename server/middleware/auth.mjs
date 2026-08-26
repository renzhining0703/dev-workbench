/**
 * Bearer 认证中间件
 *
 * 失败一律 401 'invalid credentials'（与登录失败同口径，防枚举）——语义自 v1 userAuth.mjs 平移。
 * 校验方式：token 的 SHA-256 查 sessions 表主键（替代 v1 的 O(n) 明文扫描）。
 * 鉴权通过后从 users 表带出 nickname（不存在时回退 username），挂在 req.user 上供路由直接使用。
 */

export function requireAuth({ sessions, userStore }) {
  return function check(req, res, next) {
    const header = req.headers.authorization ?? ''
    const m = /^Bearer\s+(.+)$/.exec(header.trim())
    const token = m?.[1]?.trim() ?? ''
    const user = token ? sessions.lookup(token) : null
    if (!user) {
      return res.status(401).json({ ok: false, error: 'invalid credentials' })
    }
    const u = userStore ? userStore.get(user.username) : null
    req.user = {
      username: user.username,
      nickname: u?.nickname || user.username,
    }
    req.authToken = token // logout 需要原始 token（v1 的 req._authToken）
    next()
  }
}
