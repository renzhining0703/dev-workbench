import { useMemo, useRef, useState } from 'react'
import { format } from 'date-fns'
import { zhCN } from 'date-fns/locale'
import type { Requirement } from '../types'
import {
  currentMonth,
  currentYear,
  filterByMonth,
  filterByYear,
  statusCounts,
  avgDevCycle,
  last6MonthsPublished,
  buildWeeklyReport,
  buildMonthlyReport,
} from '../lib/stats'
import { copyToClipboard } from '../lib/utils'
import { DonutChart } from './DonutChart'
import { BarChart } from './BarChart'

export function StatsView({ requirements }: { requirements: Requirement[] }) {
  const [copiedKey, setCopiedKey] = useState<'week' | 'month' | null>(null)
  const copyTimer = useRef<number | null>(null)

  const year = currentYear()
  const month = currentMonth()

  const yearItems = useMemo(
    () => filterByYear(requirements, year),
    [requirements, year],
  )
  const monthItems = useMemo(
    () => filterByMonth(requirements, month),
    [requirements, month],
  )

  const counts = useMemo(() => statusCounts(requirements), [requirements])
  const monthTrend = useMemo(
    () => last6MonthsPublished(requirements),
    [requirements],
  )

  const avgAll = useMemo(() => avgDevCycle(requirements), [requirements])
  const avgYear = useMemo(() => avgDevCycle(yearItems), [yearItems])
  const avgMonth = useMemo(() => avgDevCycle(monthItems), [monthItems])

  // 各维度的已上线样本数（用于显示「样本 X 个」）
  const samples = useMemo(() => {
    const inMonth = (r: Requirement) =>
      r.status === 'published' && r.publishTime && r.publishTime.slice(0, 7) === month
    const inYear = (r: Requirement) =>
      r.status === 'published' && r.publishTime && r.publishTime.slice(0, 4) === year
    const any = (r: Requirement) => r.status === 'published' && !!r.publishTime
    return {
      month: monthItems.filter(inMonth).length,
      year: yearItems.filter(inYear).length,
      all: requirements.filter(any).length,
    }
  }, [requirements, monthItems, yearItems, month, year])

  const copy = async (key: 'week' | 'month', text: string) => {
    const ok = await copyToClipboard(text)
    if (!ok) return
    setCopiedKey(key)
    if (copyTimer.current) window.clearTimeout(copyTimer.current)
    copyTimer.current = window.setTimeout(() => setCopiedKey(null), 1500)
  }

  if (requirements.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-200 bg-white p-12 text-center text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400">
        还没有需求数据，先去「需求列表」新建一条吧
      </div>
    )
  }

  const monthLabel = format(new Date(), 'M月', { locale: zhCN })

  return (
    <div className="space-y-5">
      {/* 顶部数据卡片 */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-4">
        <StatCard label="本年需求" value={yearItems.length} sub={`${year} 年`} />
        <StatCard label="本月需求" value={monthItems.length} sub={monthLabel} />
        <StatCard
          label="已上线"
          value={counts.published}
          sub="累计"
          accent="emerald"
        />
        <StatCard
          label="平均周期"
          value={avgAll > 0 ? `${avgAll}` : '—'}
          suffix={avgAll > 0 ? '天' : ''}
          sub="全部已上线"
          accent="indigo"
        />
      </div>

      {/* 状态分布 + 月度趋势 */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="状态分布" hint="全部需求">
          <DonutChart counts={counts} />
        </Section>
        <Section title="月度上线趋势" hint="最近 6 个月">
          <BarChart data={monthTrend} />
        </Section>
      </div>

      {/* 平均周期分维度 */}
      <Section title="平均开发周期" hint="从创建到上线 · 单位：天">
        <div className="grid grid-cols-3 gap-4">
          <CycleStat label="本月" days={avgMonth} count={samples.month} />
          <CycleStat label="本年" days={avgYear} count={samples.year} />
          <CycleStat label="全部" days={avgAll} count={samples.all} />
        </div>
      </Section>

      {/* 周报素材 */}
      <Section
        title="📋 周报素材"
        hint="点击复制后粘到 IM / 邮件"
      >
        <ReportBlock
          text={buildWeeklyReport(requirements)}
          copied={copiedKey === 'week'}
          onCopy={() => copy('week', buildWeeklyReport(requirements))}
        />
      </Section>

      {/* 月报素材 */}
      <Section title="📋 月报素材" hint="点击复制">
        <ReportBlock
          text={buildMonthlyReport(requirements)}
          copied={copiedKey === 'month'}
          onCopy={() => copy('month', buildMonthlyReport(requirements))}
        />
      </Section>
    </div>
  )
}

function StatCard({
  label,
  value,
  suffix,
  sub,
  accent,
}: {
  label: string
  value: number | string
  suffix?: string
  sub?: string
  accent?: 'emerald' | 'indigo'
}) {
  const valueColor =
    accent === 'emerald'
      ? 'text-emerald-600 dark:text-emerald-400'
      : accent === 'indigo'
        ? 'text-indigo-600 dark:text-indigo-400'
        : 'text-slate-800 dark:text-slate-100'
  return (
    <div className="card p-4">
      <p className="text-xs text-slate-500 dark:text-slate-400">{label}</p>
      <p
        className={`mt-1 text-2xl font-bold tabular-nums sm:text-3xl ${valueColor}`}
      >
        {value}
        {suffix && (
          <span className="ml-0.5 text-sm font-medium text-slate-400">
            {suffix}
          </span>
        )}
      </p>
      {sub && <p className="mt-0.5 text-[11px] text-slate-400">{sub}</p>}
    </div>
  )
}

function Section({
  title,
  hint,
  children,
}: {
  title: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <section className="card p-5">
      <header className="mb-3 flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200">
          {title}
        </h3>
        {hint && (
          <span className="text-[11px] text-slate-400 dark:text-slate-500">
            {hint}
          </span>
        )}
      </header>
      {children}
    </section>
  )
}

function CycleStat({
  label,
  days,
  count,
}: {
  label: string
  days: number
  count: number
}) {
  return (
    <div className="rounded-xl bg-slate-50 p-3 text-center dark:bg-slate-800/40">
      <p className="text-[11px] text-slate-500 dark:text-slate-400">{label}</p>
      <p className="mt-1 text-2xl font-bold text-indigo-600 dark:text-indigo-400">
        {days > 0 ? days : '—'}
      </p>
      <p className="text-[11px] text-slate-400">
        {days > 0 ? '天 / 平均' : '暂无数据'}
      </p>
      <p className="mt-0.5 text-[10px] text-slate-400">样本 {count} 个</p>
    </div>
  )
}

function ReportBlock({
  text,
  copied,
  onCopy,
}: {
  text: string
  copied: boolean
  onCopy: () => void
}) {
  return (
    <div className="relative">
      <button
        type="button"
        onClick={onCopy}
        className="absolute right-2 top-2 inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-slate-500 transition hover:bg-slate-200/70 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-slate-200"
        aria-label="复制"
      >
        {copied ? (
          <span className="font-medium text-emerald-600 dark:text-emerald-400">
            ✓ 已复制
          </span>
        ) : (
          <>
            <svg
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
            </svg>
            复制
          </>
        )}
      </button>
      <pre className="overflow-x-auto whitespace-pre-wrap rounded-lg bg-slate-50 p-4 pr-16 font-mono text-[13px] leading-relaxed text-slate-700 dark:bg-slate-800/50 dark:text-slate-200">
        {text}
      </pre>
    </div>
  )
}