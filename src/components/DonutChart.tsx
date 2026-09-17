import { useMemo } from 'react'
import type { RequirementStatus } from '../types'
import { STATUS_FLOW, statusMeta } from '../types'

interface Props {
  counts: Record<RequirementStatus, number>
  size?: number
  thickness?: number
}

/**
 * SVG 圆环图（按 STATUS_FLOW 顺序从顶部 12 点方向顺时针排列）
 * - 中心显示总数
 * - 右侧图例显示每个状态的数量
 * - 零值状态不画扇形，图例仍展示（让用户看到全部维度）
 */
export function DonutChart({ counts, size = 168, thickness = 24 }: Props) {
  const total = useMemo(
    () => Object.values(counts).reduce((a, b) => a + b, 0),
    [counts],
  )
  const radius = (size - thickness) / 2
  const circumference = 2 * Math.PI * radius

  const segments = useMemo(() => {
    if (total === 0) return []
    let offset = 0
    return STATUS_FLOW.map((status) => {
      const value = counts[status]
      const fraction = value / total
      const dash = fraction * circumference
      const seg = {
        status,
        value,
        dasharray: `${dash} ${circumference - dash}`,
        dashoffset: -offset,
        hex: DOT_HEX[status],
      }
      offset += dash
      return seg
    }).filter((s) => s.value > 0)
  }, [counts, total, circumference])

  if (total === 0) {
    return (
      <div
        className="flex items-center justify-center text-sm"
        style={{ minHeight: size, color: 'var(--wb-ink-3)' }}
      >
        暂无数据
      </div>
    )
  }

  return (
    <div className="wb-donut-wrap">
      <div
        className="relative shrink-0"
        style={{ width: size, height: size }}
      >
        <svg
          width={size}
          height={size}
          viewBox={`0 0 ${size} ${size}`}
          // 让圆环从 12 点方向开始（旋转 -90°），顺时针排
          style={{ transform: 'rotate(-90deg)' }}
        >
          {/* 背景环 */}
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke="var(--wb-surface-2)"
            strokeWidth={thickness}
          />
          {/* 各状态扇形 */}
          {segments.map((s) => (
            <circle
              key={s.status}
              cx={size / 2}
              cy={size / 2}
              r={radius}
              fill="none"
              stroke={s.hex}
              strokeWidth={thickness}
              strokeDasharray={s.dasharray}
              strokeDashoffset={s.dashoffset}
            >
              <title>
                {statusMeta(s.status).label}：{s.value} 个
              </title>
            </circle>
          ))}
        </svg>
        {/* 中心数字 */}
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span
            className="text-2xl font-medium tabular-nums"
            style={{ fontFamily: 'var(--wb-serif)', color: 'var(--wb-ink)' }}
          >
            {total}
          </span>
          <span style={{ fontSize: 11, color: 'var(--wb-ink-3)' }}>总需求</span>
        </div>
      </div>

      {/* 图例 */}
      <ul className="wb-legend">
        {STATUS_FLOW.map((status) => (
          <li key={status}>
            <span
              className="sw"
              style={{ backgroundColor: DOT_HEX[status] }}
            />
            <span>{statusMeta(status).label}</span>
            <span className="v">{counts[status]}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

/**
 * 状态对应的实际色值（与 STATUS_META.dot 保持一致，但用 hex 方便 SVG 直接用）
 * 之所以不用 STATUS_META.dot 是因为 tailwind class 不会在动态拼接时生成 CSS
 */
const DOT_HEX: Record<RequirementStatus, string> = {
  pending: '#94a3b8', // slate-400
  developing: '#3b82f6', // blue-500
  testing: '#f59e0b', // amber-500
  ready: '#a855f7', // purple-500
  paused: '#f97316', // orange-500
  published: '#10b981', // emerald-500
  archived: '#94a3b8', // slate-400
  notStarted: '#06b6d4', // cyan-500
  inProgress: '#6366f1', // indigo-500
  toConfirm: '#f43f5e', // rose-500
  done: '#14b8a6', // teal-500
}