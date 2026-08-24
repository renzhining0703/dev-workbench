import { useEffect, useRef, useState } from 'react'
import { format, parseISO } from 'date-fns'
import type { TodoItem } from '../types'

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
  onUpdate: (id: string, patch: Partial<Pick<TodoItem, 'content' | 'date' | 'done'>>) => void
  onRemove: (id: string) => void
  /** 置灰内容（昨日遗留等次要场景） */
  muted?: boolean
}

/**
 * 待办行：勾选 / 行内编辑（双击或铅笔）/ 删除 / 完成时间。
 * 今日概览与待办 Tab 共用。
 */
export function TodoRow({ todo, onToggle, onUpdate, onRemove, muted }: TodoRowProps) {
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
        <span
          className={`flex-1 cursor-text select-none text-sm ${
            todo.done
              ? 'text-slate-400 line-through dark:text-slate-500'
              : muted
                ? 'text-slate-500 dark:text-slate-400'
                : 'text-slate-700 dark:text-slate-200'
          }`}
          onDoubleClick={startEdit}
          title="双击编辑"
        >
          {todo.content}
          {todo.done && doneTime && (
            <span className="ml-2 select-none text-xs text-slate-400 dark:text-slate-500">
              {doneTime} 完成
            </span>
          )}
        </span>
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
