interface BarChartProps {
  data: { label: string; count: number }[]
  height?: number
}

// 柱状图绘图区固定像素高度（数字占位约 16px 另计）
const BAR_AREA = 140

/**
 * SVG 柱状图：最近 N 个月每月数据
 * - 纯 div + flex 实现（更易主题适配）
 * - 柱子高度按像素计算（绘图区固定高度），避免百分比依赖父级高度链失效
 * - 0 值月份画灰色 2px 基线，与「无数据」区分
 * - 颜色走 NOVA 令牌（--wb-brand-*），自动适配亮/暗主题
 */
export function BarChart({ data }: BarChartProps) {
  const max = Math.max(1, ...data.map((d) => d.count))

  return (
    <div>
      <div className="flex items-end gap-1.5 sm:gap-3" style={{ height: BAR_AREA }}>
        {data.map((d, i) => {
          // 像素高度：按最大柱等比缩放；0 值给 2px 灰基线
          const barH = d.count > 0 ? Math.max(4, Math.round((d.count / max) * BAR_AREA)) : 2
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
                  height: barH,
                  backgroundColor: d.count > 0 ? 'var(--wb-brand-500)' : 'var(--wb-ink-3)',
                  opacity: d.count > 0 ? 0.9 : 0.4,
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
