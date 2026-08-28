import { useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { format } from 'date-fns'
import { zhCN } from 'date-fns/locale'
import type { TodoItem } from '../types'
import {
  buildEfficiencyReport,
  completedByDay,
  completedByHour,
  weekStats,
} from '../lib/efficiency'
import { copyToClipboard } from '../lib/utils'

/**
 * 个人效率统计：完成趋势折线 + 时段分布 + 周复盘
 * 数据源 TodoItem.completedAt（勾选完成时自动记录），复用同一份数据资产。
 */
export function EfficiencyView({ todos }: { todos: TodoItem[] }) {
  const [copied, setCopied] = useState(false)
  const copyTimer = useRef<number | null>(null)

  const week = useMemo(() => weekStats(todos), [todos])
  const trend14 = useMemo(() => completedByDay(todos, 14), [todos])
  const hours = useMemo(() => completedByHour(todos), [todos])

  const totalDone = useMemo(
    () => todos.filter((t) => t.done && t.completedAt && !t.deletedAt).length,
    [todos],
  )

  const copy = async () => {
    const ok = await copyToClipboard(buildEfficiencyReport(todos))
    if (!ok) return
    setCopied(true)
    if (copyTimer.current) window.clearTimeout(copyTimer.current)
    copyTimer.current = window.setTimeout(() => setCopied(false), 1500)
  }

  const empty = totalDone === 0

  return (
    <div>
      <div className="wb-page-head">
        <div>
          <p className="wb-eyebrow">统计</p>
          <h2 className="wb-page-title">
            个人<em>效率</em>
          </h2>
          <p className="wb-page-sub">
            完成趋势 · 活跃时段 · 连续天数 · 周复盘（数据来自待办完成记录）
          </p>
        </div>
      </div>

      {empty ? (
        <div className="wb-card wb-card-pad">
          <p className="text-center text-sm" style={{ color: 'var(--wb-ink-2)' }}>
            还没有完成记录 —— 在「待办」里勾选几条试试，统计会自动生成
          </p>
        </div>
      ) : (
        <>
          {/* 顶部统计卡 */}
          <div className="wb-stat-grid">
            <StatCard
              label="本周完成"
              value={week.weekDone}
              suffix="条"
              sub={
                week.weekDelta !== null
                  ? week.weekDelta > 0
                    ? `较上周 +${week.weekDelta}%`
                    : `较上周 ${week.weekDelta}%`
                  : '上周无记录'
              }
              accent={week.weekDelta !== null && week.weekDelta < 0 ? 'warn' : 'brand'}
            />
            <StatCard
              label="连续完成"
              value={week.streak}
              suffix="天"
              sub={`历史最长 ${week.bestStreak} 天`}
              accent="accent"
            />
            <StatCard
              label="日均完成"
              value={week.avgPerDay30}
              suffix="条"
              sub="近 30 天"
            />
            <StatCard
              label="本周活跃"
              value={week.weekDays.length}
              suffix="天"
              sub={`近 7 天共 ${week.activeDays7} 天有完成`}
            />
          </div>

          {/* 完成趋势 + 时段分布 */}
          <div className="wb-two-col">
            <Section title="完成趋势" hint="近 14 天，每日完成条数">
              <TrendLine data={trend14} />
            </Section>
            <Section
              title="时段分布"
              hint={week.peakHour !== null ? `最活跃 ${week.peakHour}:00~${week.peakHour + 1}:00` : '暂无数据'}
            >
              <HourBars hours={hours} peakHour={week.peakHour} />
            </Section>
          </div>

          {/* 周复盘素材 */}
          <Section title="周复盘素材" hint="点击复制后粘到 IM / 邮件">
            <div className="wb-report">
              <button type="button" onClick={copy} className="copy" aria-label="复制">
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
              <pre>{buildEfficiencyReport(todos)}</pre>
            </div>
          </Section>
        </>
      )}
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
  accent?: 'brand' | 'accent' | 'warn'
}) {
  const valueClass =
    accent === 'brand'
      ? 'num-brand'
      : accent === 'accent'
        ? 'num-accent'
        : accent === 'warn'
          ? 'num-warn'
          : 'num-ink'
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

/** 完成趋势折线（手写 SVG，零依赖） */
function TrendLine({ data }: { data: { date: string; count: number; label: string }[] }) {
  const W = 680
  const H = 190
  const PAD = { top: 18, right: 10, bottom: 26, left: 10 }
  const innerW = W - PAD.left - PAD.right
  const innerH = H - PAD.top - PAD.bottom
  const max = Math.max(1, ...data.map((d) => d.count))
  const n = data.length

  const x = (i: number) => PAD.left + (i / (n - 1)) * innerW
  const y = (count: number) => PAD.top + innerH - (count / max) * innerH

  const pts = data.map((d, i) => `${x(i).toFixed(1)},${y(d.count).toFixed(1)}`)
  const area = `M${x(0).toFixed(1)},${(PAD.top + innerH).toFixed(1)} L${pts.join(' L')} L${x(n - 1).toFixed(1)},${(PAD.top + innerH).toFixed(1)} Z`

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="近 14 天完成趋势">
      {/* 网格线：0 / 半 / 满 */}
      {[0, 0.5, 1].map((g) => (
        <line
          key={g}
          x1={PAD.left}
          x2={W - PAD.right}
          y1={PAD.top + innerH - innerH * g}
          y2={PAD.top + innerH - innerH * g}
          stroke="var(--wb-line)"
          strokeWidth="1"
          strokeDasharray={g === 0 ? '0' : '3 4'}
          opacity="0.7"
        />
      ))}
      {/* 面积 + 折线 */}
      <path d={area} fill="var(--wb-brand-500)" opacity="0.1" />
      <polyline
        points={pts.join(' ')}
        fill="none"
        stroke="var(--wb-brand-500)"
        strokeWidth="2"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      {/* 数据点 */}
      {data.map((d, i) =>
        d.count > 0 ? (
          <circle
            key={d.date}
            cx={x(i)}
            cy={y(d.count)}
            r="3"
            fill="var(--wb-brand-500)"
            stroke="var(--wb-surface-1)"
            strokeWidth="1.5"
          >
            <title>{`${format(new Date(`${d.date}T00:00:00`), 'M月d日', { locale: zhCN })}：${d.count} 条`}</title>
          </circle>
        ) : null,
      )}
      {/* X 轴标签（隔天显示，首尾必显） */}
      {data.map((d, i) => {
        if (i !== 0 && i !== n - 1 && i % 2 === 1) return null
        return (
          <text
            key={d.date}
            x={x(i)}
            y={H - 8}
            textAnchor="middle"
            fontSize="10"
            fill="var(--wb-ink-3)"
          >
            {d.label}
          </text>
        )
      })}
    </svg>
  )
}

/** 24 小时完成分布条形图（div flex，峰值高亮） */
function HourBars({
  hours,
  peakHour,
}: {
  hours: { hour: number; count: number }[]
  peakHour: number | null
}) {
  const max = Math.max(1, ...hours.map((h) => h.count))
  const labelAt = (h: number) => h % 6 === 0

  return (
    <div>
      <div className="flex h-[120px] items-end gap-[2px]">
        {hours.map((h) => (
          <div
            key={h.hour}
            className="flex-1"
            title={`${h.hour}:00~${h.hour + 1}:00：${h.count} 条`}
          >
            {h.count > 0 && (
              <div
                className="mx-auto w-full rounded-t-[2px]"
                style={{
                  height: `${(h.count / max) * 100}%`,
                  minHeight: 3,
                  backgroundColor:
                    h.hour === peakHour
                      ? 'var(--wb-accent)'
                      : 'var(--wb-brand-500)',
                  opacity: h.hour === peakHour ? 1 : 0.55,
                }}
              />
            )}
          </div>
        ))}
      </div>
      <div className="mt-1.5 flex gap-[2px]">
        {hours.map((h) =>
          labelAt(h.hour) ? (
            <div key={h.hour} className="flex-1 text-center text-[9px]" style={{ color: 'var(--wb-ink-3)' }}>
              {h.hour}
            </div>
          ) : (
            <div key={h.hour} className="flex-1" />
          ),
        )}
      </div>
      <p className="mt-2 text-[11px]" style={{ color: 'var(--wb-ink-3)' }}>
        横轴为完成时刻（24 小时制），橙柱为最活跃时段
      </p>
    </div>
  )
}
