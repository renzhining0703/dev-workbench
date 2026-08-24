/**
 * lib/merge.mjs 纯函数单测 —— 固化 LWW 合并行为（v1 → v2 行为零变化的锚点）
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  emptySnapshot,
  normalizeSnapshot,
  mergeByUpdatedAt,
  mergeSettings,
  mergeSnapshot,
} from '../lib/merge.mjs'

const T = (s) => `2026-01-0${s}T00:00:00.000Z`

test('mergeByUpdatedAt：本地新增（服务端没有的 id）→ 收下', () => {
  const remote = [{ id: 'a', updatedAt: T(1) }]
  const local = [{ id: 'b', updatedAt: T(2) }]
  const merged = mergeByUpdatedAt(remote, local)
  assert.equal(merged.length, 2)
})

test('mergeByUpdatedAt：同 id 本地更新时间大 → 本地胜', () => {
  const remote = [{ id: 'a', title: 'old', updatedAt: T(1) }]
  const local = [{ id: 'a', title: 'new', updatedAt: T(2) }]
  assert.equal(mergeByUpdatedAt(remote, local)[0].title, 'new')
})

test('mergeByUpdatedAt：同 id 本地更新时间小 → 服务端胜', () => {
  const remote = [{ id: 'a', title: 'keep', updatedAt: T(2) }]
  const local = [{ id: 'a', title: 'stale', updatedAt: T(1) }]
  assert.equal(mergeByUpdatedAt(remote, local)[0].title, 'keep')
})

test('mergeByUpdatedAt：时间相等 → 服务端胜（v1 是严格大于才覆盖）', () => {
  const remote = [{ id: 'a', title: 'server', updatedAt: T(1) }]
  const local = [{ id: 'a', title: 'client', updatedAt: T(1) }]
  assert.equal(mergeByUpdatedAt(remote, local)[0].title, 'server')
})

test('mergeByUpdatedAt：缺 updatedAt 降级比较 createdAt', () => {
  const remote = [{ id: 'a', title: 'old', createdAt: T(1) }]
  const local = [{ id: 'a', title: 'new', createdAt: T(2) }]
  assert.equal(mergeByUpdatedAt(remote, local)[0].title, 'new')
})

test('mergeByUpdatedAt：两边都缺时间戳 → 时间戳按 0 处理，服务端胜', () => {
  const remote = [{ id: 'a', title: 'server' }]
  const local = [{ id: 'a', title: 'client' }]
  assert.equal(mergeByUpdatedAt(remote, local)[0].title, 'server')
})

test('mergeSettings：本地键覆盖，服务端独有键保留', () => {
  assert.deepEqual(
    mergeSettings({ a: 1, keep: 2 }, { a: 9, extra: 3 }),
    { a: 9, keep: 2, extra: 3 },
  )
})

test('normalizeSnapshot：缺字段补默认值，已有字段不覆盖', () => {
  const n = normalizeSnapshot({ version: 1, requirements: [1], settings: { theme: 'dark' } })
  assert.equal(n.version, 1)
  assert.deepEqual(n.requirements, [1])
  assert.deepEqual(n.todos, [])
  assert.deepEqual(n.projects, [])
  assert.equal(n.settings.theme, 'dark')
  assert.equal(n.settings.autoArchiveMonths, 3) // 默认值保留
})

test('normalizeSnapshot：null/非对象 → 空快照', () => {
  assert.deepEqual(normalizeSnapshot(null), emptySnapshot())
  assert.deepEqual(normalizeSnapshot(undefined), emptySnapshot())
})

test('mergeSnapshot：非数组集合按空数组处理（v1 语义）', () => {
  const merged = mergeSnapshot(
    { requirements: [{ id: 'a', updatedAt: T(1) }], settings: {} },
    { requirements: 'not-an-array', settings: {} },
  )
  assert.deepEqual(merged.requirements, [{ id: 'a', updatedAt: T(1) }])
})

test('mergeSnapshot：输出带新 serverTs 与 version', () => {
  const merged = mergeSnapshot({}, {}, '2026-08-24T00:00:00.000Z')
  assert.equal(merged.serverTs, '2026-08-24T00:00:00.000Z')
  assert.equal(merged.version, 1)
  assert.deepEqual(merged.requirements, [])
  assert.deepEqual(merged.settings, {})
})

test('mergeSnapshot：settings 非对象按空对象处理', () => {
  const merged = mergeSnapshot({ settings: { a: 1 } }, { settings: null })
  assert.deepEqual(merged.settings, { a: 1 })
})
