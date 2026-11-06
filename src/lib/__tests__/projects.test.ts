import { describe, it, expect } from 'vitest'
import {
  normalizeRequirement,
  requirementProjectModules,
  isProjectPublished,
} from '../projects'
import type { Requirement } from '../../types'

/** 最小合法需求（其余字段由 normalizeRequirement 兜底） */
const base = {
  id: 'r1',
  name: '需求A',
  branch: 'feature/20260101/REQ-1',
  status: 'developing' as Requirement['status'],
  createdAt: '2026-01-01',
  devStartTime: null,
  devEndTime: null,
  testTime: null,
  publishTime: null,
  remark: '',
  updatedAt: '2026-01-01',
}

describe('项目维度上线状态（分批上线）', () => {
  it('结构化 projects：publishedAt 原样保留，缺失归一为 null', () => {
    const r = normalizeRequirement({
      ...base,
      project: 'icare-a',
      publishModule: '',
      projects: [
        { project: 'icare-a', publishModule: 'make/', publishedAt: '2026-02-01T00:00:00.000Z' },
        { project: 'icare-b', publishModule: '' },
      ],
    })
    expect(r.projects).toHaveLength(2)
    expect(r.projects[0].publishedAt).toBe('2026-02-01T00:00:00.000Z')
    expect(r.projects[1].publishedAt).toBe(null)
    expect(isProjectPublished(r.projects[0])).toBe(true)
    expect(isProjectPublished(r.projects[1])).toBe(false)
  })

  it('旧数据迁移：已上线/已归档且有 publishTime → 各项目回填该时间', () => {
    const r = normalizeRequirement({
      ...base,
      status: 'published',
      publishTime: '2026-03-05',
      project: 'icare-a, icare-b',
      publishModule: 'make/',
    })
    expect(r.projects).toHaveLength(2)
    expect(r.projects[0].project).toBe('icare-a')
    expect(r.projects[1].project).toBe('icare-b')
    // 首个项目继承旧 publishModule
    expect(r.projects[0].publishModule).toBe('make/')
    expect(r.projects[0].publishedAt).toBe('2026-03-05')
    expect(r.projects[1].publishedAt).toBe('2026-03-05')
  })

  it('旧数据迁移：未上线状态不回填 publishedAt（避免误标成已上线）', () => {
    const r = normalizeRequirement({
      ...base,
      status: 'developing',
      publishTime: '2026-03-05',
      project: 'icare-a',
      publishModule: '',
    })
    expect(r.projects).toHaveLength(1)
    expect(r.projects[0].publishedAt).toBe(null)
  })

  it('requirementProjectModules 透传 publishedAt，空模块兜底为「全量」口径的空串', () => {
    const r = normalizeRequirement({
      ...base,
      project: 'icare-a',
      publishModule: '',
      projects: [
        { project: 'icare-a', publishModule: 'make/', publishedAt: '2026-02-01T00:00:00.000Z' },
        { project: 'icare-b', publishModule: '', publishedAt: null },
      ],
    })
    const items = requirementProjectModules(r)
    expect(items).toEqual([
      { project: 'icare-a', module: 'make/', publishedAt: '2026-02-01T00:00:00.000Z' },
      { project: 'icare-b', module: '', publishedAt: null },
    ])
  })

  it('normalizeRequirement 幂等：重复执行不丢 publishedAt', () => {
    const once = normalizeRequirement({
      ...base,
      project: 'icare-a',
      publishModule: '',
      projects: [{ project: 'icare-a', publishModule: '', publishedAt: '2026-04-01T00:00:00.000Z' }],
    })
    const twice = normalizeRequirement(once)
    expect(twice.projects[0].publishedAt).toBe('2026-04-01T00:00:00.000Z')
  })
})
