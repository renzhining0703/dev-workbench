import { useCallback, useEffect, useRef, useState } from 'react'
import { format } from 'date-fns'
import { zhCN } from 'date-fns/locale'
import type { Requirement, RequirementStatus } from './types'
import { useStore } from './store/StoreContext'
import { RequirementFormModal, type RequirementDraft } from './components/RequirementForm'
import { RequirementTable } from './components/RequirementTable'
import { ProjectManagerModal } from './components/ProjectManagerModal'
import { PublishReminder, TodoPanel } from './components/TodoPanel'
import { ExportModal } from './components/ExportModal'
import { ImportModal } from './components/ImportModal'
import { BackupModal } from './components/BackupModal'
import { InstallPrompt } from './components/InstallPrompt'
import { StatsView } from './components/StatsView'
import { PreferencesModal } from './components/PreferencesModal'
import { ShortcutsModal } from './components/ShortcutsModal'
import { findAutoArchiveTargets, getArchiveMonths } from './lib/archive'
import { parseImportData } from './lib/migrate'
import { hasProjectInitFlag, markProjectInit } from './lib/storage'
import { seedProjects } from './data/seedProjects'

type Tab = 'today' | 'list' | 'stats'

/** 首次启动自动导入历史数据的一次性标记（避免清空数据后又自动填回） */
const IMPORT_FLAG_KEY = 'dev-workbench:legacy-imported'

/** 主题切换（跟随系统，可手动覆盖） */
function useTheme() {
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    const saved = localStorage.getItem('dev-workbench:theme')
    if (saved === 'light' || saved === 'dark') return saved
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  })
  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark')
    localStorage.setItem('dev-workbench:theme', theme)
  }, [theme])
  return { theme, toggle: () => setTheme((t) => (t === 'dark' ? 'light' : 'dark')) }
}

export default function App() {
  const store = useStore()
  const { theme, toggle } = useTheme()
  const [tab, setTab] = useState<Tab>('today')
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<Requirement | null>(null)
  const [exportOpen, setExportOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [backupOpen, setBackupOpen] = useState(false)
  const [projectOpen, setProjectOpen] = useState(false)
  const [preferencesOpen, setPreferencesOpen] = useState(false)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const [archiveToast, setArchiveToast] = useState<{ count: number; months: number } | null>(null)
  const [undoToast, setUndoToast] = useState<{ label: string; items: Requirement[] } | null>(null)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [importBanner, setImportBanner] = useState('')
  const searchInputRef = useRef<HTMLInputElement>(null)
  // 防止组件 remount 时重复跑自动归档
  const archiveRunRef = useRef(false)
  // 撤销删除的定时器
  const undoTimerRef = useRef<number | null>(null)
  const [notifySupported] = useState(
    () => typeof Notification !== 'undefined',
  )
  const [notifyGranted, setNotifyGranted] = useState(
    () => typeof Notification !== 'undefined' && Notification.permission === 'granted',
  )

  // 首次启动自动导入：本地无任何需求且从未导入过时，自动载入 public/import-data.json
  // （不再依赖 #import 参数，任何 URL 打开都会触发一次；导入成功后打标记避免重复）
  useEffect(() => {
    if (store.requirements.length > 0) return
    if (localStorage.getItem(IMPORT_FLAG_KEY)) return
    // 用 import.meta.env.BASE_URL 拼接，dev 自动 /，build 自动 /dev-workbench/
    fetch(import.meta.env.BASE_URL + 'import-data.json')
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error('no file'))))
      .then((data) => {
        const items = parseImportData(data)
        if (items.length === 0) return
        const n = store.importRequirements(items)
        if (n > 0) localStorage.setItem(IMPORT_FLAG_KEY, '1')
        setImportBanner(
          n > 0
            ? `✅ 已自动导入 ${n} 条历史需求，可在「需求列表」中查看。`
            : '自动导入：本地已有相同数据，跳过。',
        )
      })
      .catch(() => {
        /* 无导入文件或加载失败时静默跳过，不影响正常使用 */
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 首次启动初始化项目库：本地无项目且从未初始化过时，写入从历史需求提取的种子项目
  useEffect(() => {
    if (store.projects.length > 0) return
    if (hasProjectInitFlag()) return
    const ok = store.initProjects(seedProjects.map((p) => p.name))
    if (ok) markProjectInit()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 自动归档：启动时把已上线超过 N 个月的需求改为 archived
  // archiveRunRef 防止 StrictMode 或其他原因触发 remount 时重复跑
  useEffect(() => {
    if (archiveRunRef.current) return
    archiveRunRef.current = true

    const months = getArchiveMonths()
    const targets = findAutoArchiveTargets(store.requirements, months)
    for (const r of targets) {
      store.updateRequirement({ ...r, status: 'archived' })
    }
    if (targets.length > 0) {
      setArchiveToast({ count: targets.length, months })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 启动时若未授权，主动请求（用于今日上线桌面提醒）
  const requestNotify = useCallback(() => {
    if (typeof Notification === 'undefined') return
    Notification.requestPermission().then((p) => {
      setNotifyGranted(p === 'granted')
    })
  }, [])

  const handleSave = (draft: RequirementDraft) => {
    if (editing) {
      store.updateRequirement({ ...editing, ...draft })
    } else {
      store.addRequirement(draft)
    }
    setFormOpen(false)
    setEditing(null)
  }

  const handleStatusChange = useCallback(
    (id: string, status: RequirementStatus) => {
      const target = store.requirements.find((r) => r.id === id)
      if (!target) return
      store.updateRequirement({ ...target, status })
    },
    [store],
  )

  // 删除需求（带撤销）：先缓存被删项，5 秒内可一键恢复
  const handleDelete = useCallback(
    (id: string) => {
      const item = store.requirements.find((r) => r.id === id)
      if (!item) return
      store.removeRequirement(id)
      setUndoToast({ label: item.name, items: [item] })
      if (undoTimerRef.current) window.clearTimeout(undoTimerRef.current)
      undoTimerRef.current = window.setTimeout(() => setUndoToast(null), 5000)
    },
    [store],
  )

  // 批量删除（带撤销）：缓存所有被删项
  const handleBatchDelete = useCallback(
    (ids: string[]) => {
      const items = store.requirements.filter((r) => ids.includes(r.id))
      if (items.length === 0) return
      ids.forEach((id) => store.removeRequirement(id))
      setUndoToast({ label: `${items.length} 条需求`, items })
      if (undoTimerRef.current) window.clearTimeout(undoTimerRef.current)
      undoTimerRef.current = window.setTimeout(() => setUndoToast(null), 5000)
    },
    [store],
  )

  const handleUndoDelete = useCallback(() => {
    if (!undoToast) return
    undoToast.items.forEach((item) => store.restoreRequirement(item))
    setUndoToast(null)
    if (undoTimerRef.current) window.clearTimeout(undoTimerRef.current)
  }, [undoToast, store])

  // 全局键盘快捷键：N 新建需求、/ 聚焦搜索
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // 忽略带修饰键的组合（Ctrl/Cmd/Alt）
      if (e.metaKey || e.ctrlKey || e.altKey) return
      // 在输入框/文本域中不触发（除非是 / 且来自 body）
      const tag = (e.target as HTMLElement)?.tagName
      const isEditable =
        tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' ||
        (e.target as HTMLElement)?.isContentEditable
      if (isEditable) return
      // 有弹窗/抽屉打开时不触发（Esc 由各组件自行处理）
      if (document.querySelector('.fixed.inset-0.z-50')) return

      if (e.key === 'n' || e.key === 'N') {
        e.preventDefault()
        setEditing(null)
        setFormOpen(true)
      } else if (e.key === '/' && tab === 'list') {
        e.preventDefault()
        searchInputRef.current?.focus()
      } else if (e.key === '?') {
        e.preventDefault()
        setShortcutsOpen(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [tab])

  return (
    <div className="min-h-screen">
      {/* PWA 安装引导：Chrome 浮窗 / iOS Modal / 微信顶部条 */}
      <InstallPrompt />

      {/* 偏好设置（含自动归档月份） */}
      <PreferencesModal
        open={preferencesOpen}
        onClose={() => setPreferencesOpen(false)}
      />

      {/* 快捷键面板 */}
      <ShortcutsModal
        open={shortcutsOpen}
        onClose={() => setShortcutsOpen(false)}
      />

      {/* 自动归档完成提示 */}
      {archiveToast && (
        <div className="fixed inset-x-0 bottom-0 z-[100] p-3">
          <div className="mx-auto flex max-w-md items-center gap-3 rounded-2xl border border-amber-200 bg-white px-4 py-3 shadow-lg dark:border-amber-500/30 dark:bg-slate-900">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-amber-500 text-white shadow-sm">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 8v13H3V8M1 3h22v5H1zM10 12h4" />
              </svg>
            </div>
            <div className="flex-1 text-sm text-slate-700 dark:text-slate-200">
              <p className="font-medium">
                已自动归档 {archiveToast.count} 条需求
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                上线超过 {archiveToast.months} 个月，自动移入归档视图
              </p>
            </div>
            <button
              type="button"
              onClick={() => setArchiveToast(null)}
              className="rounded px-2.5 py-1 text-xs font-medium text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
              aria-label="关闭"
            >
              知道了
            </button>
          </div>
        </div>
      )}

      {/* 删除撤销 toast */}
      {undoToast && (
        <div className="fixed inset-x-0 bottom-0 z-[100] p-3">
          <div className="mx-auto flex max-w-md items-center gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-lg dark:border-slate-700 dark:bg-slate-900">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-rose-500 text-white shadow-sm">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
              </svg>
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-slate-700 dark:text-slate-200">
                已删除「{undoToast.label}」
              </p>
              <p className="text-xs text-slate-400">5 秒内可撤销</p>
            </div>
            <button
              type="button"
              onClick={handleUndoDelete}
              className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-indigo-700"
            >
              撤销
            </button>
            <button
              type="button"
              onClick={() => setUndoToast(null)}
              className="rounded px-1.5 py-1 text-xs text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
              aria-label="关闭"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
      )}

      {/* 顶栏 */}
      <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/80 backdrop-blur-lg dark:border-slate-800 dark:bg-[#0b1220]/80">
        <div className="mx-auto flex max-w-6xl items-center gap-2 px-3 py-2.5 sm:gap-3 sm:px-6 sm:py-3">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-indigo-600 text-white shadow-sm sm:h-9 sm:w-9">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M4 6h16M4 12h16M4 18h10" />
            </svg>
          </div>
          <div className="min-w-0 shrink-0">
            <h1 className="whitespace-nowrap text-sm font-bold text-slate-800 sm:text-base dark:text-slate-100">
              开发工作台
            </h1>
            <p className="hidden text-[11px] text-slate-400 sm:block">
              {format(new Date(), 'yyyy年M月d日 EEEE', { locale: zhCN })}
            </p>
          </div>

          {/* Tab 切换 */}
          <nav className="ml-4 hidden items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 p-1 dark:border-slate-700 dark:bg-slate-800 sm:flex">
            {(
              [
                ['today', '今日概览'],
                ['list', '需求列表'],
                ['stats', '统计'],
              ] as [Tab, string][]
            ).map(([key, label]) => (
              <button
                key={key}
                onClick={() => setTab(key)}
                className={`whitespace-nowrap rounded-md px-3.5 py-1.5 text-sm font-medium transition ${
                  tab === key
                    ? 'bg-white text-indigo-600 shadow-sm dark:bg-slate-700 dark:text-indigo-400'
                    : 'text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200'
                }`}
              >
                {label}
              </button>
            ))}
          </nav>

          <div className="ml-auto flex shrink-0 items-center gap-1.5 sm:gap-2">
            {/* 新建需求（唯一保留的常驻操作按钮） */}
            <button className="btn-primary" onClick={() => { setEditing(null); setFormOpen(true) }} title="新建需求（快捷键 N）">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <path d="M12 5v14M5 12h14" />
              </svg>
              <span className="hidden sm:inline">新建需求</span>
              <kbd className="hidden rounded bg-white/20 px-1 py-0.5 text-[10px] font-medium lg:inline">N</kbd>
            </button>

            {/* 更多操作下拉（桌面 / 移动统一） */}
            <div className="relative">
              <button
                onClick={() => setMobileMenuOpen((v) => !v)}
                className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 text-slate-500 transition hover:bg-slate-50 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800 sm:h-9 sm:w-9"
                aria-label="更多操作"
                title="更多操作"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="5" r="1.5" />
                  <circle cx="12" cy="12" r="1.5" />
                  <circle cx="12" cy="19" r="1.5" />
                </svg>
              </button>

              {mobileMenuOpen && (
                <>
                  <div
                    className="fixed inset-0 z-40"
                    onClick={() => setMobileMenuOpen(false)}
                  />
                  <div className="absolute right-0 top-full z-50 mt-1.5 w-44 rounded-xl border border-slate-200 bg-white py-1 shadow-lg dark:border-slate-700 dark:bg-slate-800">
                    <button
                      className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-slate-600 transition hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-700/50"
                      onClick={() => { setMobileMenuOpen(false); setExportOpen(true) }}
                    >
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" />
                      </svg>
                      按月导出
                    </button>
                    <button
                      className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-slate-600 transition hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-700/50"
                      onClick={() => { setMobileMenuOpen(false); setImportOpen(true) }}
                    >
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12" />
                      </svg>
                      导入数据
                    </button>
                    <button
                      className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-slate-600 transition hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-700/50"
                      onClick={() => { setMobileMenuOpen(false); setBackupOpen(true) }}
                    >
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <ellipse cx="12" cy="5" rx="9" ry="3" />
                        <path d="M3 5v14a9 3 0 0 0 18 0V5" />
                        <path d="M3 12a9 3 0 0 0 18 0" />
                      </svg>
                      数据备份
                    </button>
                    <button
                      className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-slate-600 transition hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-700/50"
                      onClick={() => { setMobileMenuOpen(false); setProjectOpen(true) }}
                    >
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />
                        <path d="M12 12v4M10 14h4" />
                      </svg>
                      项目管理
                    </button>
                    <div className="my-1 border-t border-slate-100 dark:border-slate-700/60" />
                    <button
                      className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-slate-600 transition hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-700/50"
                      onClick={() => { setMobileMenuOpen(false); setShortcutsOpen(true) }}
                    >
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="2" y="6" width="20" height="12" rx="2" />
                        <path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M8 14h8" />
                      </svg>
                      快捷键
                    </button>
                    <button
                      className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-slate-600 transition hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-700/50"
                      onClick={() => { setMobileMenuOpen(false); setPreferencesOpen(true) }}
                    >
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="12" cy="12" r="3" />
                        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
                      </svg>
                      设置
                    </button>
                    {notifySupported && !notifyGranted && (
                      <button
                        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-slate-600 transition hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-700/50"
                        onClick={() => { setMobileMenuOpen(false); requestNotify() }}
                      >
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.94 1.94 0 0 0 3.4 0" />
                        </svg>
                        开启上线提醒
                      </button>
                    )}
                  </div>
                </>
              )}
            </div>

            <button
              onClick={toggle}
              className="rounded-lg border border-slate-200 p-1.5 text-slate-400 transition hover:bg-slate-50 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800 sm:p-2"
              aria-label="切换主题"
              title={theme === 'dark' ? '切换到浅色' : '切换到深色'}
            >
              {theme === 'dark' ? (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="4" />
                  <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
                </svg>
              ) : (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79Z" />
                </svg>
              )}
            </button>
          </div>
        </div>

        {/* 移动端 Tab */}
        <div className="flex gap-1 border-t border-slate-200 px-3 py-1.5 dark:border-slate-800 sm:hidden">
          {(
            [
              ['today', '今日概览'],
              ['list', '需求列表'],
              ['stats', '统计'],
            ] as [Tab, string][]
          ).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`flex-1 rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                tab === key
                  ? 'bg-indigo-600 text-white'
                  : 'text-slate-500 dark:text-slate-400'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </header>

      {/* 内容区 */}
      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
        {importBanner && (
          <div className="mb-4 flex items-center gap-2 rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-3 text-sm text-indigo-700 dark:border-indigo-500/30 dark:bg-indigo-500/10 dark:text-indigo-300">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <path d="M12 16v-4M12 8h.01" />
            </svg>
            <span className="flex-1">{importBanner}</span>
            <button
              onClick={() => setImportBanner('')}
              className="text-indigo-400 hover:text-indigo-600 dark:hover:text-indigo-200"
              aria-label="关闭提示"
            >
              ✕
            </button>
          </div>
        )}
        {tab === 'today' ? (
          <div className="space-y-5">
            <PublishReminder requirements={store.requirements} />
            <TodoPanel
              todos={store.todos}
              requirements={store.requirements}
              onAddTodo={store.addTodo}
              onToggleTodo={store.toggleTodo}
              onRemoveTodo={store.removeTodo}
            />
          </div>
        ) : tab === 'list' ? (
          <RequirementTable
            requirements={store.requirements}
            onEdit={(r) => { setEditing(r); setFormOpen(true) }}
            onDelete={handleDelete}
            onBatchDelete={handleBatchDelete}
            onStatusChange={handleStatusChange}
            searchInputRef={searchInputRef}
          />
        ) : (
          <StatsView requirements={store.requirements} />
        )}
      </main>

      {/* 弹窗 */}
      <RequirementFormModal
        open={formOpen}
        initial={editing}
        onClose={() => { setFormOpen(false); setEditing(null) }}
        onSave={handleSave}
      />
      <ExportModal
        open={exportOpen}
        requirements={store.requirements}
        onClose={() => setExportOpen(false)}
      />
      <ImportModal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onImport={(items) => {
          const n = store.importRequirements(items)
          return n
        }}
      />
      <ProjectManagerModal
        open={projectOpen}
        onClose={() => setProjectOpen(false)}
      />
      <BackupModal
        open={backupOpen}
        onClose={() => setBackupOpen(false)}
        onRestore={store.restoreAll}
        counts={{
          requirements: store.requirements.length,
          todos: store.todos.length,
          projects: store.projects.length,
        }}
      />
    </div>
  )
}
