/**
 * dev-workbench 同步服务入口
 * 监听 127.0.0.1:8787（默认），由 nginx 反代 /dev-workbench/api/ 到此
 *
 * 路由表：
 *   OPTIONS *                  → 204
 *   GET  /api/health           → public
 *   POST /api/auth/register    → public (rate-limited)
 *   POST /api/auth/login       → public (rate-limited)
 *   POST /api/auth/logout      → bearer
 *   GET  /api/auth/me          → bearer
 *   GET  /api/snapshot         → bearer, per-user
 *   POST /api/push             → bearer, per-user
 *
 * 启动：node index.mjs
 * 或 pm2 start ecosystem.config.cjs
 */
import http from 'node:http'
import { config } from './config.mjs'
import { send } from './auth.mjs'
import { requireUser } from './userAuth.mjs'
import { UserStore } from './users.mjs'
import { makeAuthRoutes } from './authRoutes.mjs'
import { makeRoutes } from './routes.mjs'
import { runStartup } from './startup.mjs'

const userStore = new UserStore({
  usersFile: config.usersFile,
  userDataDir: config.userDataDir,
})
const authRoutes = makeAuthRoutes({
  userStore,
  rateLimitPerMin: config.rateLimitPerMin,
})
const routes = makeRoutes({ userStore })
const requireBearer = requireUser(userStore)

const server = http.createServer(async (req, res) => {
  // CORS 头（只回显白名单 origin，不带 credentials——前端 fetch 用 omit）
  const origin = req.headers.origin
  if (origin && config.allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin)
    res.setHeader('Vary', 'Origin')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  }

  // OPTIONS 预检直接 204
  if (req.method === 'OPTIONS') {
    send(res, 204, '')
    return
  }

  const url = new URL(req.url, `http://${req.headers.host ?? 'localhost'}`)
  const pathname = url.pathname

  try {
    // 公开路由
    if (req.method === 'GET' && pathname === '/api/health') {
      await routes.health(req, res)
      return
    }
    if (req.method === 'POST' && pathname === '/api/auth/register') {
      await authRoutes.register(req, res)
      return
    }
    if (req.method === 'POST' && pathname === '/api/auth/login') {
      await authRoutes.login(req, res)
      return
    }

    // 鉴权路由
    if (req.method === 'POST' && pathname === '/api/auth/logout') {
      requireBearer(req, res, () => authRoutes.logout(req, res))
      return
    }
    if (req.method === 'GET' && pathname === '/api/auth/me') {
      requireBearer(req, res, () => authRoutes.me(req, res))
      return
    }
    if (req.method === 'GET' && pathname === '/api/snapshot') {
      requireBearer(req, res, () => routes.snapshot(req, res))
      return
    }
    if (req.method === 'POST' && pathname === '/api/push') {
      requireBearer(req, res, () => routes.push(req, res))
      return
    }
    send(res, 404, { ok: false, error: 'not found' })
  } catch (e) {
    console.error('[server] handler error:', e)
    send(res, 500, { ok: false, error: String(e.message ?? e) })
  }
})

async function main() {
  await userStore.loadList()

  server.listen(config.port, config.host, async () => {
    // 启动钩子放在 listen 成功之后；这样端口冲突不会留下半初始化的用户表
    try {
      await runStartup({ config, userStore })
    } catch (e) {
      console.error('[startup] hook failed:', e)
    }
    console.log(
      `[dev-workbench-sync] listening on http://${config.host}:${config.port}`,
    )
    console.log(`[dev-workbench-sync] users file: ${config.usersFile}`)
    console.log(`[dev-workbench-sync] user data dir: ${config.userDataDir}`)
    console.log(`[dev-workbench-sync] allowed origins:`, config.allowedOrigins)
    console.log(`[dev-workbench-sync] auth: invite=${process.env.INVITE_CODE ? 'required' : 'open'}`)
  })
}

// 优雅关闭（pm2 reload 友好）
function shutdown() {
  console.log('[dev-workbench-sync] shutting down...')
  server.close(() => process.exit(0))
  setTimeout(() => process.exit(1), 5000).unref()
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)

main().catch((e) => {
  console.error('[dev-workbench-sync] fatal startup error:', e)
  process.exit(1)
})