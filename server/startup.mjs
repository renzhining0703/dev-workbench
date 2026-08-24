/**
 * 启动钩子：首启自动迁移 + bootstrap 账户
 *
 * 执行条件：users 表为空（= 数据库是新库）。已有用户则什么都不做。
 *   1. v1 JSON 后端数据（data/users.json + data/users/*.json）→ 自动导入 SQLite
 *   2. 更早期单 token 的 store.json（LEGACY_STORE_FILE）→ 导入为 BOOTSTRAP_USER 的快照
 *   3. 仅配置 BOOTSTRAP_USER → 建号；随机密码写入 <DATA_DIR>bootstrap-password.txt（0600）
 *      —— v1 把密码打进 pm2 日志，这里改为落文件，日志只提示路径
 *
 * 失败兜底：迁移失败打印错误但不阻止启动（与 v1 一致，让用户登录后自行决定恢复）。
 */
import { existsSync, readFileSync, writeFileSync, chmodSync } from 'node:fs'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { genSalt, hashPassword } from './lib/password.mjs'
import { importLegacyJson } from './migrate.mjs'

/**
 * @param {object} deps
 * @param {ReturnType<typeof import('./config.mjs').loadConfig>} deps.config
 * @param {import('node:sqlite').DatabaseSync} deps.db
 * @param {import('./store/users.mjs').UserStore} deps.userStore
 * @param {import('./store/sessions.mjs').SessionStore} deps.sessionStore
 * @param {import('./store/snapshots.mjs').SnapshotStore} deps.snapshotStore
 */
export function runStartup({ config, db, userStore, sessionStore, snapshotStore }) {
  if (userStore.count() > 0) {
    console.log(`[startup] ${userStore.count()} user(s) already exist; skipping migration`)
    return
  }

  // 1. v1 JSON 后端数据自动导入
  if (existsSync(config.legacyUsersFile)) {
    try {
      const report = importLegacyJson({
        db,
        usersFile: config.legacyUsersFile,
        userDataDir: config.legacyUserDataDir,
        userStore,
        sessionStore,
        snapshotStore,
      })
      console.log(
        `[startup] [migration] v1 JSON → SQLite: ${report.users} users, ` +
          `${report.snapshots} snapshots, ${report.sessions} sessions` +
          (report.skipped.length ? `, skipped: ${report.skipped.join(', ')}` : ''),
      )
      console.log(
        `[startup] [migration] 旧 JSON 文件保留在原位（${config.legacyUsersFile}），确认无误后可手动删除`,
      )
      return
    } catch (e) {
      console.error('[startup] [migration] FAILED:', e)
      return // 不阻止启动
    }
  }

  const bootstrapUser = config.bootstrapUser
  if (!bootstrapUser) return

  // 2. 更早期单 token store.json → bootstrap 用户的快照
  if (config.legacyStoreFile && existsSync(config.legacyStoreFile)) {
    try {
      snapshotStore.set(bootstrapUser, JSON.parse(readFileSync(config.legacyStoreFile, 'utf8')))
      console.log(`[startup] [migration] imported legacy store.json → snapshot of "${bootstrapUser}"`)
    } catch (e) {
      console.error('[startup] [migration] FAILED:', e)
    }
  }

  // 3. 建号；密码落文件（不再打进日志）
  if (!userStore.has(bootstrapUser)) {
    try {
      const password = randomBytes(12).toString('base64url')
      const saltHex = genSalt()
      const pwHashHex = hashPassword(password, saltHex)
      userStore.create({ username: bootstrapUser, pwHashHex, saltHex })
      snapshotStore.ensure(bootstrapUser)

      const pwFile = join(config.dataDir, 'bootstrap-password.txt')
      writeFileSync(pwFile, `${bootstrapUser}: ${password}\n`, { mode: 0o600 })
      chmodSync(pwFile, 0o600)
      console.log(`[startup] [bootstrap] created user "${bootstrapUser}"`)
      console.log(`[startup] [bootstrap] 密码已写入 ${pwFile}（0600，仅本机可读），读取后请删除该文件`)
    } catch (e) {
      console.error('[startup] [bootstrap] FAILED:', e)
    }
  }
}
