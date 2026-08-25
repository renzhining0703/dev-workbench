/**
 * 同步层：本地优先 + 后台推送
 *
 * 设计：
 *   - mount/focus/visibilitychange → pull（服务端权威胜出，覆盖本地）
 *   - mutation 后 → schedulePush（300ms debounce）
 *   - 30s interval → push（pendingChanges 时才推）
 *   - pagehide/beforeunload → sendBeacon（fire-and-forget，未登录时跳过）
 *
 * 鉴权：
 *   - token 由 startSync 调用方注入（setSession）；fetch 时通过 tokenGetter 读取
 *   - 401 → emitUnauthorized → AuthContext 弹登录框
 *
 * 冲突策略：基于 updatedAt 的字段级 LWW；缺字段时降级 createdAt
 */
import type { Project, Requirement, TodoItem } from '../types'
import { SYNC_API, SYNC_ENABLED } from './syncConfig'
import { emitUnauthorized } from '../store/AuthContext'

export type SyncStatus = 'idle' | 'syncing' | 'offline' | 'error'

export interface SyncState {
  status: SyncStatus
  /** ISO 时间戳 */
  lastSyncAt: string | null
  lastError: string | null
  /** 是否有本地变更未推到服务端 */
  pendingChanges: boolean
  /** 当前登录的用户名（null 表示未登录，sync 暂停） */
  user: { username: string } | null
}

export interface RemoteSnapshot {
  /** 服务端权威时间戳（响应里有，客户端推送时不需要） */
  serverTs: string
  requirements: Requirement[]
  todos: TodoItem[]
  projects: Project[]
  settings: { autoArchiveMonths: number }
}

export interface RemoteSnapshotInput {
  requirements: Requirement[]
  todos: TodoItem[]
  projects: Project[]
  settings: { autoArchiveMonths: number }
  clientTs?: string
}

interface Adapter {
  getSnapshot: () => {
    requirements: Requirement[]
    todos: TodoItem[]
    projects: Project[]
    settings: { autoArchiveMonths: number }
  }
  applyRemote: (snap: RemoteSnapshot) => void
}

interface Options {
  debounceMs?: number
  intervalMs?: number
}

/* ---------------- 合并 ---------------- */
/* mergeByUpdatedAt 已抽到 src/lib/merge.ts（纯函数，零 DOM 依赖，便于单测） */

/* ---------------- HTTP ---------------- */

async function readJson(res: Response): Promise<unknown> {
  const text = await res.text()
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

interface SessionRef {
  token: string | null
  user: { username: string } | null
}

interface FetchResult<T> {
  ok: boolean
  status: number
  data?: T
  unauthorized?: boolean
}

async function fetchSnapshot(token: string): Promise<FetchResult<RemoteSnapshot>> {
  const res = await fetch(`${SYNC_API}/snapshot`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` },
    credentials: 'omit',
  })
  if (res.status === 401) return { ok: false, status: 401, unauthorized: true }
  if (!res.ok) return { ok: false, status: res.status }
  const body = (await readJson(res)) as { ok: boolean; data?: RemoteSnapshot } | null
  if (body?.ok && body.data) return { ok: true, status: 200, data: body.data }
  return { ok: false, status: res.status }
}

async function postPush(
  token: string,
  payload: RemoteSnapshotInput,
): Promise<FetchResult<RemoteSnapshot>> {
  const res = await fetch(`${SYNC_API}/push`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
    credentials: 'omit',
  })
  if (res.status === 401) return { ok: false, status: 401, unauthorized: true }
  if (!res.ok) return { ok: false, status: res.status }
  const body = (await readJson(res)) as { ok: boolean; data?: RemoteSnapshot } | null
  if (body?.ok && body.data) return { ok: true, status: 200, data: body.data }
  return { ok: false, status: res.status }
}

/* ---------------- Sync core ---------------- */

export interface SyncHandle {
  stop: () => void
  pushNow: () => Promise<void>
  pullNow: () => Promise<void>
  schedulePush: () => void
  subscribe: (l: (s: SyncState) => void) => () => void
  getState: () => SyncState
  /** 热切换 session（登录后/登出后调用）；null = 暂停同步 */
  setSession: (token: string | null, user: { username: string } | null) => void
}

const POLL_INTERVAL_MS = 30_000
const DEBOUNCE_MS = 300

export function startSync(adapter: Adapter, options: Options = {}): SyncHandle {
  const debounceMs = options.debounceMs ?? DEBOUNCE_MS
  const intervalMs = options.intervalMs ?? POLL_INTERVAL_MS

  const session: SessionRef = { token: null, user: null }

  let state: SyncState = {
    status: SYNC_ENABLED ? 'idle' : 'error',
    lastSyncAt: null,
    lastError: SYNC_ENABLED ? null : 'sync not configured',
    pendingChanges: false,
    user: null,
  }

  const listeners = new Set<(s: SyncState) => void>()
  const setState = (patch: Partial<SyncState>) => {
    state = { ...state, ...patch }
    listeners.forEach((l) => l(state))
  }

  let pushTimer: number | null = null
  let inflight: Promise<void> | null = null
  let lastBeaconBody: string | null = null
  /** 已触发过 401 提示，避免重复 toast */
  let unauthorizedFired = false

  function fireUnauthorizedOnce() {
    if (unauthorizedFired) return
    unauthorizedFired = true
    emitUnauthorized(session.user?.username ?? '')
    setState({ status: 'offline', lastError: '会话已过期' })
  }

  function clearUnauthorizedFlag() {
    unauthorizedFired = false
  }

  async function doPush(): Promise<void> {
    if (!SYNC_ENABLED) return
    if (!session.token) return
    if (inflight) return inflight
    setState({ status: 'syncing' })
    const snap = { ...adapter.getSnapshot(), clientTs: new Date().toISOString() }
    lastBeaconBody = JSON.stringify(snap)
    inflight = (async () => {
      const r = await postPush(session.token!, snap)
      if (r.ok && r.data) {
        try {
          adapter.applyRemote(r.data)
        } catch {
          /* 容错 */
        }
        setState({
          status: 'idle',
          lastSyncAt: new Date().toISOString(),
          lastError: null,
          pendingChanges: false,
        })
      } else if (r.unauthorized) {
        fireUnauthorizedOnce()
      } else {
        setState({ status: 'offline', lastError: 'push failed' })
      }
    })()
    try {
      await inflight
    } finally {
      inflight = null
    }
  }

  function schedulePush(): void {
    if (!session.token) return
    setState({ pendingChanges: true })
    if (pushTimer !== null) window.clearTimeout(pushTimer)
    pushTimer = window.setTimeout(() => {
      pushTimer = null
      void doPush()
    }, debounceMs)
  }

  async function doPull(): Promise<void> {
    if (!SYNC_ENABLED) return
    if (!session.token) return
    setState({ status: 'syncing' })
    const r = await fetchSnapshot(session.token)
    if (r.ok && r.data) {
      try {
        adapter.applyRemote(r.data)
      } catch {
        /* 容错 */
      }
      setState({
        status: 'idle',
        lastSyncAt: new Date().toISOString(),
        lastError: null,
      })
    } else if (r.unauthorized) {
      fireUnauthorizedOnce()
    } else {
      setState({ status: 'offline', lastError: 'pull failed' })
    }
  }

  const onFocus = () => {
    if (session.token) void doPull()
  }
  const onVisibility = () => {
    if (document.visibilityState === 'visible' && session.token) void doPull()
  }

  const onPageHide = () => {
    if (!SYNC_ENABLED) return
    if (!session.token) return
    if (!lastBeaconBody) {
      const snap = { ...adapter.getSnapshot(), clientTs: new Date().toISOString() }
      lastBeaconBody = JSON.stringify(snap)
    }
    try {
      const blob = new Blob([lastBeaconBody], { type: 'application/json' })
      navigator.sendBeacon?.(`${SYNC_API}/push`, blob)
    } catch {
      /* 静默 */
    }
  }

  const intervalId = window.setInterval(() => {
    if (!session.token) return
    if (state.pendingChanges) void doPush()
    else void doPull()
  }, intervalMs)

  window.addEventListener('focus', onFocus)
  document.addEventListener('visibilitychange', onVisibility)
  window.addEventListener('pagehide', onPageHide)
  window.addEventListener('beforeunload', onPageHide)

  return {
    stop: () => {
      window.clearInterval(intervalId)
      if (pushTimer !== null) window.clearTimeout(pushTimer)
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('pagehide', onPageHide)
      window.removeEventListener('beforeunload', onPageHide)
      listeners.clear()
    },
    pushNow: doPush,
    pullNow: doPull,
    schedulePush,
    subscribe: (l) => {
      listeners.add(l)
      l(state)
      return () => listeners.delete(l)
    },
    getState: () => state,
    setSession: (token, user) => {
      session.token = token
      session.user = user
      setState({ user, lastError: null })
      clearUnauthorizedFlag()
      if (token) {
        // 登录后：先推（保留本地数据，避免被服务端空快照覆盖）再拉（兜底拉取服务端最新）
        // doPush 内部已 applyRemote 合并结果；doPull 作为兜底防丢更新。
        void (async () => {
          await doPush()
          await doPull()
        })()
      } else {
        // 登出 → 标记 pendingChanges 为 false 避免旧数据被推回
        setState({ pendingChanges: false, status: SYNC_ENABLED ? 'offline' : 'error' })
      }
    },
  }
}