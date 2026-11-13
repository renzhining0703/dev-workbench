/** 需求状态 */
export type RequirementStatus =
  | 'pending' // 待开发
  | 'developing' // 开发中
  | 'testing' // 测试中
  | 'ready' // 待上线
  | 'paused' // 暂停
  | 'published' // 已上线
  | 'archived' // 已归档
  | 'notStarted' // 未开始
  | 'inProgress' // 进行中
  | 'toConfirm' // 待确认
  | 'done' // 已完成

/** 需求-项目关联：一个需求可涉及多个项目，每个项目各自的发布模块与上线状态 */
export interface RequirementProject {
  /** 项目名（对应项目库 Project.name） */
  project: string
  /** 发布模块：支持分模块发布的项目可填（如 make/、admin/），空 = 全量发布 */
  publishModule: string
  /**
   * 该项目单独的上线时间（ISO）；null / 缺省 = 尚未上线。
   * 一个需求涉及多个项目时可能分批上线，故上线状态记在项目维度，
   * 与需求整体的 status / publishTime 互不覆盖。
   */
  publishedAt?: string | null
}

/** 状态流转历史条目：状态每次变化追加一条（可选字段，老数据无此字段不迁移） */
export interface StatusHistoryItem {
  status: RequirementStatus
  /** 变更时间 ISO */
  at: string
}

/** 需求实体 */
export interface Requirement {
  id: string
  /** 需求名称 */
  name: string
  /**
   * 所属项目（兼容字段）：恒等于 projects[0]?.project ?? ''。
   * 历史数据可能是逗号分隔多项目文本，加载时由 normalizeRequirement 拆入 projects。
   */
  project: string
  /**
   * 发布模块（兼容字段）：恒等于 projects[0]?.publishModule ?? ''。
   */
  publishModule: string
  /** 所属项目（结构化多值） */
  projects: RequirementProject[]
  /** 代码分支 */
  branch: string
  /** PRD 文档链接（飞书等）；机器人据此扫描 PRD 变更，可空 */
  prdUrl?: string
  /** 当前状态 */
  status: RequirementStatus
  /**
   * 状态流转历史（append-only）。可选：上线前创建的老数据没有历史，
   * 首次状态变更时由 lib/statuses.ts 的 buildStatusHistory 自动补起点。
   */
  statusHistory?: StatusHistoryItem[]
  /** 创建时间 */
  createdAt: string
  /** 开始时间 */
  devStartTime: string | null
  /** 完成时间 */
  devEndTime: string | null
  /** 提测时间 */
  testTime: string | null
  /** 上线时间 */
  publishTime: string | null
  /** 备注 */
  remark: string
  /** 更新时间 */
  updatedAt: string
  /** 软删除墓碑 ISO（同步协议：删除打墓碑参与 LWW 合并，UI 层过滤；超 90 天物理清理） */
  deletedAt?: string
}

/** 待办优先级：high 置顶红标 / normal 默认 / low 沉底灰标 */
export type TodoPriority = 'low' | 'normal' | 'high'

/** 待办事项 */
export interface TodoItem {
  id: string
  content: string
  /** 目标日期 yyyy-MM-dd */
  date: string
  done: boolean
  /** 完成时间 ISO：勾选时写入，取消勾选清除（历史/统计用） */
  completedAt?: string
  /** 优先级：缺省 normal */
  priority?: TodoPriority
  /** 关联需求 id：从今日节点一键生成待办时写入，可点击跳回需求抽屉 */
  requirementId?: string
  /** 来源：bot = 机器人写入（wb-todo-add），缺省视为用户手写 */
  source?: 'bot'
  createdAt: string
  /** 最后更新时间（同步用，缺字段视为 createdAt） */
  updatedAt?: string
  /** 软删除墓碑 ISO（同步协议：删除打墓碑参与 LWW 合并，UI 层过滤；超 90 天物理清理） */
  deletedAt?: string
}

/** 项目（下拉选项数据源，独立维护） */
export interface Project {
  id: string
  /** 规范项目名，如 icare-zfl-febase */
  name: string
  /** 是否支持分模块发布（如 make/、admin/ 等路径发布）；旧数据缺字段视为 false */
  moduleBased?: boolean
  /** 创建时间 yyyy-MM-dd */
  createdAt: string
  /** 最后更新时间（同步用，缺字段视为 createdAt） */
  updatedAt?: string
  /** 软删除墓碑 ISO（同步协议：删除打墓碑参与 LWW 合并，UI 层过滤；超 90 天物理清理） */
  deletedAt?: string
}

/* ---------------- 密码管理 ---------------- */

/**
 * 密码条目的敏感字段（整体加密为 enc 密文，服务器/同步链路只见密文）。
 * 加密：src/lib/cipher.ts（AES-GCM，主密码 PBKDF2 派生密钥）。
 */
export interface PasswordSecret {
  username: string
  password: string
  notes: string
}

/** 密码条目（第四同步实体）：title/url/tags 明文，敏感字段整体密文 */
export interface PasswordEntry {
  id: string
  /** 名称（搜索主键，明文同步） */
  title: string
  /** 网址（明文同步） */
  url?: string
  /** 标签（明文同步，平铺搜索用，替代分类） */
  tags?: string[]
  /**
   * 敏感字段密文：base64(salt[16] || iv[12] || AES-GCM(JSON(PasswordSecret)))。
   * 缺省 = 条目尚未加密落盘（理论不出现，容错视为空敏感字段）。
   */
  enc?: string
  createdAt: string
  updatedAt: string
  /** 软删除墓碑 ISO（同步协议同其余实体） */
  deletedAt?: string
}

/** 密码生成器选项（参考 passlock） */
export interface GeneratorOptions {
  length: number
  uppercase: boolean
  lowercase: boolean
  numbers: boolean
  symbols: boolean
}

export const STATUS_META: Record<
  RequirementStatus,
  { label: string; color: string; dot: string }
> = {
  pending: { label: '待开发', color: 'text-slate-500 dark:text-slate-400', dot: 'bg-slate-400' },
  developing: { label: '开发中', color: 'text-blue-600 dark:text-blue-400', dot: 'bg-blue-500' },
  testing: { label: '测试中', color: 'text-amber-600 dark:text-amber-400', dot: 'bg-amber-500' },
  ready: { label: '待上线', color: 'text-purple-600 dark:text-purple-400', dot: 'bg-purple-500' },
  paused: { label: '暂停', color: 'text-orange-600 dark:text-orange-400', dot: 'bg-orange-500' },
  published: { label: '已上线', color: 'text-emerald-600 dark:text-emerald-400', dot: 'bg-emerald-500' },
  archived: { label: '已归档', color: 'text-slate-400 dark:text-slate-500', dot: 'bg-slate-400' },
  notStarted: { label: '未开始', color: 'text-cyan-600 dark:text-cyan-400', dot: 'bg-cyan-500' },
  inProgress: { label: '进行中', color: 'text-indigo-600 dark:text-indigo-400', dot: 'bg-indigo-500' },
  toConfirm: { label: '待确认', color: 'text-rose-600 dark:text-rose-400', dot: 'bg-rose-500' },
  done: { label: '已完成', color: 'text-teal-600 dark:text-teal-400', dot: 'bg-teal-500' },
}

/**
 * 安全取状态元信息：数据可能来自同步服务端/导入/旧版本，
 * 一条非法 status 不应把整个页面炸成白屏。未知状态降级为「待开发」。
 */
export function statusMeta(status: string): { label: string; color: string; dot: string } {
  return STATUS_META[status as RequirementStatus] ?? STATUS_META.pending
}

/** 状态流转顺序（用于下拉和排序） */
export const STATUS_FLOW: RequirementStatus[] = [
  'pending',
  'developing',
  'testing',
  'ready',
  'paused',
  'published',
  'archived',
  'notStarted',
  'inProgress',
  'toConfirm',
  'done',
]
