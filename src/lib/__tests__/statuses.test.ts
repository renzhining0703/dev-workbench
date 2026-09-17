/**
 * src/lib/statuses.ts 纯函数单测 —— 固化需求状态显隐配置的合并/判定规则
 * （node 环境无 localStorage，只测纯函数；load/save 仅包 try/catch 不做单测）
 */
import { describe, it, expect } from 'vitest'
import { STATUS_FLOW } from '../../types'
import {
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
