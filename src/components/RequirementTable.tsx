import { useEffect, useMemo, useRef, useState } from 'react'
import type { Requirement, RequirementStatus } from '../types'
import { STATUS_FLOW, STATUS_META } from '../types'
import { copyToClipboard, fmtDateShort, isDateToday } from '../lib/utils'
import { highlight } from '../lib/highlight'
import { extractProjectNames } from '../lib/projects'
import { useStore } from '../store/StoreContext'
import { ConfirmDialog, EmptyState, SkeletonRows } from './ui'
import { Select, statusSelectOptions } from './Select'
import { RequirementDrawer } from './RequirementDrawer'

type StatusFilter = 'all' | RequirementStatus

/** 排序方向 */
type SortDir = 'asc' | 'desc'

/** 可排序字段 */
type SortField = 'createdAt' | 'publishTime' | 'status' | 'name'

interface Props {
  requirements: Requirement[]
  onEdit: (r: Requirement) => void
  onDelete: (id: string) => void
  onStatusChange: (id: string, status: RequirementStatus) => void
  /** 搜索框 ref，供全局快捷键 / 聚焦 */
  searchInputRef?: React.Ref<HTMLInputElement>
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
 * 时间单元格：所有时间点合并为一列、一行内联展示（不换行）。
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
    return <span className="text-slate-300 dark:text-slate-600">—</span>
  }

  return (
    <div className={`flex items-center gap-1.5 text-xs ${wrap ? 'flex-wrap' : 'whitespace-nowrap'}`}>
      {items.map((it, i) => (
        <span
          key={it.key}
          className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 ${
            it.today
              ? 'bg-rose-100 font-semibold text-rose-600 dark:bg-rose-500/15 dark:text-rose-400'
              : 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400'
          }`}
        >
          {i > 0 && wrap && <span className="opacity-40">·</span>}
          <span className="opacity-75">{it.label}</span>
          <span className={it.today ? '' : 'tabular-nums'}>{it.date}</span>
        </span>
      ))}
    </div>
  )
}

export function RequirementTable({
  requirements,
  onEdit,
  onDelete,
  onStatusChange,
  searchInputRef,
}: Props) {
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [projectFilter, setProjectFilter] = useState('all')
  const [keyword, setKeyword] = useState('')
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [copiedBranch, setCopiedBranch] = useState<string | null>(null)
  const [copiedModule, setCopiedModule] = useState<string | null>(null)
  const [sortField, setSortField] = useState<SortField>('createdAt')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const [drawerId, setDrawerId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const copyTimer = useRef<number | null>(null)
  const revertRef = useRef<(() => void) | null>(null)

  // 首屏骨架屏：短暂显示骨架行，提升加载感知
  useEffect(() => {
    const t = window.setTimeout(() => setLoading(false), 120)
    return () => window.clearTimeout(t)
  }, [])

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
      if (statusFilter !== 'all' && r.status !== statusFilter) return false
      // 历史数据可能是多项目（逗号/分号分隔），按拆分匹配
      if (projectFilter !== 'all' && !extractProjectNames(r.project).includes(projectFilter)) {
        return false
      }
      if (kw) {
        const haystack = [r.name, r.branch, r.project, r.publishModule, r.remark]
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

  const counts = useMemo(() => {
    const map: Record<string, number> = { all: requirements.length }
    for (const s of STATUS_FLOW) map[s] = 0
    for (const r of requirements) map[r.status] = (map[r.status] ?? 0) + 1
    return map
  }, [requirements])

  const deleting = requirements.find((r) => r.id === deleteId)
  const drawerReq = requirements.find((r) => r.id === drawerId)

  return (
    <div className="space-y-4">
      {/* 筛选工具栏 */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          {/* 状态筛选：移动端横向滚动，桌面端自然换行 */}
          <div className="flex overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] sm:overflow-visible">
            <div className="flex flex-nowrap rounded-lg border border-slate-200 bg-white p-1 dark:border-slate-700 dark:bg-slate-800 sm:flex-wrap">
              {(['all', ...STATUS_FLOW] as StatusFilter[]).map((s) => (
                <button
                  key={s}
                  onClick={() => setStatusFilter(s)}
                  className={`shrink-0 rounded-md px-2.5 py-1 text-xs font-medium transition ${
                    statusFilter === s
                      ? 'bg-indigo-600 text-white shadow-sm'
                      : 'text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200'
                  }`}
                >
                  {s === 'all' ? '全部' : STATUS_META[s].label}
                  <span className="ml-1 opacity-70">{counts[s]}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Select
              className="w-40"
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
              className="w-36 md:hidden"
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
          </div>
        </div>

        <div className="relative">
          <svg
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
            width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"
          >
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" />
          </svg>
          <input
            ref={searchInputRef}
            className="input w-full pl-9 pr-9 lg:w-64"
            placeholder="搜索名称 / 分支 / 模块 / 备注…"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
          />
          {keyword === '' && (
            <kbd className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 hidden rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[10px] font-medium text-slate-400 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-500 sm:block">
              /
            </kbd>
          )}
        </div>
      </div>

      {/* 列表区：桌面表格 / 移动端卡片 */}
      <div className="card overflow-hidden">
        {loading ? (
          <>
            {/* 桌面骨架行 */}
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full min-w-[1100px] text-sm">
                <SkeletonRows rows={5} cols={6} />
              </table>
            </div>
            {/* 移动端骨架卡片 */}
            <div className="space-y-3 p-4 md:hidden">
              {Array.from({ length: 4 }).map((_, i) => (
                <div
                  key={i}
                  className="animate-pulse space-y-2.5 rounded-xl border border-slate-100 p-4 dark:border-slate-800/60"
                >
                  <div className="h-3.5 w-2/3 rounded bg-slate-100 dark:bg-slate-800" />
                  <div className="h-3 w-1/2 rounded bg-slate-100 dark:bg-slate-800" />
                  <div className="h-3 w-5/6 rounded bg-slate-100 dark:bg-slate-800" />
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
                <button className="btn-ghost text-sm" onClick={clearFilters}>
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
              <table className="w-full min-w-[1100px] text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs font-medium text-slate-500 dark:border-slate-800 dark:bg-slate-800/60 dark:text-slate-400">
                    <th
                      className="cursor-pointer select-none px-4 py-3 hover:text-slate-700 dark:hover:text-slate-200"
                      onClick={() => toggleSort('name')}
                    >
                      <span className="inline-flex items-center gap-1">
                        需求名称
                        <SortIcon active={sortField === 'name'} dir={sortDir} />
                      </span>
                    </th>
                    <th className="min-w-[240px] px-4 py-3">项目 / 分支</th>
                    <th className="px-4 py-3">发布模块</th>
                    <th
                      className="cursor-pointer select-none px-4 py-3 hover:text-slate-700 dark:hover:text-slate-200"
                      onClick={() => toggleSort('status')}
                    >
                      <span className="inline-flex items-center gap-1">
                        状态
                        <SortIcon active={sortField === 'status'} dir={sortDir} />
                      </span>
                    </th>
                    <th className="min-w-[340px] px-4 py-3">时间</th>
                    <th className="sticky right-0 z-10 bg-slate-50 px-4 py-3 text-right dark:bg-slate-800/60">
                      操作
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((r) => {
                  return (
                    <tr
                      key={r.id}
                      className="border-b border-slate-100 transition last:border-0 hover:bg-slate-50/70 dark:border-slate-800/60 dark:hover:bg-slate-800/40"
                    >
                      <td className="px-4 py-3">
                        <div
                          className="cursor-pointer font-medium text-slate-800 transition hover:text-indigo-600 dark:text-slate-100 dark:hover:text-indigo-400"
                          onClick={() => setDrawerId(r.id)}
                          title="点击查看详情"
                        >
                          {highlight(r.name, keyword)}
                        </div>
                        {r.remark && (
                          <div className="mt-0.5 max-w-[260px] truncate text-xs text-slate-400">
                            {highlight(r.remark, keyword)}
                          </div>
                        )}
                      </td>
                      <td className="min-w-[240px] px-4 py-3">
                        <div
                          className="max-w-[240px] truncate text-slate-700 dark:text-slate-300"
                          title={r.project || undefined}
                        >
                          {highlight(r.project || '—', keyword)}
                        </div>
                        <code
                          onClick={() => copyWithFeedback(r.branch, setCopiedBranch)}
                          className={`mt-0.5 inline-block max-w-[240px] cursor-pointer truncate rounded px-1.5 py-0.5 text-xs transition ${
                            copiedBranch === r.branch
                              ? 'bg-emerald-100 font-medium text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-400'
                              : 'bg-slate-100 text-slate-500 hover:bg-slate-200 hover:text-slate-700 dark:bg-slate-800 dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-slate-200'
                          }`}
                          title={r.branch ? '点击复制分支名' : undefined}
                        >
                          {copiedBranch === r.branch ? '✓ 已复制' : (r.branch ? highlight(r.branch, keyword) : '—')}
                        </code>
                      </td>
                      <td className="px-4 py-3">
                        {r.publishModule ? (
                          <code
                            onClick={() => copyWithFeedback(r.publishModule, setCopiedModule)}
                            className={`inline-block max-w-[200px] cursor-pointer truncate rounded px-1.5 py-0.5 text-xs font-medium transition ${
                              copiedModule === r.publishModule
                                ? 'bg-emerald-100 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-400'
                                : 'bg-indigo-50 text-indigo-600 hover:bg-indigo-100 dark:bg-indigo-500/15 dark:text-indigo-400 dark:hover:bg-indigo-500/25'
                            }`}
                            title={r.publishModule ? '点击复制发布模块' : undefined}
                          >
                            {copiedModule === r.publishModule ? '✓ 已复制' : highlight(r.publishModule, keyword)}
                          </code>
                        ) : (
                          <span className="text-slate-300 dark:text-slate-600">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => setStatusFilter(r.status)}
                            className="group/dot shrink-0 rounded-full p-1 transition hover:bg-slate-100 dark:hover:bg-slate-800"
                            title={`筛选「${STATUS_META[r.status].label}」状态`}
                          >
                            <span className={`block h-2.5 w-2.5 rounded-full transition group-hover/dot:scale-125 ${STATUS_META[r.status].dot}`} />
                          </button>
                          <Select
                            size="sm"
                            value={r.status}
                            onChange={(s) => onStatusChange(r.id, s)}
                            options={statusSelectOptions}
                          />
                        </div>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3">
                        <TimeCell r={r} />
                      </td>
                      <td className="sticky right-0 z-10 bg-white px-4 py-3 shadow-[-4px_0_8px_-4px_rgba(0,0,0,0.08)] dark:bg-[#0f1521] dark:shadow-[-4px_0_8px_-4px_rgba(0,0,0,0.3)]">
                        <div className="flex justify-end gap-1">
                          <button
                            onClick={() => setDrawerId(r.id)}
                            className="rounded-md p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-indigo-600 dark:hover:bg-slate-800 dark:hover:text-indigo-400"
                            title="查看详情"
                          >
                            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
                              <circle cx="12" cy="12" r="3" />
                            </svg>
                          </button>
                          <button
                            onClick={() => setDeleteId(r.id)}
                            className="rounded-md p-1.5 text-slate-400 transition hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-500/10 dark:hover:text-rose-400"
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
            <div className="divide-y divide-slate-100 md:hidden dark:divide-slate-800/60">
              {filtered.map((r) => (
                <RequirementCard
                  key={r.id}
                  r={r}
                  keyword={keyword}
                  copiedBranch={copiedBranch}
                  copiedModule={copiedModule}
                  onCopyBranch={(b) => copyWithFeedback(b, setCopiedBranch)}
                  onCopyModule={(m) => copyWithFeedback(m, setCopiedModule)}
                  onOpen={() => setDrawerId(r.id)}
                  onEdit={() => onEdit(r)}
                  onDelete={() => setDeleteId(r.id)}
                  onFilterStatus={(s) => setStatusFilter(s)}
                />
              ))}
            </div>
          </>
        )}
      </div>

      <p className="text-xs text-slate-400 dark:text-slate-500">
        共 {filtered.length} 条需求
      </p>

      <ConfirmDialog
        open={!!deleteId}
        title="删除需求"
        message={`确定删除「${deleting?.name ?? ''}」吗？该操作不可恢复。`}
        onCancel={() => setDeleteId(null)}
        onConfirm={() => {
          if (deleteId) onDelete(deleteId)
          setDeleteId(null)
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
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="opacity-30">
        <path d="m7 15 5 5 5-5M7 9l5-5 5 5" />
      </svg>
    )
  }
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-indigo-500">
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
  onCopyBranch,
  onCopyModule,
  onOpen,
  onEdit,
  onDelete,
  onFilterStatus,
}: {
  r: Requirement
  keyword: string
  copiedBranch: string | null
  copiedModule: string | null
  onCopyBranch: (b: string) => void
  onCopyModule: (m: string) => void
  onOpen: () => void
  onEdit: () => void
  onDelete: () => void
  onFilterStatus: (s: RequirementStatus) => void
}) {
  const meta = STATUS_META[r.status]
  return (
    <div className="space-y-2 px-4 py-3.5">
      {/* 首行：状态 chip + 操作 */}
      <div className="flex items-center justify-between gap-2">
        <button
          onClick={() => onFilterStatus(r.status)}
          className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ${meta.color} bg-slate-100 dark:bg-slate-800`}
          title={`筛选「${meta.label}」状态`}
        >
          <span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} />
          {meta.label}
        </button>
        <div className="flex gap-1">
          <button
            onClick={onEdit}
            className="rounded-md p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-indigo-600 dark:hover:bg-slate-800 dark:hover:text-indigo-400"
            title="编辑"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
            </svg>
          </button>
          <button
            onClick={onDelete}
            className="rounded-md p-1.5 text-slate-400 transition hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-500/10 dark:hover:text-rose-400"
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
        className="cursor-pointer font-medium leading-snug text-slate-800 transition active:text-indigo-600 dark:text-slate-100 dark:active:text-indigo-400"
        onClick={onOpen}
        title="点击查看详情"
      >
        {highlight(r.name, keyword)}
      </div>
      {r.remark && (
        <div className="line-clamp-2 text-xs leading-relaxed text-slate-400">
          {highlight(r.remark, keyword)}
        </div>
      )}

      {/* 项目 / 分支 / 模块 */}
      <div className="flex flex-wrap items-center gap-1.5 text-xs">
        {r.project && (
          <span className="min-w-0 max-w-full truncate text-slate-500 dark:text-slate-400">
            {highlight(r.project, keyword)}
          </span>
        )}
        {r.branch && (
          <code
            onClick={() => onCopyBranch(r.branch)}
            className={`min-w-0 max-w-full shrink-0 cursor-pointer truncate rounded px-1.5 py-0.5 transition ${
              copiedBranch === r.branch
                ? 'bg-emerald-100 font-medium text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-400'
                : 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400'
            }`}
            title="点击复制分支名"
          >
            {copiedBranch === r.branch ? '✓ 已复制' : highlight(r.branch, keyword)}
          </code>
        )}
        {r.publishModule && (
          <code
            onClick={() => onCopyModule(r.publishModule)}
            className={`min-w-0 max-w-full shrink-0 cursor-pointer truncate rounded px-1.5 py-0.5 font-medium transition ${
              copiedModule === r.publishModule
                ? 'bg-emerald-100 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-400'
                : 'bg-indigo-50 text-indigo-600 dark:bg-indigo-500/15 dark:text-indigo-400'
            }`}
            title="点击复制发布模块"
          >
            {copiedModule === r.publishModule ? '✓ 已复制' : highlight(r.publishModule, keyword)}
          </code>
        )}
      </div>

      {/* 时间 */}
      <TimeCell r={r} wrap />
    </div>
  )
}
