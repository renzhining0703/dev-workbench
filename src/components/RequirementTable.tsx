import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { Requirement, RequirementStatus } from '../types'
import { STATUS_FLOW, statusMeta } from '../types'
import { copyToClipboard, exportCsv, fmtDate, fmtDateShort, isDateToday, toDateStr } from '../lib/utils'
import { highlight } from '../lib/highlight'
import {
  requirementModuleDisplay,
  requirementProjectDisplay,
  requirementProjectNames,
} from '../lib/projects'
import { useStore } from '../store/StoreContext'
import { ConfirmDialog, EmptyState, SkeletonRows } from './ui'
import { Select, statusSelectOptions } from './Select'
import { RequirementDrawer } from './RequirementDrawer'

type StatusFilter = 'all' | RequirementStatus

/** 移动端高频 Tab：保持一屏内可达（含关键工作流节点"待上线"） */
const HIGH_FREQ_STATUSES: RequirementStatus[] = ['pending', 'developing', 'testing', 'ready']
/** 移动端低频状态：藏在"更多"下拉里；桌面端仍直接展示 */
const LOW_FREQ_STATUSES: RequirementStatus[] = ['paused', 'published', 'archived']

/** 排序方向 */
type SortDir = 'asc' | 'desc'

/** 可排序字段 */
type SortField = 'createdAt' | 'publishTime' | 'status' | 'name'

/** URL 参数读取工具 */
function readUrlParam(key: string, fallback: string): string {
  try {
    const params = new URLSearchParams(window.location.search)
    return params.get(key) || fallback
  } catch {
    return fallback
  }
}

const VALID_STATUSES: StatusFilter[] = ['all', 'pending', 'developing', 'testing', 'ready', 'paused', 'published', 'archived']
const VALID_SORT_FIELDS: SortField[] = ['createdAt', 'publishTime', 'status', 'name']
const VALID_SORT_DIRS: SortDir[] = ['asc', 'desc']

/** NOVA 品牌色（选中行/悬停面板等场景的半透明底） */
const BRAND_SOFT = 'rgba(42,112,86,.1)'

interface Props {
  requirements: Requirement[]
  onEdit: (r: Requirement) => void
  /** 克隆：以源需求为模板打开新建表单 */
  onClone?: (r: Requirement) => void
  onDelete: (id: string) => void
  onBatchDelete?: (ids: string[]) => void
  onStatusChange: (id: string, status: RequirementStatus) => void
  /** 搜索框 ref，供全局快捷键 / 聚焦 */
  searchInputRef?: React.Ref<HTMLInputElement>
  /** 外部请求打开某个需求的抽屉（如待办关联需求跳转）；变化时触发 */
  externalOpenId?: string | null
  /** externalOpenId 消费后回调（供外层清除状态） */
  onExternalOpened?: () => void
}

/** 时间列展示顺序：创建 / 开发开始 / 开发结束 / 提测 / 上线 */
const TIME_FIELDS: { key: keyof Requirement; label: string }[] = [
  { key: 'createdAt', label: '创建' },
  { key: 'devStartTime', label: '开发' },
  { key: 'devEndTime', label: '结束' },
  { key: 'testTime', label: '提测' },
  { key: 'publishTime', label: '上线' },
]

/**
 * 提测到期徽标：到了/超过提测日但状态还没进测试（待开发/开发中）时，
 * 在需求名称下方显示醒目提示 —— 不用横向滚动到时间列就能看到。
 */
function TestDueBadge({ r }: { r: Requirement }) {
  const today = toDateStr(new Date())
  if (!r.testTime) return null
  if (r.status !== 'pending' && r.status !== 'developing') return null
  if (r.testTime > today) return null

  let label: string
  let bg: string
  let color: string
  if (r.testTime === today) {
    label = '⏰ 今日提测'
    bg = 'var(--wb-warn-soft)'
    color = 'var(--wb-warn)'
  } else {
    const days = Math.max(1, Math.round((Date.parse(today) - Date.parse(r.testTime)) / 86400000))
    label = `⏰ 提测超期 ${days} 天`
    bg = 'var(--wb-danger-soft)'
    color = 'var(--wb-danger)'
  }
  return (
    <div className="mt-1">
      <span className="wb-chip" style={{ background: bg, color }}>
        {label}
      </span>
    </div>
  )
}

/** 时间单元格：所有时间点合并为一列、一行内联展示（不换行）。
 * 空值自动跳过；全部为空时显示 —；今天的日期高亮。
 * wrap 为 true 时（移动端卡片）允许折行。
 */
function TimeCell({ r, wrap = false }: { r: Requirement; wrap?: boolean }) {
  const items = TIME_FIELDS.map(({ key, label }) => {
    const iso = r[key] as string | null
    const date = fmtDateShort(iso)
    if (date === '—') return null
    return { key: String(key), label, date, today: isDateToday(iso) }
  }).filter(Boolean) as { key: string; label: string; date: string; today: boolean }[]

  if (items.length === 0) {
    return <span style={{ color: 'var(--wb-ink-3)', opacity: 0.6 }}>—</span>
  }

  return (
    <div className={`flex items-center gap-1.5 text-xs ${wrap ? 'flex-wrap' : 'whitespace-nowrap'}`}>
      {items.map((it, i) => (
        <span key={it.key} className={`wb-time-tag ${it.today ? 'hot' : ''}`}>
          {i > 0 && wrap && <span style={{ opacity: 0.4 }}>·</span>}
          <span style={{ opacity: 0.75 }}>{it.label}</span>
          <span className={it.today ? '' : 'tabular-nums'}>{it.date}</span>
        </span>
      ))}
    </div>
  )
}

export function RequirementTable({
  requirements,
  onEdit,
  onClone,
  onDelete,
  onBatchDelete,
  onStatusChange,
  searchInputRef,
  externalOpenId,
  onExternalOpened,
}: Props) {
  const [statusFilter, setStatusFilter] = useState<StatusFilter>(() => {
    const v = readUrlParam('status', 'all')
    return VALID_STATUSES.includes(v as StatusFilter) ? (v as StatusFilter) : 'all'
  })
  const [moreOpen, setMoreOpen] = useState(false)
  const moreButtonRef = useRef<HTMLButtonElement>(null)
  const [morePos, setMorePos] = useState<{ top: number; right: number } | null>(null)
  const [projectFilter, setProjectFilter] = useState(() => readUrlParam('project', 'all'))
  const [keyword, setKeyword] = useState(() => readUrlParam('q', ''))
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [copiedBranch, setCopiedBranch] = useState<string | null>(null)
  const [copiedModule, setCopiedModule] = useState<string | null>(null)
  const [sortField, setSortField] = useState<SortField>(() => {
    const v = readUrlParam('sort', 'createdAt')
    return VALID_SORT_FIELDS.includes(v as SortField) ? (v as SortField) : 'createdAt'
  })
  const [sortDir, setSortDir] = useState<SortDir>(() => {
    const v = readUrlParam('dir', 'desc')
    return VALID_SORT_DIRS.includes(v as SortDir) ? (v as SortDir) : 'desc'
  })
  const [drawerId, setDrawerId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  // 外部请求打开抽屉（待办关联需求跳转）：externalOpenId 变化时消费
  useEffect(() => {
    if (!externalOpenId) return
    setDrawerId(externalOpenId)
    onExternalOpened?.()
  }, [externalOpenId, onExternalOpened])
  // 批量选择：默认关闭，点「批量」开关后才展示复选框
  const [selectMode, setSelectMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [batchDeleteIds, setBatchDeleteIds] = useState<string[] | null>(null)
  const copyTimer = useRef<number | null>(null)
  const revertRef = useRef<(() => void) | null>(null)

  /** 退出批量模式并清空选择 */
  const exitSelectMode = useCallback(() => {
    setSelectMode(false)
    setSelectedIds(new Set())
  }, [])

  // Esc 退出批量模式（有弹窗打开时不抢按键）
  useEffect(() => {
    if (!selectMode) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (document.querySelector('.fixed.inset-0.z-50')) return
      exitSelectMode()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selectMode, exitSelectMode])

  // 首屏骨架屏：短暂显示骨架行，提升加载感知
  useEffect(() => {
    const t = window.setTimeout(() => setLoading(false), 120)
    return () => window.clearTimeout(t)
  }, [])

  // 筛选/搜索/排序状态 → URL 同步（刷新不丢，可分享链接）
  useEffect(() => {
    const params = new URLSearchParams()
    if (statusFilter !== 'all') params.set('status', statusFilter)
    if (projectFilter !== 'all') params.set('project', projectFilter)
    if (keyword.trim()) params.set('q', keyword.trim())
    if (sortField !== 'createdAt') params.set('sort', sortField)
    if (sortDir !== 'desc') params.set('dir', sortDir)
    const qs = params.toString()
    const newUrl = window.location.pathname + (qs ? '?' + qs : '') + window.location.hash
    window.history.replaceState(null, '', newUrl)
  }, [statusFilter, projectFilter, keyword, sortField, sortDir])

  // "更多"下拉定位：Portal 到 document.body，避免父级 stacking context 与 overflow 干扰
  useEffect(() => {
    if (!moreOpen) {
      setMorePos(null)
      return
    }
    const DROPDOWN_W = 144 // w-36，与面板 className 保持一致
    const PADDING = 8
    const updatePos = () => {
      const btn = moreButtonRef.current
      if (!btn) return
      const r = btn.getBoundingClientRect()
      const vw = window.innerWidth
      const vh = window.innerHeight
      // 水平：默认对齐按钮右边缘；clamp 到视口内（避免左右溢出）
      const desiredRight = vw - r.right
      const right = Math.max(0, Math.min(desiredRight, vw - DROPDOWN_W - PADDING))
      // 垂直：默认在按钮下方；下方空间不足时翻转到上方
      const panelH = 120 // 3 行 × 36 + padding，预估
      const spaceBelow = vh - r.bottom - PADDING
      const top =
        spaceBelow >= panelH
          ? r.bottom + 4
          : Math.max(PADDING, r.top - panelH - 4)
      setMorePos({ top, right })
    }
    updatePos()
    window.addEventListener('resize', updatePos)
    window.addEventListener('scroll', updatePos, true)
    return () => {
      window.removeEventListener('resize', updatePos)
      window.removeEventListener('scroll', updatePos, true)
    }
  }, [moreOpen])

  /** 点击复制到剪贴板，成功短暂显示「已复制」；新复制会先还原上一次的状态 */
  function copyWithFeedback(text: string, setCopied: (v: string | null) => void) {
    if (!text) return
    revertRef.current?.()
    const done = () => {
      setCopied(text)
      revertRef.current = () => setCopied(null)
      if (copyTimer.current) window.clearTimeout(copyTimer.current)
      copyTimer.current = window.setTimeout(() => {
        setCopied(null)
        revertRef.current = null
      }, 1500)
    }
    copyToClipboard(text).then((ok) => {
      if (ok) done()
    })
  }

  // 项目下拉数据源：来自项目库（顶栏「项目管理」维护）
  const { projects } = useStore()
  const projectOptions = useMemo(
    () => projects.map((p) => ({ value: p.name, label: p.name })),
    [projects],
  )

  const filtered = useMemo(() => {
    const kw = keyword.trim().toLowerCase()
    const result = requirements.filter((r) => {
      if (statusFilter !== 'all') {
        if (r.status !== statusFilter) return false
      } else if (r.status === 'archived') {
        // 默认「全部」视图隐藏已归档：通过「更多 → 已归档」专门查看
        return false
      }
      // 多项目需求：任一项目命中即匹配（含旧版逗号分隔数据）
      if (projectFilter !== 'all' && !requirementProjectNames(r).includes(projectFilter)) {
        return false
      }
      if (kw) {
        const haystack = [
          r.name,
          r.branch,
          requirementProjectDisplay(r),
          requirementModuleDisplay(r),
          r.remark,
        ]
          .join(' ')
          .toLowerCase()
        if (!haystack.includes(kw)) return false
      }
      return true
    })

    // 排序
    const statusOrder = (s: RequirementStatus) => STATUS_FLOW.indexOf(s)
    const sorted = [...result].sort((a, b) => {
      let cmp = 0
      switch (sortField) {
        case 'createdAt':
          cmp = (a.createdAt || '').localeCompare(b.createdAt || '')
          break
        case 'publishTime':
          cmp = (a.publishTime || '').localeCompare(b.publishTime || '')
          break
        case 'status':
          cmp = statusOrder(a.status) - statusOrder(b.status)
          break
        case 'name':
          cmp = a.name.localeCompare(b.name)
          break
      }
      return sortDir === 'asc' ? cmp : -cmp
    })
    return sorted
  }, [requirements, statusFilter, projectFilter, keyword, sortField, sortDir])

  /** 切换排序：同字段切换方向，不同字段切换到该字段默认降序 */
  function toggleSort(field: SortField) {
    if (sortField === field) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortField(field)
      setSortDir('desc')
    }
  }

  /** 清除所有筛选条件 */
  function clearFilters() {
    setStatusFilter('all')
    setProjectFilter('all')
    setKeyword('')
  }

  const hasActiveFilter = statusFilter !== 'all' || projectFilter !== 'all' || keyword.trim() !== ''

  // 批量选择操作
  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }
  const allFilteredSelected = filtered.length > 0 && filtered.every((r) => selectedIds.has(r.id))
  const toggleSelectAll = () => {
    if (allFilteredSelected) {
      setSelectedIds((prev) => {
        const next = new Set(prev)
        filtered.forEach((r) => next.delete(r.id))
        return next
      })
    } else {
      setSelectedIds((prev) => {
        const next = new Set(prev)
        filtered.forEach((r) => next.add(r.id))
        return next
      })
    }
  }
  const clearSelection = () => setSelectedIds(new Set())

  const handleBatchExport = () => {
    const items = filtered.filter((r) => selectedIds.has(r.id))
    if (items.length === 0) return
    exportCsv(
      `需求清单_${new Date().toISOString().slice(0, 10)}.csv`,
      ['需求名称', '项目', '分支', '发布模块', '状态', '创建时间', '开发开始', '开发结束', '提测时间', '上线时间', '备注'],
      items.map((r) => [
        r.name, requirementProjectDisplay(r), r.branch, requirementModuleDisplay(r),
        statusMeta(r.status).label,
        fmtDate(r.createdAt), fmtDate(r.devStartTime), fmtDate(r.devEndTime),
        fmtDate(r.testTime), fmtDate(r.publishTime), r.remark,
      ]),
    )
  }

  const counts = useMemo(() => {
    const map: Record<string, number> = { all: requirements.length }
    for (const s of STATUS_FLOW) map[s] = 0
    for (const r of requirements) map[r.status] = (map[r.status] ?? 0) + 1
    return map
  }, [requirements])

  const deleting = requirements.find((r) => r.id === deleteId)
  const drawerReq = requirements.find((r) => r.id === drawerId)

  /** 行内复选框统一样式（accent 跟随 NOVA 品牌色） */
  const checkboxStyle = { accentColor: 'var(--wb-brand-500)' } as const

  return (
    <div>
      {/* 页面标题 */}
      <div className="wb-page-head">
        <div>
          <p className="wb-eyebrow">需求</p>
          <h2 className="wb-page-title">
            需求<em>清单</em>
          </h2>
          <p className="wb-page-sub">
            按状态 / 项目 / 关键词筛选 · 支持排序、批量操作与 CSV 导出
          </p>
        </div>
      </div>

      {/* 筛选工具栏 */}
      <div className="wb-filter-bar" style={{ alignItems: 'flex-start' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, flex: '1 1 auto', minWidth: 0 }}>
          {/* 状态筛选：移动端 wrap 让所有按钮完整可见，桌面端不 wrap（单行展示全部 8 个） */}
          <div className="wb-pills">
            {/* 全部（单独处理，避免与 RequirementStatus 类型混用） */}
            <button
              onClick={() => setStatusFilter('all')}
              className={`wb-pill ${statusFilter === 'all' ? 'active' : ''}`}
            >
              全部
              <span className="cnt">{counts.all}</span>
            </button>

            {/* 高频：桌面与移动都展示 */}
            {HIGH_FREQ_STATUSES.map((s) => (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                className={`wb-pill ${statusFilter === s ? 'active' : ''}`}
              >
                {statusMeta(s).label}
                <span className="cnt">{counts[s]}</span>
              </button>
            ))}

            {/* 低频：仅桌面直接展示（移动端藏在更多下拉里） */}
            {LOW_FREQ_STATUSES.map((s) => (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                className={`wb-pill hidden md:inline-flex ${statusFilter === s ? 'active' : ''}`}
              >
                {statusMeta(s).label}
                <span className="cnt">{counts[s]}</span>
              </button>
            ))}

            {/* 更多下拉：仅移动端 */}
            <div className="relative md:hidden">
              <button
                ref={moreButtonRef}
                onClick={() => setMoreOpen((v) => !v)}
                className={`wb-pill ${
                  statusFilter !== 'all' && LOW_FREQ_STATUSES.includes(statusFilter as RequirementStatus)
                    ? 'active'
                    : ''
                }`}
                style={
                  statusFilter !== 'all' && LOW_FREQ_STATUSES.includes(statusFilter as RequirementStatus)
                    ? undefined
                    : moreOpen
                      ? { background: 'var(--wb-surface-2)', color: 'var(--wb-ink)' }
                      : undefined
                }
                title="更多状态"
              >
                ⋯ 更多
              </button>
              {moreOpen &&
                morePos &&
                createPortal(
                  <>
                    {/* 外部点击关闭层：z-40，比 header 低、不抢弹窗 */}
                    <div
                      className="fixed inset-0 z-40"
                      onClick={() => setMoreOpen(false)}
                    />
                    {/* 下拉面板：z-50（在 backdrop 之上），fixed 定位脱离父级堆叠上下文 */}
                    <div
                      className="fixed z-50 w-36 overflow-hidden rounded-xl shadow-lg"
                      style={{ top: morePos.top, right: morePos.right, background: 'var(--wb-surface)', border: '1px solid var(--wb-line)' }}
                    >
                      {LOW_FREQ_STATUSES.map((s) => {
                        const selected = statusFilter === s
                        return (
                          <button
                            key={s}
                            onClick={() => {
                              setStatusFilter(s)
                              setMoreOpen(false)
                            }}
                            className="flex w-full items-center gap-1.5 px-3 py-1.5 text-left text-xs transition"
                            style={{
                              color: 'var(--wb-ink-2)',
                              fontWeight: selected ? 600 : 500,
                              background: selected ? BRAND_SOFT : 'transparent',
                            }}
                            onMouseEnter={(e) => {
                              if (!selected) e.currentTarget.style.background = 'var(--wb-surface-2)'
                            }}
                            onMouseLeave={(e) => {
                              e.currentTarget.style.background = selected ? BRAND_SOFT : 'transparent'
                            }}
                          >
                            <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${statusMeta(s).dot}`} />
                            {statusMeta(s).label}
                            <span style={{ marginLeft: 'auto', opacity: 0.7 }}>{counts[s]}</span>
                          </button>
                        )
                      })}
                    </div>
                  </>,
                  document.body,
                )}
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <Select
              className="flex-1 sm:w-40 sm:flex-none"
              placeholder="全部项目"
              searchable
              clearable
              value={projectFilter === 'all' ? null : projectFilter}
              onChange={(v) => setProjectFilter(v)}
              onClear={() => setProjectFilter('all')}
              options={projectOptions}
            />

            {/* 移动端排序（小屏没有表头排序入口） */}
            <Select
              className="flex-1 sm:w-36 sm:flex-none md:hidden"
              value={`${sortField}:${sortDir}`}
              onChange={(v) => {
                const [f, d] = (v ?? 'createdAt:desc').split(':')
                setSortField(f as SortField)
                setSortDir(d as SortDir)
              }}
              options={[
                { value: 'createdAt:desc', label: '最新创建' },
                { value: 'createdAt:asc', label: '最早创建' },
                { value: 'publishTime:desc', label: '最晚上线' },
                { value: 'publishTime:asc', label: '最早上线' },
                { value: 'status:desc', label: '按状态' },
                { value: 'name:asc', label: '名称 A→Z' },
                { value: 'name:desc', label: '名称 Z→A' },
              ]}
            />

            {/* 批量操作开关：开启后行首才出现复选框 */}
            <button
              onClick={() => (selectMode ? exitSelectMode() : setSelectMode(true))}
              className="wb-btn-ghost"
              style={
                selectMode
                  ? { borderColor: 'var(--wb-brand-400)', color: 'var(--wb-brand-500)', background: BRAND_SOFT }
                  : undefined
              }
              title={selectMode ? '退出批量选择（Esc）' : '批量选择'}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="m3 7 2 2 4-4M3 17l2 2 4-4M13 6h8M13 12h8M13 18h8" />
              </svg>
              {selectMode ? '退出批量' : '批量'}
            </button>
          </div>
        </div>

        {/* 搜索 */}
        <div className="wb-search" style={{ marginLeft: 'auto', width: '100%', maxWidth: 300 }}>
          <svg
            width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"
          >
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" />
          </svg>
          <input
            ref={searchInputRef}
            className="wb-input"
            style={{ width: '100%' }}
            placeholder="搜索名称 / 分支 / 模块 / 备注…"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
          />
          {keyword === '' && <kbd className="hidden sm:block">/</kbd>}
        </div>
      </div>

      {/* 批量操作工具栏：仅批量模式下展示 */}
      {selectMode && (
        <div
          className="wb-card"
          style={{
            display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10,
            padding: '10px 14px', marginBottom: 14, background: 'var(--wb-surface-2)',
          }}
        >
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--wb-ink)' }}>
            {selectedIds.size > 0 ? `已选 ${selectedIds.size} 项` : '批量模式：勾选行首复选框'}
          </span>
          <div style={{ marginLeft: 'auto', display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
            <Select
              size="sm"
              className="w-32"
              placeholder="批量改状态"
              value={null}
              onChange={(v) => {
                if (v) {
                  selectedIds.forEach((id) => onStatusChange(id, v as RequirementStatus))
                  clearSelection()
                }
              }}
              options={statusSelectOptions}
            />
            <button className="wb-btn-ghost" onClick={handleBatchExport}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" />
              </svg>
              导出选中
            </button>
            {onBatchDelete && (
              <button className="wb-btn-danger-soft" onClick={() => setBatchDeleteIds([...selectedIds])}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6h14Z" />
                </svg>
                删除选中
              </button>
            )}
            <button
              className="rounded-lg px-2 py-1.5 text-xs"
              style={{ color: 'var(--wb-ink-3)' }}
              onClick={exitSelectMode}
              title="快捷键 Esc"
            >
              退出批量
            </button>
          </div>
        </div>
      )}

      {/* 列表区：桌面表格 / 移动端卡片 */}
      <div className="wb-card overflow-hidden">
        {loading ? (
          <>
            {/* 桌面骨架行 */}
            <div className="hidden overflow-x-auto md:block">
              <table className={`wb-table ${selectMode ? 'min-w-[1140px]' : 'min-w-[1100px]'}`}>
                <SkeletonRows rows={5} cols={selectMode ? 7 : 6} />
              </table>
            </div>
            {/* 移动端骨架卡片 */}
            <div className="space-y-3 p-4 md:hidden">
              {Array.from({ length: 4 }).map((_, i) => (
                <div
                  key={i}
                  className="animate-pulse space-y-2.5 rounded-xl p-4"
                  style={{ background: 'var(--wb-surface-2)' }}
                >
                  <div className="h-3.5 w-2/3 rounded" style={{ background: 'var(--wb-line)' }} />
                  <div className="h-3 w-1/2 rounded" style={{ background: 'var(--wb-line)' }} />
                  <div className="h-3 w-5/6 rounded" style={{ background: 'var(--wb-line)' }} />
                </div>
              ))}
            </div>
          </>
        ) : filtered.length === 0 ? (
          hasActiveFilter ? (
            <EmptyState
              icon={
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="11" cy="11" r="8" />
                  <path d="m21 21-4.3-4.3M8 11h6" />
                </svg>
              }
              title="没有匹配的需求"
              subtitle="试试调整筛选条件或搜索关键词"
              action={
                <button className="wb-btn-ghost" onClick={clearFilters}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                    <path d="M3 3v5h5" />
                  </svg>
                  清除筛选
                </button>
              }
            />
          ) : (
            <EmptyState
              icon={
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <path d="M14 2v6h6M12 18v-6M9 15h6" />
                </svg>
              }
              title="还没有需求记录"
              subtitle="点击「新建需求」创建第一条，或从顶栏导入历史数据"
            />
          )
        ) : (
          <>
            {/* 桌面表格 */}
            <div className="hidden overflow-x-auto md:block">
              <table className={`wb-table ${selectMode ? 'min-w-[1140px]' : 'min-w-[1100px]'}`}>
                <thead>
                  <tr>
                    {selectMode && (
                      <th className="w-10" style={{ textAlign: 'center' }}>
                        <input
                          type="checkbox"
                          checked={allFilteredSelected}
                          onChange={toggleSelectAll}
                          className="h-4 w-4 cursor-pointer rounded"
                          style={checkboxStyle}
                        />
                      </th>
                    )}
                    <th
                      className="cursor-pointer select-none transition"
                      onClick={() => toggleSort('name')}
                    >
                      <span className="inline-flex items-center gap-1">
                        需求名称
                        <SortIcon active={sortField === 'name'} dir={sortDir} />
                      </span>
                    </th>
                    <th className="min-w-[240px]">项目 / 分支</th>
                    <th>发布模块</th>
                    <th
                      className="cursor-pointer select-none"
                      onClick={() => toggleSort('status')}
                    >
                      <span className="inline-flex items-center gap-1">
                        状态
                        <SortIcon active={sortField === 'status'} dir={sortDir} />
                      </span>
                    </th>
                    <th className="min-w-[340px]">时间</th>
                    <th className="sticky right-0 z-10" style={{ textAlign: 'right', boxShadow: '-4px 0 8px -4px rgba(0,0,0,.06)' }}>
                      操作
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((r) => {
                  return (
                    <tr
                      key={r.id}
                      style={selectedIds.has(r.id) ? { background: BRAND_SOFT } : undefined}
                    >
                      {selectMode && (
                        <td style={{ textAlign: 'center' }}>
                          <input
                            type="checkbox"
                            checked={selectedIds.has(r.id)}
                            onChange={() => toggleSelect(r.id)}
                            className="h-4 w-4 cursor-pointer rounded"
                            style={checkboxStyle}
                          />
                        </td>
                      )}
                      <td>
                        <div
                          className="wb-req-name"
                          onClick={() => setDrawerId(r.id)}
                          title="点击查看详情"
                        >
                          {highlight(r.name, keyword)}
                        </div>
                        {r.remark && (
                          <div className="wb-remark">
                            {highlight(r.remark, keyword)}
                          </div>
                        )}
                        <TestDueBadge r={r} />
                      </td>
                      <td className="min-w-[240px]">
                        <div className="flex max-w-[240px] flex-wrap items-center gap-1">
                          {requirementProjectNames(r).length > 0 ? (
                            requirementProjectNames(r).map((name) => (
                              <span
                                key={name}
                                className="wb-chip"
                                style={{ background: 'var(--wb-surface-2)', color: 'var(--wb-ink-2)', maxWidth: 240 }}
                                title={name}
                              >
                                {highlight(name, keyword)}
                              </span>
                            ))
                          ) : (
                            <span style={{ color: 'var(--wb-ink-3)' }}>—</span>
                          )}
                        </div>
                        <code
                          onClick={() => copyWithFeedback(r.branch, setCopiedBranch)}
                          className="wb-code"
                          style={copiedBranch === r.branch ? { background: 'var(--wb-success-soft)', color: 'var(--wb-success)', fontWeight: 600 } : undefined}
                          title={r.branch ? '点击复制分支名' : undefined}
                        >
                          {copiedBranch === r.branch ? '✓ 已复制' : (r.branch ? highlight(r.branch, keyword) : '—')}
                        </code>
                      </td>
                      <td>
                        {requirementModuleDisplay(r) ? (
                          <code
                            onClick={() => copyWithFeedback(requirementModuleDisplay(r), setCopiedModule)}
                            className="wb-code module"
                            style={copiedModule === requirementModuleDisplay(r) ? { background: 'var(--wb-success-soft)', color: 'var(--wb-success)', fontWeight: 600 } : undefined}
                            title="点击复制发布模块"
                          >
                            {copiedModule === requirementModuleDisplay(r) ? '✓ 已复制' : highlight(requirementModuleDisplay(r), keyword)}
                          </code>
                        ) : (
                          <span style={{ color: 'var(--wb-ink-3)', opacity: 0.6 }}>—</span>
                        )}
                      </td>
                      <td>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => setStatusFilter(r.status)}
                            className="group/dot shrink-0 rounded-full p-1 transition"
                            style={{ color: 'var(--wb-ink-3)' }}
                            title={`筛选「${statusMeta(r.status).label}」状态`}
                          >
                            <span className={`block h-2.5 w-2.5 rounded-full transition group-hover/dot:scale-125 ${statusMeta(r.status).dot}`} />
                          </button>
                          <Select
                            size="sm"
                            value={r.status}
                            onChange={(s) => onStatusChange(r.id, s)}
                            options={statusSelectOptions}
                          />
                        </div>
                      </td>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        <TimeCell r={r} />
                      </td>
                      <td className="sticky right-0 z-10" style={{ background: 'var(--wb-surface)', boxShadow: '-4px 0 8px -4px rgba(0,0,0,.08)' }}>
                        <div className="wb-row-actions">
                          <button
                            onClick={() => setDrawerId(r.id)}
                            className="wb-icon-sm"
                            title="查看详情"
                          >
                            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
                              <circle cx="12" cy="12" r="3" />
                            </svg>
                          </button>
                          {onClone && (
                            <button
                              onClick={() => onClone(r)}
                              className="wb-icon-sm"
                              title="克隆（以当前需求为模板新建）"
                            >
                              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                              </svg>
                            </button>
                          )}
                          <button
                            onClick={() => setDeleteId(r.id)}
                            className="wb-icon-sm danger"
                            title="删除"
                          >
                            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6h14Z" />
                            </svg>
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                  })}
                </tbody>
              </table>
            </div>

            {/* 移动端卡片列表 */}
            <div className="md:hidden">
              {filtered.map((r) => (
                <RequirementCard
                  key={r.id}
                  r={r}
                  keyword={keyword}
                  copiedBranch={copiedBranch}
                  copiedModule={copiedModule}
                  selectMode={selectMode}
                  selected={selectedIds.has(r.id)}
                  onToggleSelect={() => toggleSelect(r.id)}
                  onCopyBranch={(b) => copyWithFeedback(b, setCopiedBranch)}
                  onCopyModule={(m) => copyWithFeedback(m, setCopiedModule)}
                  onOpen={() => setDrawerId(r.id)}
                  onEdit={() => onEdit(r)}
                  onClone={onClone ? () => onClone(r) : undefined}
                  onDelete={() => setDeleteId(r.id)}
                  onFilterStatus={(s) => setStatusFilter(s)}
                />
              ))}
            </div>
          </>
        )}
      </div>

      <p style={{ fontSize: 12, color: 'var(--wb-ink-3)', marginTop: 12 }}>
        共 {filtered.length} 条需求
      </p>

      <ConfirmDialog
        open={!!deleteId}
        title="删除需求"
        message={`确定删除「${deleting?.name ?? ''}」吗？删除后 5 秒内可撤销。`}
        onCancel={() => setDeleteId(null)}
        onConfirm={() => {
          if (deleteId) onDelete(deleteId)
          setDeleteId(null)
        }}
      />

      {/* 批量删除确认 */}
      <ConfirmDialog
        open={!!batchDeleteIds}
        title="批量删除"
        message={`确定删除选中的 ${batchDeleteIds?.length ?? 0} 条需求吗？删除后 5 秒内可撤销。`}
        onCancel={() => setBatchDeleteIds(null)}
        onConfirm={() => {
          if (batchDeleteIds && onBatchDelete) {
            onBatchDelete(batchDeleteIds)
          }
          setBatchDeleteIds(null)
          clearSelection()
        }}
      />

      <RequirementDrawer
        requirement={drawerReq ?? null}
        onClose={() => setDrawerId(null)}
        onEdit={(r) => { setDrawerId(null); onEdit(r) }}
        onStatusChange={onStatusChange}
      />
    </div>
  )
}

/** 排序方向图标 */
function SortIcon({ active, dir }: { active: boolean; dir: SortDir }) {
  if (!active) {
    return (
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.3 }}>
        <path d="m7 15 5 5 5-5M7 9l5-5 5 5" />
      </svg>
    )
  }
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--wb-brand-500)' }}>
      {dir === 'asc' ? <path d="m7 15 5-5 5 5" /> : <path d="m7 9 5 5 5-5" />}
    </svg>
  )
}

/**
 * 移动端需求卡片（< md 屏替代表格）。
 * 结构：状态 chip + 操作图标 / 需求名（点击开抽屉）/ 备注 / 项目·分支·模块 / 时间。
 */
function RequirementCard({
  r,
  keyword,
  copiedBranch,
  copiedModule,
  selectMode,
  selected,
  onToggleSelect,
  onCopyBranch,
  onCopyModule,
  onOpen,
  onEdit,
  onClone,
  onDelete,
  onFilterStatus,
}: {
  r: Requirement
  keyword: string
  copiedBranch: string | null
  copiedModule: string | null
  selectMode: boolean
  selected: boolean
  onToggleSelect: () => void
  onCopyBranch: (b: string) => void
  onCopyModule: (m: string) => void
  onOpen: () => void
  onEdit: () => void
  onClone?: () => void
  onDelete: () => void
  onFilterStatus: (s: RequirementStatus) => void
}) {
  const meta = statusMeta(r.status)
  return (
    <div
      className="space-y-2 px-4 py-3.5"
      style={{
        background: selected ? BRAND_SOFT : undefined,
        borderBottom: '1px solid var(--wb-line)',
      }}
    >
      {/* 首行：批量模式下的复选框 + 状态 chip + 操作 */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {selectMode && (
            <input
              type="checkbox"
              checked={selected}
              onChange={onToggleSelect}
              className="h-4 w-4 cursor-pointer rounded"
              style={{ accentColor: 'var(--wb-brand-500)' }}
            />
          )}
          <button
            onClick={() => onFilterStatus(r.status)}
            className={`wb-chip st-${r.status}`}
            title={`筛选「${meta.label}」状态`}
          >
            <span className="dot" />
            {meta.label}
          </button>
        </div>
        <div className="flex gap-1">
          <button
            onClick={onEdit}
            className="wb-icon-sm"
            title="编辑"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
            </svg>
          </button>
          {onClone && (
            <button
              onClick={onClone}
              className="wb-icon-sm"
              title="克隆"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
              </svg>
            </button>
          )}
          <button
            onClick={onDelete}
            className="wb-icon-sm danger"
            title="删除"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6h14Z" />
            </svg>
          </button>
        </div>
      </div>

      {/* 需求名 + 备注 */}
      <div
        className="cursor-pointer font-medium leading-snug transition"
        style={{ color: 'var(--wb-ink)' }}
        onClick={onOpen}
        title="点击查看详情"
      >
        {highlight(r.name, keyword)}
      </div>
      {r.remark && (
        <div
          className="line-clamp-2 text-xs leading-relaxed"
          style={{ color: 'var(--wb-ink-3)' }}
        >
          {highlight(r.remark, keyword)}
        </div>
      )}
      <TestDueBadge r={r} />

      {/* 项目 / 分支 / 模块 */}
      <div className="flex flex-wrap items-center gap-1.5 text-xs">
        {requirementProjectDisplay(r) && (
          <span
            className="min-w-0 max-w-full truncate"
            style={{ color: 'var(--wb-ink-2)' }}
          >
            {highlight(requirementProjectDisplay(r), keyword)}
          </span>
        )}
        {r.branch && (
          <code
            onClick={() => onCopyBranch(r.branch)}
            className="wb-code"
            style={copiedBranch === r.branch ? { background: 'var(--wb-success-soft)', color: 'var(--wb-success)', fontWeight: 600 } : undefined}
            title="点击复制分支名"
          >
            {copiedBranch === r.branch ? '✓ 已复制' : highlight(r.branch, keyword)}
          </code>
        )}
        {requirementModuleDisplay(r) && (
          <code
            onClick={() => onCopyModule(requirementModuleDisplay(r))}
            className="wb-code module"
            style={copiedModule === requirementModuleDisplay(r) ? { background: 'var(--wb-success-soft)', color: 'var(--wb-success)', fontWeight: 600 } : undefined}
            title="点击复制发布模块"
          >
            {copiedModule === requirementModuleDisplay(r) ? '✓ 已复制' : highlight(requirementModuleDisplay(r), keyword)}
          </code>
        )}
      </div>

      {/* 时间 */}
      <TimeCell r={r} wrap />
    </div>
  )
}
