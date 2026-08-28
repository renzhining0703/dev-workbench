import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { Project, Requirement, TodoItem } from '../types'
import { statusMeta } from '../types'

export type PaletteTab = 'today' | 'todo' | 'list' | 'stats'

interface PaletteItem {
  id: string
  group: string
  title: string
  sub?: string
  meta?: string
  keywords?: string
  icon: 'action' | 'req' | 'todo' | 'proj'
  run: () => void
}

interface CommandPaletteProps {
  open: boolean
  onClose: () => void
  requirements: Requirement[]
  todos: TodoItem[]
  projects: Project[]
  onNavigate: (tab: PaletteTab) => void
  onNewRequirement: () => void
  onOpenRequirement: (reqId: string) => void
  onJumpTodo: (date: string) => void
  onToggleView: () => void
  onOpenShortcuts: () => void
}

const ICONS: Record<PaletteItem['icon'], ReactNode> = {
  action: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 4l6 6-10 10H4v-6L14 4z" />
    </svg>
  ),
  req: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6" />
    </svg>
  ),
  todo: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 11l3 3L22 4" />
      <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
    </svg>
  ),
  proj: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    </svg>
  ),
}

/** 匹配关键词高亮 */
function highlight(text: string, query: string): ReactNode {
  const q = query.trim().toLowerCase()
  if (!q) return text
  const idx = text.toLowerCase().indexOf(q)
  if (idx < 0) return text
  return (
    <>
      {text.slice(0, idx)}
      <mark className="wb-mark">{text.slice(idx, idx + q.length)}</mark>
      {text.slice(idx + q.length)}
    </>
  )
}

const NAV_LABELS: Record<PaletteTab, string> = {
  today: '今日概览',
  todo: '待办',
  list: '需求列表',
  stats: '统计',
}

export function CommandPalette({
  open,
  onClose,
  requirements,
  todos,
  projects,
  onNavigate,
  onNewRequirement,
  onOpenRequirement,
  onJumpTodo,
  onToggleView,
  onOpenShortcuts,
}: CommandPaletteProps) {
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  // 打开时聚焦 + 重置搜索；锁定背景滚动
  useEffect(() => {
    if (!open) return
    setQuery('')
    setActive(0)
    const t = window.setTimeout(() => inputRef.current?.focus(), 10)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.clearTimeout(t)
      document.body.style.overflow = prevOverflow
    }
  }, [open])

  const q = query.trim().toLowerCase()

  const items = useMemo<PaletteItem[]>(() => {
    const actions: PaletteItem[] = [
      {
        id: 'act-new-req',
        group: '操作',
        title: '新建需求',
        sub: '打开需求表单',
        keywords: 'new n 新建 需求 添加',
        icon: 'action',
        run: onNewRequirement,
      },
      ...(
        ['today', 'todo', 'list', 'stats'] as PaletteTab[]
      ).map((tab) => ({
        id: `act-nav-${tab}`,
        group: '操作',
        title: `前往${NAV_LABELS[tab]}`,
        keywords: `go 前往 ${NAV_LABELS[tab]}`,
        icon: 'action' as const,
        run: () => onNavigate(tab),
      })),
      {
        id: 'act-toggle-view',
        group: '操作',
        title: '切换视图',
        sub: '表格 / 看板',
        keywords: 'view 视图 表格 看板 切换',
        icon: 'action',
        run: onToggleView,
      },
      {
        id: 'act-shortcuts',
        group: '操作',
        title: '键盘快捷键',
        keywords: '快捷键 shortcuts 帮助 help ?',
        icon: 'action',
        run: onOpenShortcuts,
      },
    ]

    const reqItems: PaletteItem[] = requirements
      .filter(
        (r) =>
          !q ||
          [r.name, r.project, r.branch, ...r.projects.map((p) => p.project)].some(
            (s) => s && s.toLowerCase().includes(q),
          ),
      )
      .slice(0, 6)
      .map((r) => ({
        id: `req-${r.id}`,
        group: '需求',
        title: r.name,
        sub: [r.project, r.branch].filter(Boolean).join(' · ') || undefined,
        meta: statusMeta(r.status).label,
        icon: 'req' as const,
        run: () => onOpenRequirement(r.id),
      }))

    const todoItems: PaletteItem[] = todos
      .filter((t) => !q || t.content.toLowerCase().includes(q))
      .slice(0, 6)
      .map((t) => ({
        id: `todo-${t.id}`,
        group: '待办',
        title: t.content,
        sub: `${t.date.replace(/-/g, '/')}`,
        meta: t.done ? '已完成' : '未完成',
        icon: 'todo' as const,
        run: () => onJumpTodo(t.date),
      }))

    const projItems: PaletteItem[] = projects
      .filter((p) => !q || p.name.toLowerCase().includes(q))
      .slice(0, 4)
      .map((p) => ({
        id: `proj-${p.id}`,
        group: '项目',
        title: p.name,
        sub: p.moduleBased ? '支持分模块发布' : undefined,
        icon: 'proj' as const,
        run: () => onNavigate('list'),
      }))

    const all = [...actions, ...reqItems, ...todoItems, ...projItems]
    // 有搜索词时：只保留标题/关键词命中的项
    return q ? all.filter((it) => it.title.toLowerCase().includes(q) || (it.keywords ?? '').toLowerCase().includes(q) || (it.sub ?? '').toLowerCase().includes(q)) : all
  }, [q, requirements, todos, projects, onNavigate, onNewRequirement, onOpenRequirement, onJumpTodo, onToggleView, onOpenShortcuts])

  // 搜索词变化时重置高亮
  useEffect(() => {
    setActive(0)
  }, [q])

  if (!open) return null

  const runAt = (i: number) => {
    const item = items[i]
    if (!item) return
    onClose()
    item.run()
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((i) => (items.length ? (i + 1) % items.length : 0))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((i) => (items.length ? (i - 1 + items.length) % items.length : 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      runAt(active)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
    }
  }

  return (
    <div
      className="wb-cmd-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="wb-cmd" role="dialog" aria-label="全局搜索">
        <input
          ref={inputRef}
          className="wb-cmd-input"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="搜索需求、待办、项目，或输入命令…"
          aria-label="搜索"
        />
        <div className="wb-cmd-list">
          {items.length === 0 ? (
            <div className="wb-cmd-empty">没有匹配「{query}」的结果</div>
          ) : (
            items.map((item, i) => (
              <Fragment key={item.id}>
                {i === 0 || items[i - 1].group !== item.group ? (
                  <div className="wb-cmd-group">{item.group}</div>
                ) : null}
                <button
                  type="button"
                  className={`wb-cmd-item ${i === active ? 'sel' : ''}`}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => runAt(i)}
                >
                  <span className="ic">{ICONS[item.icon]}</span>
                  <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {highlight(item.title, query)}
                  </span>
                  {item.sub && <span className="sub">{item.sub}</span>}
                  {item.meta && <span className="meta">{item.meta}</span>}
                </button>
              </Fragment>
            ))
          )}
        </div>
        <div className="wb-cmd-foot">
          <span>
            <kbd className="wb-cmd-kbd">↑</kbd>
            <kbd className="wb-cmd-kbd">↓</kbd> 选择
          </span>
          <span>
            <kbd className="wb-cmd-kbd">Enter</kbd> 执行
          </span>
          <span>
            <kbd className="wb-cmd-kbd">Esc</kbd> 关闭
          </span>
          <span className="ml-auto">命令面板</span>
        </div>
      </div>
    </div>
  )
}
