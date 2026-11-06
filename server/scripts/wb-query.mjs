/**
 * 工作台结构化数据导出（供 OpenClaw 周报/月报/日报/答疑消费）
 *
 * 用法：node --no-warnings scripts/wb-query.mjs [--user <用户名>] [--pretty]
 * 输出：stdout 一个 JSON 对象（exit 0）：
 *   {
 *     user, exportedAt,
 *     requirements: [{ id, name, project, publishModule, projects, branch, status,
 *                      statusHistory, publishTime, devStartTime, devEndTime, testTime,
 *                      remark, createdAt, updatedAt }],
 *     todos:       [{ id, content, date, done, priority, completedAt, createdAt }],
 *     projects:    [{ id, name, moduleBased, createdAt }],
 *     summary:     { requirementCount, todoOpen, todoDoneToday, ... }
 *   }
 *
 * 说明：
 *   - 只含活跃数据（墓碑条目不输出）；**密码条目绝不在此导出中**（安全边界）
 *   - statusHistory 为可选字段，2026-11 之前的老数据没有，消费方需容错
 */
import { loadServerEnv, loadConfig } from '../config.mjs'
import { openDatabase } from '../db.mjs'
import { SnapshotStore } from '../store/snapshots.mjs'

const argv = process.argv.slice(2)
const userFlagIdx = argv.indexOf('--user')
const user =
  userFlagIdx !== -1 && argv[userFlagIdx + 1] && !argv[userFlagIdx + 1].startsWith('-')
    ? argv[userFlagIdx + 1]
    : ((loadServerEnv().PASSWORD_USER ?? 'renzhining').trim())
const pretty = argv.includes('--pretty')

const env = loadServerEnv()
const cfg = loadConfig(env)
const db = openDatabase(cfg.dbFile)

try {
  const snap = new SnapshotStore(db).getNormalized(user)
  const reqs = (snap.requirements ?? []).filter((r) => !r.deletedAt)
  const todos = (snap.todos ?? []).filter((t) => !t.deletedAt)
  const projects = (snap.projects ?? []).filter((p) => !p.deletedAt)

  // summary：给周报/月报的速算字段（口径简单明确，复杂统计留给消费方）
  const today = new Date()
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
  const summary = {
    requirementCount: reqs.length,
    requirementByStatus: reqs.reduce((acc, r) => {
      acc[r.status] = (acc[r.status] ?? 0) + 1
      return acc
    }, {}),
    todoOpen: todos.filter((t) => !t.done).length,
    todoOpenToday: todos.filter((t) => !t.done && t.date === todayStr).length,
    todoDoneToday: todos.filter((t) => t.done && (t.completedAt ?? '').slice(0, 10) === todayStr).length,
  }

  const out = {
    user,
    exportedAt: new Date().toISOString(),
    requirements: reqs,
    todos,
    projects,
    summary,
  }
  console.log(JSON.stringify(out, null, pretty ? 2 : undefined))
} finally {
  db.close()
}
