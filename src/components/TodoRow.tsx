import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { format, parseISO } from 'date-fns'
import type { Requirement, TodoItem, TodoPriority } from '../types'
import { statusMeta } from '../types'
import { nextPriority, priorityOf, PRIORITY_META, linkableRequirements } from '../lib/todos'
import { setAiFocusTodo } from '../lib/aiFocus'

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
  /** 需求列表（关联需求选择器数据源；不传则不显示关联入口） */
  requirements?: Requirement[]
}

/**
 * 待办行：勾选 / 行内编辑（双击或铅笔）/ 优先级三态循环 / 关联需求 chip 与选择器 / 删除 / 完成时间。
 * 今日概览与待办 Tab 共用。操作按钮常显（移动端无 hover）。
 */
export function TodoRow({
  todo,
  onToggle,
  onUpdate,
  onRemove,
  muted,
  reqName,
  requirements,
}: TodoRowProps) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(todo.content)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [reqQuery, setReqQuery] = useState('')
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

  const setReq = (reqId: string | undefined) => {
    onUpdate(todo.id, { requirementId: reqId })
    setPickerOpen(false)
  }

  // 选择器候选：只保留推进中的需求（过滤已上线/已完成/已归档/待开发/未开始）
  const candidates = useMemo(() => {
    const base = linkableRequirements(requirements ?? [])
    const q = reqQuery.trim().toLowerCase()
    if (!q) return base
    return base.filter(
      (r) =>
        r.name.toLowerCase().includes(q) ||
        (r.projects ?? []).some((p) => p.project.toLowerCase().includes(q)),
    )
  }, [requirements, reqQuery])

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
          className="wb-input wb-todo-edit"
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
          <div className="wb-todo-main">
            <span
              className="content"
              style={muted ? { color: 'var(--wb-ink-3)' } : undefined}
              onClick={() => setAiFocusTodo(todo)}
              onDoubleClick={startEdit}
              title={`${todo.content}（单击携带到 AI 面板，双击编辑）`}
            >
              {todo.content}
              {todo.done && doneTime && (
                <span style={{ fontSize: 11, color: 'var(--wb-ink-3)', marginLeft: 8 }}>
                  {doneTime} 完成
                </span>
              )}
            </span>

            {/* 来源标签：机器人写入的待办（无 source 的旧数据视为手写，不显示） */}
            {todo.source === 'bot' && (
              <span className="src-chip" title="这条待办由机器人（台小二）写入">
                🤖 机器人
              </span>
            )}

            {/* 关联需求 chip：点击直接打开选择器（更换/清除）；跳需求抽屉走需求列表 */}
            {reqName && todo.requirementId ? (
              <button
                onClick={() => {
                  setReqQuery('')
                  setPickerOpen(true)
                }}
                className="req-chip"
                title={`更换/清除「${reqName}」的关联`}
              >
                🔗 {reqName}
              </button>
            ) : requirements && requirements.length > 0 ? (
              <button
                onClick={() => {
                  setReqQuery('')
                  setPickerOpen(true)
                }}
                className="req-chip req-chip-empty"
                title="关联到需求（工时汇总更方便）"
              >
                🔗 关联需求
              </button>
            ) : null}
          </div>
        </>
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
          {/* 改关联：已关联时操作区显示链接图标（未关联走虚位 chip） */}
          {requirements && requirements.length > 0 && todo.requirementId && (
            <button
              onClick={() => {
                setReqQuery('')
                setPickerOpen(true)
              }}
              className="rounded p-1 transition hover:text-blue-500"
              style={{ color: 'var(--wb-ink-3)' }}
              aria-label="修改关联需求"
              title="修改关联需求"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
              </svg>
            </button>
          )}
          <button
            onClick={startEdit}
            className="rounded p-1 transition hover:text-blue-500"
            style={{ color: 'var(--wb-ink-3)' }}
            aria-label="编辑待办"
            title="编辑待办"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
            </svg>
          </button>
          <button
            onClick={() => onRemove(todo.id)}
            className="rounded p-1 transition hover:text-red-500"
            style={{ color: 'var(--wb-ink-3)' }}
            aria-label="删除待办"
            title="删除待办"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}

      {/* 关联需求选择器：Portal 挂 body（防祖先 transform/backdrop-filter 劫持 fixed 定位） */}
      {pickerOpen &&
        createPortal(
          <div className="wb-req-picker-mask" onClick={() => setPickerOpen(false)}>
            <div className="wb-req-picker" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="选择关联需求">
              <div className="wb-req-picker-head">
                <b>关联需求</b>
                <button onClick={() => setPickerOpen(false)} aria-label="关闭">✕</button>
              </div>
              <input
                className="wb-input"
                placeholder="搜索需求名 / 项目…"
                value={reqQuery}
                onChange={(e) => setReqQuery(e.target.value)}
                autoFocus
              />
              <div className="wb-req-picker-list">
                {candidates.length === 0 ? (
                  <p className="wb-req-picker-empty">
                    {reqQuery ? '没有匹配的需求' : '没有可关联的需求（已过滤已上线/已完成/待开发等）'}
                  </p>
                ) : (
                  candidates.map((r) => (
                    <button
                      key={r.id}
                      className={`wb-req-picker-item ${r.id === todo.requirementId ? 'active' : ''}`}
                      onClick={() => setReq(r.id)}
                    >
                      <span className="name">{r.name}</span>
                      <span className="meta">
                        {(r.projects ?? []).map((p) => p.project).join(' / ')}
                        <span className="st">{statusMeta(r.status).label}</span>
                      </span>
                    </button>
                  ))
                )}
              </div>
              {todo.requirementId && (
                <button className="wb-req-picker-clear" onClick={() => setReq(undefined)}>
                  清除关联
                </button>
              )}
            </div>
          </div>,
          document.body,
        )}
    </li>
  )
}
