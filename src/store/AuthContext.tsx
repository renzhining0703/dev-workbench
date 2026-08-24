/**
 * 认证 Context：session 单一来源
 *
 * - 启动时从 localStorage 读取已有 session（loadAuth）
 * - 调用 authApi.login/register → saveAuth → setState
 * - 未登录：渲染独立认证页 AuthPage（登录/注册/忘记密码）
 *   「本地模式」（guest）可跳过登录直接进入应用，数据只存本地
 * - 401（会话过期）：清空 session 与本地登录态，回到认证页
 * - changePassword / resetPassword 支撑完整密码流程
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

export type Mode = 'login' | 'register' | 'forgot'

const GUEST_KEY = 'dev-workbench:guest'

interface AuthContextValue {
  /** 当前 session；null 表示未登录 */
  session: AuthSession | null
  /** 启动时的初始读取是否完成（避免认证页闪一下又消失） */
  bootDone: boolean
  /** 本地模式：未登录但直接进入应用（数据不云同步） */
  guest: boolean
  /** 认证页初始视图（401 重连场景预填 login + 用户名） */
  loginMode: Mode
  /** 用户名预填（401 重连场景） */
  prefillUsername: string
  /** 从认证页进入本地模式 */
  enterLocalMode: () => void
  /** 从本地模式返回认证页（header「登录」按钮用） */
  showLogin: (mode?: Mode) => void
  login: (args: { username: string; password: string; remember: boolean }) => Promise<void>
  register: (args: { username: string; password: string; inviteCode: string; remember: boolean }) => Promise<void>
  /** 忘记密码重置；成功后由认证页切回登录视图 */
  resetPassword: (args: { username: string; inviteCode: string; newPassword: string }) => Promise<void>
  /** 登录态修改密码（成功后当前会话保持有效） */
  changePassword: (args: { currentPassword: string; newPassword: string }) => Promise<void>
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
  const [guest, setGuest] = useState(false)
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

  // 启动时读取已存的 session / 本地模式标记
  useEffect(() => {
    const existing = loadAuth()
    if (existing) setSession(existing)
    else if (localStorage.getItem(GUEST_KEY) === '1') setGuest(true)
    setBootDone(true)
  }, [])

  // 订阅一个全局 401 事件（由 sync 层 emit）：会话过期 → 清空登录态，回到认证页
  useEffect(() => {
    const handler = (e: Event) => {
      const ce = e as CustomEvent<{ username?: string }>
      clearAuth()
      localStorage.removeItem(GUEST_KEY)
      setSession(null)
      setGuest(false)
      setPrefillUsername(ce.detail?.username ?? '')
      setLoginMode('login')
      notify({ tone: 'warn', text: '会话已过期，请重新登录' })
    }
    window.addEventListener('dev-workbench:auth-401', handler)
    return () => window.removeEventListener('dev-workbench:auth-401', handler)
  }, [notify])

  const enterLocalMode = useCallback(() => {
    localStorage.setItem(GUEST_KEY, '1')
    setGuest(true)
  }, [])

  /** 退出本地模式 → 显示认证页 */
  const showLogin = useCallback((mode: Mode = 'login') => {
    localStorage.removeItem(GUEST_KEY)
    setGuest(false)
    setLoginMode(mode)
  }, [])

  const login = useCallback(
    async (args: { username: string; password: string; remember: boolean }) => {
      try {
        const data = await authApi.login({
          username: args.username.trim(),
          password: args.password,
        })
        const full = saveAuth(data, args.remember)
        localStorage.removeItem(GUEST_KEY)
        setGuest(false)
        setSession(full)
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
        localStorage.removeItem(GUEST_KEY)
        setGuest(false)
        setSession(full)
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

  const resetPassword = useCallback(
    async (args: { username: string; inviteCode: string; newPassword: string }) => {
      // 抛 AuthError 由认证页展示（403 reset disabled → 服务端未配置邀请码）
      await authApi.resetPassword({
        username: args.username.trim(),
        inviteCode: args.inviteCode.trim(),
        newPassword: args.newPassword,
      })
    },
    [],
  )

  const changePassword = useCallback(
    async (args: { currentPassword: string; newPassword: string }) => {
      if (!session) throw new AuthError('not logged in', 401)
      await authApi.changePassword(session.token, args)
      notify({ tone: 'ok', text: '密码已更新' })
    },
    [session, notify],
  )

  const logout = useCallback(async () => {
    const current = session
    setSession(null)
    setGuest(false)
    localStorage.removeItem(GUEST_KEY)
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
      guest,
      loginMode,
      prefillUsername,
      enterLocalMode,
      showLogin,
      login,
      register,
      resetPassword,
      changePassword,
      logout,
      notify,
      onNotify,
    }),
    [session, bootDone, guest, loginMode, prefillUsername, enterLocalMode, showLogin, login, register, resetPassword, changePassword, logout, notify, onNotify],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

/**
 * 触发 401 流程（由 sync 层调用）
 * dispatch 一个 CustomEvent，AuthProvider 监听并清空登录态回到认证页
 */
export function emitUnauthorized(username: string) {
  window.dispatchEvent(
    new CustomEvent('dev-workbench:auth-401', { detail: { username } }),
  )
}
