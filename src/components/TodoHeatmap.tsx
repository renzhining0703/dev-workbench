import { useMemo, useState } from 'react'
import {
  addDays,
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  format,
  isSameDay,
  isSameMonth,
  parseISO,
  startOfMonth,
  startOfWeek,
  subMonths,
} from 'date-fns'
import type { TodoItem } from '../types'
import { toDateStr } from '../lib/utils'

const WEEK_LABELS = ['一', '二', '三', '四', '五', '六', '日']

/** 完成数 → 热力等级（0=无记录，1~5 由浅到深），与 index.css 的 --wb-heat-* 对应 */
function heatLevel(n: number): number {
  if (n <= 0) return 0
  if (n === 1) return 1
  if (n === 2) return 2
  if (n <= 4) return 3
  if (n <= 7) return 4
  return 5
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

interface TodoHeatmapProps {
  todos: TodoItem[]
  /** 当前选中的日期 yyyy-MM-dd（高亮标记） */
  selected: string
  onSelectDate: (date: string) => void
}

/** 月历热力图：按月展示每日待办完成量，颜色越深完成越多，点击日期跳转 */
export function TodoHeatmap({ todos, selected, onSelectDate }: TodoHeatmapProps) {
  const [month, setMonth] = useState(() => startOfMonth(new Date()))

  const doneByDay = useMemo(() => buildDoneByDay(todos), [todos])

  const days = useMemo(() => {
    const start = startOfWeek(startOfMonth(month), { weekStartsOn: 1 })
    const end = endOfMonth(month)
    const lastWeekStart = startOfWeek(end, { weekStartsOn: 1 })
    return eachDayOfInterval({ start, end: addDays(lastWeekStart, 6) })
  }, [month])

  const monthTotal = useMemo(() => {
    const prefix = format(month, 'yyyy-MM')
    let sum = 0
    for (const [day, n] of doneByDay) {
      if (day.startsWith(prefix)) sum += n
    }
    return sum
  }, [doneByDay, month])

  const activeDays = useMemo(() => {
    const prefix = format(month, 'yyyy-MM')
    let count = 0
    for (const [day, n] of doneByDay) {
      if (day.startsWith(prefix) && n > 0) count++
    }
    return count
  }, [doneByDay, month])

  const isCurrentMonth = isSameMonth(month, new Date())

  return (
    <div className="wb-card" style={{ padding: 18 }}>
      <div className="flex flex-wrap items-center gap-2">
        <div className="wb-heat-head">
          <button
            className="wb-heat-nav"
            onClick={() => setMonth((m) => subMonths(m, 1))}
            aria-label="上个月"
          >
            ◀
          </button>
          <b>{format(month, 'yyyy年M月')}</b>
          <button
            className="wb-heat-nav"
            onClick={() => setMonth((m) => addMonths(m, 1))}
            aria-label="下个月"
          >
            ▶
          </button>
          {!isCurrentMonth && (
            <button
              className="wb-btn-ghost"
              style={{ padding: '4px 10px', fontSize: 12 }}
              onClick={() => setMonth(startOfMonth(new Date()))}
            >
              回到本月
            </button>
          )}
        </div>
        <span className="ml-auto text-xs" style={{ color: 'var(--wb-ink-3)' }}>
          本月完成 <b style={{ color: 'var(--wb-brand-500)' }}>{monthTotal}</b> 条 · {activeDays} 天有记录
        </span>
      </div>

      <div className="wb-heat-grid">
        {WEEK_LABELS.map((w) => (
          <span key={w} className="wk">{w}</span>
        ))}
        {days.map((d) => {
          const inMonth = isSameMonth(d, month)
          const dayStr = toDateStr(d)
          const isToday = isSameDay(d, new Date())
          const isSel = dayStr === selected
          const n = doneByDay.get(dayStr) ?? 0
          return (
            <button
              key={dayStr}
              type="button"
              className={`wb-heat-day ${inMonth ? '' : 'out'} ${isToday ? 'today' : ''} ${isSel ? 'sel' : ''}`}
              data-l={heatLevel(n)}
              title={
                n > 0
                  ? `${format(d, 'M月d日')} · 完成 ${n} 条待办`
                  : format(d, 'M月d日') + (isToday ? ' · 今天' : '')
              }
              onClick={() => onSelectDate(dayStr)}
            >
              {format(d, 'd')}
              {n > 0 && <span className="cnt">{n}</span>}
            </button>
          )
        })}
      </div>

      <div className="wb-heat-legend">
        <span>少</span>
        <i className="l1" />
        <i className="l2" />
        <i className="l3" />
        <i className="l4" />
        <i className="l5" />
        <span>多</span>
        <span style={{ marginLeft: 'auto' }}>点击日期可直接查看当天待办</span>
      </div>
    </div>
  )
}
