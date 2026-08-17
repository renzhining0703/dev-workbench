import { useMemo } from 'react'
import type { RequirementStatus } from '../types'
import { STATUS_FLOW, STATUS_META } from '../types'

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
        className="flex items-center justify-center text-sm text-slate-400 dark:text-slate-500"
        style={{ minHeight: size }}
      >
        暂无数据
      </div>
    )
  }

  return (
    <div className="flex flex-col items-center gap-5 sm:flex-row sm:items-start sm:gap-6">
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
            stroke="currentColor"
            strokeWidth={thickness}
            className="text-slate-100 dark:text-slate-800"
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
                {STATUS_META[s.status].label}：{s.value} 个
              </title>
            </circle>
          ))}
        </svg>
        {/* 中心数字 */}
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-2xl font-bold tabular-nums text-slate-800 dark:text-slate-100">
            {total}
          </span>
          <span className="text-[11px] text-slate-400">总需求</span>
        </div>
      </div>

      {/* 图例 */}
      <ul className="grid w-full grid-cols-2 gap-x-3 gap-y-1.5 text-sm sm:w-auto sm:grid-cols-1">
        {STATUS_FLOW.map((status) => (
          <li
            key={status}
            className="flex items-center gap-2 text-slate-600 dark:text-slate-300"
          >
            <span
              className="h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: DOT_HEX[status] }}
            />
            <span className="truncate">{STATUS_META[status].label}</span>
            <span className="ml-auto pl-2 font-medium tabular-nums text-slate-700 dark:text-slate-200">
              {counts[status]}
            </span>
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
}