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
import { isStatusVisible, type VisibleStatuses } from './statuses'
import { isPmView } from './rolePresets'

/**
 * 统计口径视图：由状态显隐配置（视角）派生。
 *
 * - 开发视角：完成 = published（按上线时间），在途 = developing/testing/ready
 * - 产品视角：完成 = done（按上线时间，缺省取完成时间），在途 = inProgress/toConfirm
 * - 其它自定义组合：尽量沿用开发口径（published 缺失时退到 done），
 *   保证任何配置下统计页都有可解释的输出。
 */
export interface StatusView {
  /** 参与统计的状态列表（按 STATUS_FLOW 顺序） */
  flow: RequirementStatus[]
  /** 完成语义状态 */
  completedStatus: RequirementStatus
  /** 完成时间取值：上线时间优先，缺省取完成时间（产品视角） */
  completedTime: (r: Requirement) => string | null
  /** 在途状态集合 */
  inFlightStatuses: RequirementStatus[]
  /** 完成的中文标签（如「已上线」/「已完成」） */
  completedLabel: string
  /** 完成的短词（如「上线」/「完成」，用于「月度X趋势」「从创建到X」短语） */
  completedShort: string
  /** 在途的中文短语（如「开发/测试/待上线」/「进行中/待确认」） */
  inFlightLabel: string
}

const DEV_VIEW: Omit<StatusView, 'flow'> = {
  completedStatus: 'published',
  completedTime: (r) => r.publishTime,
  inFlightStatuses: ['developing', 'testing', 'ready'],
  completedLabel: '已上线',
  completedShort: '上线',
  inFlightLabel: '开发/测试/待上线',
}

const PM_VIEW: Omit<StatusView, 'flow'> = {
  completedStatus: 'done',
  completedTime: (r) => r.publishTime ?? r.devEndTime,
  inFlightStatuses: ['inProgress', 'toConfirm'],
  completedLabel: '已完成',
  completedShort: '完成',
  inFlightLabel: '进行中/待确认',
}

/** 全显配置（开发口径）——所有统计函数的缺省参数，行为与引入视角前完全一致 */
export function defaultStatusView(): StatusView {
  return { ...DEV_VIEW, flow: STATUS_FLOW }
}

/** 由状态显隐配置派生统计口径 */
export function resolveStatusView(visible: VisibleStatuses): StatusView {
  const flow = STATUS_FLOW.filter((s) => isStatusVisible(visible, s))
  // 产品口径判定复用 rolePresets.isPmView（唯一事实来源，避免两处判定漂移）
  if (isPmView(visible)) return { ...PM_VIEW, flow }
  // 开发 / 其它自定义组合：统一按开发口径（published）；完成态全被隐藏时统计为 0，口径仍可解释
  return { ...DEV_VIEW, flow }
}

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

/**
 * 状态分布计数（按 flow 顺序，零值也保留）。
 * 传入视图时只统计可见状态 —— 视角切换后统计页与列表口径一致。
 */
export function statusCounts(
  items: Requirement[],
  view: StatusView = defaultStatusView(),
): Record<RequirementStatus, number> {
  const init = view.flow.reduce(
    (acc, s) => ({ ...acc, [s]: 0 }),
    {} as Record<RequirementStatus, number>,
  )
  const counted = new Set<RequirementStatus>(view.flow)
  for (const r of items) {
    if (counted.has(r.status)) init[r.status] += 1
  }
  return init
}

/** 已完成需求的周期（创建→完成天数）列表 */
export function devCycles(items: Requirement[], view: StatusView = defaultStatusView()): number[] {
  return items
    .filter((r) => r.status === view.completedStatus && view.completedTime(r))
    .map((r) => differenceInDays(parseISO(view.completedTime(r)!), parseISO(r.createdAt)))
}

/** 平均周期（天），保留 1 位小数；样本为 0 时返回 0 */
export function avgDevCycle(items: Requirement[], view: StatusView = defaultStatusView()): number {
  const cycles = devCycles(items, view)
  if (cycles.length === 0) return 0
  const raw = cycles.reduce((a, b) => a + b, 0) / cycles.length
  return Math.round(raw * 10) / 10
}

/** 最近 6 个月每月完成数 */
export function last6MonthsPublished(
  items: Requirement[],
  view: StatusView = defaultStatusView(),
  now = new Date(),
): { label: string; count: number }[] {
  const result: { label: string; count: number }[] = []
  for (let i = 5; i >= 0; i--) {
    const m = subMonths(now, i)
    const yyyymm = format(m, 'yyyy-MM')
    const label = format(m, 'M月', { locale: zhCN })
    const count = items.filter(
      (r) =>
        r.status === view.completedStatus &&
        view.completedTime(r)?.slice(0, 7) === yyyymm,
    ).length
    result.push({ label, count })
  }
  return result
}

/** 周报素材（可直接粘到 IM / 邮件）；传入视图后口径与统计页一致 */
export function buildWeeklyReport(
  items: Requirement[],
  view: StatusView = defaultStatusView(),
): string {
  const { start, end } = getCurrentWeekRange()
  const fmt = (d: Date) => format(d, 'M月d日')
  const weekRange = { start, end }
  const lines: string[] = []

  lines.push(`📊 周报（${fmt(start)} ~ ${fmt(end)}）`)
  lines.push('')

  const completed = items.filter(
    (r) => r.status === view.completedStatus && inRange(view.completedTime(r), weekRange),
  )
  const created = items.filter((r) => inRange(r.createdAt, weekRange))
  const inProgress = items.filter((r) => view.inFlightStatuses.includes(r.status))
  const avgCycle = avgDevCycle(completed, view)

  lines.push(`• 本周${view.completedLabel}：${completed.length} 个`)
  lines.push(`• 本周新增：${created.length} 个`)
  lines.push(`• 在途（${view.inFlightLabel}）：${inProgress.length} 个`)
  if (avgCycle > 0) lines.push(`• 本周${view.completedShort}平均周期：${avgCycle} 天`)

  if (completed.length > 0) {
    lines.push('')
    lines.push(`${view.completedLabel}详情：`)
    for (const r of completed) lines.push(`  - ${r.name}`)
  }

  return lines.join('\n')
}

/** 月报素材（可直接粘到 IM / 邮件）；传入视图后口径与统计页一致 */
export function buildMonthlyReport(
  items: Requirement[],
  view: StatusView = defaultStatusView(),
): string {
  const monthRange = getCurrentMonthRange()
  const monthLabel = format(monthRange.start, 'yyyy年M月', { locale: zhCN })
  const lines: string[] = []

  lines.push(`📊 ${monthLabel}月报`)
  lines.push('')

  const created = items.filter((r) => inRange(r.createdAt, monthRange))
  const completed = items.filter(
    (r) => r.status === view.completedStatus && inRange(view.completedTime(r), monthRange),
  )
  const inProgress = items.filter((r) => view.inFlightStatuses.includes(r.status))
  const avgCycle = avgDevCycle(completed, view)
  const completionRate =
    created.length > 0 ? Math.round((completed.length / created.length) * 100) : 0

  lines.push(`• 本月新增：${created.length} 个`)
  lines.push(`• 本月${view.completedLabel}：${completed.length} 个`)
  lines.push(`• 完成率：${completionRate}%`)
  lines.push(`• 在途（${view.inFlightLabel}）：${inProgress.length} 个`)
  if (avgCycle > 0) lines.push(`• ${view.completedShort}平均周期：${avgCycle} 天`)

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