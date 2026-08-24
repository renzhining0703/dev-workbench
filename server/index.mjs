/**
 * dev-workbench 同步服务入口（v2 · Express + node:sqlite）
 *
 * 监听 127.0.0.1:8787（默认），由 nginx 反代 /dev-workbench/api/ 到此。
 * API 契约与 v1 完全一致（前端零改动）：
 *   GET  /api/health           → public
 *   POST /api/auth/register    → public (rate-limited)
 *   POST /api/auth/login       → public (rate-limited)
 *   POST /api/auth/logout      → bearer
 *   GET  /api/auth/me          → bearer
 *   GET  /api/snapshot         → bearer, per-user
 *   POST /api/push             → bearer, per-user（事务化 LWW 合并）
 *
 * 启动：node index.mjs（建议 --no-warnings 静默 node:sqlite 实验性提示）
 * 或 pm2 start ecosystem.config.cjs
 */
import { loadConfig, loadServerEnv } from './config.mjs'
import { openDatabase } from './db.mjs'
import { UserStore } from './store/users.mjs'
import { SessionStore } from './store/sessions.mjs'
import { SnapshotStore } from './store/snapshots.mjs'
import { createApp } from './app.mjs'
import { runStartup } from './startup.mjs'

const config = loadConfig(loadServerEnv())
const db = openDatabase(config.dbFile)
const userStore = new UserStore(db)
const sessionStore = new SessionStore(db)
const snapshotStore = new SnapshotStore(db)
const app = createApp({ config, userStore, sessionStore, snapshotStore })

const server = app.listen(config.port, config.host, () => {
  // 启动钩子放在 listen 成功之后；端口冲突不会留下半初始化的数据表
  try {
    runStartup({ config, db, userStore, sessionStore, snapshotStore })
  } catch (e) {
    console.error('[startup] hook failed:', e)
  }
  console.log(`[dev-workbench-sync] listening on http://${config.host}:${config.port}`)
  console.log(`[dev-workbench-sync] sqlite: ${config.dbFile}`)
  console.log(`[dev-workbench-sync] allowed origins:`, config.allowedOrigins)
  console.log(
    `[dev-workbench-sync] auth: invite=${config.inviteCode.length > 0 ? 'required' : 'open'}`,
  )
})

// 优雅关闭（pm2 reload 友好）：先停收新连接，关闭时释放 SQLite 连接
function shutdown() {
  console.log('[dev-workbench-sync] shutting down...')
  server.close(() => {
    try {
      db.close()
    } catch {
      /* 已关闭 */
    }
    process.exit(0)
  })
  setTimeout(() => {
    try {
      db.close()
    } catch {
      /* 已关闭 */
    }
    process.exit(1)
  }, 5000).unref()
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
