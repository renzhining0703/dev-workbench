/**
 * 排期表需求批量导入工作台（供 OpenClaw 消费，两步写入的第一步由 --dry-run 承担）
 *
 * 用法：node --no-warnings scripts/wb-req-batch-add.mjs --user <用户名> --owner <负责人关键词> [--dry-run]
 *   stdin：JSON 数组（机器人解析 xlsx 后产出），每行：
 *     { row, name, taskType, progress, owner,
 *       devStartTime, devEndTime, scheduledDone, expectedPublish, remark }
 *     日期字段须为 YYYY-MM-DD 或空串（乱格式由机器人侧转换，脚本只做校验）
 *
 * 行为：
 *   - --user / --owner 必填（缺失即 ERR 退出；负责人过滤是防全量轰炸的主闸门）
 *   - 名称 trim + 忽略大小写精确匹配查重（只对活跃需求），命中即跳过
 *   - 只新增不回写：工作台已有需求的状态不会被本脚本改动
 *   - --dry-run 只出规划报告不落库，机器人先给用户预览、确认后再真跑
 * 输出：stdout 一个 JSON 报告（exit 0）
 *   { user, dryRun, owner, received, ownerFilteredOut,
 *     added: [{name,status}], skipped: [{name,reason}], failed: [{row,name,reason}] }
 */
import { readFileSync } from 'node:fs'
import { loadServerEnv, loadConfig } from '../config.mjs'
import { openDatabase } from '../db.mjs'
import { SnapshotStore } from '../store/snapshots.mjs'
import { planImport, buildRequirement } from '../lib/req-batch.mjs'

const MAX_INPUT_ROWS = 3000

function fail(msg) {
  console.error(msg)
  process.exit(1)
}

// ---- 参数解析 ----
const argv = process.argv.slice(2)
function getFlag(name) {
  const i = argv.indexOf(`--${name}`)
  return i !== -1 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : null
}

const user = (getFlag('user') ?? '').trim()
const owner = (getFlag('owner') ?? '').trim()
const dryRun = argv.includes('--dry-run')
if (!user) fail('ERR: --user required（必须显式指定用户名，禁止默认写入）')
if (!owner) fail('ERR: --owner required（必须指定负责人过滤关键词，禁止无过滤全量导入）')

// ---- stdin 收行数据 ----
let rows
try {
  rows = JSON.parse(readFileSync(0, 'utf8'))
} catch {
  fail('ERR: stdin 不是合法 JSON')
}
if (!Array.isArray(rows)) fail('ERR: stdin 须为 JSON 数组')
if (rows.length > MAX_INPUT_ROWS) fail(`ERR: 行数 ${rows.length} 超过上限 ${MAX_INPUT_ROWS}`)

const env = loadServerEnv()
const cfg = loadConfig(env)
const db = openDatabase(cfg.dbFile)

try {
  // 用户必须先存在（避免静默建孤儿快照）
  const userRow = db.prepare('SELECT username FROM users WHERE username = ?').get(user)
  if (!userRow) fail(`ERR: 用户不存在：${user}（先查 users 表，未注册的用户不允许写入）`)

  const store = new SnapshotStore(db)
  const snap = store.get(user) ?? {}
  const existingNames = (snap.requirements ?? [])
    .filter((r) => !r.deletedAt)
    .map((r) => r.name)

  const plan = planImport(rows, { owner, existingNames })

  if (!dryRun && plan.added.length > 0) {
    // 事务写入：与前端同步协议兼容（整包快照 + LWW），不动既有条目
    store.update(user, (remote) => {
      const nowIso = new Date().toISOString()
      const currentNames = new Set(
        (remote.requirements ?? []).filter((r) => !r.deletedAt).map((r) => r.name.trim().toLowerCase())
      )
      const toAdd = plan.added
        .filter((item) => !currentNames.has(item.name.toLowerCase()))
        .map((item) => buildRequirement(item, nowIso))
      return { ...remote, requirements: [...(remote.requirements ?? []), ...toAdd] }
    })
  }

  const report = {
    user,
    dryRun,
    owner,
    received: plan.received,
    ownerFilteredOut: plan.ownerFilteredOut,
    added: plan.added.map(({ name, status }) => ({ name, status })),
    skipped: plan.skipped,
    failed: plan.failed,
    summary: {
      added: plan.added.length,
      skipped: plan.skipped.length,
      failed: plan.failed.length,
      written: dryRun ? 0 : plan.added.length,
    },
  }
  console.log(JSON.stringify(report))
} finally {
  db.close()
}
