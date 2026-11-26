import { describe, expect, it } from 'vitest'
import { dayTypeOf, lastWorkdayOfMonth, monthDayList, splitHours, buildMonthTimesheet, toTsv, toHoursGrid, exportDates } from './timesheet'
import type { Requirement, TodoItem } from '../types'

function mkTodo(p: Partial<TodoItem>): TodoItem {
  return {
    id: p.id ?? 't1',
    content: p.content ?? '干活',
    date: p.date ?? '2026-12-01',
    done: p.done ?? true,
    completedAt: p.completedAt,
    requirementId: p.requirementId,
    createdAt: p.createdAt ?? '2026-12-01T09:00:00',
    deletedAt: p.deletedAt,
  }
}

function mkReq(p: Partial<Requirement>): Requirement {
  return {
    id: p.id ?? 'r1',
    name: p.name ?? '快手年度账单',
    project: p.project ?? 'ks',
    publishModule: '',
    projects: p.projects ?? [{ project: 'ks', publishModule: '' }],
    branch: '',
    status: 'developing',
    createdAt: '2026-11-01T09:00:00',
    devStartTime: p.devStartTime ?? null,
    devEndTime: p.devEndTime ?? null,
    testTime: null,
    publishTime: null,
    remark: '',
    updatedAt: '2026-11-01T09:00:00',
  }
}

describe('holidays 2026', () => {
  it('法定节假日为 holiday，调休周六为 makeup，普通周六为 weekend', () => {
    expect(dayTypeOf('2026-01-01')).toBe('holiday')
    expect(dayTypeOf('2026-02-17')).toBe('holiday') // 春节正月初一
    expect(dayTypeOf('2026-02-14')).toBe('makeup') // 春节调休上班
    expect(dayTypeOf('2026-02-21')).toBe('holiday') // 春节假期内的周六
    expect(dayTypeOf('2026-12-05')).toBe('weekend') // 普通周六
    expect(dayTypeOf('2026-12-02')).toBe('workday')
  })

  it('2026-12 月历只有工作日/周末（无节假日数据年份按周末兜底）', () => {
    const days = monthDayList(2026, 12)
    expect(days).toHaveLength(31)
    expect(days.filter((d) => d.dayType === 'workday')).toHaveLength(23)
  })

  it('2027 无官方数据时按周末兜底', () => {
    expect(dayTypeOf('2027-02-17')).toBe('workday') // 周三
    expect(dayTypeOf('2027-02-20')).toBe('weekend') // 周六
  })

  it('月底最后一个工作日', () => {
    expect(lastWorkdayOfMonth(2026, 11)).toBe('2026-11-30') // 周一
    expect(lastWorkdayOfMonth(2026, 10)).toBe('2026-10-30') // 10/31 是周六
  })
})

describe('splitHours', () => {
  it('单份 8h，两份 4/4，三份 2.5/2.5/3', () => {
    expect(splitHours(1)).toEqual([8])
    expect(splitHours(2)).toEqual([4, 4])
    expect(splitHours(3)).toEqual([2.5, 2.5, 3])
  })
})

/** 测试共用需求（跨 describe 使用） */
const reqA = mkReq({ id: 'rA', name: '需求A', project: 'ks' })

describe('buildMonthTimesheet', () => {
  it('当天完成待办 → 按关联需求归属；未关联且无区间时智能归到可选需求（标 smart）', () => {
    const todos = [
      mkTodo({ id: 't1', requirementId: 'rA', completedAt: '2026-12-01T10:00:00' }),
      mkTodo({ id: 't2', completedAt: '2026-12-01T16:00:00' }),
    ]
    const { days, rows } = buildMonthTimesheet(todos, [reqA], 2026, 12)
    const d1 = days.find((d) => d.date === '2026-12-01')!
    // 未关联待办智能归到 reqA，与已关联的去重合并成一条
    expect(d1.entries).toEqual([{ label: '需求A', reqId: 'rA', project: 'ks', source: 'todo', hours: 8 }])
    expect(d1.smart).toBe(true)
    expect(rows.find((r) => r.label === '需求A')!.perDay['2026-12-01']).toBe(8)
  })

  it('未关联待办先回退开发区间推导，命中则不算智能（smart 缺省）', () => {
    const reqs = [mkReq({ id: 'rA', name: '需求A', devStartTime: '2026-12-01T00:00:00', devEndTime: '2026-12-05T00:00:00' })]
    const todos = [mkTodo({ id: 't1', completedAt: '2026-12-02T10:00:00' })]
    const { days } = buildMonthTimesheet(todos, reqs, 2026, 12)
    const d2 = days.find((d) => d.date === '2026-12-02')!
    expect(d2.entries).toEqual([{ label: '需求A', reqId: 'rA', project: 'ks', source: 'todo', hours: 8 }])
    expect(d2.smart).toBeUndefined()
  })

  it('区间对不上 → 智能选区间边界最近的需求', () => {
    const reqs = [
      mkReq({ id: 'rA', name: '需求A', devStartTime: '2026-12-01T00:00:00', devEndTime: '2026-12-05T00:00:00' }),
      mkReq({ id: 'rB', name: '需求B', devStartTime: '2026-12-10T00:00:00', devEndTime: '2026-12-20T00:00:00' }),
    ]
    const todos = [mkTodo({ id: 't1', completedAt: '2026-12-08T10:00:00' })] // 距 B 开头 2 天、A 结尾 3 天
    const { days } = buildMonthTimesheet(todos, reqs, 2026, 12)
    const d8 = days.find((d) => d.date === '2026-12-08')!
    expect(d8.entries).toEqual([{ label: '需求B', reqId: 'rB', project: 'ks', source: 'todo', hours: 8 }])
    expect(d8.smart).toBe(true)
  })

  it('手动指定归属：当天工时全归该需求（source=manual），智能提示消失', () => {
    const reqs = [
      mkReq({ id: 'rA', name: '需求A' }),
      mkReq({ id: 'rB', name: '需求B', project: 'zfl', projects: [{ project: 'zfl', publishModule: '' }] }),
    ]
    const todos = [mkTodo({ id: 't1', completedAt: '2026-12-01T10:00:00' })] // 本会智能归 A
    const { days, rows } = buildMonthTimesheet(todos, reqs, 2026, 12, {
      vacation: {},
      vacationHalf: {},
      hours: {},
      attributions: { '2026-12-01': 'rB' },
    })
    const d1 = days.find((d) => d.date === '2026-12-01')!
    expect(d1.entries).toEqual([{ label: '需求B', reqId: 'rB', project: 'zfl', source: 'manual', hours: 8 }])
    expect(d1.smart).toBeUndefined()
    expect(rows.find((r) => r.label === '需求B')!.total).toBe(8)
    const rowA = rows.find((r) => r.label === '需求A')!
    expect(rowA.total).toBe(8 * 22) // 其余 22 个工作日智能归 A（2026-12 共 23 个工作日）
    expect(rowA.perDay['2026-12-01']).toBeUndefined()
  })

  it('手动指定归属可给空白工作日补记', () => {
    const reqs = [mkReq({ id: 'rA', name: '需求A' })]
    const { days, emptyWorkdays } = buildMonthTimesheet([], reqs, 2026, 12, {
      vacation: {},
      vacationHalf: {},
      hours: {},
      attributions: { '2026-12-02': 'rA' },
    })
    const d2 = days.find((d) => d.date === '2026-12-02')!
    expect(d2.entries).toEqual([{ label: '需求A', reqId: 'rA', project: 'ks', source: 'manual', hours: 8 }])
    expect(emptyWorkdays).not.toContain('2026-12-02')
  })

  it('连一个可选需求都没有时才兜底「未关联待办」', () => {
    const todos = [mkTodo({ id: 't1', completedAt: '2026-12-01T10:00:00' })]
    const { days } = buildMonthTimesheet(todos, [], 2026, 12)
    const d1 = days.find((d) => d.date === '2026-12-01')!
    expect(d1.entries.map((e) => e.label)).toEqual(['未关联待办'])
    expect(d1.smart).toBe(true)
  })

  it('无待办时走需求开发区间推导；区间重叠平摊', () => {
    const reqs = [
      mkReq({ id: 'rA', name: '需求A', devStartTime: '2026-12-01T00:00:00', devEndTime: '2026-12-10T00:00:00' }),
      mkReq({ id: 'rB', name: '需求B', devStartTime: '2026-12-05T00:00:00', devEndTime: '2026-12-20T00:00:00' }),
    ]
    const { days } = buildMonthTimesheet([], reqs, 2026, 12)
    const d1 = days.find((d) => d.date === '2026-12-01')!
    expect(d1.entries.map((e) => [e.label, e.hours])).toEqual([['需求A', 8]])
    const d7 = days.find((d) => d.date === '2026-12-07')! // 两区间重叠且是周一
    expect(d7.entries.map((e) => [e.label, e.hours])).toEqual([['需求A', 4], ['需求B', 4]])
  })

  it('待办优先于区间推导（已关联需求的待办不被区间覆盖）', () => {
    const reqs = [
      mkReq({ id: 'rA', name: '需求A', devStartTime: '2026-12-01T00:00:00', devEndTime: '2026-12-05T00:00:00' }),
      mkReq({ id: 'rB', name: '需求B' }),
    ]
    const todos = [mkTodo({ id: 't1', requirementId: 'rB', completedAt: '2026-12-02T10:00:00' })]
    const { days } = buildMonthTimesheet(todos, reqs, 2026, 12)
    const d2 = days.find((d) => d.date === '2026-12-02')!
    expect(d2.entries).toEqual([{ label: '需求B', reqId: 'rB', project: 'ks', source: 'todo', hours: 8 }])
  })

  it('休假覆盖自动条目', () => {
    const todos = [mkTodo({ id: 't1', requirementId: 'rA', completedAt: '2026-12-01T10:00:00' })]
    const { days } = buildMonthTimesheet(todos, [reqA], 2026, 12, { vacation: { '2026-12-01': true }, vacationHalf: {}, hours: {} })
    const d1 = days.find((d) => d.date === '2026-12-01')!
    expect(d1.entries).toEqual([{ label: '休假', source: 'rest', hours: 8 }])
  })

  it('休半天：自动推导压缩到 4h + 休假 4h，整天仍凑满 8h', () => {
    const todos = [
      mkTodo({ id: 't1', requirementId: 'rA', completedAt: '2026-12-01T10:00:00' }),
      mkTodo({ id: 't2', requirementId: 'rA', completedAt: '2026-12-01T16:00:00' }),
    ]
    const { days } = buildMonthTimesheet(todos, [reqA], 2026, 12, {
      vacation: {},
      vacationHalf: { '2026-12-01': true },
      hours: {},
    })
    const d1 = days.find((d) => d.date === '2026-12-01')!
    // 两条待办同属一个需求 → 需求 4h + 休假 4h
    expect(d1.entries).toEqual([
      { label: '需求A', reqId: 'rA', project: 'ks', source: 'todo', hours: 4 },
      { label: '休假', source: 'rest', hours: 4 },
    ])
  })

  it('休半天且当天无工作记录：智能归 4h + 休假 4h', () => {
    const { days } = buildMonthTimesheet([], [reqA], 2026, 12, {
      vacation: {},
      vacationHalf: { '2026-12-02': true },
      hours: {},
    })
    const d2 = days.find((d) => d.date === '2026-12-02')!
    expect(d2.entries).toEqual([
      { label: '需求A', reqId: 'rA', project: 'ks', source: 'range', hours: 4 },
      { label: '休假', source: 'rest', hours: 4 },
    ])
  })

  it('手动改时数覆盖自动值', () => {
    const todos = [mkTodo({ id: 't1', requirementId: 'rA', completedAt: '2026-12-01T10:00:00' })]
    const { rows } = buildMonthTimesheet(todos, [reqA], 2026, 12, {
      vacation: {},
      vacationHalf: {},
      hours: { '2026-12-01': { 需求A: 6 } },
    })
    expect(rows.find((r) => r.label === '需求A')!.perDay['2026-12-01']).toBe(6)
  })

  it('需求非空时工作日不留空（智能推导兜底），需求为空才进空白清单', () => {
    const reqs = [mkReq({ id: 'rA', name: '需求A', devStartTime: '2026-12-07T00:00:00', devEndTime: '2026-12-07T00:00:00' })]
    const { days, emptyWorkdays } = buildMonthTimesheet([], reqs, 2026, 12)
    expect(emptyWorkdays).not.toContain('2026-12-01') // 无待办无区间 → 智能归需求A
    const d1 = days.find((d) => d.date === '2026-12-01')!
    expect(d1.entries.map((e) => e.label)).toEqual(['需求A'])
    expect(d1.smart).toBe(true)
    expect(emptyWorkdays).not.toContain('2026-12-05') // 周六
    expect(emptyWorkdays).not.toContain('2026-12-06') // 周日
    expect(emptyWorkdays).not.toContain('2026-12-07') // 有区间命中（非智能）
    const none = buildMonthTimesheet([], [], 2026, 12)
    expect(none.emptyWorkdays).toContain('2026-12-01') // 无任何需求才留空提醒补记
  })

  it('删除的待办（墓碑）不计；completedAt 缺失回退 date 字段', () => {
    const todos = [
      mkTodo({ id: 't1', deletedAt: '2026-12-01T11:00:00', completedAt: '2026-12-01T10:00:00' }),
      mkTodo({ id: 't2', completedAt: undefined, date: '2026-12-02' }),
    ]
    const { days } = buildMonthTimesheet(todos, [], 2026, 12)
    expect(days.find((d) => d.date === '2026-12-01')!.entries).toHaveLength(0)
    expect(days.find((d) => d.date === '2026-12-02')!.entries.map((e) => e.label)).toEqual(['未关联待办'])
  })

  it('复制/导出内容不含智能推导提示文案（只有需求名与工时数字）', () => {
    const reqs = [mkReq({ id: 'rA', name: '需求A' })]
    const todos = [mkTodo({ id: 't1', completedAt: '2026-12-01T10:00:00' })] // 智能归 A
    const { days, rows } = buildMonthTimesheet(todos, reqs, 2026, 12)
    expect(days.find((d) => d.date === '2026-12-01')!.smart).toBe(true)
    const tsv = toTsv(rows, exportDates(days))
    expect(tsv).not.toContain('智能')
    expect(tsv).not.toContain('提示')
    expect(tsv).toContain('需求A')
    const allDates = monthDayList(2026, 12).map((d) => d.date)
    const grid = toHoursGrid(rows, allDates)
    expect(grid).not.toContain('智能')
    expect(grid.split('\n')[0].split('\t')[0]).toBe('8')
  })
})

describe('export', () => {
  it('TSV 含表头/合计列，导出列含工作日', () => {
    const todos = [mkTodo({ id: 't1', requirementId: 'rA', completedAt: '2026-12-01T10:00:00' })]
    const { days, rows } = buildMonthTimesheet(todos, [reqA], 2026, 12)
    const dates = exportDates(days)
    expect(dates[0]).toBe('2026-12-01')
    expect(dates).not.toContain('2026-12-05') // 周六不进导出列
    const tsv = toTsv(rows, dates)
    expect(tsv.split('\n')[0].startsWith('事项\t项目\t12/01\t12/02\t12/03\t12/04\t')).toBe(true)
    expect(tsv.split('\n')[0].endsWith('\t合计')).toBe(true)
    expect(tsv).toContain('需求A\tks\t8')
  })

  it('纯工时区网格：列=全月每天（周末空格子占位），无表头无合计', () => {
    const todos = [mkTodo({ id: 't1', requirementId: 'rA', completedAt: '2026-12-01T10:00:00' })]
    const { rows } = buildMonthTimesheet(todos, [reqA], 2026, 12)
    const allDates = monthDayList(2026, 12).map((d) => d.date)
    const grid = toHoursGrid(rows, allDates)
    const lines = grid.split('\n')
    expect(lines).toHaveLength(rows.length)
    // 12/1 是周二有 8h；12/5 周六空格子占位（列对齐用）
    const cells = lines[0].split('\t')
    expect(cells).toHaveLength(31)
    expect(cells[0]).toBe('8')
    expect(cells[4]).toBe('') // 12/05 周六
    expect(lines[0]).not.toContain('合计')
  })
})
