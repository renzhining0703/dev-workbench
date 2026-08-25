import { useEffect, useMemo, useState } from 'react'
import type { Requirement, TodoItem } from '../types'
import { isDateToday, toDateStr } from '../lib/utils'
import { requirementModuleDisplay, requirementProjectDisplay } from '../lib/projects'
import { sortTodos } from '../lib/todos'
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
          body: `${requirementProjectDisplay(r) ? requirementProjectDisplay(r) + ' / ' : ''}${requirementModuleDisplay(r) ? '发布模块 ' + requirementModuleDisplay(r) : '全量发布'}`,
          tag: `publish-${r.id}-${today}`,
        })
      }
    }
  }, [dueList, today])

  if (dueList.length === 0) return null

  return (
    <div className="flex items-start gap-3 rounded-xl border border-rose-200 bg-rose-50 p-4 dark:border-rose-500/30 dark:bg-rose-500/10">
      <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-rose-500 text-white">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
          <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
        </svg>
      </span>
      <div className="flex-1">
        <p className="text-sm font-semibold text-rose-700 dark:text-rose-300">
          今日上线提醒
        </p>
        <ul className="mt-1.5 space-y-1">
          {dueList.map((r) => (
            <li key={r.id} className="text-sm text-rose-600 dark:text-rose-400">
              「{r.name}」今日上线
              {requirementModuleDisplay(r) && (
                <span className="ml-1.5 rounded bg-rose-100 px-1.5 py-0.5 text-xs font-medium text-rose-700 dark:bg-rose-500/20 dark:text-rose-300">
                  发布模块：{requirementModuleDisplay(r)}
                </span>
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

  // 今日已生成待办的需求 id 集合：任务卡片据此把「+ 待办」换成「✓ 已在今日待办」
  const addedTodoReqIds = useMemo(() => {
    const ids = new Set<string>()
    for (const t of todos) {
      if (t.requirementId && t.date === today) ids.add(t.requirementId)
    }
    return ids
  }, [todos, today])

  const submit = () => {
    const content = input.trim()
    if (!content) return
    onAddTodo(content, today)
    setInput('')
  }

  return (
    <div className="space-y-5">
      {/* 今日需求节点 */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <TaskCard
          title="今日开始开发"
          icon="code"
          color="blue"
          todoPrefix="开发："
          items={todayTasks.dev.map((r) => ({ id: r.id, name: r.name, project: requirementProjectDisplay(r) }))}
          addedReqIds={addedTodoReqIds}
          onMakeTodo={(it) => onAddTodo(`开发：${it.name}`, today, { requirementId: it.id })}
        />
        <TaskCard
          title="今日开发中"
          icon="wrench"
          color="violet"
          todoPrefix="开发："
          items={todayTasks.developing.map((r) => ({ id: r.id, name: r.name, project: requirementProjectDisplay(r) }))}
          addedReqIds={addedTodoReqIds}
          onMakeTodo={(it) => onAddTodo(`开发：${it.name}`, today, { requirementId: it.id })}
        />
        <TaskCard
          title="今日上线"
          icon="rocket"
          color="rose"
          todoPrefix="上线："
          items={todayTasks.publish.map((r) => ({ id: r.id, name: r.name, project: requirementProjectDisplay(r) }))}
          doneItems={todayTasks.publishDone.map((r) => ({ id: r.id, name: r.name, project: requirementProjectDisplay(r) }))}
          addedReqIds={addedTodoReqIds}
          onMakeTodo={(it) => onAddTodo(`上线：${it.name}`, today, { requirementId: it.id })}
        />
      </div>

      {/* 待办列表 */}
      <div className="card p-5">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200">
            今日待办
          </h3>
          <div className="flex items-center gap-3">
            {onViewAll && (
              <button
                className="text-xs text-blue-600 transition hover:text-blue-500 dark:text-blue-400"
                onClick={onViewAll}
              >
                查看全部 →
              </button>
            )}
            <span className="text-xs text-slate-400">
              {doneCount}/{todayTodos.length} 已完成
            </span>
          </div>
        </div>

        <div className="mb-3 flex gap-2">
          <input
            className="input flex-1"
            placeholder="添加一条待办，回车确认…"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
          />
          <button className="btn-primary" onClick={submit}>添加</button>
        </div>

        {/* 昨日遗留 */}
        {overdueTodos.length > 0 && (
          <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50/60 dark:border-amber-500/30 dark:bg-amber-500/10">
            <button
              className="flex w-full items-center gap-2 px-3 py-2 text-left"
              onClick={() => setOverdueOpen((v) => !v)}
            >
              <span className="text-xs font-semibold text-amber-700 dark:text-amber-300">
                📥 昨日遗留 {overdueTodos.length} 条
              </span>
              <span className="text-xs text-amber-600/80 dark:text-amber-400/80">
                {overdueOpen ? '收起' : '展开'}
              </span>
              <span className="ml-auto text-xs text-amber-600 dark:text-amber-400">
                {overdueOpen ? '▲' : '▼'}
              </span>
            </button>
            {overdueOpen && (
              <div className="px-2 pb-2">
                <div className="mb-1 flex justify-end">
                  <button
                    className="rounded-md px-2 py-1 text-xs text-amber-700 transition hover:bg-amber-100 dark:text-amber-300 dark:hover:bg-amber-500/20"
                    onClick={() => overdueTodos.forEach((t) => onUpdateTodo(t.id, { date: today }))}
                  >
                    全部顺延到今天
                  </button>
                </div>
                <ul className="space-y-1">
                  {overdueTodos.map((t) => (
                    <li key={t.id} className="flex items-center gap-3 rounded-lg px-2 py-1.5">
                      <button
                        onClick={() => onToggleTodo(t.id)}
                        className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md border border-slate-300 text-transparent transition hover:border-emerald-400 dark:border-slate-600"
                        aria-label="标记完成"
                      >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M20 6 9 17l-5-5" />
                        </svg>
                      </button>
                      <span className="flex-1 truncate text-sm text-slate-600 dark:text-slate-300" title={t.content}>
                        {t.content}
                      </span>
                      <span className="shrink-0 rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-700 dark:bg-amber-500/20 dark:text-amber-300">
                        {t.date.slice(5)}
                      </span>
                      <button
                        className="shrink-0 rounded px-1.5 py-0.5 text-xs text-slate-500 transition hover:text-blue-500"
                        onClick={() => onUpdateTodo(t.id, { date: today })}
                      >
                        顺延
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {todayTodos.length === 0 ? (
          <p className="py-6 text-center text-sm text-slate-400 dark:text-slate-500">
            今天暂无待办，享受专注的一天 ☕
          </p>
        ) : (
          <ul className="space-y-1">
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
  color: 'blue' | 'violet' | 'amber' | 'rose'
  items: { id: string; name: string; project: string }[]
  doneItems?: { id: string; name: string; project: string }[]
  /** 「+ 待办」生成的内容前缀，如「开发：」「提测：」「上线：」 */
  todoPrefix?: string
  /** 今日已生成待办的需求 id 集合（命中则显示「✓ 已在今日待办」而非「+ 待办」） */
  addedReqIds?: Set<string>
  /** hover 出现「+ 待办」按钮，一键生成关联待办 */
  onMakeTodo?: (it: { id: string; name: string }) => void
}) {
  const palette = {
    blue: 'bg-blue-500',
    violet: 'bg-violet-500',
    amber: 'bg-amber-500',
    rose: 'bg-rose-500',
  }[color]

  const icons = {
    code: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        <path d="m16 18 6-6-6-6M8 6l-6 6 6 6" />
      </svg>
    ),
    wrench: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
      </svg>
    ),
    flask: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M10 2v6L4.5 18a2 2 0 0 0 1.8 3h11.4a2 2 0 0 0 1.8-3L14 8V2M8.5 2h7M7 14h10" />
      </svg>
    ),
    rocket: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09ZM12 15l-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2ZM9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5" />
      </svg>
    ),
  }[icon]

  return (
    <div className="card flex flex-col p-4">
      <div className="mb-3 flex items-center gap-2">
        <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md ${palette} text-white`}>
          {icons}
        </span>
        <h4 className="min-w-0 flex-1 truncate text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
          {title}
        </h4>
        {items.length > 0 && (
          <span className={`shrink-0 rounded-full ${palette} px-2 py-0.5 text-xs font-bold text-white`}>
            {items.length}
          </span>
        )}
      </div>
      {items.length === 0 && doneItems.length === 0 ? (
        <p className="py-3 text-center text-xs text-slate-400 dark:text-slate-500">暂无</p>
      ) : (
        <ul className="max-h-[220px] space-y-1.5 overflow-y-auto pr-1">
          {items.map((it) => (
            <li key={it.id} className="group/item flex items-center gap-1 text-sm text-slate-700 dark:text-slate-200">
              <span className="mt-1.5 mr-1.5 inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400 align-middle" />
              <span className="min-w-0 flex-1 truncate" title={it.name}>
                {it.name}
                {it.project && (
                  <span className="ml-1 text-xs text-slate-400">· {it.project}</span>
                )}
              </span>
              {onMakeTodo && todoPrefix && (addedReqIds?.has(it.id) ? (
                <span
                  className="shrink-0 select-none text-[11px] font-medium text-emerald-600 dark:text-emerald-400"
                  title="该需求今日已生成待办"
                >
                  ✓ 已在今日待办
                </span>
              ) : (
                <button
                  onClick={() => onMakeTodo(it)}
                  className="shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium text-blue-600 opacity-100 transition hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-500/15 sm:opacity-0 sm:group-hover/item:opacity-100"
                  title={`生成待办「${todoPrefix}${it.name}」`}
                >
                  + 待办
                </button>
              ))}
            </li>
          ))}
          {doneItems.map((it) => (
            <li key={`done-${it.id}`} className="flex items-center gap-1 text-sm text-slate-400 line-through dark:text-slate-500">
              <span className="mr-1.5 inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-400 align-middle" />
              <span className="min-w-0 flex-1 truncate" title={it.name}>
                {it.name}
                {it.project && (
                  <span className="ml-1 text-xs">· {it.project}</span>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
