/**
 * 排期表批量导入测试：
 *  1) 纯函数（mapStatus / filterByOwner / normalizeDate / buildRemark / planImport / buildRequirement）
 *  2) 快照写入链路（plan → store.update → 回读校验，含二次导入查重）
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDatabase } from '../db.mjs'
import { UserStore } from '../store/users.mjs'
import { SnapshotStore } from '../store/snapshots.mjs'
import { genSalt, hashPassword } from '../lib/password.mjs'
import {
  mapStatus,
  filterByOwner,
  normalizeDate,
  buildRemark,
  planImport,
  buildRequirement,
} from '../lib/req-batch.mjs'

/* ---------------- 1. mapStatus ---------------- */

test('mapStatus：常规进度映射', () => {
  assert.equal(mapStatus('待执行', ''), 'pending')
  assert.equal(mapStatus('进行中', ''), 'inProgress')
  assert.equal(mapStatus('待确认', ''), 'toConfirm')
  assert.equal(mapStatus('待上线', ''), 'ready')
  assert.equal(mapStatus('已开发待测试', ''), 'testing')
  assert.equal(mapStatus('暂停', ''), 'paused')
  assert.equal(mapStatus('暂时不考虑', ''), 'paused')
  assert.equal(mapStatus('', ''), 'notStarted')
})

test('mapStatus：已完成按视角分流（开发=已上线，设计/方案=已完成）', () => {
  assert.equal(mapStatus('已完成', '软件开发'), 'published')
  assert.equal(mapStatus('已完成', '发布测试'), 'published')
  assert.equal(mapStatus('已完成', '技术梳理'), 'published')
  assert.equal(mapStatus('已完成', 'UI设计'), 'done')
  assert.equal(mapStatus('已完成', '方案设计'), 'done')
  assert.equal(mapStatus('已完成', '需求方案'), 'done')
  assert.equal(mapStatus('已完成', '客户验收'), 'done')
  assert.equal(mapStatus('已完成', ''), 'published')
})

test('mapStatus：无法识别返回 null（含首尾空白容错）', () => {
  assert.equal(mapStatus('未知状态', ''), null)
  assert.equal(mapStatus(' 进行中 ', ''), 'inProgress')
})

/* ---------------- 2. filterByOwner ---------------- */

test('filterByOwner：多人拼串单元格用包含匹配', () => {
  const rows = [
    { name: 'a', owner: '任治宁, 李昊' },
    { name: 'b', owner: '任治宁' },
    { name: 'c', owner: '李昊' },
    { name: 'd', owner: '' },
  ]
  const { matched, filteredOut } = filterByOwner(rows, '任治宁')
  assert.deepEqual(matched.map((r) => r.name), ['a', 'b'])
  assert.equal(filteredOut, 2)
})

test('filterByOwner：关键词为空时全部过滤（防呆）', () => {
  const { matched, filteredOut } = filterByOwner([{ name: 'a', owner: 'x' }], '')
  assert.equal(matched.length, 0)
  assert.equal(filteredOut, 1)
})

/* ---------------- 3. normalizeDate ---------------- */

test('normalizeDate：空值归 null，合法透传，非法拒收', () => {
  assert.equal(normalizeDate(''), null)
  assert.equal(normalizeDate(null), null)
  assert.equal(normalizeDate('2026-01-09'), '2026-01-09')
  assert.equal(normalizeDate('2026/1/9'), undefined)
  assert.equal(normalizeDate('2026-2-30'), undefined)
  assert.equal(normalizeDate('2026-13-01'), undefined)
})

/* ---------------- 4. buildRemark ---------------- */

test('buildRemark：排期信息并入备注，语义不污染时间字段', () => {
  assert.equal(
    buildRemark({ scheduledDone: '2026-01-09', expectedPublish: '2026-02-01', remark: '改样式' }),
    '排期完成：2026-01-09；预计上线：2026-02-01；改样式',
  )
  assert.equal(buildRemark({ scheduledDone: '', expectedPublish: '', remark: ' ' }), '')
  assert.equal(buildRemark({ scheduledDone: '2026-01-09', expectedPublish: '', remark: '' }), '排期完成：2026-01-09')
})

/* ---------------- 5. planImport ---------------- */

const ROWS = [
  { row: 1, name: '需求A', taskType: '软件开发', progress: '已完成', owner: '任治宁', devStartTime: '2026-01-09', devEndTime: '2026-01-20', scheduledDone: '', expectedPublish: '', remark: '' },
  { row: 2, name: '需求B', taskType: 'UI设计', progress: '进行中', owner: '任治宁, 李昊', devStartTime: '', devEndTime: '', scheduledDone: '2026-03-01', expectedPublish: '', remark: '图待评审' },
  { row: 3, name: '需求A ', taskType: '软件开发', progress: '进行中', owner: '任治宁', devStartTime: '', devEndTime: '', scheduledDone: '', expectedPublish: '', remark: '批内同名' },
  { row: 4, name: '', taskType: '', progress: '进行中', owner: '任治宁', devStartTime: '', devEndTime: '', scheduledDone: '', expectedPublish: '', remark: '' },
  { row: 5, name: '需求C', taskType: '软件开发', progress: '瞎写的状态', owner: '任治宁', devStartTime: '', devEndTime: '', scheduledDone: '', expectedPublish: '', remark: '' },
  { row: 6, name: '需求D', taskType: '软件开发', progress: '进行中', owner: '别人', devStartTime: '', devEndTime: '', scheduledDone: '', expectedPublish: '', remark: '' },
  { row: 7, name: '需求E', taskType: '软件开发', progress: '进行中', owner: '任治宁', devStartTime: '2026/1/9', devEndTime: '', scheduledDone: '', expectedPublish: '', remark: '日期没转' },
]

test('planImport：过滤/校验/查重三类分流', () => {
  const plan = planImport(ROWS, { owner: '任治宁', existingNames: [] })
  assert.equal(plan.received, 7)
  assert.equal(plan.ownerFilteredOut, 1)
  assert.deepEqual(plan.added.map((a) => a.name), ['需求A', '需求B'])
  assert.deepEqual(plan.added.map((a) => a.status), ['published', 'inProgress'])
  assert.equal(plan.added[1].remark, '排期完成：2026-03-01；图待评审')
  assert.deepEqual(plan.skipped.map((s) => s.name), ['需求A'])
  assert.deepEqual(
    plan.failed.map((f) => f.reason),
    ['任务名称为空', '无法识别的任务进度：瞎写的状态', '日期格式非法（需 YYYY-MM-DD，机器人负责转换）'],
  )
})

test('planImport：与工作台既有需求按名称查重（trim + 忽略大小写）', () => {
  const plan = planImport(ROWS.slice(0, 2), { owner: '任治宁', existingNames: [' 需求a'] })
  assert.deepEqual(plan.added.map((a) => a.name), ['需求B'])
  assert.deepEqual(plan.skipped.map((s) => s.name), ['需求A'])
})

test('planImport：超出单次上限的部分进 failed 不静默丢弃', () => {
  const many = Array.from({ length: 12 }, (_, i) => ({
    row: i + 1, name: `批量需求${i}`, taskType: '软件开发', progress: '进行中', owner: '任治宁',
    devStartTime: '', devEndTime: '', scheduledDone: '', expectedPublish: '', remark: '',
  }))
  const plan = planImport(many, { owner: '任治宁', existingNames: [], maxAdd: 10 })
  assert.equal(plan.added.length, 10)
  assert.equal(plan.failed.length, 2)
  assert.ok(plan.failed[0].reason.includes('上限 10'))
})

/* ---------------- 6. 快照写入链路 ---------------- */

test('快照写入：plan → update → 回读字段齐全，二次导入全跳过', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'req-batch-test-'))
  try {
    const db = openDatabase(join(tmp, 'test.db'))
    // snapshots 表对 users 有外键，先建用户
    const salt = genSalt()
    new UserStore(db).create({ username: 'renzhining', pwHashHex: hashPassword('pw123456', salt), saltHex: salt })
    const store = new SnapshotStore(db)

    const rows = [
      { row: 1, name: '快手运营工具前端', taskType: '软件开发', progress: '已完成', owner: '任治宁', devStartTime: '2026-01-07', devEndTime: '2026-01-09', scheduledDone: '2026-01-09', expectedPublish: '', remark: '补录' },
      { row: 2, name: '体检中间页设计', taskType: 'UI设计', progress: '进行中', owner: '马振皎', devStartTime: '2026-01-19', devEndTime: '', scheduledDone: '', expectedPublish: '2026-02-10', remark: '' },
    ]
    const plan = planImport(rows, { owner: '任治宁', existingNames: [] })
    assert.equal(plan.added.length, 1)

    const nowIso = '2026-11-13T07:00:00.000Z'
    store.update('renzhining', (remote) => ({
      ...remote,
      requirements: [...(remote.requirements ?? []), ...plan.added.map((item) => buildRequirement(item, nowIso))],
    }))

    const snap = store.get('renzhining')
    assert.equal(snap.requirements.length, 1)
    const r = snap.requirements[0]
    assert.equal(r.name, '快手运营工具前端')
    assert.equal(r.status, 'published')
    assert.equal(r.devStartTime, '2026-01-07')
    assert.equal(r.devEndTime, '2026-01-09')
    assert.equal(r.publishTime, null)
    assert.equal(r.remark, '排期完成：2026-01-09；补录')
    assert.equal(r.source, 'bot')
    assert.ok(r.id && r.createdAt && r.updatedAt)
    assert.deepEqual(r.statusHistory, [{ status: 'published', at: nowIso }])

    // 二次导入：同名被查重跳过，不产生重复条目
    const existingNames = snap.requirements.filter((x) => !x.deletedAt).map((x) => x.name)
    const plan2 = planImport(rows, { owner: '任治宁', existingNames })
    assert.equal(plan2.added.length, 0)
    assert.equal(plan2.skipped.length, 1)

    db.close()
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})
