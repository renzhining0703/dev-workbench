import { useEffect, useMemo, useState, type FormEvent } from 'react'
import type { Requirement, TodoItem, TodoPriority } from '../types'
import { PRIORITY_META, defaultTodoContent, linkedTodosOf } from '../lib/todos'
import { fmtDateShort, toDateStr } from '../lib/utils'
import { Modal } from './ui'

/**
 * 需求列表「+ 待办」弹框
 *
 * - 三个字段：待办内容（预填「开发：需求名」）/ 日期（默认今天）/ 优先级（默认普通）
 * - 已有关联待办时顶部展示提示条（含各条日期与完成状态）——同一需求允许分多天排
 * - 所选日期已存在该需求的待办时禁用提交，避免同日重复
 * - 提交后由外层调 store.addTodo(content, date, { requirementId, priority })
 */

const PRIORITIES: TodoPriority[] = ['low', 'normal', 'high']

/** 日期快捷按钮：今天 / 明天 / 下周一 */
function quickDates(): { label: string; date: string }[] {
  const today = new Date()
  const tomorrow = new Date(today)
  tomorrow.setDate(tomorrow.getDate() + 1)
  const nextMonday = new Date(today)
  // getDay(): 0=周日 … 1=周一。距下一个周一的天数（今天是周一则 +7）
  nextMonday.setDate(nextMonday.getDate() + ((8 - nextMonday.getDay()) % 7 || 7))
  return [
    { label: '今天', date: toDateStr(today) },
    { label: '明天', date: toDateStr(tomorrow) },
    { label: '下周一', date: toDateStr(nextMonday) },
  ]
}

export function AddTodoModal({
  open,
  requirement,
  todos,
  onClose,
  onSubmit,
}: {
  open: boolean
  /** 目标需求；null 时不渲染 */
  requirement: Requirement | null
  /** 全量待办（active 过滤后），用于算已有关联与同日去重 */
  todos: TodoItem[]
  onClose: () => void
  onSubmit: (args: { content: string; date: string; priority: TodoPriority }) => void
}) {
  const [content, setContent] = useState('')
  const [date, setDate] = useState('')
  const [priority, setPriority] = useState<TodoPriority>('normal')

  const reqId = requirement?.id ?? ''

  // 每次打开（或切换需求）重置为默认值
  useEffect(() => {
    if (!open || !requirement) return
    setContent(defaultTodoContent(requirement))
    setDate(toDateStr(new Date()))
    setPriority('normal')
  }, [open, reqId, requirement])

  const existing = useMemo(
    () => (reqId ? linkedTodosOf(todos, reqId) : []),
    [todos, reqId],
  )

  const quick = useMemo(quickDates, [])

  const trimmed = content.trim()
  const dateTaken = existing.some((t) => t.date === date)
  const canSubmit = trimmed.length > 0 && date.length > 0 && !dateTaken

  function submit(e: FormEvent) {
    e.preventDefault()
    if (!canSubmit) return
    onSubmit({ content: trimmed, date, priority })
  }

  if (!requirement) return null

  return (
    <Modal open={open} onClose={onClose} title="添加待办" width="max-w-md">
      <form onSubmit={submit} className="space-y-4">
        {/* 关联需求 */}
        <div>
          <label className="mb-1.5 block text-xs font-medium" style={{ color: 'var(--wb-ink-2)' }}>
            关联需求
          </label>
          <div
            className="truncate rounded-lg px-3 py-2 text-sm"
            style={{ background: 'var(--wb-surface-2)', color: 'var(--wb-ink)' }}
            title={requirement.name}
          >
            🔗 {requirement.name}
          </div>
        </div>

        {/* 已有关联待办提示 */}
        {existing.length > 0 && (
          <div className="wb-hint-box">
            <span aria-hidden="true">ⓘ</span>
            <span>
              该需求已有 {existing.length} 条关联待办：
              {existing.map((t, i) => (
                <span key={t.id}>
                  {i > 0 && ' · '}
                  <span className="tabular-nums">{fmtDateShort(t.date)}</span>
                  {t.done && '（已完成）'}
                </span>
              ))}
            </span>
          </div>
        )}

        {/* 待办内容 */}
        <div>
          <label
            htmlFor="add-todo-content"
            className="mb-1.5 block text-xs font-medium"
            style={{ color: 'var(--wb-ink-2)' }}
          >
            待办内容
          </label>
          <input
            id="add-todo-content"
            className="wb-input"
            value={content}
            autoFocus
            placeholder="待办内容"
            onChange={(e) => setContent(e.target.value)}
          />
        </div>

        {/* 日期 */}
        <div>
          <label
            htmlFor="add-todo-date"
            className="mb-1.5 block text-xs font-medium"
            style={{ color: 'var(--wb-ink-2)' }}
          >
            日期
          </label>
          <input
            id="add-todo-date"
            type="date"
            className="wb-input"
            value={date}
            aria-invalid={dateTaken || undefined}
            onChange={(e) => setDate(e.target.value)}
          />
          <div className="mt-2 flex gap-1.5">
            {quick.map((q) => (
              <button
                key={q.label}
                type="button"
                className={`wb-prio-btn ${date === q.date ? 'active' : ''}`}
                onClick={() => setDate(q.date)}
              >
                {q.label}
              </button>
            ))}
          </div>
          {dateTaken && (
            <p className="mt-2 text-xs" style={{ color: 'var(--wb-danger)' }} role="alert">
              该日期已有此需求的待办，换个日期或直接去待办列表修改
            </p>
          )}
        </div>

        {/* 优先级 */}
        <div>
          <label className="mb-1.5 block text-xs font-medium" style={{ color: 'var(--wb-ink-2)' }}>
            优先级
          </label>
          <div className="wb-prio-group" role="radiogroup" aria-label="优先级">
            {PRIORITIES.map((p) => (
              <button
                key={p}
                type="button"
                role="radio"
                aria-checked={priority === p}
                className={`wb-prio-btn ${priority === p ? 'active' : ''}`}
                onClick={() => setPriority(p)}
              >
                <span className={`dot ${PRIORITY_META[p].dot}`} />
                {PRIORITY_META[p].label}
              </button>
            ))}
          </div>
        </div>

        {/* 操作 */}
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" className="wb-btn-ghost" onClick={onClose}>
            取消
          </button>
          <button type="submit" className="wb-btn-primary" disabled={!canSubmit}>
            添加
          </button>
        </div>
      </form>
    </Modal>
  )
}

/** 加号图标（日历 + 加号：区别于「新建需求」的纯加号） */
function CalendarPlusIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 13V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h8" />
      <path d="M16 2v4M8 2v4M3 10h18" />
      <path d="M18 15v6M15 18h6" />
    </svg>
  )
}

/**
 * 「+ 待办」图标按钮（表格操作列 / 移动端卡片 / 看板卡片共用）
 * count > 0 时右上角显示角标 = 该需求已有的关联待办条数。
 */
export function AddTodoIconButton({
  count,
  onClick,
  className = 'wb-icon-sm ok',
}: {
  count: number
  onClick: (e: React.MouseEvent<HTMLButtonElement>) => void
  className?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={className}
      title={count > 0 ? `添加待办（已有 ${count} 条关联待办）` : '添加待办'}
      aria-label={count > 0 ? `添加待办，已有 ${count} 条关联待办` : '添加待办'}
    >
      <CalendarPlusIcon />
      {count > 0 && <span className="wb-icon-badge">{count > 9 ? '9+' : count}</span>}
    </button>
  )
}
