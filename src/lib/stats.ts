import {
  startOfWeek,
  endOfWeek,
  startOfMonth,
  endOfMonth,
  format,
  parseISO,
  isWithinInterval,
  subMonths,
  differenceInDays,
} from 'date-fns'
import { zhCN } from 'date-fns/locale'
import type { Requirement, RequirementStatus } from '../types'
import { STATUS_FLOW } from '../types'

/** 当前 yyyy-MM */
export function currentMonth(now = new Date()): string {
  return format(now, 'yyyy-MM')
}

/** 当前 yyyy */
export function currentYear(now = new Date()): string {
  return format(now, 'yyyy')
}

/** 当前周起止（周一~周日） */
export function getCurrentWeekRange(now = new Date()) {
  return {
    start: startOfWeek(now, { weekStartsOn: 1 }),
    end: endOfWeek(now, { weekStartsOn: 1 }),
  }
}

/** 当前月起止 */
export function getCurrentMonthRange(now = new Date()) {
  return { start: startOfMonth(now), end: endOfMonth(now) }
}

/** 按 createdAt 落在 yyyy-MM 过滤 */
export function filterByMonth(items: Requirement[], yyyymm: string): Requirement[] {
  return items.filter((r) => (r.createdAt || '').slice(0, 7) === yyyymm)
}

/** 按 createdAt 落在 yyyy 过滤 */
export function filterByYear(items: Requirement[], yyyy: string): Requirement[] {
  return items.filter((r) => (r.createdAt || '').slice(0, 4) === yyyy)
}

/** ISO 时间是否落在区间内（容错处理） */
function inRange(iso: string | null | undefined, range: { start: Date; end: Date }): boolean {
  if (!iso) return false
  try {
    return isWithinInterval(parseISO(iso), range)
  } catch {
    return false
  }
}

/** 状态分布计数（按 STATUS_FLOW 顺序，零值也保留） */
export function statusCounts(items: Requirement[]): Record<RequirementStatus, number> {
  const init = STATUS_FLOW.reduce(
    (acc, s) => ({ ...acc, [s]: 0 }),
    {} as Record<RequirementStatus, number>,
  )
  for (const r of items) init[r.status] += 1
  return init
}

/** 已上线需求的开发周期（创建→上线天数）列表 */
export function devCycles(items: Requirement[]): number[] {
  return items
    .filter((r) => r.status === 'published' && r.publishTime)
    .map((r) => differenceInDays(parseISO(r.publishTime!), parseISO(r.createdAt)))
}

/** 平均开发周期（天），保留 1 位小数；样本为 0 时返回 0 */
export function avgDevCycle(items: Requirement[]): number {
  const cycles = devCycles(items)
  if (cycles.length === 0) return 0
  const raw = cycles.reduce((a, b) => a + b, 0) / cycles.length
  return Math.round(raw * 10) / 10
}

/** 最近 6 个月每月上线数 */
export function last6MonthsPublished(
  items: Requirement[],
  now = new Date(),
): { label: string; count: number }[] {
  const result: { label: string; count: number }[] = []
  for (let i = 5; i >= 0; i--) {
    const m = subMonths(now, i)
    const yyyymm = format(m, 'yyyy-MM')
    const label = format(m, 'M月', { locale: zhCN })
    const count = items.filter(
      (r) =>
        r.status === 'published' &&
        r.publishTime &&
        r.publishTime.slice(0, 7) === yyyymm,
    ).length
    result.push({ label, count })
  }
  return result
}

/** 周报素材（可直接粘到 IM / 邮件） */
export function buildWeeklyReport(items: Requirement[]): string {
  const { start, end } = getCurrentWeekRange()
  const fmt = (d: Date) => format(d, 'M月d日')
  const weekRange = { start, end }
  const lines: string[] = []

  lines.push(`📊 周报（${fmt(start)} ~ ${fmt(end)}）`)
  lines.push('')

  const published = items.filter(
    (r) => r.status === 'published' && inRange(r.publishTime, weekRange),
  )
  const created = items.filter((r) => inRange(r.createdAt, weekRange))
  const inProgress = items.filter(
    (r) => r.status === 'developing' || r.status === 'testing',
  )
  const avgCycle = avgDevCycle(published)

  lines.push(`• 本周上线：${published.length} 个`)
  lines.push(`• 本周新增：${created.length} 个`)
  lines.push(`• 在开发/测试中：${inProgress.length} 个`)
  if (avgCycle > 0) lines.push(`• 本周上线平均周期：${avgCycle} 天`)

  if (published.length > 0) {
    lines.push('')
    lines.push('上线详情：')
    for (const r of published) lines.push(`  - ${r.name}`)
  }

  return lines.join('\n')
}

/** 月报素材（可直接粘到 IM / 邮件） */
export function buildMonthlyReport(items: Requirement[]): string {
  const monthRange = getCurrentMonthRange()
  const monthLabel = format(monthRange.start, 'yyyy年M月', { locale: zhCN })
  const lines: string[] = []

  lines.push(`📊 ${monthLabel}月报`)
  lines.push('')

  const created = items.filter((r) => inRange(r.createdAt, monthRange))
  const published = items.filter(
    (r) => r.status === 'published' && inRange(r.publishTime, monthRange),
  )
  const inProgress = items.filter(
    (r) =>
      r.status === 'developing' || r.status === 'testing' || r.status === 'ready',
  )
  const avgCycle = avgDevCycle(published)
  const completionRate =
    created.length > 0 ? Math.round((published.length / created.length) * 100) : 0

  lines.push(`• 本月新增：${created.length} 个`)
  lines.push(`• 本月上线：${published.length} 个`)
  lines.push(`• 完成率：${completionRate}%`)
  lines.push(`• 在途（开发/测试/待上线）：${inProgress.length} 个`)
  if (avgCycle > 0) lines.push(`• 上线平均周期：${avgCycle} 天`)

  // Top 3 项目（按本月新增）
  const projectCounts = new Map<string, number>()
  for (const r of created) {
    projectCounts.set(r.project, (projectCounts.get(r.project) ?? 0) + 1)
  }
  const top3 = [...projectCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
  if (top3.length > 0) {
    lines.push('')
    lines.push('项目分布 TOP3：')
    for (const [p, c] of top3) lines.push(`  - ${p}：${c} 个`)
  }

  return lines.join('\n')
}