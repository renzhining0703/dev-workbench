import { useEffect, useId, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

/** 模态弹窗 */
export function Modal({
  open,
  onClose,
  title,
  children,
  width = 'max-w-2xl',
  /**
   * flush：内容自适应布局（卡片自身不内边距、不滚动，头部固定带分割线）。
   * 供「设置中心」这类需要内部两栏 + 局部滚动的弹窗使用；默认 false 时行为与旧版完全一致。
   */
  flush = false,
}: {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
  width?: string
  flush?: boolean
}) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null
  // Portal 到 body：弹窗可能被渲染在带 backdrop-filter/transform 的容器内
  // （如 sticky header），那些属性会让 position:fixed 相对该容器定位，弹窗被钉在顶部
  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4 backdrop-blur-sm sm:items-center"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        className={`wb-card w-full ${width} my-8 ${
          flush ? 'overflow-hidden' : 'max-h-[90vh] overflow-y-auto p-6'
        }`}
      >
        <div
          className={
            flush
              ? 'flex items-center justify-between border-b px-5 py-3.5'
              : 'mb-5 flex items-center justify-between'
          }
          style={flush ? { borderColor: 'var(--wb-line)' } : undefined}
        >
          <h3 style={{ fontSize: 16, fontWeight: 600, color: 'var(--wb-ink)' }}>
            {title}
          </h3>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 transition"
            style={{ color: 'var(--wb-ink-3)' }}
            aria-label="关闭"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  )
}

/**
 * 开关（Switch）。
 * 用原生 button + role="switch"，天然支持 Tab 聚焦 / Space 与 Enter 切换。
 * 配色走主题变量，明暗主题自适应。
 */
export function Switch({
  checked,
  onChange,
  disabled = false,
  label,
  size = 'md',
}: {
  checked: boolean
  onChange: (next: boolean) => void
  disabled?: boolean
  /** 无障碍名称；外层已有可见文字标签时可不传 */
  label?: string
  size?: 'sm' | 'md'
}) {
  const id = useId()
  const dims = size === 'sm'
    ? { track: 'h-[18px] w-[32px]', thumb: 14, travel: 14 }
    : { track: 'h-[22px] w-[38px]', thumb: 18, travel: 18 }
  return (
    <button
      type="button"
      id={id}
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`wb-switch ${dims.track}`}
      style={
        {
          '--wb-switch-thumb': `${dims.thumb}px`,
          '--wb-switch-travel': `${dims.travel}px`,
        } as React.CSSProperties
      }
      data-checked={checked ? 'true' : 'false'}
    >
      <span className="wb-switch-thumb" />
    </button>
  )
}


/** 确认对话框 */
export function ConfirmDialog({
  open,
  title,
  message,
  onCancel,
  onConfirm,
  confirmLabel = '删除',
  cancelLabel = '取消',
}: {
  open: boolean
  title: string
  message: string
  onCancel: () => void
  onConfirm: () => void
  /** 确认按钮文案，默认「删除」（保持原行为） */
  confirmLabel?: string
  /** 取消按钮文案，默认「取消」 */
  cancelLabel?: string
}) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onCancel()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onCancel])

  if (!open) return null
  // 同 Modal：Portal 到 body，避免被祖先容器的 backdrop-filter 破坏 fixed 定位
  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
      onMouseDown={(e) => e.target === e.currentTarget && onCancel()}
    >
      <div className="wb-card w-full max-w-sm p-6">
        <h3 style={{ fontSize: 16, fontWeight: 600, color: 'var(--wb-ink)' }}>{title}</h3>
        <p className="mt-2 whitespace-pre-line text-sm" style={{ color: 'var(--wb-ink-2)' }}>{message}</p>
        <div className="mt-5 flex justify-end gap-2">
          <button className="wb-btn-ghost" onClick={onCancel}>{cancelLabel}</button>
          <button className="wb-btn-danger-soft" onClick={onConfirm}>{confirmLabel}</button>
        </div>
      </div>
    </div>,
    document.body,
  )
}

/* -------- 项目维度上线状态（一个需求多项目分批上线） --------
   区分手段 = 颜色 + 图标双通道：已上线 = 绿色实心对勾，未上线 = 灰色空心点。
   不只依赖颜色，色弱用户也能辨认；配色走 success / surface 变量，深浅主题自适应。 */

function PublishedGlyph({ published }: { published: boolean }) {
  return published ? (
    <svg
      className="chk"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="3.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m4 10.5 3.6 3.6L16 6" />
    </svg>
  ) : (
    <span className="dot" />
  )
}

/** 上线状态标题文案（含日期与操作提示） */
function publishedTitle(publishedAt: string | null | undefined, canToggle: boolean): string {
  const published = !!publishedAt
  const date = publishedAt ? publishedAt.slice(0, 10) : ''
  if (!published) return canToggle ? '未上线，点击标记为已上线' : '未上线'
  return `已上线${date ? `（${date}）` : ''}${canToggle ? '，点击标记为未上线' : ''}`
}

/**
 * 紧凑圆点：列表「发布模块」列每行行首、项目溢出面板等窄空间。
 * 传 onToggle → 可点击切换；否则只读展示（span，不进 Tab 焦点序列）。
 */
export function ProjectPublishedDot({
  project,
  publishedAt,
  onToggle,
}: {
  project: string
  publishedAt?: string | null
  onToggle?: () => void
}) {
  const published = !!publishedAt
  const glyph = <PublishedGlyph published={published} />
  if (!onToggle) {
    return (
      <span className={`wb-pm-toggle ${published ? 'on' : ''}`} title={publishedTitle(publishedAt, false)}>
        {glyph}
      </span>
    )
  }
  return (
    <button
      type="button"
      className={`wb-pm-toggle ${published ? 'on' : ''}`}
      onClick={(e) => {
        // 列表行/卡片整体可点击，这里必须阻止冒泡
        e.stopPropagation()
        onToggle()
      }}
      title={publishedTitle(publishedAt, true)}
      aria-label={`${project} ${published ? '已上线' : '未上线'}`}
      aria-pressed={published}
    >
      {glyph}
    </button>
  )
}

/**
 * 圆点 + 文字的展开版：表单、抽屉等空间充裕处。
 * 复用 wb-chip + st-published / st-pending 配色（深浅主题已有定义）。
 */
export function ProjectPublishedChip({
  project,
  publishedAt,
  onToggle,
}: {
  project: string
  publishedAt?: string | null
  onToggle?: () => void
}) {
  const published = !!publishedAt
  const inner = (
    <>
      <PublishedGlyph published={published} />
      {published ? '已上线' : '未上线'}
    </>
  )
  if (!onToggle) {
    return (
      <span className={`wb-chip shrink-0 ${published ? 'st-published' : 'st-pending'}`}>
        {inner}
      </span>
    )
  }
  return (
    <button
      type="button"
      className={`wb-chip shrink-0 transition ${published ? 'st-published' : 'st-pending'}`}
      onClick={onToggle}
      title={publishedTitle(publishedAt, true)}
      aria-label={`${project} ${published ? '已上线' : '未上线'}`}
      aria-pressed={published}
    >
      {inner}
    </button>
  )
}

/** 空状态 */
export function EmptyState({
  icon,
  title,
  subtitle,
  action,
}: {
  icon?: ReactNode
  title: string
  subtitle?: string
  action?: ReactNode
}) {
  return (
    <div className="flex flex-col items-center justify-center py-14 text-center">
      <div
        className="mb-3 flex h-12 w-12 items-center justify-center rounded-full"
        style={{ background: 'var(--wb-surface-2)', color: 'var(--wb-ink-3)' }}
      >
        {icon ?? (
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21.5 2v6h-6M2.5 22v-6h6" />
            <path d="M21.34 15.57a10 10 0 1 1-2.91-9.6L21.5 8" />
          </svg>
        )}
      </div>
      <p style={{ fontSize: 14, fontWeight: 500, color: 'var(--wb-ink)' }}>{title}</p>
      {subtitle && <p className="mt-1 text-xs" style={{ color: 'var(--wb-ink-3)' }}>{subtitle}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}

/** 骨架屏行（用于首屏加载感知） */
export function SkeletonRows({ rows = 5, cols = 6 }: { rows?: number; cols?: number }) {
  return (
    <tbody>
      {Array.from({ length: rows }).map((_, i) => (
        <tr key={i} style={{ borderBottom: '1px solid var(--wb-line)' }}>
          {Array.from({ length: cols }).map((_, j) => (
            <td key={j} className="px-4 py-3">
              <div className="h-4 animate-pulse rounded" style={{ background: 'var(--wb-surface-2)', width: `${40 + ((i + j) % 5) * 12}%` }} />
            </td>
          ))}
        </tr>
      ))}
    </tbody>
  )
}
