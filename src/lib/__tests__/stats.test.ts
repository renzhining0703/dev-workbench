/**
 * src/lib/stats.ts 纯函数单测 —— 固化「统计口径跟随使用视角」的行为：
 * 产品视角（done 可见 / published 隐藏）与开发口径（默认全显）在同一份数据下
 * 产出不同的完成/在途统计与周月报文案。
 */
import { describe, it, expect } from 'vitest'
import type { Requirement, RequirementStatus } from '../../types'
import {
  defaultStatusView,
  resolveStatusView,
  statusCounts,
  avgDevCycle,
  last6MonthsPublished,
  buildWeeklyReport,
  buildMonthlyReport,
} from '../stats'
import { defaultVisibleStatuses, type VisibleStatuses } from '../statuses'
import { ROLE_PRESETS, DEV_STATUSES, PM_STATUSES } from '../rolePresets'

/* ---------------- 测试数据 ---------------- */

function mk(partial: Partial<Requirement> & { status: RequirementStatus }): Requirement {
  return {
    id: partial.id ?? Math.random().toString(36).slice(2),
    name: partial.name ?? '某需求',
    project: '',
    publishModule: '',
    projects: [],
    branch: '',
    createdAt: partial.createdAt ?? '2026-09-01T10:00:00.000Z',
    devStartTime: null,
    devEndTime: partial.devEndTime ?? null,
    testTime: null,
    publishTime: partial.publishTime ?? null,
    remark: '',
    updatedAt: '2026-09-01T10:00:00.000Z',
    ...partial,
  }
}

/** 产品视角的状态显隐配置（来自 pm 预设） */
const PM_VISIBLE: VisibleStatuses = ROLE_PRESETS.find((p) => p.id === 'pm')!.visibleStatuses

const items: Requirement[] = [
  // 开发流
  mk({ id: 'a', name: '开发已完成并上线', status: 'published', createdAt: '2026-08-01T00:00:00.000Z', publishTime: '2026-08-20T00:00:00.000Z' }),
  mk({ id: 'b', name: '开发中', status: 'developing', createdAt: '2026-09-02T00:00:00.000Z' }),
  // 产品流
  mk({ id: 'c', name: '产品已完成', status: 'done', createdAt: '2026-08-02T00:00:00.000Z', devEndTime: '2026-08-15T00:00:00.000Z' }),
  mk({ id: 'd', name: '产品进行中', status: 'inProgress', createdAt: '2026-09-03T00:00:00.000Z' }),
]

/* ---------------- resolveStatusView ---------------- */

describe('resolveStatusView', () => {
  it('全显配置（老用户默认）= 开发口径 + 完整 flow，行为与引入视角前一致', () => {
    const view = resolveStatusView(defaultVisibleStatuses())
    const def = defaultStatusView()
    expect(view.flow).toEqual(def.flow)
    expect(view.completedStatus).toBe('published')
    expect(view.completedLabel).toBe('已上线')
  })

  it('产品视角判定：看得到 done、看不到 published → done 口径', () => {
    const view = resolveStatusView(PM_VISIBLE)
    expect(view.completedStatus).toBe('done')
    expect(view.completedTime(mk({ status: 'done', devEndTime: '2026-01-01T00:00:00.000Z' }))).toBe('2026-01-01T00:00:00.000Z')
    expect(view.completedLabel).toBe('已完成')
    expect(view.inFlightStatuses).toEqual(['inProgress', 'toConfirm'])
  })

  it('flow 只含可见状态（产品视角 = 4 个产品状态）', () => {
    const view = resolveStatusView(PM_VISIBLE)
    expect(view.flow).toEqual([...PM_STATUSES])
  })

  it('开发预设 → 开发口径且 flow = 7 个开发状态', () => {
    const devVisible = ROLE_PRESETS.find((p) => p.id === 'dev')!.visibleStatuses
    const view = resolveStatusView(devVisible)
    expect(view.completedStatus).toBe('published')
    expect(view.flow).toEqual([...DEV_STATUSES])
  })

  it('完成口径全被隐藏的自定义配置 → 降级开发口径，保证统计页有输出', () => {
    const visible = defaultVisibleStatuses()
    visible.published = false
    visible.done = false
    const view = resolveStatusView(visible)
    expect(view.completedStatus).toBe('published')
  })
})

/* ---------------- 统计函数跟随视角 ---------------- */

describe('statusCounts / avgDevCycle / last6MonthsPublished 跟随视角', () => {
  it('statusCounts 默认全量：published=1、done=1', () => {
    const counts = statusCounts(items)
    expect(counts.published).toBe(1)
    expect(counts.done).toBe(1)
    expect(Object.keys(counts).length).toBe(11)
  })

  it('statusCounts 产品视角：只统计 4 个产品状态，隐藏状态无键', () => {
    const view = resolveStatusView(PM_VISIBLE)
    const counts = statusCounts(items, view)
    expect(Object.keys(counts).sort()).toEqual([...PM_STATUSES].sort())
    expect(counts.done).toBe(1)
    expect(counts.inProgress).toBe(1)
    expect(counts.published).toBeUndefined()
  })

  it('avgDevCycle 开发口径按 publishTime；产品口径按 publishTime ?? devEndTime', () => {
    // done 项：创建 08-02 → 完成 08-15 = 13 天
    expect(avgDevCycle(items, resolveStatusView(PM_VISIBLE))).toBe(13)
    // published 项：创建 08-01 → 上线 08-20 = 19 天
    expect(avgDevCycle(items)).toBe(19)
  })

  it('last6MonthsPublished 产品口径统计 done 的完成月份', () => {
    const trend = last6MonthsPublished(items, resolveStatusView(PM_VISIBLE))
    expect(trend.length).toBe(6)
    const aug = new Date('2026-08-15T00:00:00.000Z')
    // 用同一时间锚点核对 8 月完成数为 1（避免跨月边界抖动）
    const anchored = last6MonthsPublished(items, resolveStatusView(PM_VISIBLE), aug)
    const augLabel = String(new Date(aug).getMonth() + 1) + '月'
    expect(anchored.find((m) => m.label === augLabel)?.count).toBe(1)
    expect(trend.reduce((a, b) => a + b.count, 0)).toBe(1)
  })
})

/* ---------------- 周报 / 月报跟随视角 ---------------- */

describe('buildWeeklyReport / buildMonthlyReport 跟随视角', () => {
  it('开发口径（缺省参数）文案保持旧口径：已上线 / 在途（开发/测试/待上线）', () => {
    const text = buildWeeklyReport(items)
    expect(text).toContain('本周已上线')
    expect(text).toContain('在途（开发/测试/待上线）')
    expect(text).not.toContain('已完成')
  })

  it('产品视角：完成=done、在途=进行中/待确认，文案随口径切换', () => {
    const view = resolveStatusView(PM_VISIBLE)
    const text = buildWeeklyReport(items, view)
    expect(text).toContain('本周已完成')
    expect(text).toContain('在途（进行中/待确认）')
    expect(text).not.toContain('已上线')
  })

  it('月报：产品视角下完成率按 done 计算', () => {
    const view = resolveStatusView(PM_VISIBLE)
    const text = buildMonthlyReport(items, view)
    expect(text).toContain('本月已完成')
    expect(text).toContain('完成率')
  })
})
