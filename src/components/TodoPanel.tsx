import { useEffect, useMemo, useState } from 'react'
import type { Requirement, TodoItem } from '../types'
import { isDateToday, toDateStr } from '../lib/utils'

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
          body: `${r.project ? r.project + ' / ' : ''}${r.publishModule ? '发布模块 ' + r.publishModule : '全量发布'}`,
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
              {r.publishModule && (
                <span className="ml-1.5 rounded bg-rose-100 px-1.5 py-0.5 text-xs font-medium text-rose-700 dark:bg-rose-500/20 dark:text-rose-300">
                  发布模块：{r.publishModule}
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
  onAddTodo: (content: string, date: string) => void
  onToggleTodo: (id: string) => void
  onRemoveTodo: (id: string) => void
}

export function TodoPanel({
  todos,
  requirements,
  onAddTodo,
  onToggleTodo,
  onRemoveTodo,
}: TodoProps) {
  const [input, setInput] = useState('')
  const today = toDateStr(new Date())

  const todayTodos = useMemo(
    () =>
      todos
        .filter((t) => t.date === today)
        .sort((a, b) => Number(a.done) - Number(b.done)),
    [todos, today],
  )
  const doneCount = todayTodos.filter((t) => t.done).length

  // 今日节点（按开发开始/提测/上线时间聚合）
  const todayTasks = useMemo(() => {
    const dev = requirements.filter((r) => isDateToday(r.devStartTime) && r.status === 'developing')
    const test = requirements.filter((r) => isDateToday(r.testTime) && r.status === 'testing')
    const publish = requirements.filter(
      (r) => isDateToday(r.publishTime) && r.status !== 'published' && r.status !== 'archived',
    )
    const publishDone = requirements.filter((r) => isDateToday(r.publishTime) && r.status === 'published')
    return { dev, test, publish, publishDone }
  }, [requirements])

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
          items={todayTasks.dev.map((r) => ({ id: r.id, name: r.name, project: r.project }))}
        />
        <TaskCard
          title="今日待提测"
          icon="flask"
          color="amber"
          items={todayTasks.test.map((r) => ({ id: r.id, name: r.name, project: r.project }))}
        />
        <TaskCard
          title="今日上线"
          icon="rocket"
          color="rose"
          items={todayTasks.publish.map((r) => ({ id: r.id, name: r.name, project: r.project }))}
          doneItems={todayTasks.publishDone.map((r) => ({ id: r.id, name: r.name, project: r.project }))}
        />
      </div>

      {/* 待办列表 */}
      <div className="card p-5">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200">
            今日待办
          </h3>
          <span className="text-xs text-slate-400">
            {doneCount}/{todayTodos.length} 已完成
          </span>
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

        {todayTodos.length === 0 ? (
          <p className="py-6 text-center text-sm text-slate-400 dark:text-slate-500">
            今天暂无待办，享受专注的一天 ☕
          </p>
        ) : (
          <ul className="space-y-1">
            {todayTodos.map((t) => (
              <li
                key={t.id}
                className="group flex items-center gap-3 rounded-lg px-2 py-2 transition hover:bg-slate-50 dark:hover:bg-slate-800/50"
              >
                <button
                  onClick={() => onToggleTodo(t.id)}
                  className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md border transition ${
                    t.done
                      ? 'border-emerald-500 bg-emerald-500 text-white'
                      : 'border-slate-300 text-transparent hover:border-emerald-400 dark:border-slate-600'
                  }`}
                  aria-label={t.done ? '标记未完成' : '标记完成'}
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M20 6 9 17l-5-5" />
                  </svg>
                </button>
                <span
                  className={`flex-1 text-sm ${
                    t.done
                      ? 'text-slate-400 line-through dark:text-slate-500'
                      : 'text-slate-700 dark:text-slate-200'
                  }`}
                >
                  {t.content}
                </span>
                <button
                  onClick={() => onRemoveTodo(t.id)}
                  className="rounded p-1 text-slate-300 opacity-0 transition hover:text-rose-500 group-hover:opacity-100 dark:text-slate-600"
                  aria-label="删除待办"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                    <path d="M18 6 6 18M6 6l12 12" />
                  </svg>
                </button>
              </li>
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
}: {
  title: string
  icon: 'code' | 'flask' | 'rocket'
  color: 'blue' | 'amber' | 'rose'
  items: { id: string; name: string; project: string }[]
  doneItems?: { id: string; name: string; project: string }[]
}) {
  const palette = {
    blue: 'bg-blue-500',
    amber: 'bg-amber-500',
    rose: 'bg-rose-500',
  }[color]

  const icons = {
    code: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        <path d="m16 18 6-6-6-6M8 6l-6 6 6 6" />
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
    <div className="card p-4">
      <div className="mb-3 flex items-center gap-2">
        <span className={`flex h-6 w-6 items-center justify-center rounded-md ${palette} text-white`}>
          {icons}
        </span>
        <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
          {title}
        </h4>
        {items.length > 0 && (
          <span className={`ml-auto rounded-full ${palette} px-2 py-0.5 text-xs font-bold text-white`}>
            {items.length}
          </span>
        )}
      </div>
      {items.length === 0 && doneItems.length === 0 ? (
        <p className="py-3 text-center text-xs text-slate-400 dark:text-slate-500">暂无</p>
      ) : (
        <ul className="space-y-1.5">
          {items.map((it) => (
            <li key={it.id} className="break-words text-sm text-slate-700 dark:text-slate-200">
              <span className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-amber-400 align-middle" />
              {it.name}
              {it.project && (
                <span className="ml-1 text-xs text-slate-400">· {it.project}</span>
              )}
            </li>
          ))}
          {doneItems.map((it) => (
            <li key={`done-${it.id}`} className="break-words text-sm text-slate-400 line-through dark:text-slate-500">
              <span className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-emerald-400 align-middle" />
              {it.name}
              {it.project && (
                <span className="ml-1 text-xs">· {it.project}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
