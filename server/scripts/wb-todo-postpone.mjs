/**
 * 待办过期自动顺延（供 OpenClaw 凌晨 cron 消费）
 *
 * 用法：node --no-warnings scripts/wb-todo-postpone.mjs --user <用户名> [--dry-run]
 *
 * 行为：
 *   - 扫描该用户 todos：未完成（!done）、未删除（无 deletedAt）、date 非空且 < 今天
 *   - 将其 date 顺延为今天，并刷新 updatedAt（LWW 同步要求，否则前端旧值会覆盖）
 *   - --dry-run 只出报告不落库；输出 JSON 报告（exit 0）
 *     { user, dryRun, today, scanned, count, postponed: [{id, content, from}] }
 *   - 无可顺延项时照常 exit 0、count=0（调用方据此决定是否通知）
 */
import { loadServerEnv, loadConfig } from '../config.mjs'
import { openDatabase } from '../db.mjs'
import { SnapshotStore } from '../store/snapshots.mjs'

function fail(msg) {
  console.error(msg)
  process.exit(1)
}

const argv = process.argv.slice(2)
function getFlag(name) {
  const i = argv.indexOf(`--${name}`)
  return i !== -1 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : null
}

const user = (getFlag('user') ?? '').trim()
const dryRun = argv.includes('--dry-run')
if (!user) fail('ERR: --user required（必须显式指定用户名，禁止默认写入）')

// 本地日期（不能用 toISOString：UTC 会把北京 0 点算成昨天）
function localDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const env = loadServerEnv()
const cfg = loadConfig(env)
const db = openDatabase(cfg.dbFile)

const userRow = db.prepare('SELECT username FROM users WHERE username = ?').get(user)
if (!userRow) fail(`ERR: 用户不存在：${user}`)

const store = new SnapshotStore(db)
const snap = store.get(user) ?? {}
const todos = snap.todos ?? []
const today = localDate(new Date())

const overdue = todos.filter(
  (t) => t && !t.done && !t.deletedAt && t.date && t.date < today
)

if (!dryRun && overdue.length > 0) {
  const nowIso = new Date().toISOString()
  const ids = new Set(overdue.map((t) => t.id))
  store.update(user, (remote) => {
    for (const t of remote.todos ?? []) {
      if (ids.has(t.id) && !t.done && !t.deletedAt) {
        t.date = today
        t.updatedAt = nowIso
      }
    }
    return remote
  })
}

console.log(
  JSON.stringify(
    {
      user,
      dryRun,
      today,
      scanned: todos.length,
      count: overdue.length,
      postponed: overdue.map((t) => ({ id: t.id, content: t.content, from: t.date })),
    },
    null,
    2
  )
)
