/**
 * 需求字段显隐与列表展示顺序配置（UI 偏好，仅本地存储，不进入云同步）
 *
 * 除「需求名称 name」（身份标识，恒显）外的全部需求字段都可配置显隐。
 * 默认全部可见；未配置/脏数据一律回退可见（向前兼容，旧本地数据也不会突然消失）。
 *
 * 消费方：表单（RequirementForm）、列表（RequirementTable / RequirementKanban）、
 * 详情抽屉（RequirementDrawer）四处联动，读同一份 visibleFields。
 *
 * 顺序（fieldOrder）只作用于「需求列表」的展示：桌面表格的列顺序与
 * 移动端卡片的字段块顺序。名称/备注/操作列的位置与现状保持一致。
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

/** 设置面板里的字段分组（仅用于排版，不影响任何逻辑） */
export const FIELD_GROUPS: { label: string; keys: RequirementFieldKey[] }[] = [
  { label: '基础信息', keys: ['project', 'module', 'branch', 'status', 'remark'] },
  { label: '时间信息', keys: ['createdAt', 'devStartTime', 'devEndTime', 'testTime', 'publishTime'] },
]

/** 字段中文名（按 key 取，未知 key 回退为 key 本身） */
export function fieldLabel(key: RequirementFieldKey): string {
  return REQUIREMENT_FIELDS.find((f) => f.key === key)?.label ?? key
}

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

/* ============================================================
   列表展示顺序（块级顺序）
   ============================================================ */

/**
 * 需求列表的「展示块」：桌面表格的一列 / 移动端卡片的一段。
 *
 * 一个块可以聚合多个字段（如「时间」块把 5 个时间字段并成一列），
 * 而需求列表的列并非与字段一一对应 —— 因此顺序以「字段顺序」持久化
 * （可扩展、不丢信息），在设置面板里以「块」为单位让用户调整。
 *
 * 说明：表格首列（需求名称，含备注）与末列（操作）为固定锚点，不参与排序。
 */
export type FieldBlockId = 'projectBranch' | 'module' | 'status' | 'time' | 'remark'

export interface FieldBlock {
  id: FieldBlockId
  label: string
  /** 该块覆盖的字段（顺序即块内相对顺序） */
  keys: RequirementFieldKey[]
  /** 固定块：不参与排序，位置由布局决定 */
  pinned?: boolean
  /** 固定原因（设置面板提示用） */
  pinnedHint?: string
}

export const FIELD_BLOCKS: readonly FieldBlock[] = [
  { id: 'projectBranch', label: '项目 / 分支', keys: ['project', 'branch'] },
  { id: 'module', label: '发布模块', keys: ['module'] },
  { id: 'status', label: '状态', keys: ['status'] },
  {
    id: 'time',
    label: '时间',
    keys: ['createdAt', 'devStartTime', 'devEndTime', 'testTime', 'publishTime'],
  },
  {
    id: 'remark',
    label: '备注',
    keys: ['remark'],
    pinned: true,
    pinnedHint: '跟随需求名称显示，不参与排序',
  },
]

const ORDER_STORAGE_KEY = 'dev-workbench:requirement-field-order'

/** 全部字段 key（注册表顺序，即默认顺序） */
const ALL_FIELD_KEYS = REQUIREMENT_FIELDS.map((f) => f.key) as RequirementFieldKey[]
const ALL_FIELD_KEY_SET = new Set<string>(ALL_FIELD_KEYS)

/** 默认顺序 = 注册表顺序 */
export function defaultFieldOrder(): RequirementFieldKey[] {
  return [...ALL_FIELD_KEYS]
}

/**
 * 把任意来源（localStorage / 旧数据 / 脏数据）合并为合法顺序：
 * 过滤非法值与重复项，缺失的 key 按默认顺序补齐到末尾。
 * 保证返回值一定是「全字段、无重复」的排列。
 */
export function mergeFieldOrder(partial: unknown): RequirementFieldKey[] {
  const out: RequirementFieldKey[] = []
  const seen = new Set<string>()
  if (Array.isArray(partial)) {
    for (const v of partial) {
      if (typeof v !== 'string' || !ALL_FIELD_KEY_SET.has(v) || seen.has(v)) continue
      seen.add(v)
      out.push(v as RequirementFieldKey)
    }
  }
  for (const k of ALL_FIELD_KEYS) if (!seen.has(k)) out.push(k)
  return out
}

/** 读取本地顺序（缺失/损坏时静默退回默认） */
export function loadFieldOrder(): RequirementFieldKey[] {
  try {
    const raw = localStorage.getItem(ORDER_STORAGE_KEY)
    if (!raw) return defaultFieldOrder()
    return mergeFieldOrder(JSON.parse(raw))
  } catch {
    return defaultFieldOrder()
  }
}

/** 写入本地顺序（失败静默，不阻断 UI） */
export function saveFieldOrder(order: RequirementFieldKey[]): void {
  try {
    localStorage.setItem(ORDER_STORAGE_KEY, JSON.stringify(order))
  } catch {
    /* 存储不可用：忽略，仅影响持久化 */
  }
}

/** 字段顺序 → 位置索引表（重复 key 取首次出现的位置） */
function orderIndex(order: RequirementFieldKey[]): Map<string, number> {
  const pos = new Map<string, number>()
  order.forEach((k, i) => {
    if (!pos.has(k)) pos.set(k, i)
  })
  return pos
}

/**
 * 按字段顺序派生块顺序。
 * 以块内「最早出现的字段」位置为块的排序键；一个字段都没命中的块排到最后
 * （保持注册表相对顺序），这样即使 order 里缺少某个块的字段也不会丢列。
 */
export function orderedFieldBlocks(order: RequirementFieldKey[]): FieldBlock[] {
  const pos = orderIndex(order)
  return FIELD_BLOCKS.map((block, index) => {
    let first: number | null = null
    for (const k of block.keys) {
      const p = pos.get(k)
      if (p === undefined) continue
      first = first === null ? p : Math.min(first, p)
    }
    return { block, index, first }
  })
    .sort((a, b) => {
      if (a.first === null && b.first === null) return a.index - b.index
      if (a.first === null) return 1
      if (b.first === null) return -1
      return a.first - b.first
    })
    .map((x) => x.block)
}

/** 可排序（非固定）块的当前顺序 —— 设置面板的拖拽列表 & 列表渲染都用它 */
export function orderedSortableBlocks(order: RequirementFieldKey[]): FieldBlock[] {
  return orderedFieldBlocks(order).filter((b) => !b.pinned)
}

/** 把一组块压平回「字段顺序」：块内保持原相对顺序，固定块统一附在末尾 */
function flattenBlocks(
  sortable: FieldBlock[],
  order: RequirementFieldKey[],
): RequirementFieldKey[] {
  const pos = orderIndex(order)
  const byCurrentOrder = (keys: RequirementFieldKey[]) =>
    [...keys].sort((a, b) => (pos.get(a) ?? 0) - (pos.get(b) ?? 0))

  const out: RequirementFieldKey[] = []
  for (const block of sortable) out.push(...byCurrentOrder(block.keys))
  for (const block of FIELD_BLOCKS) {
    if (block.pinned) out.push(...byCurrentOrder(block.keys))
  }
  // 兜底：注册表新增了未归入任何块的字段时，补齐到末尾，避免顺序数组丢字段
  for (const k of ALL_FIELD_KEYS) if (!out.includes(k)) out.push(k)
  return out
}

/**
 * 把某个可排序块移动到目标位置（0 起，越界自动 clamp）。
 * 返回新的字段顺序；块不存在或位置未变化时原样返回（引用相等，便于 React 跳过更新）。
 */
export function moveFieldBlock(
  order: RequirementFieldKey[],
  blockId: FieldBlockId,
  targetIndex: number,
): RequirementFieldKey[] {
  const sortable = orderedSortableBlocks(order)
  const from = sortable.findIndex((b) => b.id === blockId)
  if (from < 0) return order
  const to = Math.max(0, Math.min(sortable.length - 1, Math.trunc(targetIndex)))
  if (to === from) return order

  const next = [...sortable]
  const [moved] = next.splice(from, 1)
  next.splice(to, 0, moved)
  return flattenBlocks(next, order)
}

/** 按块 id 上/下移动一位（移动端与键盘无障碍替代拖拽） */
export function shiftFieldBlock(
  order: RequirementFieldKey[],
  blockId: FieldBlockId,
  delta: -1 | 1,
): RequirementFieldKey[] {
  const sortable = orderedSortableBlocks(order)
  const from = sortable.findIndex((b) => b.id === blockId)
  if (from < 0) return order
  return moveFieldBlock(order, blockId, from + delta)
}

