import { describe, expect, it } from 'vitest'
import type { TodoItem } from '../../types'
import {
  bestStreak,
  buildEfficiencyReport,
  completedByDay,
  completedByHour,
  currentStreak,
  weekStats,
} from '../efficiency'

/** 构造一条完成记录：completedAt 决定完成日期与小时 */
function done(content: string, completedAt: string, extra: Partial<TodoItem> = {}): TodoItem {
  return {
    id: content,
    content,
    date: completedAt.slice(0, 10),
    done: true,
    completedAt,
    createdAt: completedAt,
    ...extra,
  }
}

/** 本地时间构造 ISO（避免 toISOString 的 UTC 偏移影响归日/归小时断言） */
function iso(y: number, mo: number, d: number, h = 10, mi = 0): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${y}-${p(mo)}-${p(d)}T${p(h)}:${p(mi)}:00`
}

// 固定「now」：2026-08-27（周四）本地 10:00
const NOW = new Date(2026, 7, 27, 10, 0, 0)

describe('completedByDay', () => {
  it('近 N 天每天计数，缺失天补 0', () => {
    const todos = [
      done('a', iso(2026, 8, 27, 9)),
      done('b', iso(2026, 8, 27, 14)),
      done('c', iso(2026, 8, 25, 9)),
      done('d', iso(2026, 7, 30, 9)), // 窗口外
    ]
    const days = completedByDay(todos, 7, NOW)
    expect(days).toHaveLength(7)
    expect(days[6]).toMatchObject({ date: '2026-08-27', count: 2 })
    expect(days[4]).toMatchObject({ date: '2026-08-25', count: 1 })
    expect(days[0]).toMatchObject({ count: 0 })
  })

  it('未完成 / 无 completedAt / 墓碑不计入', () => {
    const todos = [
      { ...done('x', iso(2026, 8, 27, 9)), done: false },
      done('y', iso(2026, 8, 27, 9), { deletedAt: '2026-08-01T00:00:00' }),
      { id: 'z', content: 'z', date: '2026-08-27', done: true, createdAt: iso(2026, 8, 27, 9) },
    ]
    const days = completedByDay(todos, 7, NOW)
    expect(days[6].count).toBe(0)
  })
})

describe('completedByHour', () => {
  it('按小时聚合，0-23 全保留', () => {
    const todos = [
      done('a', iso(2026, 8, 27, 9)),
      done('b', iso(2026, 8, 26, 9)),
      done('c', iso(2026, 8, 26, 21)),
    ]
    const hours = completedByHour(todos)
    expect(hours).toHaveLength(24)
    expect(hours[9].count).toBe(2)
    expect(hours[21].count).toBe(1)
    expect(hours[0].count).toBe(0)
  })
})

describe('streak', () => {
  it('currentStreak：今天有完成 → 连续到今天', () => {
    const todos = [
      done('a', iso(2026, 8, 27, 9)),
      done('b', iso(2026, 8, 26, 9)),
      done('c', iso(2026, 8, 25, 9)),
    ]
    expect(currentStreak(todos, NOW)).toBe(3)
  })

  it('currentStreak：今天未完成不算断更（宽容口径）', () => {
    const todos = [
      done('b', iso(2026, 8, 26, 9)),
      done('c', iso(2026, 8, 25, 9)),
    ]
    expect(currentStreak(todos, NOW)).toBe(2)
  })

  it('currentStreak：中间断一天则清零', () => {
    const todos = [done('b', iso(2026, 8, 26, 9)), done('c', iso(2026, 8, 24, 9))]
    expect(currentStreak(todos, NOW)).toBe(1)
  })

  it('bestStreak：历史最长连续', () => {
    const todos = [
      done('a', iso(2026, 8, 27, 9)),
      done('b', iso(2026, 8, 26, 9)),
      done('c', iso(2026, 8, 25, 9)),
      done('d', iso(2026, 8, 20, 9)),
      done('e', iso(2026, 8, 19, 9)),
    ]
    expect(bestStreak(todos)).toBe(3)
  })

  it('bestStreak：无记录返回 0', () => {
    expect(bestStreak([])).toBe(0)
    expect(currentStreak([], NOW)).toBe(0)
  })
})

describe('weekStats', () => {
  it('本周/上周对比 + 周增量', () => {
    // 本周一 2026-08-24，上周 2026-08-17 ~ 08-23
    const todos = [
      done('a', iso(2026, 8, 27, 9)), // 本周 3 条
      done('b', iso(2026, 8, 26, 9)),
      done('c', iso(2026, 8, 24, 9)),
      done('d', iso(2026, 8, 20, 9)), // 上周 1 条
    ]
    const s = weekStats(todos, NOW)
    expect(s.weekDone).toBe(3)
    expect(s.lastWeekDone).toBe(1)
    expect(s.weekDelta).toBe(200)
  })

  it('上周为 0 → weekDelta null', () => {
    const s = weekStats([done('a', iso(2026, 8, 27, 9))], NOW)
    expect(s.weekDelta).toBeNull()
  })

  it('最活跃时段与近 30 天日均', () => {
    const todos = [
      done('a', iso(2026, 8, 27, 9)),
      done('b', iso(2026, 8, 27, 9)),
      done('c', iso(2026, 8, 27, 21)),
      done('d', iso(2026, 8, 26, 9)),
    ]
    const s = weekStats(todos, NOW)
    expect(s.peakHour).toBe(9)
    expect(s.peakCount).toBe(3)
    // 4 条 / 30 天 = 0.133… → 0.1
    expect(s.avgPerDay30).toBe(0.1)
    expect(s.activeDays7).toBe(2)
  })

  it('无任何完成记录 → 峰值 null、全零', () => {
    const s = weekStats([], NOW)
    expect(s.weekDone).toBe(0)
    expect(s.peakHour).toBeNull()
    expect(s.peakCount).toBe(0)
    expect(s.streak).toBe(0)
    expect(s.bestStreak).toBe(0)
  })
})

describe('buildEfficiencyReport', () => {
  it('生成可复制文案', () => {
    const text = buildEfficiencyReport([done('a', iso(2026, 8, 27, 9))], NOW)
    expect(text).toContain('本周效率复盘')
    expect(text).toContain('本周完成待办：1 条')
    expect(text).toContain('连续完成')
  })
})
