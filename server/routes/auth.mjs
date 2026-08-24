/**
 * 认证路由：POST /register /login /logout, GET /me
 *
 * 安全语义自 v1 authRoutes.mjs 逐条平移：
 *   - 登录/注册失败一律 401 'invalid credentials'，不区分具体原因（防枚举）
 *   - 用户名不存在时 scrypt 仍跑（dummy hash 保持时长一致）
 *   - 密码比较 timingSafeEqual；token 32 字节随机 hex；登录即轮换（单会话互踢）
 *   - register / login 走 express-rate-limit（按 IP，经 nginx 反代由 trust proxy 还原）
 */
import { Router } from 'express'
import rateLimit from 'express-rate-limit'
import { isValidUsername } from '../store/users.mjs'
import {
  genSalt,
  hashPassword,
  safeEqualHex,
  DUMMY_SALT,
  DUMMY_HASH,
} from '../lib/password.mjs'
import { genToken } from '../lib/token.mjs'

/**
 * @param {object} deps
 * @param {import('../store/users.mjs').UserStore} deps.userStore
 * @param {import('../store/sessions.mjs').SessionStore} deps.sessionStore
 * @param {import('../store/snapshots.mjs').SnapshotStore} deps.snapshotStore
 * @param {string} deps.inviteCode 空 = 开放注册
 * @param {number} deps.rateLimitPerMin
 */
export function createAuthRouter({
  userStore,
  sessionStore,
  snapshotStore,
  inviteCode = '',
  rateLimitPerMin = 20,
  requireAuth,
}) {
  const router = Router()

  // 只挂在 register/login 上（与 v1 一致：logout/me 不计入限流）
  const authLimiter = rateLimit({
    windowMs: 60_000,
    limit: rateLimitPerMin,
    standardHeaders: false,
    legacyHeaders: false,
    handler: (_req, res) => {
      res.status(429).json({ ok: false, error: 'too many attempts' })
    },
  })

  /** POST /api/auth/register */
  router.post('/register', authLimiter, (req, res) => {
    const { username, password, inviteCode: given } = req.body ?? {}

    if (!isValidUsername(username) || typeof password !== 'string' || password.length < 8) {
      return res.status(400).json({ ok: false, error: 'invalid input' })
    }

    // 邀请码校验（如配置）；不区分「邀请码错」与「用户名冲突」——一律 invalid credentials
    if (inviteCode.length > 0 && given !== inviteCode) {
      return res.status(401).json({ ok: false, error: 'invalid credentials' })
    }
    if (userStore.has(username)) {
      return res.status(401).json({ ok: false, error: 'invalid credentials' })
    }

    const saltHex = genSalt()
    const pwHashHex = hashPassword(password, saltHex)
    const result = userStore.create({ username, pwHashHex, saltHex })
    if (!result.ok) {
      return res.status(401).json({ ok: false, error: 'invalid credentials' })
    }

    const token = sessionStore.issue(username)
    userStore.touch(username)
    // 注册成功后确保快照行存在（对应 v1 注册后写空快照文件）
    snapshotStore.ensure(username)

    return res.status(200).json({
      ok: true,
      data: { user: { username }, token },
    })
  })

  /** POST /api/auth/login */
  router.post('/login', authLimiter, (req, res) => {
    const { username, password } = req.body ?? {}

    if (!isValidUsername(username) || typeof password !== 'string') {
      return res.status(401).json({ ok: false, error: 'invalid credentials' })
    }

    const u = userStore.get(username)
    // 即使用户名不存在，scrypt 仍跑（dummy）以保持时长一致
    const saltHex = u?.saltHex ?? DUMMY_SALT
    const wantHash = u?.pwHashHex ?? DUMMY_HASH
    const gotHash = hashPassword(password, saltHex)
    if (!u || !safeEqualHex(gotHash, wantHash)) {
      return res.status(401).json({ ok: false, error: 'invalid credentials' })
    }

    // token rotation（单会话互踢：删旧插新）
    const token = sessionStore.issue(username)
    userStore.touch(username)
    return res.status(200).json({
      ok: true,
      data: { user: { username }, token },
    })
  })

  /** POST /api/auth/logout（鉴权后清掉该 token） */
  router.post('/logout', requireAuth, (req, res) => {
    if (req.authToken) sessionStore.revoke(req.authToken)
    res.status(204).end()
  })

  /** GET /api/auth/me */
  router.get('/me', requireAuth, (req, res) => {
    res.status(200).json({
      ok: true,
      data: { user: { username: req.user.username } },
    })
  })

  return router
}
