import { useEffect, useState } from 'react'
import { toDateStr } from '../lib/utils'
import { lastWorkdayOfMonth } from '../lib/timesheet'

/**
 * 工时表月度提醒：每月最后一个工作日首次打开时横幅提醒填工时表。
 * 纯浏览器端，按月去重（localStorage），点「去查看」跳工时 Tab。
 */
const TS_REMIND_KEY = 'dev-workbench:timesheet-reminded-months'

function getRemindedMonths(): string[] {
  try {
    return JSON.parse(localStorage.getItem(TS_REMIND_KEY) ?? '[]') as string[]
  } catch {
    return []
  }
}

function markReminded(monthKey: string): void {
  const list = getRemindedMonths().filter((m) => m !== monthKey)
  list.push(monthKey)
  localStorage.setItem(TS_REMIND_KEY, JSON.stringify(list))
}

export function TimesheetReminder({ onViewTimesheet }: { onViewTimesheet?: () => void }) {
  const now = new Date()
  const today = toDateStr(now)
  const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  const lastWorkday = lastWorkdayOfMonth(now.getFullYear(), now.getMonth() + 1)
  const [banner, setBanner] = useState(false)

  useEffect(() => {
    if (!lastWorkday || today !== lastWorkday) return
    if (getRemindedMonths().includes(monthKey)) return
    markReminded(monthKey)
    setBanner(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastWorkday, today, monthKey])

  if (!banner) return null

  return (
    <div className="fixed inset-x-0 bottom-0 z-[100] p-3">
      <div className="wb-card mx-auto flex max-w-md items-center gap-3 px-4 py-3">
        <div
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg"
          style={{ background: 'var(--wb-warn)', color: '#F6EFDF' }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="4" width="18" height="18" rx="2" />
            <path d="M16 2v4M8 2v4M3 10h18M9 16l2 2 4-4" />
          </svg>
        </div>
        <div className="min-w-0 flex-1 text-sm" style={{ color: 'var(--wb-ink)' }}>
          <p className="font-medium">今天是本月最后一个工作日</p>
          <p className="truncate text-xs" style={{ color: 'var(--wb-ink-2)' }}>
            记得看一眼工时月报，把表填了
          </p>
        </div>
        {onViewTimesheet && (
          <button
            type="button"
            onClick={() => {
              setBanner(false)
              onViewTimesheet()
            }}
            className="wb-btn-soft shrink-0 text-xs"
          >
            去查看
          </button>
        )}
        <button
          type="button"
          onClick={() => setBanner(false)}
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
