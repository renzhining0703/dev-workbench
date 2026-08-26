import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { format, parseISO } from 'date-fns'
import type { TodoItem, TodoPriority } from '../types'
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
  // NOVA 语义色：高=危险红 / 普通=琥珀 / 低=弱化灰
  const prioChipStyle: Record<TodoPriority, CSSProperties> = {
    high: { background: 'var(--wb-danger-soft)', color: 'var(--wb-danger)' },
    normal: { background: 'var(--wb-surface-2)', color: 'var(--wb-ink-2)' },
    low: { background: 'transparent', color: 'var(--wb-ink-3)' },
  }

  return (
    <li className={`wb-todo-row ${todo.done ? 'done' : ''}`}>
      <button
        onClick={() => onToggle(todo.id)}
        className="wb-check"
        aria-label={todo.done ? '标记未完成' : '标记完成'}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
          <path d="M20 6 9 17l-5-5" />
        </svg>
      </button>

      {editing ? (
        <input
          ref={inputRef}
          className="wb-input"
          style={{ flex: 1, height: 30, padding: '4px 10px' }}
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
        <>
          {/* 优先级圆点（设计稿风格） */}
          <span className={`pri ${prio === 'high' ? 'pri-high' : prio === 'normal' ? 'pri-normal' : 'pri-low'}`} />
          <span
            className="content"
            style={muted ? { color: 'var(--wb-ink-3)' } : undefined}
            onDoubleClick={startEdit}
            title={todo.content}
          >
            {todo.content}
            {todo.done && doneTime && (
              <span style={{ fontSize: 11, color: 'var(--wb-ink-3)', marginLeft: 8 }}>
                {doneTime} 完成
              </span>
            )}
          </span>
        </>
      )}

      {/* 关联需求 chip（点击跳回需求抽屉） */}
      {!editing && reqName && todo.requirementId && (
        <button
          onClick={() => onOpenRequirement?.(todo.requirementId!)}
          className="req-chip"
          title={`打开需求「${reqName}」`}
        >
          🔗 {reqName}
        </button>
      )}

      {/* 优先级三态循环：高 / 普通 / 低，点击切换 */}
      {!editing && (
        <button
          onClick={() => onUpdate(todo.id, { priority: nextPriority(prio) })}
          className="shrink-0 rounded px-1.5 py-0.5 text-[11px] font-semibold transition"
          style={prioChipStyle[prio]}
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
            className="rounded p-1 opacity-0 transition hover:text-blue-500 group-hover:opacity-100"
            style={{ color: 'var(--wb-ink-3)', opacity: 0 }}
            onMouseEnter={(e) => (e.currentTarget.style.opacity = '1')}
            onMouseLeave={(e) => (e.currentTarget.style.opacity = '0')}
            aria-label="编辑待办"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
            </svg>
          </button>
          <button
            onClick={() => onRemove(todo.id)}
            className="rounded p-1 opacity-0 transition group-hover:opacity-100"
            style={{ color: 'var(--wb-ink-3)', opacity: 0 }}
            onMouseEnter={(e) => (e.currentTarget.style.opacity = '1')}
            onMouseLeave={(e) => (e.currentTarget.style.opacity = '0')}
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
