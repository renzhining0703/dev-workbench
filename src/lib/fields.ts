/**
 * 需求字段显隐配置（UI 偏好，仅本地存储，不进入云同步）
 *
 * 除「需求名称 name」（身份标识，恒显）外的全部需求字段都可配置显隐。
 * 默认全部可见；未配置/脏数据一律回退可见（向前兼容，旧本地数据也不会突然消失）。
 *
 * 消费方：表单（RequirementForm）、列表（RequirementTable / RequirementKanban）、
 * 详情抽屉（RequirementDrawer）四处联动，读同一份 visibleFields。
 */

export const REQUIREMENT_FIELDS = [
  { key: 'project', label: '所属项目' },
  { key: 'module', label: '发布模块' },
  { key: 'branch', label: '代码分支' },
  { key: 'status', label: '当前状态' },
  { key: 'createdAt', label: '创建时间' },
  { key: 'devStartTime', label: '开始时间' },
  { key: 'devEndTime', label: '完成时间' },
  { key: 'testTime', label: '提测时间' },
  { key: 'publishTime', label: '上线时间' },
  { key: 'remark', label: '备注' },
] as const

export type RequirementFieldKey = (typeof REQUIREMENT_FIELDS)[number]['key']

export type VisibleFields = Record<RequirementFieldKey, boolean>

/**
 * 时间类字段（供列表/抽屉/看板过滤时间线复用）。
 * 与 RequirementFieldKey 不同，这些 key 直接对应 Requirement 实体的时间字段，
 * 可直接 r[key] 取值（RequirementFieldKey 含 'module' 等 UI 别名，不可直接索引实体）。
 */
export const TIME_FIELD_KEYS = [
  'createdAt',
  'devStartTime',
  'devEndTime',
  'testTime',
  'publishTime',
] as const

export type TimeFieldKey = (typeof TIME_FIELD_KEYS)[number]

const STORAGE_KEY = 'dev-workbench:requirement-fields'

/** 全字段默认可见 */
export function defaultVisibleFields(): VisibleFields {
  const out = {} as VisibleFields
  for (const f of REQUIREMENT_FIELDS) out[f.key] = true
  return out
}

/**
 * 把任意来源（localStorage / 旧数据 / 脏数据）合并为合法配置。
 * 缺键或非布尔值一律回退默认（true），显式 false 保留。
 */
export function mergeVisibleFields(partial: unknown): VisibleFields {
  const def = defaultVisibleFields()
  if (!partial || typeof partial !== 'object') return def
  const src = partial as Record<string, unknown>
  for (const f of REQUIREMENT_FIELDS) {
    const v = src[f.key]
    if (typeof v === 'boolean') def[f.key] = v
  }
  return def
}

/** 某字段是否可见（fields 缺键按默认 true 处理） */
export function isVisible(fields: VisibleFields, key: RequirementFieldKey): boolean {
  return fields[key] !== false
}

/** 读取本地配置（localStorage 缺失/损坏时静默退回默认） */
export function loadVisibleFields(): VisibleFields {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return defaultVisibleFields()
    return mergeVisibleFields(JSON.parse(raw))
  } catch {
    return defaultVisibleFields()
  }
}

/** 写入本地配置（失败静默，不阻断 UI） */
export function saveVisibleFields(fields: VisibleFields): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(fields))
  } catch {
    /* 存储不可用：忽略，仅影响持久化 */
  }
}
