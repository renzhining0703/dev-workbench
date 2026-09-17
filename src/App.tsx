import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { format } from 'date-fns'
import { zhCN } from 'date-fns/locale'
import type { Requirement, RequirementStatus, TodoPriority } from './types'
import { StoreProvider, useStore, type PushTrigger } from './store/StoreContext'
import { RequirementFormModal, type RequirementDraft } from './components/RequirementForm'
import { RequirementTable } from './components/RequirementTable'
import { RequirementKanban } from './components/RequirementKanban'
import { ProjectManagerModal } from './components/ProjectManagerModal'
import { PublishReminder, TodoPanel } from './components/TodoPanel'
import { TodoView } from './components/TodoView'
import { TodayHero } from './components/TodayHero'
import { TodoSummaryReminder } from './components/TodoSummaryReminder'
import { Logo } from './components/Logo'
import { ExportModal } from './components/ExportModal'
import { ImportModal } from './components/ImportModal'
import { BackupModal } from './components/BackupModal'
import { InstallPrompt } from './components/InstallPrompt'
import { StatsView } from './components/StatsView'
import { EfficiencyView } from './components/EfficiencyView'
import { PreferencesModal } from './components/PreferencesModal'
import { ShortcutsModal } from './components/ShortcutsModal'
import { PushModal } from './components/PushModal'
import { AddTodoModal } from './components/AddTodoModal'
import { CommandPalette, type PaletteTab } from './components/CommandPalette'
import { AuthPage } from './components/AuthPage'
import { UserMenu } from './components/UserMenu'
import { ErrorBoundary } from './components/ErrorBoundary'
import { AuthProvider, useAuth } from './store/AuthContext'
import { findAutoArchiveTargets } from './lib/archive'
import { countTodosByRequirement } from './lib/todos'
import { parseImportData } from './lib/migrate'
import { hasProjectInitFlag, markProjectInit } from './lib/storage'
import { seedProjects } from './data/seedProjects'
import { startSync, type SyncHandle } from './lib/sync'

type Tab = 'today' | 'todo' | 'list' | 'stats'
type ListView = 'table' | 'kanban'

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
  return (
    <AuthProvider>
      <AppShell />
    </AuthProvider>
  )
}

/**
 * 认证门卫 + 拿到 auth session 后再包 StoreProvider + AppRoot；
 * AppRoot 内部根据 session 启动/暂停 sync。
 * 未登录（且未进入本地模式）→ 渲染独立认证页 AuthPage。
 */
function AppShell() {
  const auth = useAuth()
  const syncRef = useRef<SyncHandle | null>(null)
  const pushTrigger = useCallback<PushTrigger>(() => {
    syncRef.current?.schedulePush()
  }, [])

  if (!auth.bootDone) return null

  return (
    <StoreProvider pushTrigger={pushTrigger}>
      <ErrorBoundary>
        {auth.session || auth.guest ? (
          <AppRoot syncRef={syncRef} auth={auth} />
        ) : (
          <AuthPage />
        )}
      </ErrorBoundary>
    </StoreProvider>
  )
}

/**
 * 在 StoreProvider 之内：拿到 store 后启动 startSync，
 * session 变化时通过 setSession 通知 sync。
 */
function AppRoot({
  syncRef,
  auth,
}: {
  syncRef: React.MutableRefObject<SyncHandle | null>
  auth: ReturnType<typeof useAuth>
}) {
  const store = useStore()
  // 让 startSync 的闭包永远拿到最新 store（之前用 mount 时的 store 会读到陈旧 state）
  const storeRef = useRef(store)
  storeRef.current = store
  const prevSession = useRef<typeof auth.session>(null)

  // mount 时启动 startSync（不立即拉，由 setSession 触发）
  useEffect(() => {
    const handle = startSync({
      getSnapshot: () => storeRef.current.getSyncData(),
      applyRemote: (snap) => storeRef.current.applyRemote(snap),
    })
    syncRef.current = handle
    return () => {
      handle.stop()
      syncRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // session 变化 → sync.setSession
  // 仅在「换账号登录」时清空本地数据（防止账号 A 的数据被推到账号 B）。
  // 登出 / 会话过期（401）不再清空：本地数据保留，重新登录同一账号后由
  // push/pull 合并恢复；避免服务端短暂不可用或 token 失效就毁掉本地数据。
  // lastUsername 跨登出持久记录：登出(账号A) → 登录(账号B) 也能正确识别切换。
  const lastUsername = useRef<string | null>(null)
  useEffect(() => {
    const cur = auth.session
    const prev = prevSession.current
    if (cur?.token === prev?.token && cur?.user.username === prev?.user.username) return

    if (cur && lastUsername.current && cur.user.username !== lastUsername.current) {
      store.clearAll()
    }
    if (cur) lastUsername.current = cur.user.username

    syncRef.current?.setSession(cur?.token ?? null, cur?.user ?? null)
    prevSession.current = cur
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.session?.token, auth.session?.user.username])

  return <AppInner syncRef={syncRef} auth={auth} />
}

/* ---------------- App 主体 ---------------- */

function AppInner({
  syncRef,
  auth,
}: {
  syncRef: React.MutableRefObject<SyncHandle | null>
  auth: ReturnType<typeof useAuth>
}) {
  const store = useStore()
  const { theme, toggle } = useTheme()
  const [tab, setTab] = useState<Tab>('today')
  const [listView, setListView] = useState<ListView>('table')
  // 统计 Tab 二级视图：req = 需求总览，eff = 个人效率
  const [statsView, setStatsView] = useState<'req' | 'eff'>('req')
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<Requirement | null>(null)
  const [cloneSource, setCloneSource] = useState<Requirement | null>(null)
  const [exportOpen, setExportOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [backupOpen, setBackupOpen] = useState(false)
  const [projectOpen, setProjectOpen] = useState(false)
  const [preferencesOpen, setPreferencesOpen] = useState(false)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  // Web Push 推送提醒设置
  const [pushOpen, setPushOpen] = useState(false)
  const [archiveToast, setArchiveToast] = useState<{ count: number; months: number } | null>(null)
  const [undoToast, setUndoToast] = useState<{ label: string; items: Requirement[] } | null>(null)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [importBanner, setImportBanner] = useState('')
  // 全局命令面板（⌘K / Ctrl+K）
  const [paletteOpen, setPaletteOpen] = useState(false)
  // 命令面板搜索待办 → 跳待办 Tab 并选中该日期（TodoView 消费后清空）
  const [pendingTodoDate, setPendingTodoDate] = useState<string | null>(null)
  // 待办关联需求跳转：待办 chip 点击 → 切到需求列表并打开对应抽屉
  const [pendingReqId, setPendingReqId] = useState<string | null>(null)
  // 需求列表「+ 待办」：非空时打开添加待办弹框
  const [addTodoFor, setAddTodoFor] = useState<Requirement | null>(null)
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
  const [notifyToast, setNotifyToast] = useState<{ tone: 'ok' | 'warn'; title: string; desc?: string } | null>(null)
  const notifyToastTimerRef = useRef<number | null>(null)
  // 更多操作下拉外点关闭：header 有 backdrop-blur（backdrop-filter 会为 fixed 后代建 containing block），
  // fixed 关闭层实际只覆盖 header 高度，点击页面内容关不掉菜单，故改用 window mousedown + ref 判定
  const mobileMenuRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!mobileMenuOpen) return
    const onDown = (e: MouseEvent) => {
      if (mobileMenuRef.current && !mobileMenuRef.current.contains(e.target as Node)) {
        setMobileMenuOpen(false)
      }
    }
    window.addEventListener('mousedown', onDown)
    return () => window.removeEventListener('mousedown', onDown)
  }, [mobileMenuOpen])

  // 首次启动自动导入：本地无任何需求且从未导入过时，自动载入 public/import-data.json
  // 注：sync 已经在 mount 时跑了一次 pull（覆盖本地），所以这里的判断基于已被同步覆盖后的本地
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
  // 注：sync 已在 mount 时拉过一次（pull），如果服务端有项目就用了服务端的，本地仍为空才走种子
  useEffect(() => {
    if (store.projects.length > 0) return
    if (hasProjectInitFlag()) return
    const ok = store.initProjects(seedProjects.map((p) => p.name))
    if (ok) markProjectInit()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 自动归档：启动时把已上线超过 N 个月的需求改为 archived
  // 用 store.archiveMonths（同步通道）而非 getArchiveMonths 直读
  // archiveRunRef 防止 StrictMode 或其他原因触发 remount 时重复跑
  useEffect(() => {
    if (archiveRunRef.current) return
    archiveRunRef.current = true

    const months = store.archiveMonths
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
  const showNotifyToast = useCallback((t: { tone: 'ok' | 'warn'; title: string; desc?: string }) => {
    setNotifyToast(t)
    if (notifyToastTimerRef.current !== null) window.clearTimeout(notifyToastTimerRef.current)
    notifyToastTimerRef.current = window.setTimeout(() => setNotifyToast(null), 8000)
  }, [])

  const requestNotify = useCallback(() => {
    if (typeof Notification === 'undefined') return
    if (Notification.permission === 'denied') {
      showNotifyToast({
        tone: 'warn',
        title: '通知权限已被浏览器拒绝',
        desc: '点击地址栏左侧的站点设置图标，把「通知」改为允许，再回到本页重新开启。',
      })
      return
    }
    Notification.requestPermission().then((p) => {
      setNotifyGranted(p === 'granted')
      if (p === 'granted') {
        showNotifyToast({ tone: 'ok', title: '已开启上线提醒', desc: '今日有需求上线时会收到桌面通知。' })
      } else if (p === 'denied') {
        showNotifyToast({
          tone: 'warn',
          title: '通知权限被拒绝',
          desc: '点击地址栏左侧的站点设置图标，把「通知」改为允许，再回到本页重新开启。',
        })
      } else {
        showNotifyToast({ tone: 'warn', title: '未开启通知', desc: '可在「更多」菜单中再次开启。' })
      }
    })
  }, [showNotifyToast])

  const handleSave = (draft: RequirementDraft) => {
    if (editing) {
      store.updateRequirement({ ...editing, ...draft })
    } else {
      store.addRequirement(draft)
    }
    setFormOpen(false)
    setEditing(null)
    setCloneSource(null)
  }

  const handleClone = useCallback((r: Requirement) => {
    setEditing(null)
    setCloneSource(r)
    setFormOpen(true)
  }, [])

  const handleStatusChange = useCallback(
    (id: string, status: RequirementStatus) => {
      const target = store.requirements.find((r) => r.id === id)
      if (!target) return
      store.updateRequirement({ ...target, status })
    },
    [store],
  )

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

  /** 待办关联需求 → 跳转需求列表并打开抽屉（列表 Tab 下的表格/看板都切到表格视图，抽屉在表格里） */
  const jumpToRequirement = useCallback((reqId: string) => {
    setListView('table')
    setTab('list')
    setPendingReqId(reqId)
  }, [])

  /** requirementId → 已有关联待办条数（列表按钮角标）；一次遍历，避免每行 filter 全量 */
  const todoCounts = useMemo(() => countTodosByRequirement(store.todos), [store.todos])

  /** 需求列表「+ 待办」提交：写入待办并关联需求 */
  const handleAddTodoSubmit = useCallback(
    ({ content, date, priority }: { content: string; date: string; priority: TodoPriority }) => {
      if (!addTodoFor) return
      store.addTodo(content, date, { requirementId: addTodoFor.id, priority })
      setAddTodoFor(null)
      showNotifyToast({
        tone: 'ok',
        title: '待办已添加',
        desc: `${date} · ${content}`,
      })
    },
    [addTodoFor, store, showNotifyToast],
  )

  /** 命令面板：导航到指定 Tab */
  const handlePaletteNavigate = useCallback((t: PaletteTab) => {
    setTab(t)
    setPaletteOpen(false)
  }, [])

  /** 命令面板：搜索到待办 → 跳待办 Tab 并选中对应日期 */
  const handlePaletteJumpTodo = useCallback((date: string) => {
    setPendingTodoDate(date)
    setTab('todo')
    setPaletteOpen(false)
  }, [])

  // 全局键盘快捷键：⌘K 命令面板、N 新建需求、/ 聚焦搜索、? 快捷键面板
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // ⌘K / Ctrl+K：打开或关闭命令面板（输入框内也生效）
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setPaletteOpen((v) => !v)
        return
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const tag = (e.target as HTMLElement)?.tagName
      const isEditable =
        tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' ||
        (e.target as HTMLElement)?.isContentEditable
      if (isEditable) return
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
      <InstallPrompt />

      <PreferencesModal
        open={preferencesOpen}
        onClose={() => setPreferencesOpen(false)}
      />

      <PushModal
        open={pushOpen}
        onClose={() => setPushOpen(false)}
        token={auth.session?.token ?? null}
      />

      <ShortcutsModal
        open={shortcutsOpen}
        onClose={() => setShortcutsOpen(false)}
      />

      <AddTodoModal
        open={!!addTodoFor}
        requirement={addTodoFor}
        todos={store.todos}
        onClose={() => setAddTodoFor(null)}
        onSubmit={handleAddTodoSubmit}
      />

      {archiveToast && (
        <div className="wb-toast">
          <span className="dot" />
          <div style={{ flex: 1 }}>
            <b>已自动归档 {archiveToast.count} 条需求</b>
            <div style={{ fontSize: 11.5, opacity: 0.75, marginTop: 1 }}>
              上线超过 {archiveToast.months} 个月，自动移入归档视图
            </div>
          </div>
          <button onClick={() => setArchiveToast(null)}>知道了</button>
        </div>
      )}

      {undoToast && (
        <div className="wb-toast">
          <span className="dot" />
          <div style={{ flex: 1 }}>
            <b>已删除「{undoToast.label}」</b>
            <div style={{ fontSize: 11.5, opacity: 0.75, marginTop: 1 }}>5 秒内可撤销</div>
          </div>
          <button onClick={handleUndoDelete}>撤销</button>
          <button onClick={() => setUndoToast(null)} aria-label="关闭">✕</button>
        </div>
      )}

      {notifyToast && (
        <div className="wb-toast">
          <span className="dot" style={{ background: notifyToast.tone === 'ok' ? 'var(--wb-success)' : 'var(--wb-accent)' }} />
          <div style={{ flex: 1 }}>
            <b>{notifyToast.title}</b>
            {notifyToast.desc && (
              <div style={{ fontSize: 11.5, opacity: 0.75, marginTop: 1 }}>{notifyToast.desc}</div>
            )}
          </div>
          <button onClick={() => setNotifyToast(null)}>知道了</button>
        </div>
      )}

      {/* 顶栏（NOVA：深绿品牌条） */}
      <header className="wb-header">
        <div className="wb-header-inner">
          <div className="wb-logo">
            <div className="wb-logo-mark">
              <Logo size={20} title="开发工作台" />
            </div>
            <div>
              <div className="wb-logo-name">开发工作台</div>
              <div className="wb-logo-date">
                {format(new Date(), 'yyyy年M月d日 EEEE', { locale: zhCN })}
              </div>
            </div>
          </div>

          <nav className="wb-nav wb-nav-desktop">
            {(
              [
                ['today', '今日概览'],
                ['todo', '待办'],
                ['list', '需求列表'],
                ['stats', '统计'],
              ] as [Tab, string][]
            ).map(([key, label]) => (
              <button
                key={key}
                onClick={() => setTab(key)}
                className={`wb-nav-btn ${tab === key ? 'active' : ''}`}
              >
                <span className="nav-dot" />
                {label}
              </button>
            ))}
          </nav>

          <div className="wb-header-actions">
            {/* 全局搜索（⌘K）——PC 显示文字按钮，移动端图标 */}
            <button
              onClick={() => setPaletteOpen(true)}
              className="hidden items-center gap-2 rounded-lg border border-white/20 bg-white/5 px-3 py-1.5 text-xs text-white/75 transition hover:bg-white/10 hover:text-white md:flex"
              aria-label="全局搜索"
              title="全局搜索（⌘K）"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="7" />
                <path d="m21 21-4.35-4.35" />
              </svg>
              搜索
              <kbd className="rounded border border-white/25 px-1 text-[10px] leading-4">⌘K</kbd>
            </button>
            <button
              onClick={() => setPaletteOpen(true)}
              className="wb-icon-btn md:hidden"
              aria-label="全局搜索"
              title="全局搜索"
            >
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="7" />
                <path d="m21 21-4.35-4.35" />
              </svg>
            </button>

            <button className="wb-btn-primary" onClick={() => { setEditing(null); setFormOpen(true) }} title="新建需求（快捷键 N）">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <path d="M12 5v14M5 12h14" />
              </svg>
              <span className="hidden sm:inline">新建需求</span>
            </button>

            {/* 更多操作下拉 */}
            <div className="relative" ref={mobileMenuRef}>
              <button
                onClick={() => setMobileMenuOpen((v) => !v)}
                className="wb-icon-btn"
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
                  <div className="wb-card absolute right-0 top-full z-50 mt-1.5 w-44 py-1">
                    <button
                      className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition hover:bg-[var(--wb-surface-2)]"
                      style={{ color: 'var(--wb-ink-2)' }}
                      onClick={() => { setMobileMenuOpen(false); setExportOpen(true) }}
                    >
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" />
                      </svg>
                      按月导出
                    </button>
                    <button
                      className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition hover:bg-[var(--wb-surface-2)]"
                      style={{ color: 'var(--wb-ink-2)' }}
                      onClick={() => { setMobileMenuOpen(false); setImportOpen(true) }}
                    >
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12" />
                      </svg>
                      导入数据
                    </button>
                    <button
                      className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition hover:bg-[var(--wb-surface-2)]"
                      style={{ color: 'var(--wb-ink-2)' }}
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
                      className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition hover:bg-[var(--wb-surface-2)]"
                      style={{ color: 'var(--wb-ink-2)' }}
                      onClick={() => { setMobileMenuOpen(false); setProjectOpen(true) }}
                    >
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />
                        <path d="M12 12v4M10 14h4" />
                      </svg>
                      项目管理
                    </button>
                    <div className="my-1 border-t" style={{ borderColor: 'var(--wb-line)' }} />
                    <button
                      className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition hover:bg-[var(--wb-surface-2)]"
                      style={{ color: 'var(--wb-ink-2)' }}
                      onClick={() => { setMobileMenuOpen(false); setShortcutsOpen(true) }}
                    >
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="2" y="6" width="20" height="12" rx="2" />
                        <path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M8 14h8" />
                      </svg>
                      快捷键
                    </button>
                    <button
                      className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition hover:bg-[var(--wb-surface-2)]"
                      style={{ color: 'var(--wb-ink-2)' }}
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
                        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition hover:bg-[var(--wb-surface-2)]"
                      style={{ color: 'var(--wb-ink-2)' }}
                        onClick={() => { setMobileMenuOpen(false); requestNotify() }}
                      >
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.94 1.94 0 0 0 3.4 0" />
                        </svg>
                        开启上线提醒
                      </button>
                    )}
                    {auth.session && (
                      <button
                        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition hover:bg-[var(--wb-surface-2)]"
                        style={{ color: 'var(--wb-ink-2)' }}
                        onClick={() => { setMobileMenuOpen(false); setPushOpen(true) }}
                      >
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
                        </svg>
                        推送提醒
                      </button>
                    )}
                  </div>
                </>
              )}
            </div>

            {/* 已登录：用户菜单（含 SyncBadge）；未登录：单独「登录」入口 */}
            {syncRef.current && auth.session ? (
              <UserMenu sync={syncRef.current} />
            ) : (
              <button
                onClick={() => auth.showLogin('login')}
                className="rounded-lg border border-white/25 px-3 py-1.5 text-xs font-medium text-white/90 transition hover:bg-white/10"
                aria-label="登录"
              >
                登录
              </button>
            )}

            <button
              onClick={toggle}
              className="wb-icon-btn"
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

        {/* 移动端 Tab 栏 */}
        <div className="flex gap-1 border-t border-white/10 px-3 py-1.5 sm:hidden">
          {(
            [
              ['today', '今日概览'],
              ['todo', '待办'],
              ['list', '需求列表'],
              ['stats', '统计'],
            ] as [Tab, string][]
          ).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`flex-1 rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                tab === key
                  ? 'bg-white/15 text-white'
                  : 'text-white/55 hover:text-white/85'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </header>

      <main className="wb-main">
        {importBanner && (
          <div
            className="mb-4 flex items-center gap-2 rounded-xl border px-4 py-3 text-sm"
            style={{ borderColor: 'var(--wb-line)', background: 'var(--wb-warn-soft)', color: 'var(--wb-warn)' }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <path d="M12 16v-4M12 8h.01" />
            </svg>
            <span className="flex-1">{importBanner}</span>
            <button
              onClick={() => setImportBanner('')}
              className="transition hover:opacity-70"
              aria-label="关闭提示"
            >
              ✕
            </button>
          </div>
        )}
        {tab === 'today' ? (
          <div className="wb-view active">
            <TodayHero
              nickname={auth.session?.user.nickname ?? '朋友'}
              todos={store.todos}
              requirements={store.requirements}
            />
            <PublishReminder requirements={store.requirements} />
            <TodoPanel
              todos={store.todos}
              requirements={store.requirements}
              onAddTodo={store.addTodo}
              onToggleTodo={store.toggleTodo}
              onUpdateTodo={store.updateTodo}
              onRemoveTodo={store.removeTodo}
              onViewAll={() => setTab('todo')}
              onOpenRequirement={jumpToRequirement}
            />
          </div>
        ) : tab === 'todo' ? (
          <div className="wb-view active">
            <TodoView
              todos={store.todos}
              requirements={store.requirements}
              onAddTodo={store.addTodo}
              onToggleTodo={store.toggleTodo}
              onUpdateTodo={store.updateTodo}
              onRemoveTodo={store.removeTodo}
              onOpenRequirement={jumpToRequirement}
              externalDate={pendingTodoDate ?? undefined}
              onExternalDateConsumed={() => setPendingTodoDate(null)}
            />
          </div>
        ) : tab === 'list' ? (
          <>
            <div className="wb-pills mb-4">
              {(['table', 'kanban'] as const).map((v) => (
                <button
                  key={v}
                  onClick={() => setListView(v)}
                  className={`wb-pill ${listView === v ? 'active' : ''}`}
                >
                  {v === 'table' ? '📋 表格' : '🗂 看板'}
                </button>
              ))}
            </div>

            {listView === 'table' ? (
              <RequirementTable
                requirements={store.requirements}
                onEdit={(r) => { setEditing(r); setFormOpen(true) }}
                onClone={handleClone}
                onDelete={handleDelete}
                onBatchDelete={handleBatchDelete}
                onStatusChange={handleStatusChange}
                searchInputRef={searchInputRef}
                externalOpenId={pendingReqId}
                onExternalOpened={() => setPendingReqId(null)}
                onAddTodo={setAddTodoFor}
                todoCounts={todoCounts}
              />
            ) : (
              <RequirementKanban
                requirements={store.requirements}
                onEdit={(r) => { setEditing(r); setFormOpen(true) }}
                onStatusChange={handleStatusChange}
                searchInputRef={searchInputRef}
                onAddTodo={setAddTodoFor}
                todoCounts={todoCounts}
              />
            )}
          </>
        ) : (
          <>
            <div className="wb-pills mb-4">
              {(
                [
                  ['req', '需求总览'],
                  ['eff', '个人效率'],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  onClick={() => setStatsView(key)}
                  className={`wb-pill ${statsView === key ? 'active' : ''}`}
                >
                  {label}
                </button>
              ))}
            </div>
            {statsView === 'req' ? (
              <div className="wb-view active">
                <StatsView requirements={store.requirements} />
              </div>
            ) : (
              <div className="wb-view active">
                <EfficiencyView todos={store.todos} />
              </div>
            )}
          </>
        )}
      </main>

      {/* 今日待办汇总通知：每天首次打开时今日未完成 >3 条触发 */}
      <TodoSummaryReminder
        todos={store.todos}
        onViewTodos={() => setTab('todo')}
      />

      <RequirementFormModal
        open={formOpen}
        initial={editing}
        prefill={cloneSource}
        onClose={() => { setFormOpen(false); setEditing(null); setCloneSource(null) }}
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

      {/* 全局命令面板（⌘K / Ctrl+K） */}
      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        requirements={store.requirements}
        todos={store.todos}
        projects={store.projects}
        onNavigate={handlePaletteNavigate}
        onNewRequirement={() => {
          setEditing(null)
          setFormOpen(true)
          setPaletteOpen(false)
        }}
        onOpenRequirement={(id) => {
          jumpToRequirement(id)
          setPaletteOpen(false)
        }}
        onJumpTodo={handlePaletteJumpTodo}
        onToggleView={() => {
          setListView((v) => (v === 'table' ? 'kanban' : 'table'))
          setPaletteOpen(false)
        }}
        onOpenShortcuts={() => {
          setShortcutsOpen(true)
          setPaletteOpen(false)
        }}
      />
    </div>
  )
}
