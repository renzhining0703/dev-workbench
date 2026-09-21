/**
 * 使用视角预设（开发 / 产品 / 自定义）
 *
 * 背景：11 个需求状态实际是两套词汇的并集 ——
 *   开发流：pending / developing / testing / ready / paused / published / archived
 *   产品流：notStarted / inProgress / toConfirm / done
 * 前端开发与产品经理共用本工具时，各自只需要其中一套词汇与关注字段。
 *
 * 预设 = 一次性写入三份既有本地配置（字段显隐 / 状态显隐 / 列顺序），
 * 不引入新的渲染分支：点「产品视角」等价于帮使用者把设置面板批量调好。
 * 选择预设后，任何手动调整（开关 / 拖拽 / 恢复默认）自动降级为 custom，不弹窗打扰。
 *
 * 兼容性（重要）：
 *   - 未选择过视角的老用户 = custom，界面与升级前完全一致（默认全显）
 *   - 不新增/删除/改名任何状态枚举，旧数据 status 原样有效
 *   - 三个既有 localStorage key 语义不变，本模块只新增 ui-role 一个 key
 */

import type { RequirementStatus } from '../types'
import {
  defaultFieldOrder,
  defaultVisibleFields,
  mergeFieldOrder,
  type RequirementFieldKey,
  type VisibleFields,
} from './fields'
import { isStatusVisible, type VisibleStatuses } from './statuses'

export type UiRole = 'dev' | 'pm' | 'custom'

const ROLE_STORAGE_KEY = 'dev-workbench:ui-role'

/** 开发流状态（前端开发视角关注的 7 个） */
export const DEV_STATUSES: readonly RequirementStatus[] = [
  'pending',
  'developing',
  'testing',
  'ready',
  'paused',
  'published',
  'archived',
]

/** 产品流状态（产品经理视角关注的 4 个） */
export const PM_STATUSES: readonly RequirementStatus[] = [
  'notStarted',
  'inProgress',
  'toConfirm',
  'done',
]

/**
 * 产品视角下隐藏的技术字段。
 * 保留：需求名称（恒显）/ 当前状态 / 创建时间 / 开始时间 / 完成时间 / 备注
 * 隐藏：所属项目、发布模块、代码分支、提测时间、上线时间
 */
const PM_HIDDEN_FIELD_KEYS: readonly RequirementFieldKey[] = [
  'project',
  'module',
  'branch',
  'testTime',
  'publishTime',
]

/** 产品视角新建需求时的默认状态（产品流起点，而非开发流的 pending） */
const PM_DEFAULT_STATUS: RequirementStatus = 'notStarted'
/** 开发视角新建需求时的默认状态（保持既有行为） */
const DEV_DEFAULT_STATUS: RequirementStatus = 'pending'

export interface RolePreset {
  id: Exclude<UiRole, 'custom'>
  label: string
  desc: string
  visibleStatuses: VisibleStatuses
  visibleFields: VisibleFields
  fieldOrder: RequirementFieldKey[]
}

/** 按白名单生成状态显隐配置（名单外全部隐藏） */
function statusesFrom(allowed: readonly RequirementStatus[]): VisibleStatuses {
  const out = {} as VisibleStatuses
  const allow = new Set<string>(allowed)
  for (const s of [...DEV_STATUSES, ...PM_STATUSES]) out[s] = allow.has(s)
  return out
}

/** 按黑名单生成字段显隐配置（名单外全部可见） */
function fieldsExcluding(hidden: readonly RequirementFieldKey[]): VisibleFields {
  const out = defaultVisibleFields()
  for (const k of hidden) out[k] = false
  return out
}

export const ROLE_PRESETS: readonly RolePreset[] = [
  {
    id: 'dev',
    label: '开发视角',
    desc: '展示开发全流程状态与分支、提测、上线时间等技术字段',
    visibleStatuses: statusesFrom(DEV_STATUSES),
    visibleFields: defaultVisibleFields(),
    fieldOrder: defaultFieldOrder(),
  },
  {
    id: 'pm',
    label: '产品视角',
    desc: '只保留未开始 / 进行中 / 待确认 / 已完成，隐藏所属项目、分支等技术字段',
    visibleStatuses: statusesFrom(PM_STATUSES),
    visibleFields: fieldsExcluding(PM_HIDDEN_FIELD_KEYS),
    // 种子顺序：状态列最前，其次时间块（创建 / 开始 / 完成）；其余字段由 mergeFieldOrder 补齐
    fieldOrder: mergeFieldOrder(['status', 'createdAt', 'devStartTime', 'devEndTime']),
  },
]

export function findRolePreset(id: Exclude<UiRole, 'custom'>): RolePreset | undefined {
  return ROLE_PRESETS.find((p) => p.id === id)
}

/**
 * 是否处于「产品口径」——看得到 done、看不到 published。
 *
 * 这是「视角判定」的唯一事实来源：统计口径（lib/stats.ts resolveStatusView）
 * 与新建需求的默认状态都以它为准，避免两处判定逻辑漂移。
 */
export function isPmView(visible: VisibleStatuses): boolean {
  return isStatusVisible(visible, 'done') && !isStatusVisible(visible, 'published')
}

/**
 * 新建 / 克隆需求时的默认状态。
 * 产品视角落到产品流起点「未开始」，其余口径保持既有「待开发」。
 */
export function defaultStatusForNewRequirement(visible: VisibleStatuses): RequirementStatus {
  return isPmView(visible) ? PM_DEFAULT_STATUS : DEV_DEFAULT_STATUS
}

/** 角色中文名（UI 展示用） */
export function roleLabel(role: UiRole): string {
  if (role === 'dev') return '开发视角'
  if (role === 'pm') return '产品视角'
  return '自定义'
}

/** 任意来源 → 合法角色（脏数据回退 custom） */
export function mergeUiRole(raw: unknown): UiRole {
  return raw === 'dev' || raw === 'pm' ? raw : 'custom'
}

/** 读取本地角色（缺失/损坏时静默回退 custom = 保持现状配置） */
export function loadUiRole(): UiRole {
  try {
    return mergeUiRole(localStorage.getItem(ROLE_STORAGE_KEY))
  } catch {
    return 'custom'
  }
}

/** 写入本地角色（失败静默，不阻断 UI） */
export function saveUiRole(role: UiRole): void {
  try {
    localStorage.setItem(ROLE_STORAGE_KEY, role)
  } catch {
    /* 存储不可用：忽略，仅影响持久化 */
  }
}
