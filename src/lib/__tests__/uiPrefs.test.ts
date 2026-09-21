/**
 * src/lib/uiPrefs.ts 纯函数单测 —— 固化 settings.uiPrefs 的合并与 LWW 时间戳规则
 * （node 环境无 localStorage，load/save 不做单测）
 */
import { describe, it, expect } from 'vitest'
import { mergeUiPrefs, isTsAfter } from '../uiPrefs'
import { mergeVisibleFields, mergeFieldOrder } from '../fields'
import { mergeVisibleStatuses } from '../statuses'
import { ROLE_PRESETS } from '../rolePresets'

describe('mergeUiPrefs', () => {
  it('null / 非对象 → null（服务端缺字段即旧行为）', () => {
    expect(mergeUiPrefs(null)).toBeNull()
    expect(mergeUiPrefs(undefined)).toBeNull()
    expect(mergeUiPrefs('x')).toBeNull()
    expect(mergeUiPrefs(42)).toBeNull()
  })

  it('空对象 → 合法结构（角色回退 custom、偏好回退默认全显、时间戳纪元）', () => {
    const merged = mergeUiPrefs({})
    expect(merged).not.toBeNull()
    expect(merged!.role).toBe('custom')
    expect(merged!.updatedAt).toBe(new Date(0).toISOString())
    expect(merged!.visibleFields).toEqual(mergeVisibleFields(undefined))
    expect(merged!.visibleStatuses).toEqual(mergeVisibleStatuses(undefined))
    expect(merged!.fieldOrder).toEqual(mergeFieldOrder(undefined))
  })

  it('合法载荷原样保留（产品预设打包 → 解包往返）', () => {
    const pm = ROLE_PRESETS.find((p) => p.id === 'pm')!
    const raw = {
      updatedAt: '2026-09-18T00:00:00.000Z',
      role: 'pm',
      visibleFields: pm.visibleFields,
      visibleStatuses: pm.visibleStatuses,
      fieldOrder: pm.fieldOrder,
    }
    const merged = mergeUiPrefs(raw)
    expect(merged).toEqual(raw)
  })

  it('脏字段静默降级（role 非法回 custom、时间戳非法回纪元）', () => {
    const merged = mergeUiPrefs({ role: 'hacker', updatedAt: 123, visibleStatuses: { done: 'yes' } })
    expect(merged!.role).toBe('custom')
    expect(merged!.updatedAt).toBe(new Date(0).toISOString())
    expect(merged!.visibleStatuses.done).toBe(true) // 非布尔回退默认
  })
})

describe('isTsAfter', () => {
  it('严格大于才为真（相等为假，避免 pull 循环覆盖）', () => {
    const a = '2026-09-18T01:00:00.000Z'
    const b = '2026-09-18T00:00:00.000Z'
    expect(isTsAfter(a, b)).toBe(true)
    expect(isTsAfter(b, a)).toBe(false)
    expect(isTsAfter(a, a)).toBe(false)
  })

  it('非法时间戳按 0 处理', () => {
    expect(isTsAfter('garbage', new Date(0).toISOString())).toBe(false)
    expect(isTsAfter(new Date(1000).toISOString(), 'garbage')).toBe(true)
    expect(isTsAfter('garbage', 'garbage')).toBe(false)
  })
})
