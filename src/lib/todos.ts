import type { Requirement, RequirementStatus, TodoItem, TodoPriority } from '../types'
import { toDateStr } from './utils'

/** 优先级元信息：展示标签 / 排序权重（越小越靠前） */
export const PRIORITY_META: Record<
  TodoPriority,
  { label: string; rank: number; chip: string; dot: string }
> = {
  high: { label: '高', rank: 0, chip: 'bg-rose-100 text-rose-600 dark:bg-rose-500/20 dark:text-rose-300', dot: 'bg-rose-500' },
  normal: { label: '普通', rank: 1, chip: 'bg-slate-100 text-slate-500 dark:bg-slate-700/60 dark:text-slate-300', dot: 'bg-slate-400' },
  low: { label: '低', rank: 2, chip: 'bg-slate-100 text-slate-400 dark:bg-slate-800 dark:text-slate-500', dot: 'bg-slate-300 dark:bg-slate-600' },
}

export function priorityOf(t: TodoItem): TodoPriority {
  return t.priority === 'high' || t.priority === 'low' ? t.priority : 'normal'
}

/** 三态循环：low → normal → high → low */
export function nextPriority(p: TodoPriority): TodoPriority {
  return p === 'low' ? 'normal' : p === 'normal' ? 'high' : 'low'
}

/**
 * 待办排序：未完成在前 → 优先级（high 置顶 / normal / low 沉底）→ 创建时间倒序。
 * 已完成条目统一沉底（保持原始相对顺序按创建时间）。
 */
export function sortTodos(list: TodoItem[]): TodoItem[] {
  return [...list].sort((a, b) => {
    const ad = Number(a.done)
    const bd = Number(b.done)
    if (ad !== bd) return ad - bd
    if (ad === 1) return b.createdAt.localeCompare(a.createdAt)
    const r = PRIORITY_META[priorityOf(a)].rank - PRIORITY_META[priorityOf(b)].rank
    if (r !== 0) return r
    return b.createdAt.localeCompare(a.createdAt)
  })
}

/**
 * 已有待办的需求 id 集合，任务卡片据此把「+ 待办」换成「✓ 已有待办」。
 * 规则：只要该需求存在过任何关联待办（不限日期、不限完成状态）即计入——
 * 已完成的需求不需要再生成待办，避免重复创建。
 */
export function collectTodoReqIds(todos: TodoItem[]): Set<string> {
  const ids = new Set<string>()
  for (const t of todos) {
    if (t.requirementId) ids.add(t.requirementId)
  }
  return ids
}

/** 今日汇总：未完成数 / 其中高优先级数 / 昨日遗留数 */
export function buildTodoSummary(todos: TodoItem[]) {
  const today = toDateStr(new Date())
  let undone = 0
  let high = 0
  let overdue = 0
  for (const t of todos) {
    if (t.done) continue
    if (t.date === today) {
      undone++
      if (t.priority === 'high') high++
    } else if (t.date < today) {
      overdue++
    }
  }
  return { undone, high, overdue }
}

/* ---------- 需求列表「+ 待办」入口 ---------- */

/**
 * 可从需求列表生成待办的状态：仅「待开发 / 开发中」。
 * 已提测及之后的需求不再需要排开发待办，暂停/归档的也不排。
 */
export const TODO_ELIGIBLE_STATUSES: readonly RequirementStatus[] = ['pending', 'developing']

/** 该需求是否允许生成待办（决定操作列按钮是否展示） */
export function canAddTodo(r: Pick<Requirement, 'status'>): boolean {
  return TODO_ELIGIBLE_STATUSES.includes(r.status)
}

/**
 * 某需求已关联的待办，按日期升序。
 * 入参应是 active() 过滤后的列表（墓碑不计入），调用方保证。
 */
export function linkedTodosOf(todos: TodoItem[], requirementId: string): TodoItem[] {
  return todos
    .filter((t) => t.requirementId === requirementId)
    .sort((a, b) => a.date.localeCompare(b.date))
}

/**
 * requirementId → 关联待办条数，供列表按钮角标使用。
 * 一次遍历建 Map，避免每行都 filter 一遍全量待办。
 */
export function countTodosByRequirement(todos: TodoItem[]): Map<string, number> {
  const m = new Map<string, number>()
  for (const t of todos) {
    if (!t.requirementId) continue
    m.set(t.requirementId, (m.get(t.requirementId) ?? 0) + 1)
  }
  return m
}

/** 「+ 待办」默认文案，与 TodoPanel 任务卡片的一键生成保持一致 */
export function defaultTodoContent(r: Pick<Requirement, 'name'>): string {
  return `开发：${r.name}`
}
