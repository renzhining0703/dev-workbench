import { useEffect, useMemo, useState } from 'react'
import type { TodoItem } from '../types'
import { toDateStr } from '../lib/utils'
import { buildTodoSummary } from '../lib/todos'

/**
 * 汇总通知：每天首次打开页面时，若「今日未完成待办 > 3 条」触发一次。
 * 通知方式（纯浏览器端，无服务端推送）：
 *   1. 应用内底部横幅（必现，无需权限）
 *   2. 浏览器桌面通知（Notification API，需用户授权过）
 * 每日去重 key 独立于上线提醒，互不影响。
 */
const SUMMARY_NOTIFY_KEY = 'dev-workbench:todo-summary-dates'

function getSummaryNotifiedDates(): string[] {
  try {
    return JSON.parse(localStorage.getItem(SUMMARY_NOTIFY_KEY) ?? '[]') as string[]
  } catch {
    return []
  }
}

function markSummaryNotified(date: string) {
  const list = getSummaryNotifiedDates().filter((d) => d !== date)
  list.push(date)
  localStorage.setItem(SUMMARY_NOTIFY_KEY, JSON.stringify(list))
}

export function TodoSummaryReminder({
  todos,
  onViewTodos,
}: {
  todos: TodoItem[]
  /** 点击横幅「查看待办」→ 跳转待办 Tab */
  onViewTodos?: () => void
}) {
  const today = toDateStr(new Date())
  const summary = useMemo(() => buildTodoSummary(todos), [todos])
  const [banner, setBanner] = useState<{ undone: number; high: number; overdue: number } | null>(null)

  useEffect(() => {
    // 今日未完成 <= 3 条不打扰
    if (summary.undone <= 3) return
    const notified = getSummaryNotifiedDates()
    if (notified.includes(today)) return
    markSummaryNotified(today)
    setBanner(summary)

    // 浏览器桌面通知（需已授权；未授权时仅应用内横幅）
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      try {
        const parts = [`今日还有 ${summary.undone} 条待办未完成`]
        if (summary.high > 0) parts.push(`其中高优先级 ${summary.high} 条`)
        if (summary.overdue > 0) parts.push(`昨日遗留 ${summary.overdue} 条`)
        new Notification('📋 今日待办汇总', {
          body: parts.join('，'),
          tag: `todo-summary-${today}`,
        })
      } catch {
        /* 浏览器限制时静默（如移动端） */
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [summary.undone, summary.high, summary.overdue, today])

  if (!banner) return null

  return (
    <div className="fixed inset-x-0 bottom-0 z-[100] p-3">
      <div className="wb-card mx-auto flex max-w-md items-center gap-3 px-4 py-3">
        <div
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg"
          style={{ background: 'var(--wb-brand-600)', color: '#F6EFDF' }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 11l3 3L22 4M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
          </svg>
        </div>
        <div className="min-w-0 flex-1 text-sm" style={{ color: 'var(--wb-ink)' }}>
          <p className="font-medium">今日还有 {banner.undone} 条待办未完成</p>
          <p className="truncate text-xs" style={{ color: 'var(--wb-ink-2)' }}>
            {[
              banner.high > 0 ? `高优先级 ${banner.high} 条` : '',
              banner.overdue > 0 ? `昨日遗留 ${banner.overdue} 条` : '',
            ].filter(Boolean).join(' · ') || '打开待办页开始处理吧'}
          </p>
        </div>
        {onViewTodos && (
          <button
            type="button"
            onClick={() => {
              setBanner(null)
              onViewTodos()
            }}
            className="wb-btn-soft shrink-0 text-xs"
          >
            查看待办
          </button>
        )}
        <button
          type="button"
          onClick={() => setBanner(null)}
          className="shrink-0 rounded px-1.5 py-1 text-xs transition hover:text-[var(--wb-ink)]"
          style={{ color: 'var(--wb-ink-3)' }}
          aria-label="关闭"
        >
          ✕
        </button>
      </div>
    </div>
  )
}
