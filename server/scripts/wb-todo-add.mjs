import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { loadServerEnv, loadConfig } from '../config.mjs'
import { openDatabase } from '../db.mjs'
import { SnapshotStore } from '../store/snapshots.mjs'

// ---- 参数解析 ----
const args = process.argv.slice(2)
function getFlag(name) {
  const i = args.indexOf(`--${name}`)
  return i !== -1 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : null
}
function getMulti(name) {
  const out = []
  for (let i = 0; i < args.length; i++) {
    if (args[i] === `--${name}` && args[i + 1]) out.push(args[i + 1])
  }
  return out
}

// ---- 校验 ----
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const PRIORITY_ENUM = new Set(['low', 'normal', 'high'])
const MAX_TASKS = 50

function fail(msg) {
  console.error(msg)
  process.exit(1)
}

const env = loadServerEnv()
const cfg = loadConfig(env)
const db = openDatabase(cfg.dbFile)
const store = new SnapshotStore(db)

const username = (getFlag('user') ?? (env.PASSWORD_USER ?? 'renzhining')).trim()

// ③ user 必须先存在，否则 exit 1（避免 update 静默建孤儿快照）
const userRow = db.prepare('SELECT username FROM users WHERE username = ?').get(username)
if (!userRow) {
  db.close()
  fail(`用户不存在：${username}（先查 users 表，未注册的用户不允许写入）`)
}

const today = new Date()
const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
const date = getFlag('date') ?? todayStr
const prefix = getFlag('prefix') ?? ''
const priority = getFlag('priority') ?? 'normal'

// ⑥ date 正则 + priority 枚举校验
if (!DATE_RE.test(date)) {
  db.close()
  fail(`date 格式非法：${date}（需 YYYY-MM-DD）`)
}
if (!PRIORITY_ENUM.has(priority)) {
  db.close()
  fail(`priority 非法：${priority}（需 low|normal|high）`)
}

// ---- 收集待办内容：--task 多值 + stdin 每行 ----
let tasks = getMulti('task').map((t) => t.trim()).filter(Boolean)
if (!process.stdin.isTTY) {
  const buf = readFileSync(0, 'utf8')
  tasks = tasks.concat(buf.split('\n').map((l) => l.trim()).filter(Boolean))
}

// ⑤ 上限 50 条
if (tasks.length === 0) {
  db.close()
  fail('未提供任何待办内容（用 --task 或 stdin 传入）')
}
if (tasks.length > MAX_TASKS) {
  db.close()
  fail(`任务数 ${tasks.length} 超过上限 ${MAX_TASKS}`)
}

// ---- 幂等查重 + 事务写入 ----
const nowIso = new Date().toISOString()
let addedCount = 0
let skippedCount = 0

store.update(username, (remote) => {
  const todos = Array.isArray(remote.todos) ? remote.todos : []

  // ① 只比对活跃条目（无 deletedAt），按 user+date+content(去前缀) 查重
  const seen = new Set(
    todos
      .filter((t) => !t.deletedAt)
      .map((t) => `${t.date}|${t.content}`)
  )
  const toAdd = []
  for (const raw of tasks) {
    const content = prefix ? `${prefix}${raw}` : raw
    const key = `${date}|${content}`
    if (seen.has(key)) {
      skippedCount++
      continue
    }
    seen.add(key)
    toAdd.push({
      // ② 字段写全：randomUUID + done + createdAt + updatedAt（updatedAt 是 LWW 合并键）
      id: randomUUID(),
      content,
      date,
      done: false,
      createdAt: nowIso,
      updatedAt: nowIso,
      priority,
    })
  }
  addedCount = toAdd.length
  // ④ 直接用 { ...remote, todos: [...remote.todos, ...new] } 扩展，不重组快照
  return { ...remote, todos: [...todos, ...toAdd] }
})

db.close()
console.log(`新增 ${addedCount} / 跳过 ${skippedCount}（user=${username}, date=${date}, priority=${priority}）`)
