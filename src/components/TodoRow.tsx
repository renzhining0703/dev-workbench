import { useEffect, useRef, useState } from 'react'
import { format, parseISO } from 'date-fns'
import type { TodoItem } from '../types'
import { nextPriority, priorityOf, PRIORITY_META } from '../lib/todos'

/** 完成时间展示：HH:mm（旧数据缺 completedAt 时不显示） */
export function fmtCompletedAt(iso: string | undefined): string {
  if (!iso) return ''
  try {
    return format(parseISO(iso), 'HH:mm')
  } catch {
    return ''
  }
}

interface TodoRowProps {
  todo: TodoItem
  onToggle: (id: string) => void
  onUpdate: (id: string, patch: Partial<Pick<TodoItem, 'content' | 'date' | 'done' | 'priority' | 'requirementId'>>) => void
  onRemove: (id: string) => void
  /** 置灰内容（昨日遗留等次要场景） */
  muted?: boolean
  /** 关联需求名称（有值且 todo.requirementId 存在时展示 chip，可点击跳转） */
  reqName?: string
  /** 点击关联需求 chip → 跳回需求抽屉 */
  onOpenRequirement?: (reqId: string) => void
}

/**
 * 待办行：勾选 / 行内编辑（双击或铅笔）/ 优先级三态循环 / 关联需求 chip / 删除 / 完成时间。
 * 今日概览与待办 Tab 共用。
 */
export function TodoRow({
  todo,
  onToggle,
  onUpdate,
  onRemove,
  muted,
  reqName,
  onOpenRequirement,
}: TodoRowProps) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(todo.content)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus()
      inputRef.current?.select()
    }
  }, [editing])

  const startEdit = () => {
    setDraft(todo.content)
    setEditing(true)
  }

  const commit = () => {
    const content = draft.trim()
    if (content && content !== todo.content) {
      onUpdate(todo.id, { content })
    }
    setEditing(false)
  }

  const cancel = () => {
    setDraft(todo.content)
    setEditing(false)
  }

  const doneTime = fmtCompletedAt(todo.completedAt)
  const prio = priorityOf(todo)
  const prioMeta = PRIORITY_META[prio]

  return (
    <li className="group flex items-center gap-3 rounded-lg px-2 py-2 transition hover:bg-slate-50 dark:hover:bg-slate-800/50">
      <button
        onClick={() => onToggle(todo.id)}
        className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md border transition ${
          todo.done
            ? 'border-emerald-500 bg-emerald-500 text-white'
            : 'border-slate-300 text-transparent hover:border-emerald-400 dark:border-slate-600'
        }`}
        aria-label={todo.done ? '标记未完成' : '标记完成'}
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
          <path d="M20 6 9 17l-5-5" />
        </svg>
      </button>

      {editing ? (
        <input
          ref={inputRef}
          className="input h-7 flex-1 py-0 text-sm"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit()
            if (e.key === 'Escape') cancel()
          }}
          onBlur={commit}
          aria-label="编辑待办内容"
        />
      ) : (
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <span
            className={`min-w-0 flex-1 cursor-text select-none truncate text-sm ${
              todo.done
                ? 'text-slate-400 line-through dark:text-slate-500'
                : muted
                  ? 'text-slate-500 dark:text-slate-400'
                  : 'text-slate-700 dark:text-slate-200'
            }`}
            onDoubleClick={startEdit}
            title={todo.content}
          >
            {todo.content}
          </span>
          {todo.done && doneTime && (
            <span className="shrink-0 select-none text-xs text-slate-400 dark:text-slate-500">
              {doneTime} 完成
            </span>
          )}
        </div>
      )}

      {/* 关联需求 chip（点击跳回需求抽屉） */}
      {!editing && reqName && todo.requirementId && (
        <button
          onClick={() => onOpenRequirement?.(todo.requirementId!)}
          className="max-w-[90px] shrink-0 truncate rounded-md bg-indigo-50 px-1.5 py-0.5 text-[11px] font-medium text-indigo-600 transition hover:bg-indigo-100 dark:bg-indigo-500/15 dark:text-indigo-300 dark:hover:bg-indigo-500/25 sm:max-w-[160px]"
          title={`打开需求「${reqName}」`}
        >
          🔗 {reqName}
        </button>
      )}

      {/* 优先级三态循环：normal 普通点 / high 红高 / low 灰低，点击切换 */}
      {!editing && (
        <button
          onClick={() => onUpdate(todo.id, { priority: nextPriority(prio) })}
          className={`shrink-0 rounded px-1.5 py-0.5 text-[11px] font-semibold transition ${prioMeta.chip}`}
          aria-label={`优先级：${prioMeta.label}，点击切换`}
          title={`优先级：${prioMeta.label}，点击切换`}
        >
          {prio === 'high' ? '高' : prio === 'low' ? '低' : '·'}
        </button>
      )}

      {!editing && (
        <div className="flex shrink-0 items-center gap-0.5">
          <button
            onClick={startEdit}
            className="rounded p-1 text-slate-300 opacity-0 transition hover:text-blue-500 group-hover:opacity-100 dark:text-slate-600"
            aria-label="编辑待办"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
            </svg>
          </button>
          <button
            onClick={() => onRemove(todo.id)}
            className="rounded p-1 text-slate-300 opacity-0 transition hover:text-rose-500 group-hover:opacity-100 dark:text-slate-600"
            aria-label="删除待办"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}
    </li>
  )
}
