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
import { parseImportData } from './lib/migrate'
import { hasProjectInitFlag, markProjectInit } from './lib/storage'
import { seedProjects } from './data/seedProjects'

type Tab = 'today' | 'list'

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
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [importBanner, setImportBanner] = useState('')
  const searchInputRef = useRef<HTMLInputElement>(null)
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
    fetch('/import-data.json')
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
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [tab])

  return (
    <div className="min-h-screen">
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
              ] as [Tab, string][]
            ).map(([key, label]) => (
              <button
                key={key}
                onClick={() => setTab(key)}
                className={`rounded-md px-3.5 py-1.5 text-sm font-medium transition ${
                  tab === key
                    ? 'bg-white text-indigo-600 shadow-sm dark:bg-slate-700 dark:text-indigo-400'
                    : 'text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200'
                }`}
              >
                {label}
              </button>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-1.5 sm:gap-2">
            {/* 桌面端：完整按钮组 */}
            <div className="hidden items-center gap-2 sm:flex">
              {notifySupported && !notifyGranted && (
                <button
                  onClick={requestNotify}
                  className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs text-slate-500 transition hover:bg-slate-50 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800"
                  title="开启桌面通知，上线日自动提醒"
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.94 1.94 0 0 0 3.4 0" />
                  </svg>
                  开启上线提醒
                </button>
              )}

              <button className="btn-ghost" onClick={() => setExportOpen(true)}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" />
                </svg>
                <span className="hidden sm:inline">按月导出</span>
              </button>

              <button
                className="btn-ghost"
                onClick={() => setBackupOpen(true)}
                title="导出完整备份或从备份恢复"
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <ellipse cx="12" cy="5" rx="9" ry="3" />
                  <path d="M3 5v14a9 3 0 0 0 18 0V5" />
                  <path d="M3 12a9 3 0 0 0 18 0" />
                </svg>
                <span className="hidden lg:inline">数据备份</span>
              </button>

              <button
                className="btn-ghost"
                onClick={() => setProjectOpen(true)}
                title="维护项目下拉数据（增删改）"
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />
                  <path d="M12 12v4M10 14h4" />
                </svg>
                <span className="hidden lg:inline">项目管理</span>
              </button>

              <button
                className="btn-ghost"
                onClick={() => setImportOpen(true)}
                title="导入需求数据（支持旧版记录）"
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12" />
                </svg>
                <span className="hidden lg:inline">导入数据</span>
              </button>

              <button className="btn-primary" onClick={() => { setEditing(null); setFormOpen(true) }} title="快捷键 N">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                  <path d="M12 5v14M5 12h14" />
                </svg>
                <span className="hidden sm:inline">新建需求</span>
                <kbd className="hidden rounded bg-white/20 px-1 py-0.5 text-[10px] font-medium lg:inline">N</kbd>
              </button>
            </div>

            {/* 移动端：仅保留新建 + 更多 + 主题 */}
            <div className="flex items-center gap-1 sm:hidden">
              <button
                className="btn-primary h-8 w-8 items-center justify-center px-0"
                onClick={() => { setEditing(null); setFormOpen(true) }}
                title="新建需求"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                  <path d="M12 5v14M5 12h14" />
                </svg>
              </button>

              <div className="relative">
                <button
                  onClick={() => setMobileMenuOpen((v) => !v)}
                  className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 text-slate-500 transition hover:bg-slate-50 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800"
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
                      <button
                        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-slate-600 transition hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-700/50"
                        onClick={() => { setMobileMenuOpen(false); setImportOpen(true) }}
                      >
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12" />
                        </svg>
                        导入数据
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
        ) : (
          <RequirementTable
            requirements={store.requirements}
            onEdit={(r) => { setEditing(r); setFormOpen(true) }}
            onDelete={store.removeRequirement}
            onStatusChange={handleStatusChange}
            searchInputRef={searchInputRef}
          />
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
