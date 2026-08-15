import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { RequirementStatus } from '../types'
import { STATUS_FLOW, STATUS_META } from '../types'

export interface SelectOption<T extends string> {
  value: T
  label: string
  disabled?: boolean
  /** 小圆点颜色 class（如 bg-emerald-500） */
  dot?: string
  /** 文字颜色 class（如 text-emerald-600 dark:text-emerald-400） */
  color?: string
}

interface SelectProps<T extends string> {
  value: T | null
  onChange: (value: T) => void
  options: SelectOption<T>[]
  placeholder?: string
  /** 面板顶部显示搜索框，支持输入过滤 */
  searchable?: boolean
  /** 有选中值时显示清空按钮，点击后回调 onClear */
  clearable?: boolean
  onClear?: () => void
  size?: 'sm' | 'md'
  disabled?: boolean
  className?: string
}

/**
 * 类 antd 的下拉选择组件（自封装，零依赖）
 * - 点击展开 / 点击外部、滚动、Esc 关闭
 * - 支持搜索过滤、清空、键盘导航（↑↓ 移动 / Enter 选中）
 * - 通过 Portal + fixed 定位，不会被 overflow 容器裁剪
 * - 深浅主题随项目 Tailwind 规范
 */
export function Select<T extends string>({
  value,
  onChange,
  options,
  placeholder = '请选择',
  searchable = false,
  clearable = false,
  onClear,
  size = 'md',
  disabled = false,
  className = '',
}: SelectProps<T>) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [hl, setHl] = useState(0)
  const [pos, setPos] = useState<{ top: number; left: number; width: number; maxWidth: number } | null>(null)

  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  const selected = options.find((o) => o.value === value)
    ?? (value ? ({ value, label: value } as SelectOption<T>) : null)

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return options
    return options.filter((o) => o.label.toLowerCase().includes(q))
  }, [options, query])

  // 打开时定位（fixed + Portal，避免被表格 overflow 裁剪；下方空间不足则向上展开）
  useLayoutEffect(() => {
    if (!open) return
    const el = triggerRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const panelH = Math.min(filtered.length * (size === 'sm' ? 30 : 36) + (searchable ? 44 : 8), 264)
    const spaceBelow = window.innerHeight - r.bottom - 8
    const spaceAbove = r.top - 8
    const up = spaceBelow < panelH && spaceAbove > spaceBelow
    setPos({
      top: up ? Math.max(8, r.top - panelH - 4) : r.bottom + 4,
      left: r.left,
      width: Math.max(r.width, 140),
      maxWidth: Math.min(420, window.innerWidth - r.left - 16),
    })
    const idx = options.findIndex((o) => o.value === value)
    setHl(idx >= 0 ? idx : 0)
    if (searchable) searchRef.current?.focus()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, filtered.length])

  // 外部点击 / 滚动 / 窗口变化 / Esc 关闭
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent | TouchEvent) => {
      const t = e.target as Node
      if (panelRef.current?.contains(t) || triggerRef.current?.contains(t)) return
      setOpen(false)
    }
    const onScroll = (e: Event) => {
      // 面板内部滚动（选项列表滚动）不关闭；仅页面/外部容器滚动时关闭
      const t = e.target as Node
      if (panelRef.current?.contains(t)) return
      setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown, true)
    document.addEventListener('touchstart', onDown, true)
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onScroll)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown, true)
      document.removeEventListener('touchstart', onDown, true)
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onScroll)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  // 高亮项滚动到可见区域
  useEffect(() => {
    if (!open) return
    panelRef.current?.querySelector('[data-hl="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [open, hl])

  const close = useCallback(() => {
    setOpen(false)
    setQuery('')
  }, [])

  const pick = useCallback(
    (opt: SelectOption<T>) => {
      if (opt.disabled) return
      onChange(opt.value)
      close()
    },
    [onChange, close],
  )

  const onTriggerKeyDown = (e: React.KeyboardEvent) => {
    if (disabled) return
    if (!open) {
      if (e.key === 'Enter' || e.key === 'ArrowDown' || e.key === ' ') {
        e.preventDefault()
        setOpen(true)
      }
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setHl((h) => Math.min(h + 1, filtered.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHl((h) => Math.max(h - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const opt = filtered[hl]
      if (opt) pick(opt)
    } else if (e.key === 'Escape') {
      close()
    }
  }

  const isSm = size === 'sm'
  const sizeCls = isSm ? 'h-8 text-xs' : 'h-10 text-sm'
  const itemCls = isSm ? 'h-[30px] text-xs' : 'h-9 text-sm'

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={onTriggerKeyDown}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={`inline-flex items-center justify-between gap-2 rounded-lg border px-3 text-left transition ${sizeCls}
          ${disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}
          ${
            open
              ? 'border-indigo-500 ring-2 ring-indigo-500/20 dark:border-indigo-400 dark:ring-indigo-400/20'
              : 'border-slate-300 hover:border-slate-400 dark:border-slate-700 dark:hover:border-slate-600'
          }
          bg-white text-slate-800 dark:bg-slate-800 dark:text-slate-200 ${className}`}
      >
        <span
          className={`flex min-w-0 flex-1 items-center gap-1.5 truncate ${selected?.color ?? ''} ${
            !selected ? 'text-slate-400 dark:text-slate-500' : ''
          }`}
        >
          {selected?.dot && <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${selected.dot}`} />}
          {selected ? selected.label : placeholder}
        </span>
        {clearable && selected && (
          <span
            role="button"
            aria-label="清除"
            onClick={(e) => {
              e.stopPropagation()
              onClear?.()
              close()
            }}
            className="shrink-0 rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-700 dark:hover:text-slate-300"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </span>
        )}
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={`shrink-0 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`}
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>

      {open &&
        pos &&
        createPortal(
          <div
            ref={panelRef}
            role="listbox"
            style={{
              position: 'fixed',
              top: pos.top,
              left: pos.left,
              minWidth: pos.width,
              maxWidth: pos.maxWidth,
              zIndex: 9999,
            }}
            className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl dark:border-slate-700 dark:bg-slate-800 dark:shadow-black/40"
          >
            {searchable && (
              <div className="border-b border-slate-100 p-1.5 dark:border-slate-700">
                <input
                  ref={searchRef}
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value)
                    setHl(0)
                  }}
                  placeholder="搜索…"
                  className="w-full rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs text-slate-700 outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-200 dark:focus:border-indigo-400"
                />
              </div>
            )}
            <div className="max-h-64 overflow-y-auto p-1">
              {filtered.length === 0 && (
                <div className="px-3 py-4 text-center text-xs text-slate-400 dark:text-slate-500">无匹配选项</div>
              )}
              {filtered.map((opt, i) => {
                const isHl = i === hl
                const isSel = opt.value === value
                return (
                  <div
                    key={opt.value}
                    data-hl={isHl}
                    role="option"
                    aria-selected={isSel}
                    onClick={() => pick(opt)}
                    onMouseEnter={() => setHl(i)}
                    className={`flex cursor-pointer items-center justify-between gap-2 rounded-lg px-2.5 transition ${itemCls}
                      ${opt.disabled ? 'cursor-not-allowed opacity-40' : ''}
                      ${isHl ? 'bg-indigo-50 dark:bg-indigo-500/15' : ''}`}
                  >
                    <span
                      className={`flex min-w-0 items-center gap-1.5 truncate ${
                        opt.color ?? 'text-slate-700 dark:text-slate-300'
                      }`}
                    >
                      {opt.dot && <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${opt.dot}`} />}
                      {opt.label}
                    </span>
                    {isSel && (
                      <svg
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        className="shrink-0 text-indigo-600 dark:text-indigo-400"
                      >
                        <path d="M20 6 9 17l-5-5" />
                      </svg>
                    )}
                  </div>
                )
              })}
            </div>
          </div>,
          document.body,
        )}
    </>
  )
}

/** 需求状态下拉选项（带状态色小圆点） */
export const statusSelectOptions: SelectOption<RequirementStatus>[] = STATUS_FLOW.map((s) => ({
  value: s,
  label: STATUS_META[s].label,
  dot: STATUS_META[s].dot,
  color: STATUS_META[s].color,
}))
