import type { TodoItem, TodoPriority } from '../types'
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
 * 计入规则（任一命中即算）：
 * 1. 今日生成过的待办（无论是否已完成）——今天已加过，不应重复生成；
 * 2. 未完成的遗留待办（date < today 且未完成）——昨日生成、今天还没做完；
 * 3. 今天完成的遗留待办（completedAt 为今天）——刚被处理完，也属于今天的上下文。
 * 只有「完成于今天之前」的旧待办才不计入，允许重新生成。
 */
export function collectTodoReqIds(todos: TodoItem[], today: string): Set<string> {
  const ids = new Set<string>()
  for (const t of todos) {
    if (!t.requirementId) continue
    if (t.date === today) {
      ids.add(t.requirementId)
    } else if (!t.done && t.date < today) {
      ids.add(t.requirementId)
    } else if (t.done && (t.completedAt ?? '').slice(0, 10) === today) {
      ids.add(t.requirementId)
    }
  }
  return ids
}

/** 今日汇总：未完成数 / 其中高优先级数 / 昨日遗留数 */export function buildTodoSummary(todos: TodoItem[]) {
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
