#!/usr/bin/env node
/**
 * v1 JSON → v2 SQLite 手动迁移脚本（幂等，可反复执行）
 *
 * 用法（在 server/ 目录下）：
 *   node scripts/migrate-json-to-sqlite.mjs                 # dry-run：临时库试迁移 + 校验，不碰真实库
 *   node scripts/migrate-json-to-sqlite.mjs --apply         # 写入真实 DB_FILE
 *   DB_FILE=/path/x.db DATA_DIR=/path/data node scripts/... # 指定位置
 *
 * 安全设计：
 *   - 已存在于库中的用户自动跳过（增量幂等）
 *   - 写入后逐字段校验（用户哈希/盐、快照逐字节对比、会话），不一致即报错退出
 *   - v1 JSON 文件永不删除，确认无误后手动清理
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadConfig } from '../config.mjs'
import { openDatabase } from '../db.mjs'
import { UserStore } from '../store/users.mjs'
import { SessionStore } from '../store/sessions.mjs'
import { SnapshotStore } from '../store/snapshots.mjs'
import { importLegacyJson, verifyImport } from '../migrate.mjs'

const APPLY = process.argv.includes('--apply')
const config = loadConfig()

console.log(`[migrate] mode: ${APPLY ? 'APPLY（写入真实库）' : 'DRY-RUN（临时库试迁移）'}`)
console.log(`[migrate] users.json: ${config.legacyUsersFile}`)
console.log(`[migrate] target db:  ${config.dbFile}`)

if (!APPLY) {
  // dry-run：临时目录建库 → 导入 → 校验 → 删除
  const tmp = mkdtempSync(join(tmpdir(), 'sync-migrate-'))
  const dbFile = join(tmp, 'dry.db')
  try {
    const { ok, problems } = runOne(dbFile)
    report(ok, problems)
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
} else {
  const { ok, problems } = runOne(config.dbFile)
  report(ok, problems)
}

function runOne(dbFile) {
  const db = openDatabase(dbFile)
  const userStore = new UserStore(db)
  const sessionStore = new SessionStore(db)
  const snapshotStore = new SnapshotStore(db)

  const existing = userStore.count()
  if (existing > 0) {
    console.log(`[migrate] 目标库已有 ${existing} 个用户，仅导入新增用户（幂等增量）`)
  }

  const report = importLegacyJson({
    db,
    usersFile: config.legacyUsersFile,
    userDataDir: config.legacyUserDataDir,
    userStore,
    sessionStore,
    snapshotStore,
  })
  console.log(
    `[migrate] imported: ${report.users} users, ${report.snapshots} snapshots, ${report.sessions} sessions` +
      (report.already ? `, already-in-db: ${report.already}` : '') +
      (report.skipped.length ? `, skipped: ${report.skipped.join(', ')}` : ''),
  )

  const v = verifyImport({
    db,
    usersFile: config.legacyUsersFile,
    userDataDir: config.legacyUserDataDir,
  })
  db.close()
  return v
}

function report(ok, problems) {
  if (ok) {
    console.log('[migrate] 校验通过：用户哈希/盐、快照、会话全部一致 ✓')
    if (!APPLY) console.log('[migrate] dry-run 通过。加 --apply 执行真实迁移。')
    else console.log('[migrate] 迁移完成。v1 JSON 文件保留原位，确认服务正常后可手动删除。')
    process.exit(0)
  }
  console.error('[migrate] 校验失败，问题清单：')
  for (const p of problems) console.error(`  - ${p}`)
  console.error('[migrate] 中止。' + (APPLY ? '目标库可能处于半迁移状态——可重跑脚本（幂等）或回滚。' : '未写入真实库。'))
  process.exit(1)
}
