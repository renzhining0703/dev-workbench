/**
 * src/lib/tombstone.ts 纯函数单测 —— 固化墓碑（软删除）协议行为
 * （与 server/lib/merge.mjs 的 gcTombstones / TOMBSTONE_GC_DAYS 同款，二者必须一致）
 */
import { describe, it, expect } from 'vitest'
import { active, gcTombstones, TOMBSTONE_GC_DAYS } from '../tombstone'

const DAY = 86_400_000

/** 测试用条目：带 id + 可选 deletedAt，满足 Tombstoned 约束且 .map(x=>x.id) 可用 */
interface Item {
  id: string
  deletedAt?: string
}

describe('active（活跃过滤）', () => {
  it('过滤掉带 deletedAt 的条目，保留活跃条目', () => {
    const list: Item[] = [
      { id: 'a', deletedAt: '2026-01-01T00:00:00.000Z' },
      { id: 'b' },
      { id: 'c' },
    ]
    expect(active(list).map((x) => x.id)).toEqual(['b', 'c'])
  })

  it('不修改原数组', () => {
    const list: Item[] = [
      { id: 'a', deletedAt: '2026-01-01T00:00:00.000Z' },
      { id: 'b' },
    ]
    active(list)
    expect(list).toHaveLength(2)
  })
})

describe('gcTombstones（超期墓碑物理清理）', () => {
  const now = Date.parse('2026-08-24T00:00:00.000Z')

  it('清理超过 GC 天数的墓碑', () => {
    const old = new Date(now - (TOMBSTONE_GC_DAYS + 1) * DAY).toISOString()
    const list: Item[] = [{ id: 'a', deletedAt: old }]
    expect(gcTombstones(list, now)).toEqual([])
  })

  it('保留未超期墓碑（< GC 天数）', () => {
    const fresh = new Date(now - 1 * DAY).toISOString()
    const list: Item[] = [{ id: 'a', deletedAt: fresh }]
    expect(gcTombstones(list, now).map((x) => x.id)).toEqual(['a'])
  })

  it('恰好等于 GC 天数边界 → 保留（>= cutoff）', () => {
    const edge = new Date(now - TOMBSTONE_GC_DAYS * DAY).toISOString()
    const list: Item[] = [{ id: 'a', deletedAt: edge }]
    expect(gcTombstones(list, now).map((x) => x.id)).toEqual(['a'])
  })

  it('保留活跃条目（无 deletedAt）', () => {
    const list: Item[] = [{ id: 'a' }, { id: 'b' }]
    expect(gcTombstones(list, now).map((x) => x.id)).toEqual(['a', 'b'])
  })

  it('deletedAt 无法解析 → 保守保留', () => {
    const list: Item[] = [{ id: 'a', deletedAt: 'not-a-date' }]
    expect(gcTombstones(list, now).map((x) => x.id)).toEqual(['a'])
  })

  it('混合场景：清理超期、保留未超期与活跃与非法', () => {
    const old = new Date(now - (TOMBSTONE_GC_DAYS + 5) * DAY).toISOString()
    const fresh = new Date(now - 10 * DAY).toISOString()
    const list: Item[] = [
      { id: 'old', deletedAt: old },
      { id: 'fresh', deletedAt: fresh },
      { id: 'live' },
      { id: 'bad', deletedAt: 'garbage' },
    ]
    expect(gcTombstones(list, now).map((x) => x.id)).toEqual([
      'fresh',
      'live',
      'bad',
    ])
  })
})

describe('协议常量漂移护栏', () => {
  it('TOMBSTONE_GC_DAYS === 90（与 server/lib/merge.mjs 必须相等）', () => {
    expect(TOMBSTONE_GC_DAYS).toBe(90)
  })
})
