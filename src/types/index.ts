/** 需求状态 */
export type RequirementStatus =
  | 'pending' // 待开发
  | 'developing' // 开发中
  | 'testing' // 测试中
  | 'ready' // 待上线
  | 'paused' // 暂停
  | 'published' // 已上线
  | 'archived' // 已归档

/** 需求实体 */
export interface Requirement {
  id: string
  /** 需求名称 */
  name: string
  /** 所属项目（如 febase） */
  project: string
  /** 代码分支 */
  branch: string
  /** 发布模块：支持分模块发布，如 make/、admin/ 等路径 */
  publishModule: string
  /** 当前状态 */
  status: RequirementStatus
  /** 创建时间 */
  createdAt: string
  /** 开发开始时间 */
  devStartTime: string | null
  /** 开发结束时间 */
  devEndTime: string | null
  /** 提测时间 */
  testTime: string | null
  /** 上线时间 */
  publishTime: string | null
  /** 备注 */
  remark: string
  /** 更新时间 */
  updatedAt: string
}

/** 待办事项 */
export interface TodoItem {
  id: string
  content: string
  /** 目标日期 yyyy-MM-dd */
  date: string
  done: boolean
  createdAt: string
}

/** 项目（下拉选项数据源，独立维护） */
export interface Project {
  id: string
  /** 规范项目名，如 icare-zfl-febase */
  name: string
  /** 创建时间 yyyy-MM-dd */
  createdAt: string
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
]
