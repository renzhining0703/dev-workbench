import { useMemo, useState } from 'react'
import type { DragEvent } from 'react'
import type { Requirement, RequirementStatus } from '../types'
import { STATUS_META } from '../types'
import { fmtDateShort } from '../lib/utils'

/**
 * 看板包含的 4 列：只展示工作流高频状态
 * paused / published / archived 不进看板（用表格 Tab 专门查看）
 */
const KANBAN_COLUMNS: RequirementStatus[] = ['pending', 'developing', 'testing', 'ready']

interface Props {
  requirements: Requirement[]
  onEdit: (r: Requirement) => void
  onStatusChange: (id: string, status: RequirementStatus) => void
  /** 搜索框 ref，供全局快捷键 `/` 聚焦 */
  searchInputRef?: React.Ref<HTMLInputElement>
}

/** 卡片底部显示的最近一个时间点：上线 > 提测 > 结束 > 开发 > 创建 */
function recentTimeText(r: Requirement): string {
  const order: (keyof Requirement)[] = [
    'publishTime',
    'testTime',
    'devEndTime',
    'devStartTime',
    'createdAt',
  ]
  for (const k of order) {
    const v = r[k] as string | null
    if (v) return fmtDateShort(v)
  }
  return '—'
}

export function RequirementKanban({
  requirements,
  onEdit,
  onStatusChange,
  searchInputRef,
}: Props) {
  const [keyword, setKeyword] = useState('')
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [dragOverCol, setDragOverCol] = useState<RequirementStatus | null>(null)

  // 只看看板内的 4 种状态的需求
  const inKanban = useMemo(
    () => requirements.filter((r) => KANBAN_COLUMNS.includes(r.status)),
    [requirements],
  )

  // 按状态分组 + 关键词过滤 + 按更新时间倒序
  const columns = useMemo(() => {
    const kw = keyword.trim().toLowerCase()
    const map = new Map<RequirementStatus, Requirement[]>()
    for (const col of KANBAN_COLUMNS) map.set(col, [])
    for (const r of inKanban) {
      if (kw) {
        const haystack = [r.name, r.branch, r.project, r.publishModule, r.remark]
          .join(' ')
          .toLowerCase()
        if (!haystack.includes(kw)) continue
      }
      map.get(r.status)!.push(r)
    }
    for (const col of KANBAN_COLUMNS) {
      map
        .get(col)!
        .sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''))
    }
    return map
  }, [inKanban, keyword])

  // ====== HTML5 拖拽事件 ======
  const onCardDragStart = (e: DragEvent<HTMLDivElement>, id: string) => {
    setDraggingId(id)
    e.dataTransfer.effectAllowed = 'move'
    // text/plain 是必填项（FF 要求非空），用 id 作为载荷
    e.dataTransfer.setData('text/plain', id)
  }
  const onCardDragEnd = () => {
    setDraggingId(null)
    setDragOverCol(null)
  }
  const onColumnDragOver = (e: DragEvent<HTMLDivElement>, col: RequirementStatus) => {
    // 必须 preventDefault 才能触发 drop
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    if (dragOverCol !== col) setDragOverCol(col)
  }
  const onColumnDragLeave = (e: DragEvent<HTMLDivElement>, col: RequirementStatus) => {
    // 子元素冒泡也会触发 dragleave，用 relatedTarget 判断是否真的离开列容器
    if (dragOverCol !== col) return
    const related = e.relatedTarget as Node | null
    const current = e.currentTarget
    if (related && current.contains(related)) return
    setDragOverCol(null)
  }
  const onColumnDrop = (e: DragEvent<HTMLDivElement>, col: RequirementStatus) => {
    e.preventDefault()
    const id = e.dataTransfer.getData('text/plain')
    setDragOverCol(null)
    setDraggingId(null)
    if (!id) return
    onStatusChange(id, col)
  }

  // 整体空（没有任何看板内的需求）
  if (inKanban.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-200 bg-white p-12 text-center dark:border-slate-700 dark:bg-slate-900">
        <p className="text-sm text-slate-500 dark:text-slate-400">
          当前没有「待开发 / 开发中 / 测试中 / 待上线」状态的需求
        </p>
        <p className="mt-1 text-xs text-slate-400">
          其他状态（暂停 / 已上线 / 已归档）请切换到「表格」视图查看
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* 搜索 + 计数 */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative">
          <svg
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
            width="15"
            height="15"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          >
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" />
          </svg>
          <input
            ref={searchInputRef}
            className="input w-full pl-9 sm:w-72"
            placeholder="搜索看板内需求..."
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
          />
        </div>
        <span className="text-xs text-slate-400 dark:text-slate-500">
          看板共 {inKanban.length} 个任务
        </span>
      </div>

      {/* 4 列横排：移动端 1 列 → sm 2 列 → lg 4 列 */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {KANBAN_COLUMNS.map((col) => {
          const list = columns.get(col) ?? []
          const meta = STATUS_META[col]
          const isOver = dragOverCol === col
          return (
            <div
              key={col}
              onDragOver={(e) => onColumnDragOver(e, col)}
              onDragLeave={(e) => onColumnDragLeave(e, col)}
              onDrop={(e) => onColumnDrop(e, col)}
              className={`flex flex-col rounded-xl border transition ${
                isOver
                  ? 'border-indigo-400 bg-indigo-50/60 shadow-md dark:border-indigo-500 dark:bg-indigo-500/15'
                  : 'border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800/40'
              }`}
            >
              {/* 列头 */}
              <div className="flex items-center justify-between border-b border-slate-200 px-3 py-2.5 dark:border-slate-700">
                <div className="flex items-center gap-2">
                  <span className={`h-2 w-2 rounded-full ${meta.dot}`} />
                  <span className="text-sm font-medium text-slate-700 dark:text-slate-200">
                    {meta.label}
                  </span>
                </div>
                <span className="rounded-full bg-white px-2 py-0.5 text-xs font-medium tabular-nums text-slate-500 dark:bg-slate-900 dark:text-slate-400">
                  {list.length}
                </span>
              </div>

              {/* 卡片堆叠区 */}
              <div
                className="flex-1 space-y-2 overflow-y-auto p-2"
                style={{ minHeight: 200, maxHeight: 'calc(100vh - 320px)' }}
              >
                {list.length === 0 ? (
                  <div className="flex items-center justify-center rounded-lg border border-dashed border-slate-200 py-6 text-xs text-slate-400 dark:border-slate-700">
                    拖到此处
                  </div>
                ) : (
                  list.map((r) => (
                    <KanbanCard
                      key={r.id}
                      r={r}
                      dragging={draggingId === r.id}
                      onDragStart={(e) => onCardDragStart(e, r.id)}
                      onDragEnd={onCardDragEnd}
                      onClick={() => onEdit(r)}
                    />
                  ))
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function KanbanCard({
  r,
  dragging,
  onDragStart,
  onDragEnd,
  onClick,
}: {
  r: Requirement
  dragging: boolean
  onDragStart: (e: DragEvent<HTMLDivElement>) => void
  onDragEnd: () => void
  onClick: () => void
}) {
  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={onClick}
      className={`group cursor-pointer select-none rounded-lg border border-slate-200 bg-white p-3 shadow-sm transition hover:border-indigo-300 hover:shadow-md dark:border-slate-700 dark:bg-slate-900 dark:hover:border-indigo-500 ${
        dragging ? 'opacity-30' : ''
      }`}
      title="点击编辑 · 拖拽改状态"
    >
      <div className="line-clamp-2 text-sm font-medium leading-snug text-slate-800 dark:text-slate-100">
        {r.name}
      </div>
      {r.project && (
        <div
          className="mt-1.5 truncate text-[11px] text-slate-500 dark:text-slate-400"
          title={r.project}
        >
          {r.project}
        </div>
      )}
      {r.branch && (
        <code className="mt-1 inline-block max-w-full truncate rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500 dark:bg-slate-800 dark:text-slate-400">
          {r.branch}
        </code>
      )}
      <div className="mt-2 flex items-center justify-between gap-1.5 text-[10px] text-slate-400 dark:text-slate-500">
        <span>{recentTimeText(r)}</span>
        {r.status === 'ready' && r.publishTime && (
          <span className="rounded bg-purple-100 px-1.5 py-0.5 font-medium text-purple-600 dark:bg-purple-500/15 dark:text-purple-400">
            今日上线
          </span>
        )}
      </div>
    </div>
  )
}