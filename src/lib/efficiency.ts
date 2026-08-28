/**
 * 个人效率统计（纯函数，零 DOM 依赖，便于单测）
 *
 * 数据源：TodoItem.completedAt（勾选完成时写入的 ISO 时间）。
 * 口径说明：
 *   - 「完成」= done === true 且有 completedAt；墓碑（deletedAt）数据一律不计
 *   - 按本地时区归日/归小时（completedAt 是完整 ISO，直接用 new Date 解析）
 *   - 「连续完成天数」采用宽容口径：今天尚未完成不算断更，从昨天往前数
 */
import {
  eachDayOfInterval,
  endOfWeek,
  format,
  startOfWeek,
  subDays,
} from 'date-fns'
import type { TodoItem } from '../types'

/** 一条「有效完成记录」：done 且有 completedAt，未墓碑删除 */
function doneAt(t: TodoItem): string | null {
  if (!t.done || !t.completedAt || t.deletedAt) return null
  return t.completedAt
}

/** 本地时区 yyyy-MM-dd */
export function toLocalDay(iso: string): string {
  const d = new Date(iso)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/** 本地时区小时 0-23（解析失败返回 null） */
function localHour(iso: string): number | null {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? null : d.getHours()
}

/** 近 N 天（含今天）每天完成条数 */
export function completedByDay(
  todos: TodoItem[],
  days: number,
  now = new Date(),
): { date: string; count: number; label: string }[] {
  const start = subDays(now, days - 1)
  const range = eachDayOfInterval({ start, end: now })
  const counts = new Map<string, number>()
  for (const t of todos) {
    const iso = doneAt(t)
    if (!iso) continue
    const day = toLocalDay(iso)
    counts.set(day, (counts.get(day) ?? 0) + 1)
  }
  return range.map((d) => {
    const date = format(d, 'yyyy-MM-dd')
    return {
      date,
      count: counts.get(date) ?? 0,
      label: format(d, 'M/d'),
    }
  })
}

/** 24 小时完成分布（0-23，全零也保留） */
export function completedByHour(todos: TodoItem[]): { hour: number; count: number }[] {
  const counts = new Array<number>(24).fill(0)
  for (const t of todos) {
    const iso = doneAt(t)
    if (!iso) continue
    const h = localHour(iso)
    if (h === null) continue
    counts[h] += 1
  }
  return counts.map((count, hour) => ({ hour, count }))
}

/** 排序去重后的完成日期列表（本地日期字符串） */
function doneDayList(todos: TodoItem[]): string[] {
  const set = new Set<string>()
  for (const t of todos) {
    const iso = doneAt(t)
    if (!iso) continue
    set.add(toLocalDay(iso))
  }
  return [...set].sort()
}

/** 两个 yyyy-MM-dd 的日期差（天）；无法解析返回 null */
function diffDays(a: string, b: string): number | null {
  const da = new Date(`${a}T00:00:00`)
  const db = new Date(`${b}T00:00:00`)
  if (Number.isNaN(da.getTime()) || Number.isNaN(db.getTime())) return null
  return Math.round((db.getTime() - da.getTime()) / 86_400_000)
}

/** 历史最长连续完成天数 */
export function bestStreak(todos: TodoItem[]): number {
  const days = doneDayList(todos)
  if (days.length === 0) return 0
  let best = 1
  let cur = 1
  for (let i = 1; i < days.length; i++) {
    const gap = diffDays(days[i - 1], days[i])
    if (gap === 1) {
      cur += 1
      best = Math.max(best, cur)
    } else if (gap !== null && gap > 1) {
      cur = 1
    }
    // gap === null（脏数据）时保持 cur 不动，避免误断
  }
  return best
}

/** 当前连续完成天数（今天未完成不计断，从昨天往前数） */
export function currentStreak(todos: TodoItem[], now = new Date()): number {
  const doneDays = new Set(doneDayList(todos))
  let cursor = new Date(now)
  // 今天没完成 → 从昨天开始数（今天尚未过完，不算断更）
  if (!doneDays.has(format(cursor, 'yyyy-MM-dd'))) {
    cursor = subDays(cursor, 1)
  }
  let streak = 0
  while (doneDays.has(format(cursor, 'yyyy-MM-dd'))) {
    streak += 1
    cursor = subDays(cursor, 1)
  }
  return streak
}

export interface WeekStats {
  weekDone: number
  lastWeekDone: number
  /** 本周 vs 上周百分比变化；上周为 0 时返回 null */
  weekDelta: number | null
  streak: number
  bestStreak: number
  /** 近 30 天日均完成（保留 1 位小数） */
  avgPerDay30: number
  /** 最活跃小时 0-23；无数据返回 null */
  peakHour: number | null
  peakCount: number
  /** 近 7 天有完成记录的天数 */
  activeDays7: number
  /** 本周完成日期集合（供热力点） */
  weekDays: string[]
}

/** 周复盘核心统计 */
export function weekStats(todos: TodoItem[], now = new Date()): WeekStats {
  const weekStart = startOfWeek(now, { weekStartsOn: 1 })
  const weekEnd = endOfWeek(now, { weekStartsOn: 1 })
  const lastWeekStart = subDays(weekStart, 7)
  const lastWeekEnd = subDays(weekStart, 1)

  const inRange = (iso: string, start: Date, end: Date) => {
    const t = new Date(iso).getTime()
    return t >= start.getTime() && t <= end.getTime()
  }

  let weekDone = 0
  let lastWeekDone = 0
  const weekDays = new Set<string>()
  const doneDays = new Set<string>()
  for (const t of todos) {
    const iso = doneAt(t)
    if (!iso) continue
    const day = toLocalDay(iso)
    doneDays.add(day)
    if (inRange(iso, weekStart, weekEnd)) {
      weekDone += 1
      weekDays.add(day)
    } else if (inRange(iso, lastWeekStart, lastWeekEnd)) {
      lastWeekDone += 1
    }
  }

  const hours = completedByHour(todos)
  let peakHour: number | null = null
  let peakCount = 0
  for (const h of hours) {
    if (h.count > peakCount) {
      peakCount = h.count
      peakHour = h.hour
    }
  }

  // 近 30 天完成总数 + 近 7 天活跃天数
  const nowDay = new Date(now)
  nowDay.setHours(0, 0, 0, 0)
  const start30 = subDays(nowDay, 29)
  let done30 = 0
  const dayCounts30 = new Map<string, number>()
  for (const t of todos) {
    const iso = doneAt(t)
    if (!iso) continue
    const day = toLocalDay(iso)
    const d = new Date(`${day}T00:00:00`)
    if (d >= start30 && d <= nowDay) {
      done30 += 1
      dayCounts30.set(day, (dayCounts30.get(day) ?? 0) + 1)
    }
  }
  const activeDays7 = [...dayCounts30.keys()].filter((d) => {
    const dd = new Date(`${d}T00:00:00`)
    return dd >= subDays(nowDay, 6)
  }).length

  const avgPerDay30 = Math.round((done30 / 30) * 10) / 10

  return {
    weekDone,
    lastWeekDone,
    weekDelta:
      lastWeekDone === 0
        ? null
        : Math.round(((weekDone - lastWeekDone) / lastWeekDone) * 100),
    streak: currentStreak(todos, now),
    bestStreak: bestStreak(todos),
    avgPerDay30,
    peakHour: peakCount > 0 ? peakHour : null,
    peakCount,
    activeDays7,
    weekDays: [...weekDays].sort(),
  }
}

/** 周复盘素材（可复制到 IM / 邮件） */
export function buildEfficiencyReport(todos: TodoItem[], now = new Date()): string {
  const s = weekStats(todos, now)
  const lines: string[] = []
  lines.push(`📈 本周效率复盘（${format(weekStartOf(now), 'M月d日')} ~ ${format(now, 'M月d日')}）`)
  lines.push('')
  lines.push(`• 本周完成待办：${s.weekDone} 条` + (s.weekDelta !== null ? `（vs 上周 ${s.weekDelta > 0 ? '+' : ''}${s.weekDelta}%）` : ''))
  lines.push(`• 连续完成：${s.streak} 天（历史最长 ${s.bestStreak} 天）`)
  lines.push(`• 近 30 天日均完成：${s.avgPerDay30} 条`)
  lines.push(`• 近 7 天活跃：${s.activeDays7} 天`)
  if (s.peakHour !== null) lines.push(`• 最活跃时段：${s.peakHour}:00 ~ ${s.peakHour + 1}:00（${s.peakCount} 条）`)
  return lines.join('\n')
}

function weekStartOf(now: Date): Date {
  return startOfWeek(now, { weekStartsOn: 1 })
}
