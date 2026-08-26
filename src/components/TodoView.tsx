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
import type { Requirement, TodoItem } from '../types'
import { toDateStr } from '../lib/utils'
import { sortTodos } from '../lib/todos'
import { TodoRow } from './TodoRow'

const WEEK_LABELS = ['一', '二', '三', '四', '五', '六', '日']
const WEEKDAY_LABELS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

interface TodoViewProps {
  todos: TodoItem[]
  requirements: Requirement[]
  onAddTodo: (content: string, date: string) => void
  onToggleTodo: (id: string) => void
  onUpdateTodo: (id: string, patch: Partial<Pick<TodoItem, 'content' | 'date' | 'done' | 'priority' | 'requirementId'>>) => void
  onRemoveTodo: (id: string) => void
  /** 点击关联需求 chip → 跳回需求抽屉 */
  onOpenRequirement?: (reqId: string) => void
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
  requirements,
  onAddTodo,
  onToggleTodo,
  onUpdateTodo,
  onRemoveTodo,
  onOpenRequirement,
}: TodoViewProps) {
  const today = toDateStr(new Date())
  const [selected, setSelected] = useState(today)
  const [input, setInput] = useState('')
  const [calOpen, setCalOpen] = useState(false)
  const [calMonth, setCalMonth] = useState(() => startOfMonth(new Date()))
  const calRef = useRef<HTMLDivElement>(null)

  const selectedDate = parseISO(selected)
  const dayTodos = useMemo(
    () => sortTodos(todos.filter((t) => t.date === selected)),
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
    <div className="space-y-[18px]">
      {/* 页头 */}
      <div className="wb-page-head">
        <div>
          <div className="wb-eyebrow">Todos</div>
          <h1 className="wb-page-title">待办 <em>日历</em></h1>
          <p className="wb-page-sub">按日规划，完成即打卡；日历上的绿点表示当天有完成记录</p>
        </div>
      </div>

      {/* 简报 */}
      <div className="wb-todo-stats">
        <div className="wb-card wb-stat-mini">
          <div className="num num-brand">{stats.weekDone}</div>
          <div className="lbl">本周完成（条）</div>
          <div className="cap">本周累计</div>
        </div>
        <div className="wb-card wb-stat-mini">
          <div className="num num-accent">{stats.streak}</div>
          <div className="lbl">连续打卡（天）</div>
          <div className="cap">今天已完成 · 延续中</div>
        </div>
        <div className="wb-card wb-stat-mini">
          <div className="num num-ink">{stats.monthDone}</div>
          <div className="lbl">本月完成（条）</div>
          <div className="cap">{format(new Date(), 'M 月累计')}</div>
        </div>
      </div>

      {/* 日期导航 + 待办列表 */}
      <div className="wb-card" style={{ padding: 18 }}>
        <div className="wb-datebar" ref={calRef}>
          <button
            className="wb-day-nav"
            onClick={() => goDay(-1)}
            aria-label="前一天"
          >
            ◀
          </button>
          <div style={{ position: 'relative' }}>
            <button
              className="wb-date-label"
              onClick={() => {
                setCalOpen((v) => !v)
                setCalMonth(startOfMonth(selectedDate))
              }}
            >
              {dateLabel}
              <span className="cal">📅</span>
            </button>

            {/* 日历弹层 */}
            {calOpen && (
              <div className="wb-cal-pop">
                <div className="wb-cal-head">
                  <button onClick={() => setCalMonth(subMonths(calMonth, 1))} aria-label="上个月">◀</button>
                  <b>{format(calMonth, 'yyyy年M月')}</b>
                  <button onClick={() => setCalMonth(addMonths(calMonth, 1))} aria-label="下个月">▶</button>
                </div>
                <div className="wb-cal-grid">
                  {WEEK_LABELS.map((w) => (
                    <span key={w} className="wk">{w}</span>
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
                        className={`wb-cal-day ${isSel ? 'sel' : ''} ${isToday ? 'today' : ''} ${inMonth ? '' : 'out'}`}
                        onClick={() => {
                          setSelected(dayStr)
                          setCalOpen(false)
                        }}
                      >
                        {format(d, 'd')}
                        {doneN > 0 && <span className="fdot" />}
                      </button>
                    )
                  })}
                </div>
              </div>
            )}
          </div>
          <button
            className="wb-day-nav"
            onClick={() => goDay(1)}
            aria-label="后一天"
          >
            ▶
          </button>
          {selected !== today && (
            <button
              className="wb-btn-ghost"
              style={{ padding: '5px 10px', fontSize: 12 }}
              onClick={() => {
                setSelected(today)
                setCalOpen(false)
              }}
            >
              回到今天
            </button>
          )}
          <span className="wb-date-progress">
            {doneCount}/{dayTodos.length} 已完成
          </span>
        </div>

        <div className="wb-add-row">
          <input
            className="wb-input"
            placeholder={selected === today ? '添加一条待办，回车确认…' : `添加到 ${selected} 的待办…`}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
          />
          <button className="wb-btn-soft" onClick={submit}>添加</button>
        </div>

        {dayTodos.length === 0 ? (
          <p className="wb-todo-empty">
            {selected === today ? '今天暂无待办，享受专注的一天 ☕' : '这一天没有待办记录'}
          </p>
        ) : (
          <ul className="wb-todo-list">
            {dayTodos.map((t) => (
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
