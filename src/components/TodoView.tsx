import { useMemo, useRef, useState, useEffect } from 'react'
import {
  addDays,
  eachDayOfInterval,
  endOfMonth,
  format,
  isSameDay,
  isSameMonth,
  parseISO,
  startOfMonth,
  startOfWeek,
  subDays,
  subMonths,
  addMonths,
} from 'date-fns'
import type { TodoItem } from '../types'
import { toDateStr } from '../lib/utils'
import { TodoRow } from './TodoRow'

const WEEK_LABELS = ['一', '二', '三', '四', '五', '六', '日']
const WEEKDAY_LABELS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

interface TodoViewProps {
  todos: TodoItem[]
  onAddTodo: (content: string, date: string) => void
  onToggleTodo: (id: string) => void
  onUpdateTodo: (id: string, patch: Partial<Pick<TodoItem, 'content' | 'date' | 'done'>>) => void
  onRemoveTodo: (id: string) => void
}

/** 每天完成数（completedAt 缺失的旧数据回退用待办目标日期） */
function buildDoneByDay(todos: TodoItem[]): Map<string, number> {
  const m = new Map<string, number>()
  for (const t of todos) {
    if (!t.done) continue
    let day: string
    try {
      day = t.completedAt ? format(parseISO(t.completedAt), 'yyyy-MM-dd') : t.date
    } catch {
      day = t.date
    }
    m.set(day, (m.get(day) ?? 0) + 1)
  }
  return m
}

/** 简报：本周完成 / 本月完成 / 连续打卡（今天没完成则从昨天起算） */
function buildStats(doneByDay: Map<string, number>) {
  const now = new Date()
  const today = toDateStr(now)

  const weekStart = startOfWeek(now, { weekStartsOn: 1 })
  const weekDone = eachDayOfInterval({ start: weekStart, end: now })
    .reduce((sum, d) => sum + (doneByDay.get(toDateStr(d)) ?? 0), 0)

  const monthPrefix = format(now, 'yyyy-MM')
  let monthDone = 0
  for (const [day, n] of doneByDay) {
    if (day.startsWith(monthPrefix)) monthDone += n
  }

  let streak = 0
  let cursor = now
  if ((doneByDay.get(today) ?? 0) === 0) cursor = subDays(now, 1)
  while ((doneByDay.get(toDateStr(cursor)) ?? 0) > 0) {
    streak++
    cursor = subDays(cursor, 1)
  }

  return { weekDone, monthDone, streak }
}

export function TodoView({
  todos,
  onAddTodo,
  onToggleTodo,
  onUpdateTodo,
  onRemoveTodo,
}: TodoViewProps) {
  const today = toDateStr(new Date())
  const [selected, setSelected] = useState(today)
  const [input, setInput] = useState('')
  const [calOpen, setCalOpen] = useState(false)
  const [calMonth, setCalMonth] = useState(() => startOfMonth(new Date()))
  const calRef = useRef<HTMLDivElement>(null)

  const selectedDate = parseISO(selected)
  const dayTodos = useMemo(
    () =>
      todos
        .filter((t) => t.date === selected)
        .sort((a, b) => Number(a.done) - Number(b.done) || a.createdAt.localeCompare(b.createdAt)),
    [todos, selected],
  )
  const doneCount = dayTodos.filter((t) => t.done).length

  const doneByDay = useMemo(() => buildDoneByDay(todos), [todos])
  const stats = useMemo(() => buildStats(doneByDay), [doneByDay])

  // 点击日历外部关闭
  useEffect(() => {
    if (!calOpen) return
    const onDown = (e: MouseEvent) => {
      if (calRef.current && !calRef.current.contains(e.target as Node)) setCalOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [calOpen])

  const submit = () => {
    const content = input.trim()
    if (!content) return
    onAddTodo(content, selected)
    setInput('')
  }

  const goDay = (offset: number) => {
    setSelected(toDateStr(addDays(selectedDate, offset)))
    setCalOpen(false)
  }

  const dateLabel = (() => {
    const weekday = WEEKDAY_LABELS[selectedDate.getDay()]
    if (selected === today) return `今天 · ${format(selectedDate, 'M月d日')} ${weekday}`
    if (selected === toDateStr(addDays(new Date(), 1))) return `明天 · ${format(selectedDate, 'M月d日')}`
    if (selected === toDateStr(subDays(new Date(), 1))) return `昨天 · ${format(selectedDate, 'M月d日')}`
    return `${format(selectedDate, 'yyyy年M月d日')} ${weekday}`
  })()

  const calendarDays = useMemo(() => {
    const start = startOfWeek(startOfMonth(calMonth), { weekStartsOn: 1 })
    const end = endOfMonth(calMonth)
    const lastWeekStart = startOfWeek(end, { weekStartsOn: 1 })
    const days = eachDayOfInterval({ start, end: addDays(lastWeekStart, 6) })
    return days
  }, [calMonth])

  return (
    <div className="space-y-5">
      {/* 简报 */}
      <div className="grid grid-cols-3 gap-3">
        <div className="card p-4 text-center">
          <div className="text-2xl font-bold text-blue-600 dark:text-blue-400">{stats.weekDone}</div>
          <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">本周完成（条）</div>
        </div>
        <div className="card p-4 text-center">
          <div className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">{stats.streak}</div>
          <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">连续打卡（天）</div>
        </div>
        <div className="card p-4 text-center">
          <div className="text-2xl font-bold text-violet-600 dark:text-violet-400">{stats.monthDone}</div>
          <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">本月完成（条）</div>
        </div>
      </div>

      {/* 日期导航 + 待办列表 */}
      <div className="card p-5">
        <div className="relative mb-4 flex flex-wrap items-center gap-2" ref={calRef}>
          <button
            className="btn-ghost h-8 w-8 p-0 text-slate-500"
            onClick={() => goDay(-1)}
            aria-label="前一天"
          >
            ◀
          </button>
          <button
            className="rounded-lg px-3 py-1.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
            onClick={() => {
              setCalOpen((v) => !v)
              setCalMonth(startOfMonth(selectedDate))
            }}
          >
            {dateLabel}
            <span className="ml-1.5 text-xs text-slate-400">📅</span>
          </button>
          <button
            className="btn-ghost h-8 w-8 p-0 text-slate-500"
            onClick={() => goDay(1)}
            aria-label="后一天"
          >
            ▶
          </button>
          {selected !== today && (
            <button
              className="rounded-md bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-600 transition hover:bg-blue-100 dark:bg-blue-500/15 dark:text-blue-400 dark:hover:bg-blue-500/25"
              onClick={() => {
                setSelected(today)
                setCalOpen(false)
              }}
            >
              回到今天
            </button>
          )}
          <span className="ml-auto text-xs text-slate-400">
            {doneCount}/{dayTodos.length} 已完成
          </span>

          {/* 日历弹层 */}
          {calOpen && (
            <div className="absolute left-5 top-full z-30 mt-2 w-72 rounded-xl border border-slate-200 bg-white p-3 shadow-xl dark:border-slate-700 dark:bg-slate-800">
              <div className="mb-2 flex items-center justify-between">
                <button
                  className="rounded p-1 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700"
                  onClick={() => setCalMonth(subMonths(calMonth, 1))}
                  aria-label="上个月"
                >
                  ◀
                </button>
                <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">
                  {format(calMonth, 'yyyy年M月')}
                </span>
                <button
                  className="rounded p-1 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700"
                  onClick={() => setCalMonth(addMonths(calMonth, 1))}
                  aria-label="下个月"
                >
                  ▶
                </button>
              </div>
              <div className="grid grid-cols-7 gap-y-1 text-center">
                {WEEK_LABELS.map((w) => (
                  <div key={w} className="py-1 text-xs text-slate-400">{w}</div>
                ))}
                {calendarDays.map((d) => {
                  const inMonth = isSameMonth(d, calMonth)
                  const dayStr = toDateStr(d)
                  const isSel = dayStr === selected
                  const isToday = isSameDay(d, new Date())
                  const doneN = doneByDay.get(dayStr) ?? 0
                  return (
                    <button
                      key={dayStr}
                      className={`relative mx-auto flex h-8 w-8 items-center justify-center rounded-full text-xs transition ${
                        isSel
                          ? 'bg-blue-600 font-bold text-white'
                          : isToday
                            ? 'font-bold text-blue-600 hover:bg-slate-100 dark:text-blue-400 dark:hover:bg-slate-700'
                            : inMonth
                              ? 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-700'
                              : 'text-slate-300 dark:text-slate-600'
                      }`}
                      onClick={() => {
                        setSelected(dayStr)
                        setCalOpen(false)
                      }}
                    >
                      {format(d, 'd')}
                      {doneN > 0 && !isSel && (
                        <span className="absolute bottom-0.5 h-1 w-1 rounded-full bg-emerald-500" />
                      )}
                    </button>
                  )
                })}
              </div>
            </div>
          )}
        </div>

        <div className="mb-3 flex gap-2">
          <input
            className="input flex-1"
            placeholder={selected === today ? '添加一条待办，回车确认…' : `添加到 ${selected} 的待办…`}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
          />
          <button className="btn-primary" onClick={submit}>添加</button>
        </div>

        {dayTodos.length === 0 ? (
          <p className="py-6 text-center text-sm text-slate-400 dark:text-slate-500">
            {selected === today ? '今天暂无待办，享受专注的一天 ☕' : '这一天没有待办记录'}
          </p>
        ) : (
          <ul className="space-y-1">
            {dayTodos.map((t) => (
              <TodoRow
                key={t.id}
                todo={t}
                onToggle={onToggleTodo}
                onUpdate={onUpdateTodo}
                onRemove={onRemoveTodo}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
