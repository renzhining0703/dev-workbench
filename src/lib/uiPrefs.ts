/**
 * UI 偏好打包随账号同步（settings.uiPrefs 通道）
 *
 * 服务端对 settings 做字段级展开合并且未知 key 透传保留（server/lib/merge.mjs），
 * 因此把角色 / 字段显隐 / 状态显隐 / 列顺序打包成 settings.uiPrefs 上传，
 * **服务端零改动**；旧客户端不认识该字段就忽略，缺字段即旧行为。
 *
 * 冲突策略：uiPrefs.updatedAt 时间戳 LWW ——
 *   - 本地任意偏好变更时打当前时间戳
 *   - applyRemote 仅在远端时间戳更新时覆盖本地
 * 避免出现「pull 到旧偏好把刚改好的本地配置冲回去」的问题。
 */

import { mergeFieldOrder, mergeVisibleFields, type RequirementFieldKey, type VisibleFields } from './fields'
import { mergeVisibleStatuses, type VisibleStatuses } from './statuses'
import { mergeUiRole, type UiRole } from './rolePresets'

export interface UiPrefs {
  /** 偏好最后变更时间（ISO）——跨设备 LWW 判定用 */
  updatedAt: string
  role: UiRole
  visibleFields: VisibleFields
  visibleStatuses: VisibleStatuses
  fieldOrder: RequirementFieldKey[]
}

const TS_STORAGE_KEY = 'dev-workbench:ui-prefs-ts'

/** 时间戳的本地持久化（刷新后仍记得自己是「新」的，不会被旧远端覆盖） */
export function loadUiPrefsTs(): string {
  try {
    const raw = localStorage.getItem(TS_STORAGE_KEY)
    if (raw) return raw
  } catch {
    /* 存储不可用：按纪元处理（远端任意有效偏好都胜出） */
  }
  return new Date(0).toISOString()
}

export function saveUiPrefsTs(ts: string): void {
  try {
    localStorage.setItem(TS_STORAGE_KEY, ts)
  } catch {
    /* 存储不可用：忽略，仅影响持久化 */
  }
}

/** 任意来源（服务端 / 旧数据 / 脏数据）→ 合法 UiPrefs；结构非法返回 null */
export function mergeUiPrefs(raw: unknown): UiPrefs | null {
  if (!raw || typeof raw !== 'object') return null
  const src = raw as Record<string, unknown>
  const updatedAt =
    typeof src.updatedAt === 'string' && src.updatedAt ? src.updatedAt : new Date(0).toISOString()
  return {
    updatedAt,
    role: mergeUiRole(src.role),
    visibleFields: mergeVisibleFields(src.visibleFields),
    visibleStatuses: mergeVisibleStatuses(src.visibleStatuses),
    fieldOrder: mergeFieldOrder(src.fieldOrder),
  }
}

/** 时间戳比较：a 是否严格晚于 b（解析失败按 0 处理） */
export function isTsAfter(a: string, b: string): boolean {
  const ta = Date.parse(a)
  const tb = Date.parse(b)
  return (Number.isNaN(ta) ? 0 : ta) > (Number.isNaN(tb) ? 0 : tb)
}
