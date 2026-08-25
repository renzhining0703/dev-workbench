/**
 * SQLite 每日自动备份（保留最近 N 份，超期自动清理）
 *
 * 用法：node --no-warnings scripts/backup-db.mjs
 * 定时：pm2 按 ecosystem.config.cjs 的 cron 每天 03:17 触发
 *       （autorestart:false —— 跑完即退，pm2 不重启，到点再起一次）。
 * 手动：ssh 上服务器后 `cd /var/www/dev-workbench-sync && node scripts/backup-db.mjs`
 *
 * 备份方式：VACUUM INTO —— 生成一份事务一致的全量快照（含 WAL 中已提交数据），
 *           不需要额外 checkpoint，也不会长时间锁住主连接的写操作；
 *           目标文件必须不存在（脚本用 时间戳 命名，天然不冲突）。
 *
 * 保留策略：RETENTION_DAYS（默认 7）天前的备份按文件名时间戳清理。
 *           只清理本脚本产生的 sync-*.db 文件，不碰其它。
 *
 * 环境变量（均可选，缺省走 config.mjs）：
 *   BACKUP_DIR             备份目录（默认 <dataDir>/backups/）
 *   BACKUP_RETENTION_DAYS  保留天数（默认 7）
 *   DATA_DIR / DB_FILE     见 server/config.mjs
 */
import { DatabaseSync } from 'node:sqlite'
import { existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { loadServerEnv, loadConfig } from '../config.mjs'

const env = loadServerEnv()
const cfg = loadConfig(env)

const RETENTION_DAYS = (() => {
  const n = Number(env.BACKUP_RETENTION_DAYS ?? 7)
  return Number.isFinite(n) && n > 0 ? n : 7
})()

const BACKUP_DIR = env.BACKUP_DIR && env.BACKUP_DIR.length > 0
  ? env.BACKUP_DIR
  : join(dirname(cfg.dbFile), 'backups')

const SRC_DB = cfg.dbFile

/** 本地时区的 时间戳 文件名段：YYYYMMDD-HHMMSS */
function stamp(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0')
  return (
    d.getFullYear() +
    p(d.getMonth() + 1) +
    p(d.getDate()) +
    '-' +
    p(d.getHours()) +
    p(d.getMinutes()) +
    p(d.getSeconds())
  )
}

/** SQL 字符串字面量转义：单引号翻倍 */
function sqlQuote(s) {
  return "'" + String(s).replace(/'/g, "''") + "'"
}

/** 清理超期备份（仅匹配 sync-*.db），保留最近 RETENTION_DAYS 个 */
function pruneOldBackups(dir, keep) {
  if (!existsSync(dir)) return { kept: 0, removed: 0 }
  const re = /^sync-\d{8}-\d{6}\.db$/
  const files = readdirSync(dir).filter((f) => re.test(f)).sort().reverse()
  const toRemove = files.slice(keep)
  for (const f of toRemove) {
    try {
      unlinkSync(join(dir, f))
    } catch {
      /* 单个清理失败不阻断整体 */
    }
  }
  return { kept: files.length - toRemove.length, removed: toRemove.length }
}

function main() {
  if (!existsSync(SRC_DB)) {
    console.error(`[backup] 数据库文件不存在: ${SRC_DB}（服务可能尚未首次启动），跳过`)
    process.exit(0)
  }
  mkdirSync(BACKUP_DIR, { recursive: true })

  const dest = join(BACKUP_DIR, `sync-${stamp()}.db`)
  // VACUUM INTO 要求目标不存在；理论上 时间戳 唯一，兜底清一下
  if (existsSync(dest)) unlinkSync(dest)

  // 用独立的只读意图连接做备份，避免和主服务连接耦合
  const db = new DatabaseSync(SRC_DB, { readOnly: true })
  try {
    db.exec(`VACUUM INTO ${sqlQuote(dest)}`)
  } finally {
    db.close()
  }

  if (!existsSync(dest)) {
    console.error(`[backup] VACUUM INTO 未生成文件: ${dest}`)
    process.exit(1)
  }

  const { kept, removed } = pruneOldBackups(BACKUP_DIR, RETENTION_DAYS)
  const sizeKb = Math.max(1, Math.round((statSync(dest).size || 1) / 1024))
  console.log(
    `[backup] ✓ ${dest} (${sizeKb}KB) | 保留 ${kept} 份 | 清理 ${removed} 份 | 阈值 ${RETENTION_DAYS} 天`,
  )
}

main()
