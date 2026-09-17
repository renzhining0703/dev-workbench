/**
 * src/lib/fields.ts 纯函数单测 —— 固化需求字段显隐配置的合并/判定规则
 * （node 环境无 localStorage，只测纯函数；load/save 仅包 try/catch 不做单测）
 */
import { describe, it, expect } from 'vitest'
import {
  REQUIREMENT_FIELDS,
  TIME_FIELD_KEYS,
  defaultVisibleFields,
  mergeVisibleFields,
  isVisible,
  type VisibleFields,
} from '../fields'

describe('defaultVisibleFields', () => {
  it('全部字段默认可见（true）', () => {
    const def = defaultVisibleFields()
    expect(Object.keys(def).length).toBe(REQUIREMENT_FIELDS.length)
    for (const f of REQUIREMENT_FIELDS) {
      expect(def[f.key]).toBe(true)
    }
  })
})

describe('mergeVisibleFields', () => {
  it('null / undefined / 非对象一律回退全可见', () => {
    expect(mergeVisibleFields(null)).toEqual(defaultVisibleFields())
    expect(mergeVisibleFields(undefined)).toEqual(defaultVisibleFields())
    expect(mergeVisibleFields('x')).toEqual(defaultVisibleFields())
    expect(mergeVisibleFields(42)).toEqual(defaultVisibleFields())
  })

  it('缺键按默认可见（true）处理', () => {
    const merged = mergeVisibleFields({ branch: false })
    expect(merged.branch).toBe(false)
    expect(merged.project).toBe(true)
    expect(merged.remark).toBe(true)
  })

  it('非布尔值回退默认 true', () => {
    const merged = mergeVisibleFields({ branch: 'false', remark: 0 } as unknown)
    expect(merged.branch).toBe(true)
    expect(merged.remark).toBe(true)
  })

  it('显式 false 保留', () => {
    const merged = mergeVisibleFields({ branch: false, remark: false, project: true })
    expect(merged.branch).toBe(false)
    expect(merged.remark).toBe(false)
    expect(merged.project).toBe(true)
  })
})

describe('isVisible', () => {
  it('缺键默认 true', () => {
    const fields = {} as VisibleFields
    expect(isVisible(fields, 'branch')).toBe(true)
    expect(isVisible(fields, 'remark')).toBe(true)
  })

  it('false 判定为不可见', () => {
    const fields = mergeVisibleFields({ branch: false }) as VisibleFields
    expect(isVisible(fields, 'branch')).toBe(false)
    expect(isVisible(fields, 'project')).toBe(true)
  })
})

describe('TIME_FIELD_KEYS', () => {
  it('覆盖 5 个时间字段，顺序为创建/开发开始/开发结束/提测/上线', () => {
    expect([...TIME_FIELD_KEYS]).toEqual([
      'createdAt',
      'devStartTime',
      'devEndTime',
      'testTime',
      'publishTime',
    ])
  })

  it('每个时间字段都在 REQUIREMENT_FIELDS 注册表内', () => {
    const registered = new Set(REQUIREMENT_FIELDS.map((f) => f.key))
    for (const k of TIME_FIELD_KEYS) {
      expect(registered.has(k)).toBe(true)
    }
  })
})
