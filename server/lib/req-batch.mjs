/**
 * 排期表批量导入需求的纯逻辑（wb-req-batch-add.mjs 消费，独立成文件便于单测）
 *
 * 输入行由机器人侧解析 xlsx 产出（日期已统一转 YYYY-MM-DD，脚本只收净数据）：
 *   { row, name, taskType, progress, owner,
 *     devStartTime, devEndTime, scheduledDone, expectedPublish, remark }
 */
import { randomUUID } from 'node:crypto'

/** 状态映射：表内「任务进度」→ 工作台 RequirementStatus；无法识别返回 null */
export function mapStatus(progress, taskType) {
  const p = (progress ?? '').trim()
  const t = (taskType ?? '').trim()
  switch (p) {
    case '待执行': return 'pending'
    case '进行中': return 'inProgress'
    case '待确认': return 'toConfirm'
    case '待上线': return 'ready'
    case '已开发待测试': return 'testing'
    case '暂停':
    case '暂时不考虑': return 'paused'
    case '': return 'notStarted'
    // 开发视角「已完成」= 已上线；设计/方案/验收/培训视角 = 已完成
    case '已完成': return /设计|方案|验收|培训/.test(t) ? 'done' : 'published'
    default: return null
  }
}

/** 负责人过滤：单元格可能是「任治宁, 李昊」多人拼串，必须包含匹配而非全等 */
export function filterByOwner(rows, ownerKeyword) {
  const kw = (ownerKeyword ?? '').trim()
  if (!kw) return { matched: [], filteredOut: rows.length }
  const matched = rows.filter((r) => (r.owner ?? '').includes(kw))
  return { matched, filteredOut: rows.length - matched.length }
}

/** 日期校验：空值归一为 null；非空必须严格 YYYY-MM-DD 且是真实日期 */
export function normalizeDate(s) {
  const v = (s ?? '').trim()
  if (!v) return null
  const m = v.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!m) return undefined
  const d = new Date(`${v}T00:00:00`)
  if (Number.isNaN(d.getTime()) || `${d.getMonth() + 1}`.padStart(2, '0') !== m[2] || `${d.getDate()}`.padStart(2, '0') !== m[3]) return undefined
  return v
}

/** 组装 remark：排期时间不落结构化字段（避免污染 devEndTime/publishTime 语义），并入备注 */
export function buildRemark({ scheduledDone, expectedPublish, remark }) {
  const parts = []
  if (scheduledDone) parts.push(`排期完成：${scheduledDone}`)
  if (expectedPublish) parts.push(`预计上线：${expectedPublish}`)
  const r = (remark ?? '').trim()
  if (r) parts.push(r)
  return parts.join('；')
}

/**
 * 导入规划：校验 + 查重，产出待写/跳过/失败三类明细（不落库）
 * @param {Array<object>} rows 机器人解析出的行
 * @param {{ owner: string, existingNames: string[], maxAdd?: number }} opts
 */
export function planImport(rows, { owner, existingNames, maxAdd = 300 }) {
  const { matched, filteredOut } = filterByOwner(rows, owner)
  // 查重口径：名称 trim + 忽略大小写后全等（中文名不受影响）
  const seen = new Set(existingNames.map((n) => n.trim().toLowerCase()))
  const added = []
  const skipped = []
  const failed = []

  for (const r of matched) {
    const name = (r.name ?? '').trim()
    const rowNo = r.row ?? '-'
    if (!name) {
      failed.push({ row: rowNo, name: '', reason: '任务名称为空' })
      continue
    }
    const status = mapStatus(r.progress, r.taskType)
    if (!status) {
      failed.push({ row: rowNo, name, reason: `无法识别的任务进度：${r.progress}` })
      continue
    }
    const devStartTime = normalizeDate(r.devStartTime)
    const devEndTime = normalizeDate(r.devEndTime)
    const scheduledDone = normalizeDate(r.scheduledDone)
    const expectedPublish = normalizeDate(r.expectedPublish)
    if (
      devStartTime === undefined || devEndTime === undefined ||
      scheduledDone === undefined || expectedPublish === undefined
    ) {
      failed.push({ row: rowNo, name, reason: '日期格式非法（需 YYYY-MM-DD，机器人负责转换）' })
      continue
    }
    const key = name.toLowerCase()
    if (seen.has(key)) {
      skipped.push({ name, reason: '工作台已存在同名需求' })
      continue
    }
    if (added.length >= maxAdd) {
      failed.push({ row: rowNo, name, reason: `超出单次写入上限 ${maxAdd} 条，剩余未处理` })
      continue
    }
    seen.add(key)
    added.push({ row: rowNo, name, status, devStartTime, devEndTime, remark: buildRemark(r) })
  }

  return { received: rows.length, ownerFilteredOut: filteredOut, added, skipped, failed }
}

/** 由规划条目构造完整 Requirement（字段写全：id/createdAt/updatedAt 是 LWW 合并键，不能缺） */
export function buildRequirement(item, nowIso) {
  return {
    id: randomUUID(),
    name: item.name,
    // 所属项目留空：排期表的项目口径与工作台项目库对不上，不自动建项目污染项目库
    project: '',
    publishModule: '',
    projects: [],
    branch: '',
    status: item.status,
    statusHistory: [{ status: item.status, at: nowIso }],
    createdAt: nowIso,
    devStartTime: item.devStartTime,
    devEndTime: item.devEndTime,
    testTime: null,
    publishTime: null,
    remark: item.remark ?? '',
    updatedAt: nowIso,
    source: 'bot',
  }
}
