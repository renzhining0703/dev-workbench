/**
 * Express 应用工厂
 *
 * createApp(deps) 返回可独立 listen 的 app —— 测试里用 ephemeral port 起，
 * 生产由 index.mjs 起。中间件顺序（与 v1 行为对齐）：
 *   CORS(白名单回显 + OPTIONS 204) → express.json(4MB, 不看 content-type)
 *   → /api/auth → /api → 404 → 错误处理
 */
import express from 'express'
import { createAuthRouter } from './routes/auth.mjs'
import { createSyncRouter } from './routes/sync.mjs'
import { requireAuth } from './middleware/auth.mjs'

/**
 * @param {object} deps
 * @param {ReturnType<typeof import('./config.mjs').loadConfig>} deps.config
 * @param {import('./store/users.mjs').UserStore} deps.userStore
 * @param {import('./store/sessions.mjs').SessionStore} deps.sessionStore
 * @param {import('./store/snapshots.mjs').SnapshotStore} deps.snapshotStore
 */
export function createApp({ config, userStore, sessionStore, snapshotStore }) {
  const app = express()
  app.disable('x-powered-by')
  // nginx 反代一层；express-rate-limit 依赖它还原真实客户端 IP
  // （v1 手取 XFF 首段可被伪造绕过，这里是官方解法）
  app.set('trust proxy', 1)

  // ---- CORS（只回显白名单 origin，不带 credentials——前端 fetch 用 omit）----
  app.use((req, res, next) => {
    const origin = req.headers.origin
    if (origin && config.allowedOrigins.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin)
      res.setHeader('Vary', 'Origin')
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    }
    // OPTIONS 预检对任意路径一律 204（v1 行为）
    if (req.method === 'OPTIONS') {
      return res.status(204).end()
    }
    next()
  })

  // ---- body 解析：4MB 上限；不看 content-type（v1 readJsonBody 对任何 body 尝试 JSON.parse）----
  app.use(express.json({ limit: '4mb', type: () => true }))

  const auth = requireAuth({ sessions: sessionStore, userStore })
  app.use(
    '/api/auth',
    createAuthRouter({
      userStore,
      sessionStore,
      snapshotStore,
      inviteCode: config.inviteCode,
      rateLimitPerMin: config.rateLimitPerMin,
      requireAuth: auth,
    }),
  )
  app.use('/api', createSyncRouter({ snapshotStore, requireAuth: auth }))

  // ---- 404（v1：{ok:false,error:'not found'}）----
  app.use((_req, res) => {
    res.status(404).json({ ok: false, error: 'not found' })
  })

  // ---- 错误处理：body 解析错误 → 400（对齐 v1 文案）；其余 → 500 JSON ----
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    if (err?.type === 'entity.parse.failed') {
      return res.status(400).json({ ok: false, error: 'invalid json' })
    }
    if (err?.type === 'entity.too.large') {
      return res.status(400).json({ ok: false, error: 'payload too large' })
    }
    console.error('[server] handler error:', err)
    return res.status(500).json({ ok: false, error: String(err?.message ?? err) })
  })

  return app
}
