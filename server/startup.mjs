/**
 * 启动钩子：迁移旧 store.json + 自动建 bootstrap 账户
 *
 * 启动时执行一次：
 *   1. 若 data/users.json 不存在（首次启动新版本）：
 *      a. 若 data/store.json 存在 且 BOOTSTRAP_USER 已配置 → mv 到 data/users/<bootstrap>.json
 *      b. 若 BOOTSTRAP_USER 已配置 → 自动创建该账户并打印随机密码到 stdout
 *   2. 否则什么都不做（已存在的部署不做任何迁移）
 *
 * 失败兜底：迁移失败打印错误但不阻止启动（让用户登录后看到空数据，自己决定恢复）
 */
import { existsSync, renameSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { genSalt, hashPassword } from './authRoutes.mjs'

export async function runStartup({ config, userStore }) {
  const bootstrapUser = (process.env.BOOTSTRAP_USER ?? '').trim()
  const oldStoreFile = (process.env.LEGACY_STORE_FILE ?? '').trim()
  const users = userStore.list()

  // 已有用户 → 什么都不做
  if (users.length > 0) {
    console.log(`[startup] ${users.length} user(s) already exist; skipping migration`)
    return
  }

  // 1. 迁移旧 store.json
  if (oldStoreFile && existsSync(oldStoreFile) && bootstrapUser) {
    try {
      const targetFile = userStore.userSnapshotFile(bootstrapUser)
      if (!existsSync(targetFile)) {
        renameSync(oldStoreFile, targetFile)
        console.log(
          `[startup] [migration] moved ${oldStoreFile} → ${targetFile}`,
        )
      } else {
        console.log(
          `[startup] [migration] target already exists, leaving ${oldStoreFile} in place: ${targetFile}`,
        )
      }
    } catch (e) {
      console.error('[startup] [migration] FAILED:', e)
    }
  }

  // 2. 自动创建 BOOTSTRAP_USER（如配置）
  if (bootstrapUser && !userStore.has(bootstrapUser)) {
    try {
      const password = randomBytes(12).toString('base64url')
      const saltHex = genSalt()
      const pwHashHex = hashPassword(password, saltHex)
      await userStore.create({ username: bootstrapUser, pwHashHex, saltHex })
      console.log(
        `[startup] [bootstrap] created user "${bootstrapUser}" with password: ${password}`,
      )
      console.log(
        '[startup] [bootstrap] ⚠️  save this password NOW — it will not be shown again',
      )
    } catch (e) {
      console.error('[startup] [bootstrap] FAILED:', e)
    }
  }
}