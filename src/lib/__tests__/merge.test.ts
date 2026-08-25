/**
 * src/lib/merge.ts 纯函数单测 —— 固化前端 LWW 合并行为
 * （与 server/lib/merge.mjs 同款语义，二者必须保持一致）
 */
import { describe, it, expect } from 'vitest'
import { mergeByUpdatedAt } from '../merge'

const T = (s: string) => `2026-01-0${s}T00:00:00.000Z`

describe('mergeByUpdatedAt', () => {
  it('本地有而服务端没有的 id → 收下（新增）', () => {
    const remote = [{ id: 'a', updatedAt: T('1') }]
    const local = [{ id: 'b', updatedAt: T('2') }]
    const merged = mergeByUpdatedAt(remote, local)
    expect(merged).toHaveLength(2)
    expect(merged.map((x) => x.id).sort()).toEqual(['a', 'b'])
  })

  it('服务端有而本地没有的 id → 收下', () => {
    const remote = [{ id: 'a', updatedAt: T('1') }, { id: 'c', updatedAt: T('3') }]
    const local: { id: string; updatedAt?: string }[] = []
    expect(mergeByUpdatedAt(remote, local)).toHaveLength(2)
  })

  it('同 id 本地更新时间更大 → 本地胜', () => {
    const remote = [{ id: 'a', title: 'old', updatedAt: T('1') }]
    const local = [{ id: 'a', title: 'new', updatedAt: T('2') }]
    expect(mergeByUpdatedAt(remote, local)[0]).toMatchObject({ id: 'a', title: 'new' })
  })

  it('同 id 本地更新时间更小 → 服务端胜', () => {
    const remote = [{ id: 'a', title: 'keep', updatedAt: T('2') }]
    const local = [{ id: 'a', title: 'stale', updatedAt: T('1') }]
    expect(mergeByUpdatedAt(remote, local)[0]).toMatchObject({ id: 'a', title: 'keep' })
  })

  it('时间相等 → 服务端胜（严格大于才覆盖）', () => {
    const remote = [{ id: 'a', title: 'server', updatedAt: T('1') }]
    const local = [{ id: 'a', title: 'client', updatedAt: T('1') }]
    expect(mergeByUpdatedAt(remote, local)[0]).toMatchObject({ title: 'server' })
  })

  it('缺 updatedAt → 降级比较 createdAt', () => {
    const remote = [{ id: 'a', title: 'old', createdAt: T('1') }]
    const local = [{ id: 'a', title: 'new', createdAt: T('2') }]
    expect(mergeByUpdatedAt(remote, local)[0]).toMatchObject({ title: 'new' })
  })

  it('两边都缺时间戳 → 按 0 处理，服务端胜', () => {
    const remote = [{ id: 'a', title: 'server' }]
    const local = [{ id: 'a', title: 'client' }]
    expect(mergeByUpdatedAt(remote, local)[0]).toMatchObject({ title: 'server' })
  })

  it('输出无重复 id（并集去重）', () => {
    const remote = [{ id: 'a', updatedAt: T('1') }, { id: 'b', updatedAt: T('1') }]
    const local = [{ id: 'a', updatedAt: T('2') }, { id: 'c', updatedAt: T('3') }]
    const ids = mergeByUpdatedAt(remote, local).map((x) => x.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids.sort()).toEqual(['a', 'b', 'c'])
  })

  it('泛型适配不同实体形状（需求：status 字段不丢）', () => {
    const remote = [{ id: 'r1', status: 'developing', updatedAt: T('1') }]
    const local = [{ id: 'r1', status: 'testing', updatedAt: T('2') }]
    expect(mergeByUpdatedAt(remote, local)[0]).toMatchObject({ status: 'testing' })
  })
})
