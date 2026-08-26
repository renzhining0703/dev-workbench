import { useMemo } from 'react'
import { format, startOfWeek, endOfWeek, parseISO, isWithinInterval, subDays } from 'date-fns'
import type { Requirement, TodoItem } from '../types'

interface TodayHeroProps {
  nickname: string
  todos: TodoItem[]
  requirements: Requirement[]
}

/** 根据当前小时返回问候语 */
function greetingFor(hour: number): string {
  if (hour < 6) return '凌晨好'
  if (hour < 12) return '早上好'
  if (hour < 18) return '下午好'
  return '晚上好'
}

/**
 * 连续打卡天数：从今天往前数，连续有完成待办的天数。
 * 今天还没完成时，往回数到昨天为止的连续天数（即「目前已连续」）。
 */
function calcStreak(todos: TodoItem[], today: Date): number {
  const doneDates = new Set<string>()
  for (const t of todos) {
    if (!t.done) continue
    const d = t.completedAt ? t.completedAt.slice(0, 10) : t.date
    doneDates.add(d)
  }

  let streak = 0
  let d = today
  while (doneDates.has(format(d, 'yyyy-MM-dd'))) {
    streak++
    d = subDays(d, 1)
  }
  return streak
}

export function TodayHero({ nickname, todos, requirements }: TodayHeroProps) {
  const now = new Date()
  const dateLabel = format(now, 'EEEE · MMMM yyyy').toUpperCase()
  const greeting = greetingFor(now.getHours())

  const stats = useMemo(() => {
    const todayStr = format(now, 'yyyy-MM-dd')

    // 今日节点：今日开始开发 + 今日开发中 + 今日待上线
    const dev = requirements.filter(
      (r) => r.status === 'developing' && r.devStartTime?.startsWith(todayStr),
    )
    const developing = requirements.filter(
      (r) => r.status === 'developing' && !r.devStartTime?.startsWith(todayStr),
    )
    const publish = requirements.filter(
      (r) =>
        r.status !== 'published' &&
        r.status !== 'archived' &&
        r.publishTime?.startsWith(todayStr),
    )
    const todayNodes = dev.length + developing.length + publish.length

    // 今日待上线数（与右侧「待上线」统计一致）
    const dueToday = publish.length

    // 今日已上线数（用于副标题）
    const publishDone = requirements.filter(
      (r) => r.status === 'published' && r.publishTime?.startsWith(todayStr),
    ).length

    // 今日待办
    const todayTodos = todos.filter((t) => t.date === todayStr && !t.deletedAt)
    const todoDone = todayTodos.filter((t) => t.done).length
    const todoTotal = todayTodos.length
    const todoRate = todoTotal > 0 ? Math.round((todoDone / todoTotal) * 100) : 0

    // 本周完成：按 completedAt 落到本周（周一~周日）
    const weekRange = {
      start: startOfWeek(now, { weekStartsOn: 1 }),
      end: endOfWeek(now, { weekStartsOn: 1 }),
    }
    const weekDone = todos.filter((t) => {
      if (!t.done) return false
      const doneDate = t.completedAt ? parseISO(t.completedAt) : parseISO(t.date)
      return isWithinInterval(doneDate, weekRange)
    }).length

    // 连续打卡
    const streak = calcStreak(todos, now)

    return { todayNodes, dueToday, publishDone, todoDone, todoTotal, todoRate, weekDone, streak }
  }, [todos, requirements, now])

  const { todayNodes, dueToday, publishDone, todoDone, todoTotal, todoRate, weekDone, streak } =
    stats

  const displayName = nickname.trim() || '朋友'
  const remaining = Math.max(0, todoTotal - todoDone)
  const allDone = todoTotal > 0 && remaining === 0

  return (
    <div className="wb-hero">
      <div className="wb-hero-inner">
        <div className="wb-hero-main">
          <div className="wb-hero-date">{dateLabel}</div>
          <h2>
            {greeting}，<em>{displayName}</em>。今天有 {todayNodes} 个节点。
          </h2>
          <p>
            本周完成 {weekDone} 条待办 · 连续打卡 {streak} 天
            {publishDone > 0 || dueToday > 0
              ? ` · ${publishDone + dueToday} 条需求今日上线`
              : null}
          </p>
        </div>
        <div className="wb-hero-stats">
          <div className="wb-hero-stat">
            <strong>{todayNodes}</strong>
            <span>今日节点</span>
          </div>
          <div className="wb-hero-stat">
            <strong>{dueToday}</strong>
            <span>待上线</span>
          </div>
          <div className="wb-hero-stat">
            <strong>{todoRate}%</strong>
            <span>今日待办</span>
          </div>
        </div>
      </div>
      <div className="wb-hero-progress">
        <div className="bar">
          <i style={{ width: `${todoTotal > 0 ? (todoDone / todoTotal) * 100 : 0}%` }} />
        </div>
        <div className="meta">
          <span>
            已完成 {todoDone}/{todoTotal} 条
          </span>
          <span>
            剩余 {remaining} 条 · {allDone ? '赞' : '加油'}
          </span>
        </div>
      </div>
    </div>
  )
}
