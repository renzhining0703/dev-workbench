import { useEffect, useMemo, useState } from 'react'
import type { Requirement, TodoItem } from '../types'
import { isDateToday, toDateStr } from '../lib/utils'
import { requirementModuleDisplay, requirementProjectDisplay } from '../lib/projects'
import { collectTodoReqIds, sortTodos } from '../lib/todos'
import { TodoRow } from './TodoRow'

/* ---------------- 今日上线提醒 ---------------- */

const NOTIFY_KEY = 'dev-workbench:notified-dates'

function getNotifiedDates(): string[] {
  try {
    return JSON.parse(localStorage.getItem(NOTIFY_KEY) ?? '[]') as string[]
  } catch {
    return []
  }
}

function markNotified(date: string) {
  const list = getNotifiedDates().filter((d) => d !== date)
  list.push(date)
  localStorage.setItem(NOTIFY_KEY, JSON.stringify(list))
}

/** 今日上线提醒：页面横幅 + 桌面通知（每日只提醒一次） */
export function PublishReminder({ requirements }: { requirements: Requirement[] }) {
  const today = toDateStr(new Date())
  const dueList = useMemo(
    () =>
      requirements.filter(
        (r) =>
          r.status !== 'published' &&
          r.status !== 'archived' &&
          isDateToday(r.publishTime),
      ),
    [requirements, today],
  )

  useEffect(() => {
    if (dueList.length === 0) return
    const notified = getNotifiedDates()
    if (notified.includes(today)) return
    markNotified(today)

    // 浏览器桌面通知（需用户授权）
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      for (const r of dueList) {
        new Notification(`🔔 ${r.name} 今日上线`, {
          body: `${requirementProjectDisplay(r) ? requirementProjectDisplay(r) + ' / ' : ''}${r.branch ? '分支 ' + r.branch + ' · ' : ''}${requirementModuleDisplay(r) ? '发布模块 ' + requirementModuleDisplay(r) : '全量发布'}`,
          tag: `publish-${r.id}-${today}`,
        })
      }
    }
  }, [dueList, today])

  if (dueList.length === 0) return null

  return (
    <div className="wb-reminder">
      <span className="ic">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
          <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
        </svg>
      </span>
      <div>
        <b>今日上线提醒 · {dueList.length} 条需求今日上线</b>
        <ul className="tags">
          {dueList.map((r) => (
            <li key={r.id}>
              <span className="name">「{r.name}」</span>
              {r.branch && (
                <span className="tag branch">{r.branch}</span>
              )}
              {requirementModuleDisplay(r) && (
                <span className="tag">模块 {requirementModuleDisplay(r)}</span>
              )}
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

/* ---------------- 今日待办 ---------------- */

interface TodoProps {
  todos: TodoItem[]
  requirements: Requirement[]
  onAddTodo: (
    content: string,
    date: string,
    extra?: { priority?: 'low' | 'normal' | 'high'; requirementId?: string },
  ) => void
  onToggleTodo: (id: string) => void
  onUpdateTodo: (id: string, patch: Partial<Pick<TodoItem, 'content' | 'date' | 'done' | 'priority' | 'requirementId'>>) => void
  onRemoveTodo: (id: string) => void
  /** 跳转到「待办」Tab（查看全部/历史） */
  onViewAll?: () => void
  /** 点击关联需求 chip → 跳回需求抽屉 */
  onOpenRequirement?: (reqId: string) => void
}

export function TodoPanel({
  todos,
  requirements,
  onAddTodo,
  onToggleTodo,
  onUpdateTodo,
  onRemoveTodo,
  onViewAll,
  onOpenRequirement,
}: TodoProps) {
  const [input, setInput] = useState('')
  const [overdueOpen, setOverdueOpen] = useState(false)
  const today = toDateStr(new Date())

  const todayTodos = useMemo(
    () => sortTodos(todos.filter((t) => t.date === today)),
    [todos, today],
  )
  const doneCount = todayTodos.filter((t) => t.done).length

  // 昨日遗留：目标日期早于今天且未完成
  const overdueTodos = useMemo(
    () =>
      todos
        .filter((t) => !t.done && t.date < today)
        .sort((a, b) => b.date.localeCompare(a.date)),
    [todos, today],
  )

  // 今日节点（按开发开始/提测/上线时间聚合）
  const todayTasks = useMemo(() => {
    const dev = requirements.filter((r) => isDateToday(r.devStartTime) && r.status === 'developing')
    // 今日开发中：处于开发中、且不是今天才开始（今天开始的在「今日开始开发」卡片，避免重复）
    const developing = requirements.filter(
      (r) => r.status === 'developing' && !isDateToday(r.devStartTime),
    )
    const publish = requirements.filter(
      (r) => isDateToday(r.publishTime) && r.status !== 'published' && r.status !== 'archived',
    )
    const publishDone = requirements.filter((r) => isDateToday(r.publishTime) && r.status === 'published')
    return { dev, developing, publish, publishDone }
  }, [requirements])

  // 已有待办的需求 id 集合：存在过任何关联待办（不限日期/完成状态）就算，
  // 卡片显示「✓ 已有待办」，避免重复生成（已完成的需求不需要再生成待办）
  const addedTodoReqIds = useMemo(() => collectTodoReqIds(todos), [todos])

  const submit = () => {
    const content = input.trim()
    if (!content) return
    onAddTodo(content, today)
    setInput('')
  }

  return (
    <div className="space-y-[18px]">
      {/* 今日需求节点 */}
      <div className="wb-task-grid">
        <TaskCard
          title="今日开始开发"
          icon="code"
          color="brand"
          items={todayTasks.dev.map((r) => ({ id: r.id, name: r.name, project: requirementProjectDisplay(r) }))}
          addedReqIds={addedTodoReqIds}
          onMakeTodo={(it) => onAddTodo(`开发：${it.name}`, today, { requirementId: it.id })}
        />
        <TaskCard
          title="今日开发中"
          icon="wrench"
          color="blue"
          items={todayTasks.developing.map((r) => ({ id: r.id, name: r.name, project: requirementProjectDisplay(r) }))}
          addedReqIds={addedTodoReqIds}
          onMakeTodo={(it) => onAddTodo(`开发：${it.name}`, today, { requirementId: it.id })}
        />
        <TaskCard
          title="今日上线"
          icon="rocket"
          color="accent"
          items={todayTasks.publish.map((r) => ({ id: r.id, name: r.name, project: requirementProjectDisplay(r) }))}
          doneItems={todayTasks.publishDone.map((r) => ({ id: r.id, name: r.name, project: requirementProjectDisplay(r) }))}
          addedReqIds={addedTodoReqIds}
          onMakeTodo={(it) => onAddTodo(`上线：${it.name}`, today, { requirementId: it.id })}
        />
      </div>

      {/* 待办列表 */}
      <div className="wb-card">
        <div className="wb-card-head">
          <div className="wb-card-title">今日待办</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            {onViewAll && (
              <button
                className="wb-btn-ghost"
                style={{ padding: '5px 10px', fontSize: 12 }}
                onClick={onViewAll}
              >
                查看全部 →
              </button>
            )}
            <span className="wb-card-hint">
              {doneCount}/{todayTodos.length} 已完成
            </span>
          </div>
        </div>

        <div style={{ padding: '16px 18px' }}>
          <div className="wb-add-row">
            <input
              className="wb-input"
              placeholder="添加一条待办，回车确认…"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && submit()}
            />
            <button className="wb-btn-soft shrink-0 whitespace-nowrap min-w-[48px]" onClick={submit}>添加</button>
          </div>

          {/* 昨日遗留 */}
          {overdueTodos.length > 0 && (
            <div className="wb-overdue">
              <button
                className="wb-overdue-head"
                onClick={() => setOverdueOpen((v) => !v)}
              >
                <span>📥 昨日遗留 {overdueTodos.length} 条</span>
                <span style={{ fontSize: 11, opacity: 0.75 }}>{overdueOpen ? '收起' : '展开'}</span>
                <span style={{ marginLeft: 'auto', fontSize: 10 }}>{overdueOpen ? '▲' : '▼'}</span>
              </button>
              {overdueOpen && (
                <div className="wb-overdue-body">
                  {overdueTodos.map((t) => (
                    <div key={t.id} className="row">
                      <button
                        onClick={() => onToggleTodo(t.id)}
                        className="wb-check"
                        style={{ borderColor: 'var(--wb-line-2)' }}
                        aria-label="标记完成"
                      >
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M20 6 9 17l-5-5" />
                        </svg>
                      </button>
                      <span style={{ flex: 1, fontSize: 12.5, minWidth: 0 }} title={t.content}>
                        {t.content}
                      </span>
                      <span className="date">{t.date.slice(5)}</span>
                      <button
                        style={{ border: 'none', background: 'transparent', color: 'var(--wb-ink-3)', fontSize: 11.5 }}
                        onClick={() => onUpdateTodo(t.id, { date: today })}
                      >
                        顺延
                      </button>
                    </div>
                  ))}
                  <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '4px 8px 2px' }}>
                    <button
                      style={{ border: 'none', background: 'transparent', color: 'var(--wb-warn)', fontSize: 11.5 }}
                      onClick={() => overdueTodos.forEach((t) => onUpdateTodo(t.id, { date: today }))}
                    >
                      全部顺延到今天
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {todayTodos.length === 0 ? (
            <p className="wb-todo-empty">
              今天暂无待办，享受专注的一天 ☕
            </p>
          ) : (
            <ul className="wb-todo-list">
              {todayTodos.map((t) => (
                <TodoRow
                  key={t.id}
                  todo={t}
                  onToggle={onToggleTodo}
                  onUpdate={onUpdateTodo}
                  onRemove={onRemoveTodo}
                  reqName={t.requirementId ? requirements.find((r) => r.id === t.requirementId)?.name : undefined}
                  onOpenRequirement={onOpenRequirement}
                />
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}

/* ---------------- 今日任务卡片 ---------------- */

function TaskCard({
  title,
  icon,
  color,
  items,
  doneItems = [],
  todoPrefix,
  addedReqIds,
  onMakeTodo,
}: {
  title: string
  icon: 'code' | 'wrench' | 'flask' | 'rocket'
  color: 'brand' | 'blue' | 'accent'
  items: { id: string; name: string; project: string }[]
  doneItems?: { id: string; name: string; project: string }[]
  /** 「+ 待办」生成的内容前缀，如「开发：」「提测：」「上线：」 */
  todoPrefix?: string
  /** 已有待办（今日或未完成遗留）的需求 id 集合（命中则显示「✓ 已有待办」而非「+ 待办」） */
  addedReqIds?: Set<string>
  /** hover 出现「+ 待办」按钮，一键生成关联待办 */
  onMakeTodo?: (it: { id: string; name: string }) => void
}) {
  const bg = {
    brand: 'var(--wb-brand-500)',
    blue: 'var(--wb-blue)',
    accent: 'var(--wb-accent)',
  }[color]

  const icons = {
    code: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        <path d="m16 18 6-6-6-6M8 6l-6 6 6 6" />
      </svg>
    ),
    wrench: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
      </svg>
    ),
    flask: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M10 2v6L4.5 18a2 2 0 0 0 1.8 3h11.4a2 2 0 0 0 1.8-3L14 8V2M8.5 2h7M7 14h10" />
      </svg>
    ),
    rocket: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09ZM12 15l-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2ZM9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5" />
      </svg>
    ),
  }[icon]

  return (
    <div className="wb-card wb-task-card">
      <div className="wb-task-head">
        <span className="wb-task-icon" style={{ background: bg }}>
          {icons}
        </span>
        <span className="wb-task-title">{title}</span>
        <span className="wb-task-count" style={{ background: bg }}>
          {items.length}
        </span>
      </div>
      {items.length === 0 && doneItems.length === 0 ? (
        <p className="wb-task-empty">暂无</p>
      ) : (
        <ul className="wb-task-list">
          {items.map((it) => (
            <li key={it.id}>
              <span className="bullet" />
              <span className="min-w-0 flex-1 truncate" title={it.name}>
                {it.name}
                {it.project && (
                  <span className="proj">· {it.project}</span>
                )}
              </span>
              {onMakeTodo && todoPrefix && (addedReqIds?.has(it.id) ? (
                <span className="wb-task-has" title="该需求已生成过待办，无需重复添加">
                  ✓ 已有待办
                </span>
              ) : (
                <button
                  onClick={() => onMakeTodo(it)}
                  className="wb-task-add"
                  title={`生成待办「${todoPrefix}${it.name}」`}
                >
                  + 待办
                </button>
              ))}
            </li>
          ))}
          {doneItems.map((it) => (
            <li key={`done-${it.id}`} className="done">
              <span className="bullet" />
              <span className="min-w-0 flex-1 truncate" title={it.name}>
                {it.name}
                {it.project && (
                  <span className="proj">· {it.project}</span>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
