import { useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
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
      <div className="wb-card wb-card-pad">
        <p className="text-center text-sm" style={{ color: 'var(--wb-ink-2)' }}>
          还没有需求数据，先去「需求列表」新建一条吧
        </p>
      </div>
    )
  }

  const monthLabel = format(new Date(), 'M月', { locale: zhCN })

  return (
    <div>
      {/* 页面标题 */}
      <div className="wb-page-head">
        <div>
          <p className="wb-eyebrow">统计</p>
          <h2 className="wb-page-title">
            数据<em>总览</em>
          </h2>
          <p className="wb-page-sub">
            需求状态分布 · 月度上线趋势 · 平均开发周期 · 周报 / 月报素材
          </p>
        </div>
      </div>

      {/* 顶部数据卡片 */}
      <div className="wb-stat-grid">
        <StatCard label="本年需求" value={yearItems.length} sub={`${year} 年`} />
        <StatCard label="本月需求" value={monthItems.length} sub={monthLabel} />
        <StatCard
          label="已上线"
          value={counts.published}
          sub="累计"
          accent="brand"
        />
        <StatCard
          label="平均周期"
          value={avgAll > 0 ? `${avgAll}` : '—'}
          suffix={avgAll > 0 ? '天' : ''}
          sub="全部已上线"
          accent="accent"
        />
      </div>

      {/* 状态分布 + 月度趋势 */}
      <div className="wb-two-col">
        <Section title="状态分布" hint="全部需求">
          <DonutChart counts={counts} />
        </Section>
        <Section title="月度上线趋势" hint="最近 6 个月">
          <BarChart data={monthTrend} />
        </Section>
      </div>

      {/* 平均周期分维度 */}
      <Section title="平均开发周期" hint="从创建到上线 · 单位：天">
        <div className="wb-cycle-grid">
          <CycleStat label="本月" days={avgMonth} count={samples.month} />
          <CycleStat label="本年" days={avgYear} count={samples.year} />
          <CycleStat label="全部" days={avgAll} count={samples.all} />
        </div>
      </Section>

      {/* 周报素材 */}
      <Section title="周报素材" hint="点击复制后粘到 IM / 邮件">
        <ReportBlock
          text={buildWeeklyReport(requirements)}
          copied={copiedKey === 'week'}
          onCopy={() => copy('week', buildWeeklyReport(requirements))}
        />
      </Section>

      {/* 月报素材 */}
      <Section title="月报素材" hint="点击复制">
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
  accent?: 'brand' | 'accent'
}) {
  const valueClass =
    accent === 'brand' ? 'num-brand' : accent === 'accent' ? 'num-accent' : 'num-ink'
  return (
    <div className="wb-card wb-stat-lg">
      <p className="lbl">{label}</p>
      <p className={`num ${valueClass}`}>
        {value}
        {suffix && <small>{suffix}</small>}
      </p>
      {sub && <p className="sub">{sub}</p>}
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
  children: ReactNode
}) {
  return (
    <section className="wb-card">
      <header className="wb-card-head">
        <h3 className="wb-card-title">{title}</h3>
        {hint && <span className="wb-card-hint">{hint}</span>}
      </header>
      <div className="wb-chart-body">{children}</div>
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
    <div className="wb-cycle">
      <p className="lbl">{label}</p>
      <p className="num">{days > 0 ? days : '—'}</p>
      <p className="meta">
        {days > 0 ? '天 / 平均' : '暂无数据'} · 样本 {count} 个
      </p>
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
    <div className="wb-report">
      <button type="button" onClick={onCopy} className="copy" aria-label="复制">
        {copied ? (
          <span className="font-medium" style={{ color: 'var(--wb-brand-500)' }}>
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
      <pre>{text}</pre>
    </div>
  )
}
