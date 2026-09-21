/**
 * src/lib/fields.ts 纯函数单测 —— 固化需求字段显隐配置的合并/判定规则
 * （node 环境无 localStorage，只测纯函数；load/save 仅包 try/catch 不做单测）
 */
import { describe, it, expect } from 'vitest'
import {
  FIELD_BLOCKS,
  FIELD_GROUPS,
  REQUIREMENT_FIELDS,
  TIME_FIELD_KEYS,
  defaultFieldOrder,
  defaultVisibleFields,
  isVisible,
  mergeFieldOrder,
  mergeVisibleFields,
  moveFieldBlock,
  orderedFieldBlocks,
  orderedSortableBlocks,
  shiftFieldBlock,
  type RequirementFieldKey,
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

/* ---------------- 列表展示顺序 ---------------- */

const blockIds = (order: RequirementFieldKey[]) =>
  orderedSortableBlocks(order).map((b) => b.id)

describe('FIELD_GROUPS / FIELD_BLOCKS 覆盖性', () => {
  it('分组恰好覆盖全部字段且不重复', () => {
    const flat = FIELD_GROUPS.flatMap((g) => g.keys)
    expect(flat.length).toBe(REQUIREMENT_FIELDS.length)
    expect(new Set(flat).size).toBe(REQUIREMENT_FIELDS.length)
    expect(new Set(flat)).toEqual(new Set(REQUIREMENT_FIELDS.map((f) => f.key)))
  })

  it('展示块恰好覆盖全部字段且不重复', () => {
    const flat = FIELD_BLOCKS.flatMap((b) => b.keys)
    expect(flat.length).toBe(REQUIREMENT_FIELDS.length)
    expect(new Set(flat).size).toBe(REQUIREMENT_FIELDS.length)
  })

  it('备注是唯一的固定块', () => {
    const pinned = FIELD_BLOCKS.filter((b) => b.pinned)
    expect(pinned.map((b) => b.id)).toEqual(['remark'])
  })
})

describe('defaultFieldOrder', () => {
  it('等于注册表顺序，且是全字段排列', () => {
    expect(defaultFieldOrder()).toEqual(REQUIREMENT_FIELDS.map((f) => f.key))
  })

  it('默认顺序派生出与历史一致的列顺序', () => {
    expect(blockIds(defaultFieldOrder())).toEqual(['projectBranch', 'module', 'status', 'time'])
  })
})

describe('mergeFieldOrder', () => {
  it('脏数据一律回退默认顺序', () => {
    expect(mergeFieldOrder(null)).toEqual(defaultFieldOrder())
    expect(mergeFieldOrder(undefined)).toEqual(defaultFieldOrder())
    expect(mergeFieldOrder('x')).toEqual(defaultFieldOrder())
    expect(mergeFieldOrder({ a: 1 })).toEqual(defaultFieldOrder())
  })

  it('过滤非法值与重复项', () => {
    const merged = mergeFieldOrder(['status', 'notAField', 'status', 42, 'project'])
    expect(merged.slice(0, 2)).toEqual(['status', 'project'])
    expect(merged).toHaveLength(REQUIREMENT_FIELDS.length)
    expect(new Set(merged).size).toBe(REQUIREMENT_FIELDS.length)
  })

  it('缺失字段按默认顺序补齐（旧数据新增字段后不丢列）', () => {
    const merged = mergeFieldOrder(['status', 'project'])
    expect(merged.slice(0, 2)).toEqual(['status', 'project'])
    // 其余字段按注册表顺序补齐
    const rest = merged.slice(2)
    const expectedRest = REQUIREMENT_FIELDS.map((f) => f.key).filter(
      (k) => k !== 'status' && k !== 'project',
    )
    expect(rest).toEqual(expectedRest)
  })
})

describe('orderedFieldBlocks', () => {
  it('包含全部块（可排序 + 固定）', () => {
    expect(orderedFieldBlocks(defaultFieldOrder()).map((b) => b.id)).toEqual([
      'projectBranch',
      'module',
      'status',
      'time',
      'remark',
    ])
  })

  it('空顺序时按注册表顺序兜底，不丢块', () => {
    expect(orderedFieldBlocks([]).map((b) => b.id)).toEqual([
      'projectBranch',
      'module',
      'status',
      'time',
      'remark',
    ])
  })
})

describe('moveFieldBlock', () => {
  it('把状态列移到第一位', () => {
    const next = moveFieldBlock(defaultFieldOrder(), 'status', 0)
    expect(blockIds(next)).toEqual(['status', 'projectBranch', 'module', 'time'])
    // 块内字段保持相邻
    expect(next.slice(1, 3)).toEqual(['project', 'branch'])
  })

  it('把时间列移到第一位', () => {
    const next = moveFieldBlock(defaultFieldOrder(), 'time', 0)
    expect(blockIds(next)).toEqual(['time', 'projectBranch', 'module', 'status'])
  })

  it('目标位置越界时 clamp，不抛错', () => {
    const order = defaultFieldOrder()
    expect(blockIds(moveFieldBlock(order, 'time', 99))).toEqual([
      'projectBranch',
      'module',
      'status',
      'time',
    ])
    expect(blockIds(moveFieldBlock(order, 'module', -5))).toEqual([
      'module',
      'projectBranch',
      'status',
      'time',
    ])
  })

  it('块不存在或位置未变化时返回原引用（便于跳过 re-render）', () => {
    const order = defaultFieldOrder()
    expect(moveFieldBlock(order, 'remark', 0)).toBe(order)
    expect(moveFieldBlock(order, 'projectBranch', 0)).toBe(order)
  })

  it('结果永远是全字段排列且不含重复', () => {
    let order = defaultFieldOrder()
    for (const [id, to] of [
      ['time', 0],
      ['module', 2],
      ['status', 1],
      ['projectBranch', 3],
    ] as const) {
      order = moveFieldBlock(order, id, to)
      expect(order).toHaveLength(REQUIREMENT_FIELDS.length)
      expect(new Set(order).size).toBe(REQUIREMENT_FIELDS.length)
    }
  })

  it('固定块（备注）不参与排序，始终排在字段数组末尾', () => {
    const next = moveFieldBlock(defaultFieldOrder(), 'status', 0)
    expect(next[next.length - 1]).toBe('remark')
  })
})

describe('shiftFieldBlock', () => {
  it('上移/下移各一位', () => {
    const order = defaultFieldOrder()
    expect(blockIds(shiftFieldBlock(order, 'module', -1))).toEqual([
      'module',
      'projectBranch',
      'status',
      'time',
    ])
    expect(blockIds(shiftFieldBlock(order, 'module', 1))).toEqual([
      'projectBranch',
      'status',
      'module',
      'time',
    ])
  })

  it('已在边界时返回原引用', () => {
    const order = defaultFieldOrder()
    expect(shiftFieldBlock(order, 'projectBranch', -1)).toBe(order)
    expect(shiftFieldBlock(order, 'time', 1)).toBe(order)
  })
})
