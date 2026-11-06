/**
 * src/lib/statuses.ts 纯函数单测 —— 固化需求状态显隐配置的合并/判定规则
 * （node 环境无 localStorage，只测纯函数；load/save 仅包 try/catch 不做单测）
 */
import { describe, it, expect } from 'vitest'
import { STATUS_FLOW } from '../../types'
import {
  buildStatusHistory,
  defaultVisibleStatuses,
  mergeVisibleStatuses,
  isStatusVisible,
  visibleStatusOptions,
  type VisibleStatuses,
} from '../statuses'

describe('defaultVisibleStatuses', () => {
  it('全部状态默认可见（true）', () => {
    const def = defaultVisibleStatuses()
    expect(Object.keys(def).length).toBe(STATUS_FLOW.length)
    for (const s of STATUS_FLOW) {
      expect(def[s]).toBe(true)
    }
  })
})

describe('mergeVisibleStatuses', () => {
  it('null / undefined / 非对象一律回退全可见', () => {
    expect(mergeVisibleStatuses(null)).toEqual(defaultVisibleStatuses())
    expect(mergeVisibleStatuses(undefined)).toEqual(defaultVisibleStatuses())
    expect(mergeVisibleStatuses('x')).toEqual(defaultVisibleStatuses())
    expect(mergeVisibleStatuses(42)).toEqual(defaultVisibleStatuses())
  })

  it('缺键按默认可见（true）处理', () => {
    const merged = mergeVisibleStatuses({ done: false })
    expect(merged.done).toBe(false)
    expect(merged.pending).toBe(true)
    expect(merged.notStarted).toBe(true)
  })

  it('非布尔值回退默认 true', () => {
    const merged = mergeVisibleStatuses({ done: 'false', ready: 0 } as unknown)
    expect(merged.done).toBe(true)
    expect(merged.ready).toBe(true)
  })

  it('显式 false 保留', () => {
    const merged = mergeVisibleStatuses({ done: false, paused: false, pending: true })
    expect(merged.done).toBe(false)
    expect(merged.paused).toBe(false)
    expect(merged.pending).toBe(true)
  })
})

describe('isStatusVisible', () => {
  it('缺键默认 true', () => {
    const statuses = {} as VisibleStatuses
    expect(isStatusVisible(statuses, 'done')).toBe(true)
    expect(isStatusVisible(statuses, 'archived')).toBe(true)
  })

  it('false 判定为不可见', () => {
    const statuses = mergeVisibleStatuses({ done: false }) as VisibleStatuses
    expect(isStatusVisible(statuses, 'done')).toBe(false)
    expect(isStatusVisible(statuses, 'pending')).toBe(true)
  })
})

describe('visibleStatusOptions', () => {
  it('全可见时按 STATUS_FLOW 顺序返回全部状态', () => {
    const options = visibleStatusOptions(defaultVisibleStatuses())
    expect(options.map((o) => o.value)).toEqual(STATUS_FLOW)
  })

  it('隐藏状态从选项里剔除', () => {
    const statuses = mergeVisibleStatuses({ done: false, archived: false }) as VisibleStatuses
    const options = visibleStatusOptions(statuses)
    expect(options.map((o) => o.value)).toEqual(
      STATUS_FLOW.filter((s) => s !== 'done' && s !== 'archived'),
    )
  })

  it('include 保底：当前值即使被隐藏也保留', () => {
    const statuses = mergeVisibleStatuses({ done: false }) as VisibleStatuses
    const options = visibleStatusOptions(statuses, 'done')
    expect(options.map((o) => o.value)).toContain('done')
  })
})

describe('buildStatusHistory（状态流转历史）', () => {
  const prevBase = {
    status: 'developing' as const,
    updatedAt: '2026-11-01T10:00:00.000Z',
    createdAt: '2026-10-01T09:00:00.000Z',
  }

  it('status 没变 → 原样返回既有历史，不追加噪音', () => {
    const existing = [{ status: 'developing' as const, at: '2026-10-20T00:00:00.000Z' }]
    expect(buildStatusHistory({ ...prevBase, statusHistory: existing }, 'developing', 'now')).toBe(existing)
  })

  it('status 没变且无历史 → 保持 undefined（不给老数据造历史）', () => {
    expect(buildStatusHistory(prevBase, 'developing', 'now')).toBeUndefined()
  })

  it('老数据首次变更：补「旧状态 @ updatedAt」起点 + 追加新状态', () => {
    const out = buildStatusHistory(prevBase, 'testing', '2026-11-05T08:00:00.000Z')
    expect(out).toEqual([
      { status: 'developing', at: '2026-11-01T10:00:00.000Z' },
      { status: 'testing', at: '2026-11-05T08:00:00.000Z' },
    ])
  })

  it('老数据无 updatedAt → 起点降级 createdAt', () => {
    const { updatedAt: _u, ...noUpdated } = prevBase
    const out = buildStatusHistory(noUpdated, 'ready', '2026-11-05T08:00:00.000Z')
    expect(out?.[0]).toEqual({ status: 'developing', at: '2026-10-01T09:00:00.000Z' })
    expect(out).toHaveLength(2)
  })

  it('既有历史 → 直接追加，不覆盖', () => {
    const existing = [
      { status: 'pending' as const, at: '2026-10-01T09:00:00.000Z' },
      { status: 'developing' as const, at: '2026-10-15T09:00:00.000Z' },
    ]
    const out = buildStatusHistory({ ...prevBase, statusHistory: existing }, 'ready', '2026-11-05T08:00:00.000Z')
    expect(out).toEqual([
      ...existing,
      { status: 'ready', at: '2026-11-05T08:00:00.000Z' },
    ])
  })
})
