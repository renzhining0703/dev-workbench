/**
 * 需求状态显隐配置（UI 偏好；已随账号同步 —— 打包进 settings.uiPrefs，见 lib/uiPrefs.ts）
 *
 * 与字段显隐（fields.ts）同理：用户在偏好里勾选要展示的状态枚举，勾选才展示、
 * 默认全展示。作用于「筛选 pill、状态下拉（新建/编辑/详情/列表/批量）、看板列、
 * 抽屉状态流转」联动；隐藏状态的数据在「全部」视图仍可见（隐藏 ≠ 删数据）。
 *
 * 注意：显隐只控制「可选/可筛」入口，不影响数据本身；统计页口径跟随此配置
 * （见 lib/stats.ts 的 resolveStatusView，隐藏状态不参与统计与图表）。
 */

import { STATUS_FLOW, statusMeta } from '../types'
import type { RequirementStatus } from '../types'

export type VisibleStatuses = Record<RequirementStatus, boolean>

const STORAGE_KEY = 'dev-workbench:requirement-statuses'

/** 全部状态默认可见 */
export function defaultVisibleStatuses(): VisibleStatuses {
  const out = {} as VisibleStatuses
  for (const s of STATUS_FLOW) out[s] = true
  return out
}

/**
 * 把任意来源（localStorage / 旧数据 / 脏数据）合并为合法配置。
 * 缺键或非布尔值一律回退默认（true），显式 false 保留。
 */
export function mergeVisibleStatuses(partial: unknown): VisibleStatuses {
  const def = defaultVisibleStatuses()
  if (!partial || typeof partial !== 'object') return def
  const src = partial as Record<string, unknown>
  for (const s of STATUS_FLOW) {
    const v = src[s]
    if (typeof v === 'boolean') def[s] = v
  }
  return def
}

/** 某状态是否可见（map 缺键按默认 true 处理） */
export function isStatusVisible(visible: VisibleStatuses, status: RequirementStatus): boolean {
  return visible[status] !== false
}

/** 读取本地配置（localStorage 缺失/损坏时静默退回默认） */
export function loadVisibleStatuses(): VisibleStatuses {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return defaultVisibleStatuses()
    return mergeVisibleStatuses(JSON.parse(raw))
  } catch {
    return defaultVisibleStatuses()
  }
}

/** 写入本地配置（失败静默，不阻断 UI） */
export function saveVisibleStatuses(statuses: VisibleStatuses): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(statuses))
  } catch {
    /* 存储不可用：忽略，仅影响持久化 */
  }
}

/** 状态下拉选项类型（与 Select 的 SelectOption 结构兼容） */
export interface StatusOption {
  value: RequirementStatus
  label: string
  dot: string
  color: string
}

/** 状态流转历史条目（随 Requirement 整体 LWW 同步，见 types 里 statusHistory） */
export interface StatusHistoryItem {
  status: RequirementStatus
  at: string
}

/**
 * 计算状态变更后的 statusHistory（纯函数）。
 * - status 没变 → 原样返回既有历史（undefined 保持 undefined，不给老数据凭空造历史）
 * - 首次变更且旧数据无历史 → 用「旧状态 @ updatedAt」补一个起点，再追加新状态
 * - 正常情况 → 在既有历史后追加
 */
export function buildStatusHistory(
  prev: {
    status: RequirementStatus
    statusHistory?: StatusHistoryItem[]
    updatedAt?: string
    createdAt?: string
  },
  nextStatus: RequirementStatus,
  nowIso: string,
): StatusHistoryItem[] | undefined {
  if (prev.status === nextStatus) return prev.statusHistory
  const base: StatusHistoryItem[] = prev.statusHistory
    ? [...prev.statusHistory]
    : [{ status: prev.status, at: prev.updatedAt ?? prev.createdAt ?? nowIso }]
  base.push({ status: nextStatus, at: nowIso })
  return base
}

/**
 * 生成可见状态的下拉选项（按 STATUS_FLOW 顺序）。
 * `include` 传当前值以保底展示：某状态被隐藏但其当前值仍在下拉里，
 * 避免把当前值显示成裸 key。
 */
export function visibleStatusOptions(
  visible: VisibleStatuses,
  include?: RequirementStatus,
): StatusOption[] {
  const out: StatusOption[] = []
  for (const s of STATUS_FLOW) {
    if (!isStatusVisible(visible, s) && s !== include) continue
    const m = statusMeta(s)
    out.push({ value: s, label: m.label, dot: m.dot, color: m.color })
  }
  return out
}
