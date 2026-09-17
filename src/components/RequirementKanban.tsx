import { useMemo, useState } from 'react'
import type { DragEvent } from 'react'
import type { Requirement, RequirementStatus } from '../types'
import { statusMeta } from '../types'
import { fmtDateShort } from '../lib/utils'
import { requirementModuleDisplay, requirementProjectDisplay } from '../lib/projects'
import { isVisible, type VisibleFields, type TimeFieldKey } from '../lib/fields'
import { isStatusVisible } from '../lib/statuses'
import { useStore } from '../store/StoreContext'
import { AddTodoIconButton } from './AddTodoModal'
import { canAddTodo } from '../lib/todos'

/**
 * 看板包含的 8 列：活跃工作流状态（4 开发 + 4 通用）
 * paused / published / archived 不进看板（用表格 Tab 专门查看）；
 * 再按显隐配置进一步过滤（见 visibleColumns）。
 */
const KANBAN_COLUMNS: RequirementStatus[] = [
  'pending',
  'developing',
  'testing',
  'ready',
  'notStarted',
  'inProgress',
  'toConfirm',
  'done',
]

interface Props {
  requirements: Requirement[]
  onEdit: (r: Requirement) => void
  onStatusChange: (id: string, status: RequirementStatus) => void
  /** 生成待办：仅「待开发 / 开发中」的需求展示入口；未传则整体隐藏 */
  onAddTodo?: (r: Requirement) => void
  /** requirementId → 已有关联待办条数（按钮角标） */
  todoCounts?: Map<string, number>
  /** 搜索框 ref，供全局快捷键 `/` 聚焦 */
  searchInputRef?: React.Ref<HTMLInputElement>
}

/** 卡片底部显示的最近一个时间点：上线 > 提测 > 结束 > 开发 > 创建（跳过不可见字段） */
function recentTimeText(r: Requirement, fields: VisibleFields): string {
  const order: TimeFieldKey[] = [
    'publishTime',
    'testTime',
    'devEndTime',
    'devStartTime',
    'createdAt',
  ]
  for (const k of order) {
    if (!isVisible(fields, k)) continue
    const v = r[k] as string | null
    if (v) return fmtDateShort(v)
  }
  return '—'
}

export function RequirementKanban({
  requirements,
  onEdit,
  onStatusChange,
  onAddTodo,
  todoCounts,
  searchInputRef,
}: Props) {
  const { visibleFields, visibleStatuses } = useStore()
  const [keyword, setKeyword] = useState('')
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [dragOverCol, setDragOverCol] = useState<RequirementStatus | null>(null)

  // 看板列 = 8 个活跃状态再按显隐配置过滤
  const visibleColumns = useMemo(
    () => KANBAN_COLUMNS.filter((s) => isStatusVisible(visibleStatuses, s)),
    [visibleStatuses],
  )

  // 只看看板内（可见列）状态的需求
  const inKanban = useMemo(
    () => requirements.filter((r) => visibleColumns.includes(r.status)),
    [requirements, visibleColumns],
  )

  // 按状态分组 + 关键词过滤 + 按更新时间倒序
  const columns = useMemo(() => {
    const kw = keyword.trim().toLowerCase()
    const map = new Map<RequirementStatus, Requirement[]>()
    for (const col of visibleColumns) map.set(col, [])
    for (const r of inKanban) {
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
        if (!haystack.includes(kw)) continue
      }
      map.get(r.status)!.push(r)
    }
    for (const col of visibleColumns) {
      map
        .get(col)!
        .sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''))
    }
    return map
  }, [inKanban, keyword, visibleColumns])

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
      <div className="rounded-2xl border border-dashed border-[var(--wb-line-2)] bg-[var(--wb-surface)] p-12 text-center">
        <p className="text-sm" style={{ color: 'var(--wb-ink-2)' }}>
          当前没有看板状态的需求
        </p>
        <p className="mt-1 text-xs" style={{ color: 'var(--wb-ink-3)' }}>
          其他状态（暂停 / 已上线 / 已归档）及在偏好里隐藏的状态请切换到「表格」视图查看
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
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2"
            style={{ color: 'var(--wb-ink-3)' }}
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
            className="wb-input w-full pl-9 sm:w-72"
            placeholder="搜索看板内需求..."
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
          />
        </div>
        <span className="text-xs" style={{ color: 'var(--wb-ink-3)' }}>
          看板共 {inKanban.length} 个任务
        </span>
      </div>

      {/* 4 列横排：移动端 1 列 → sm 2 列 → lg 4 列 */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {visibleColumns.map((col) => {
          const list = columns.get(col) ?? []
          const meta = statusMeta(col)
          const isOver = dragOverCol === col
          return (
            <div
              key={col}
              onDragOver={(e) => onColumnDragOver(e, col)}
              onDragLeave={(e) => onColumnDragLeave(e, col)}
              onDrop={(e) => onColumnDrop(e, col)}
              className="flex flex-col rounded-xl border transition"
              style={
                isOver
                  ? { borderColor: 'var(--wb-brand-400)', background: 'rgba(42,112,86,.08)', boxShadow: 'var(--wb-shadow)' }
                  : { borderColor: 'var(--wb-line)', background: 'var(--wb-surface-2)' }
              }
            >
              {/* 列头 */}
              <div
                className="flex items-center justify-between border-b px-3 py-2.5"
                style={{ borderColor: 'var(--wb-line)' }}
              >
                <div className="flex items-center gap-2">
                  <span className={`h-2 w-2 rounded-full ${meta.dot}`} />
                  <span className="text-sm font-medium" style={{ color: 'var(--wb-ink)' }}>
                    {meta.label}
                  </span>
                </div>
                <span
                  className="rounded-full px-2 py-0.5 text-xs font-medium tabular-nums"
                  style={{ background: 'var(--wb-surface)', color: 'var(--wb-ink-2)' }}
                >
                  {list.length}
                </span>
              </div>

              {/* 卡片堆叠区 */}
              <div
                className="flex-1 space-y-2 overflow-y-auto p-2"
                style={{ minHeight: 200, maxHeight: 'calc(100vh - 320px)' }}
              >
                {list.length === 0 ? (
                  <div
                    className="flex items-center justify-center rounded-lg border border-dashed py-6 text-xs"
                    style={{ borderColor: 'var(--wb-line-2)', color: 'var(--wb-ink-3)' }}
                  >
                    拖到此处
                  </div>
                ) : (
                  list.map((r) => (
                    <KanbanCard
                      key={r.id}
                      r={r}
                      fields={visibleFields}
                      dragging={draggingId === r.id}
                      onDragStart={(e) => onCardDragStart(e, r.id)}
                      onDragEnd={onCardDragEnd}
                      onClick={() => onEdit(r)}
                      onAddTodo={onAddTodo && canAddTodo(r) ? () => onAddTodo(r) : undefined}
                      todoCount={todoCounts?.get(r.id) ?? 0}
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
  fields,
  dragging,
  onDragStart,
  onDragEnd,
  onClick,
  onAddTodo,
  todoCount,
}: {
  r: Requirement
  fields: VisibleFields
  dragging: boolean
  onDragStart: (e: DragEvent<HTMLDivElement>) => void
  onDragEnd: () => void
  onClick: () => void
  /** 生成待办；undefined = 该需求状态不支持或整体未启用 */
  onAddTodo?: () => void
  todoCount: number
}) {
  const showProject = isVisible(fields, 'project')
  const showBranch = isVisible(fields, 'branch')
  const showTime =
    isVisible(fields, 'createdAt') ||
    isVisible(fields, 'devStartTime') ||
    isVisible(fields, 'devEndTime') ||
    isVisible(fields, 'testTime') ||
    isVisible(fields, 'publishTime')
  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={onClick}
      className={`wb-card group cursor-pointer select-none rounded-lg p-3 transition hover:border-[var(--wb-brand-400)] hover:shadow-md ${
        dragging ? 'opacity-30' : ''
      }`}
      title="点击编辑 · 拖拽改状态"
    >
      <div className="line-clamp-2 text-sm font-medium leading-snug" style={{ color: 'var(--wb-ink)' }}>
        {r.name}
      </div>
      {showProject && requirementProjectDisplay(r) && (
        <div
          className="mt-1.5 truncate text-[11px]"
          style={{ color: 'var(--wb-ink-2)' }}
          title={requirementProjectDisplay(r)}
        >
          {requirementProjectDisplay(r)}
        </div>
      )}
      {showBranch && r.branch && (
        <code
          className="mt-1 inline-block max-w-full truncate rounded px-1.5 py-0.5 text-[10px]"
          style={{ background: 'var(--wb-surface-2)', color: 'var(--wb-ink-2)' }}
        >
          {r.branch}
        </code>
      )}
      <div className="mt-2 flex items-center justify-between gap-1.5 text-[10px]" style={{ color: 'var(--wb-ink-3)' }}>
        {showTime ? <span>{recentTimeText(r, fields)}</span> : <span />}
        <div className="flex items-center gap-1.5">
          {r.status === 'ready' && isVisible(fields, 'publishTime') && r.publishTime && (
            <span
              className="rounded px-1.5 py-0.5 font-medium"
              style={{ background: 'var(--wb-success-soft)', color: 'var(--wb-success)' }}
            >
              今日上线
            </span>
          )}
          {onAddTodo && (
            <AddTodoIconButton
              count={todoCount}
              onClick={(e) => {
                // 卡片整体 onClick 是「打开编辑」，这里不能冒泡上去
                e.stopPropagation()
                onAddTodo()
              }}
            />
          )}
        </div>
      </div>
    </div>
  )
}