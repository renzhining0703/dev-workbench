/**
 * src/lib/rolePresets.ts 纯函数单测 —— 固化「使用视角」预设的结构约束
 * （node 环境无 localStorage，load/save 不做单测；只测纯函数与预设数据）
 */
import { describe, it, expect } from 'vitest'
import { STATUS_FLOW } from '../../types'
import {
  DEV_STATUSES,
  PM_STATUSES,
  ROLE_PRESETS,
  defaultStatusForNewRequirement,
  findRolePreset,
  isPmView,
  mergeUiRole,
  roleLabel,
} from '../rolePresets'
import { defaultVisibleFields, defaultFieldOrder, mergeFieldOrder } from '../fields'
import { defaultVisibleStatuses } from '../statuses'

describe('预设数据结构', () => {
  it('两套状态词汇恰好是 11 个枚举的划分（无重叠、无遗漏）', () => {
    expect(DEV_STATUSES.length).toBe(7)
    expect(PM_STATUSES.length).toBe(4)
    const union = [...DEV_STATUSES, ...PM_STATUSES]
    expect(new Set(union).size).toBe(union.length)
    expect(union.slice().sort()).toEqual([...STATUS_FLOW].sort())
  })

  it('开发预设 = 开发流状态全显、产品流状态隐藏、字段与顺序保持默认', () => {
    const dev = findRolePreset('dev')
    expect(dev).toBeDefined()
    for (const s of DEV_STATUSES) expect(dev!.visibleStatuses[s]).toBe(true)
    for (const s of PM_STATUSES) expect(dev!.visibleStatuses[s]).toBe(false)
    expect(dev!.visibleFields).toEqual(defaultVisibleFields())
    expect(dev!.fieldOrder).toEqual(defaultFieldOrder())
  })

  it('产品预设：只保留 4 个产品状态，字段保留「状态/创建/开始/完成/备注」', () => {
    const pm = findRolePreset('pm')
    expect(pm).toBeDefined()
    // 产品状态可见、开发状态全隐藏
    for (const s of PM_STATUSES) expect(pm!.visibleStatuses[s]).toBe(true)
    for (const s of DEV_STATUSES) expect(pm!.visibleStatuses[s]).toBe(false)
    // 保留字段
    expect(pm!.visibleFields.status).toBe(true)
    expect(pm!.visibleFields.createdAt).toBe(true)
    expect(pm!.visibleFields.devStartTime).toBe(true)
    expect(pm!.visibleFields.devEndTime).toBe(true)
    expect(pm!.visibleFields.remark).toBe(true)
    // 隐藏字段：所属项目 / 发布模块 / 代码分支 / 提测时间 / 上线时间
    expect(pm!.visibleFields.project).toBe(false)
    expect(pm!.visibleFields.module).toBe(false)
    expect(pm!.visibleFields.branch).toBe(false)
    expect(pm!.visibleFields.testTime).toBe(false)
    expect(pm!.visibleFields.publishTime).toBe(false)
    // 列顺序合法（mergeFieldOrder 补齐缺失字段），状态列在前、时间字段紧随
    expect(pm!.fieldOrder).toEqual(mergeFieldOrder(pm!.fieldOrder))
    expect(pm!.fieldOrder.slice(0, 4)).toEqual(['status', 'createdAt', 'devStartTime', 'devEndTime'])
  })
})

describe('isPmView / defaultStatusForNewRequirement', () => {
  const pmVisible = ROLE_PRESETS.find((p) => p.id === 'pm')!.visibleStatuses
  const devVisible = ROLE_PRESETS.find((p) => p.id === 'dev')!.visibleStatuses

  it('看得到 done、看不到 published 才算产品口径', () => {
    expect(isPmView(pmVisible)).toBe(true)
    expect(isPmView(devVisible)).toBe(false)
    expect(isPmView(defaultVisibleStatuses())).toBe(false) // 老用户全显 = 开发口径
    const both = defaultVisibleStatuses()
    both.published = false
    both.done = false
    expect(isPmView(both)).toBe(false) // 都隐藏 → 不算产品口径
  })

  it('新建需求默认状态：产品视角「未开始」，其余「待开发」', () => {
    expect(defaultStatusForNewRequirement(pmVisible)).toBe('notStarted')
    expect(defaultStatusForNewRequirement(devVisible)).toBe('pending')
    expect(defaultStatusForNewRequirement(defaultVisibleStatuses())).toBe('pending')
  })
})

describe('mergeUiRole', () => {
  it('合法值透传，其余（含脏数据）回退 custom', () => {
    expect(mergeUiRole('dev')).toBe('dev')
    expect(mergeUiRole('pm')).toBe('pm')
    expect(mergeUiRole('custom')).toBe('custom')
    expect(mergeUiRole('DEV')).toBe('custom')
    expect(mergeUiRole(null)).toBe('custom')
    expect(mergeUiRole(undefined)).toBe('custom')
    expect(mergeUiRole(42)).toBe('custom')
    expect(mergeUiRole({})).toBe('custom')
  })
})

describe('roleLabel', () => {
  it('三种角色均有中文名', () => {
    expect(roleLabel('dev')).toBe('开发视角')
    expect(roleLabel('pm')).toBe('产品视角')
    expect(roleLabel('custom')).toBe('自定义')
  })
})

describe('ROLE_PRESETS 完整性', () => {
  it('只包含 dev / pm 两个可点击预设（custom 不是按钮）', () => {
    expect(ROLE_PRESETS.map((p) => p.id).sort()).toEqual(['dev', 'pm'])
  })
})
