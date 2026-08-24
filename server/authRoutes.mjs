/**
 * 认证路由：/api/auth/register, /api/auth/login, /api/auth/logout, /api/auth/me
 *
 * 安全要点：
 *   - 密码用 scrypt (N=16384, r=8, p=1) 哈希 + 16 字节 salt
 *   - 登录失败一律 401 'invalid credentials'，不区分用户名错/密码错（防枚举）
 *   - 用户名存在但密码错时，scrypt 仍跑（用 dummy hash 保持时长一致）
 *   - token 32 字节随机 hex；登录成功重新生成（token rotation）
 *   - /api/auth/* 走 rateLimit（IP-based）
 */
import { scryptSync, randomBytes, timingSafeEqual } from 'node:crypto'
import { send } from './auth.mjs'
import { genToken, isValidUsername } from './users.mjs'

const SCRYPT_KEYLEN = 64
// Node scrypt 默认 N=16384, r=8, p=1（不传 options 走默认）
const SCRYPT_OPTS = { N: 16384, r: 8, p: 1 }

/** 16 字节 salt → hex */
export function genSalt() {
  return randomBytes(16).toString('hex')
}

/** 同步 scrypt 哈希；返回 hex */
export function hashPassword(password, saltHex) {
  const salt = Buffer.from(saltHex, 'hex')
  return scryptSync(password, salt, SCRYPT_KEYLEN, SCRYPT_OPTS).toString('hex')
}

/** 时序安全比较两个 hex hash */
function safeEqualHex(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false
  if (a.length !== b.length) return false
  return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'))
}

/** 通用读 body（4MB cap），与 routes.mjs 一致 */
async function readJsonBody(req, maxBytes = 4 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > maxBytes) {
        reject(new Error('payload too large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8')
      if (!raw) return resolve({})
      try {
        resolve(JSON.parse(raw))
      } catch {
        reject(new Error('invalid json'))
      }
    })
    req.on('error', reject)
  })
}

/**
 * 简单 IP 限流：每个 ip 每分钟 N 次
 * 返回 true 表示「已超限」
 */
export function makeRateLimiter(perMin) {
  const buckets = new Map() // ip → { count, resetAt }
  const WINDOW_MS = 60_000
  return function rateLimit(ip) {
    const now = Date.now()
    const b = buckets.get(ip)
    if (!b || b.resetAt <= now) {
      buckets.set(ip, { count: 1, resetAt: now + WINDOW_MS })
      return false
    }
    b.count += 1
    if (b.count > perMin) return true
    return false
  }
}

/** dummy hash 用于登录失败时等长 scrypt 计算（防时序枚举） */
const DUMMY_SALT = '00'.repeat(16)
const DUMMY_HASH = hashPassword('__not_a_real_password__', DUMMY_SALT)

export function makeAuthRoutes({ userStore, rateLimitPerMin }) {
  const rateLimit = makeRateLimiter(rateLimitPerMin)

  function clientIp(req) {
    return (
      req.headers['x-forwarded-for']?.toString().split(',')[0].trim() ||
      req.socket.remoteAddress ||
      'unknown'
    )
  }

  async function readBody(req) {
    try {
      return await readJsonBody(req)
    } catch (e) {
      send(req.res, 400, { ok: false, error: String(e.message ?? e) })
      return null
    }
  }

  return {
    /** POST /api/auth/register */
    async register(req, res) {
      if (rateLimit(clientIp(req))) {
        send(res, 429, { ok: false, error: 'too many attempts' })
        return
      }
      const body = await readBody(req)
      if (!body) return
      const { username, password, inviteCode } = body ?? {}

      if (!isValidUsername(username) || typeof password !== 'string' || password.length < 8) {
        send(res, 400, { ok: false, error: 'invalid input' })
        return
      }

      // 邀请码校验（如配置）
      const expected = process.env.INVITE_CODE ?? ''
      if (expected.length > 0 && inviteCode !== expected) {
        // 不区分「邀请码错」与「用户名冲突」—— 一律 invalid credentials
        send(res, 401, { ok: false, error: 'invalid credentials' })
        return
      }

      if (userStore.has(username)) {
        send(res, 401, { ok: false, error: 'invalid credentials' })
        return
      }

      const saltHex = genSalt()
      const pwHashHex = hashPassword(password, saltHex)
      const result = await userStore.create({ username, pwHashHex, saltHex })
      if (!result.ok) {
        send(res, 401, { ok: false, error: 'invalid credentials' })
        return
      }
      const tokenHex = genToken()
      await userStore.setToken(username, tokenHex)

      // 注册成功后立刻为该用户写一份空快照（确保后续 push 写入路径已存在）
      const empty = await userStore.loadUserSnapshot(username)
      await userStore.saveUserSnapshot(username, empty)

      send(res, 200, {
        ok: true,
        data: { user: { username }, token: tokenHex },
      })
    },

    /** POST /api/auth/login */
    async login(req, res) {
      if (rateLimit(clientIp(req))) {
        send(res, 429, { ok: false, error: 'too many attempts' })
        return
      }
      const body = await readBody(req)
      if (!body) return
      const { username, password } = body ?? {}

      if (!isValidUsername(username) || typeof password !== 'string') {
        send(res, 401, { ok: false, error: 'invalid credentials' })
        return
      }

      const u = userStore.get(username)
      // 即使用户名不存在，scrypt 仍跑（dummy）以保持时长一致
      const saltHex = u?.saltHex ?? DUMMY_SALT
      const wantHash = u?.pwHashHex ?? DUMMY_HASH
      const gotHash = hashPassword(password, saltHex)
      if (!u || !safeEqualHex(gotHash, wantHash)) {
        send(res, 401, { ok: false, error: 'invalid credentials' })
        return
      }

      // token rotation
      const tokenHex = genToken()
      await userStore.setToken(username, tokenHex)
      send(res, 200, {
        ok: true,
        data: { user: { username }, token: tokenHex },
      })
    },

    /** POST /api/auth/logout（清掉该 token） */
    async logout(req, res) {
      // requireUser 已挂好 req.user；token 在 Authorization header 里
      const tokenHex = req._authToken
      if (tokenHex) await userStore.clearToken(tokenHex)
      send(res, 204, '')
    },

    /** GET /api/auth/me */
    async me(req, res) {
      send(res, 200, {
        ok: true,
        data: { user: { username: req.user.username } },
      })
    },
  }
}