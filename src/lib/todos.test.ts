import { describe, expect, it } from 'vitest'
import { linkableRequirements } from './todos'
import type { Requirement } from '../types'

function mkReq(id: string, status: Requirement['status'], name = `需求${id}`): Requirement {
  return {
    id,
    name,
    project: 'ks',
    publishModule: '',
    projects: [{ project: 'ks', publishModule: '' }],
    branch: '',
    status,
    createdAt: '2026-11-01T09:00:00',
    devStartTime: null,
    devEndTime: null,
    testTime: null,
    publishTime: null,
    remark: '',
    updatedAt: '2026-11-01T09:00:00',
  }
}

describe('linkableRequirements', () => {
  it('过滤已上线/已完成/已归档/待开发/未开始，保留推进中的状态', () => {
    const reqs = [
      mkReq('1', 'developing'),
      mkReq('2', 'testing'),
      mkReq('3', 'ready'),
      mkReq('4', 'paused'),
      mkReq('5', 'inProgress'),
      mkReq('6', 'toConfirm'),
      mkReq('7', 'published'),
      mkReq('8', 'done'),
      mkReq('9', 'archived'),
      mkReq('10', 'pending'),
      mkReq('11', 'notStarted'),
    ]
    const got = linkableRequirements(reqs)
    expect(got.map((r) => r.id).sort()).toEqual(['1', '2', '3', '4', '5', '6'])
  })

  it('墓碑（deletedAt）不进候选', () => {
    const r = mkReq('1', 'developing')
    r.deletedAt = '2026-11-20T00:00:00'
    expect(linkableRequirements([r])).toHaveLength(0)
  })

  it('按 updatedAt 降序（最近在动的排前面）', () => {
    const a = mkReq('a', 'developing')
    const b = mkReq('b', 'testing')
    a.updatedAt = '2026-11-20T10:00:00'
    b.updatedAt = '2026-11-24T10:00:00'
    expect(linkableRequirements([a, b]).map((r) => r.id)).toEqual(['b', 'a'])
  })
})
