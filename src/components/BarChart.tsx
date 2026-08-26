interface BarChartProps {
  data: { label: string; count: number }[]
  height?: number
}

/**
 * SVG 柱状图：最近 N 个月每月数据
 * - 纯 div + flex 实现（更易主题适配）
 * - 高度按最大柱子等比例缩放
 * - 颜色走 NOVA 令牌（--wb-brand-*），自动适配亮/暗主题
 */
export function BarChart({ data, height = 180 }: BarChartProps) {
  const max = Math.max(1, ...data.map((d) => d.count))

  return (
    <div style={{ minHeight: height }}>
      <div className="flex h-[calc(100%-1.75rem)] items-end gap-1.5 sm:gap-3">
        {data.map((d, i) => {
          const h = (d.count / max) * 100
          return (
            <div
              key={i}
              className="flex flex-1 flex-col items-center justify-end"
              title={`${d.label}：${d.count} 个`}
            >
              <span
                className="mb-1 text-[11px] font-medium tabular-nums"
                style={{ color: 'var(--wb-ink-2)' }}
              >
                {d.count}
              </span>
              <div
                className="w-full rounded-t-md"
                style={{
                  height: `${h}%`,
                  minHeight: d.count > 0 ? 4 : 0,
                  backgroundColor: 'var(--wb-brand-500)',
                  opacity: 0.9,
                }}
              />
            </div>
          )
        })}
      </div>
      <div className="mt-2 flex gap-1.5 sm:gap-3">
        {data.map((d, i) => (
          <div
            key={i}
            className="flex-1 text-center text-[10px] sm:text-xs"
            style={{ color: 'var(--wb-ink-3)' }}
          >
            {d.label}
          </div>
        ))}
      </div>
    </div>
  )
}
