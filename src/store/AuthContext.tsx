/**
 * 认证 Context：session 单一来源
 *
 * - 启动时从 localStorage 读取已有 session（loadAuth）
 * - 调用 authApi.login/register → saveAuth → setState
 * - logout: 清 localStorage + setState(null)
 * - 提供 showLogin() 让 sync 层在 401 时打开登录弹窗
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import type { AuthSession } from '../lib/auth'
import { loadAuth, saveAuth, clearAuth } from '../lib/auth'
import { authApi, AuthError } from '../lib/authClient'

export type Mode = 'login' | 'register'

interface AuthContextValue {
  /** 当前 session；null 表示未登录 */
  session: AuthSession | null
  /** 启动时的初始读取是否完成（避免 modal 闪一下又关掉） */
  bootDone: boolean
  /** 是否显示登录弹窗（任何页面都可触发） */
  loginModalOpen: boolean
  /** 登录弹窗预填模式（'login' 默认；'register' 邀请码注册的入口） */
  loginMode: Mode
  /** 触发打开登录弹窗 */
  showLogin: (mode?: Mode) => void
  hideLogin: () => void
  /** 用户名预填（401 重连场景） */
  prefillUsername: string
  login: (args: { username: string; password: string; remember: boolean }) => Promise<void>
  register: (args: { username: string; password: string; inviteCode: string; remember: boolean }) => Promise<void>
  logout: () => Promise<void>
  /** 通知外部（toast 之类） */
  notify: (msg: { tone: 'ok' | 'warn' | 'error'; text: string }) => void
  /** 订阅外部通知；返回 unsubscribe */
  onNotify: (l: (msg: { tone: 'ok' | 'warn' | 'error'; text: string }) => void) => () => void
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<AuthSession | null>(null)
  const [bootDone, setBootDone] = useState(false)
  const [loginModalOpen, setLoginModalOpen] = useState(false)
  const [loginMode, setLoginMode] = useState<Mode>('login')
  const [prefillUsername, setPrefillUsername] = useState('')

  const notifyListeners = useRef(new Set<(m: { tone: 'ok' | 'warn' | 'error'; text: string }) => void>())
  const notify = useCallback((m: { tone: 'ok' | 'warn' | 'error'; text: string }) => {
    notifyListeners.current.forEach((l) => l(m))
  }, [])
  const onNotify = useCallback(
    (l: (m: { tone: 'ok' | 'warn' | 'error'; text: string }) => void) => {
      notifyListeners.current.add(l)
      return () => notifyListeners.current.delete(l)
    },
    [],
  )

  // 启动时读取已存的 session
  useEffect(() => {
    const existing = loadAuth()
    if (existing) setSession(existing)
    setBootDone(true)
  }, [])

  // 订阅一个全局 401 事件（由 sync 层 emit）；event bus 简单实现
  useEffect(() => {
    const handler = (e: Event) => {
      const ce = e as CustomEvent<{ username?: string }>
      const username = ce.detail?.username ?? ''
      setPrefillUsername(username)
      setLoginMode('login')
      setLoginModalOpen(true)
      notify({ tone: 'warn', text: '会话已过期，请重新登录' })
    }
    window.addEventListener('dev-workbench:auth-401', handler)
    return () => window.removeEventListener('dev-workbench:auth-401', handler)
  }, [notify])

  const showLogin = useCallback((mode: Mode = 'login') => {
    setLoginMode(mode)
    setLoginModalOpen(true)
  }, [])
  const hideLogin = useCallback(() => setLoginModalOpen(false), [])

  const login = useCallback(
    async (args: { username: string; password: string; remember: boolean }) => {
      try {
        const data = await authApi.login({
          username: args.username.trim(),
          password: args.password,
        })
        const full = saveAuth(data, args.remember)
        setSession(full)
        setLoginModalOpen(false)
        notify({ tone: 'ok', text: `欢迎回来，${full.user.username}` })
      } catch (e) {
        if (e instanceof AuthError) {
          notify({ tone: 'error', text: e.message === 'invalid credentials' ? '用户名或密码错误' : e.message })
        } else {
          notify({ tone: 'error', text: '登录失败：网络错误' })
        }
        throw e
      }
    },
    [notify],
  )

  const register = useCallback(
    async (args: { username: string; password: string; inviteCode: string; remember: boolean }) => {
      try {
        const data = await authApi.register({
          username: args.username.trim(),
          password: args.password,
          inviteCode: args.inviteCode || undefined,
        })
        const full = saveAuth(data, args.remember)
        setSession(full)
        setLoginModalOpen(false)
        notify({ tone: 'ok', text: `账号 ${full.user.username} 已创建` })
      } catch (e) {
        if (e instanceof AuthError) {
          notify({ tone: 'error', text: e.message === 'invalid credentials' ? '注册失败：邀请码错误或用户名已被占用' : e.message })
        } else {
          notify({ tone: 'error', text: '注册失败：网络错误' })
        }
        throw e
      }
    },
    [notify],
  )

  const logout = useCallback(async () => {
    const current = session
    setSession(null)
    clearAuth()
    if (current) {
      try {
        await authApi.logout(current.token)
      } catch {
        /* 忽略：本地已清 */
      }
    }
    notify({ tone: 'ok', text: '已退出登录' })
  }, [session, notify])

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      bootDone,
      loginModalOpen,
      loginMode,
      showLogin,
      hideLogin,
      prefillUsername,
      login,
      register,
      logout,
      notify,
      onNotify,
    }),
    [session, bootDone, loginModalOpen, loginMode, showLogin, hideLogin, prefillUsername, login, register, logout, notify, onNotify],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

/**
 * 触发 401 流程（由 sync 层调用）
 * dispatch 一个 CustomEvent，AuthProvider 监听并打开登录弹窗
 */
export function emitUnauthorized(username: string) {
  window.dispatchEvent(
    new CustomEvent('dev-workbench:auth-401', { detail: { username } }),
  )
}