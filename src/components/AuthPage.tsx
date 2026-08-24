import { useEffect, useState } from 'react'
import { useAuth } from '../store/AuthContext'
import { authApi, AuthError } from '../lib/authClient'

/**
 * 独立认证页（全屏，替代原 LoginModal 弹窗）
 *
 * - 登录 / 注册 / 忘记密码 三个视图
 * - 注册视图按 GET /api/auth/config 探测是否需要邀请码
 * - 忘记密码：用户名 + 邀请码 + 新密码（服务端无邮件通道，邀请码即身份凭证）
 * - 底部「本地模式」入口：不登录直接使用，数据只存本地
 */
type View = 'login' | 'register' | 'forgot'

const USERNAME_RE = /^[a-z0-9_]{3,20}$/

function friendlyError(e: unknown, fallback: string): string {
  if (e instanceof AuthError) {
    if (e.message === 'invalid credentials') return '用户名或密码错误'
    if (e.message === 'too many attempts') return '尝试过于频繁，请稍后再试'
    if (e.message === 'reset disabled') return '服务端未配置邀请码，重置通道未开启'
    return e.message
  }
  return fallback
}

export function AuthPage() {
  const auth = useAuth()
  const [view, setView] = useState<View>(auth.loginMode === 'forgot' ? 'forgot' : auth.loginMode)
  const [username, setUsername] = useState(auth.prefillUsername)
  const [password, setPassword] = useState('')
  const [inviteCode, setInviteCode] = useState('')
  const [remember, setRemember] = useState(true)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [done, setDone] = useState('') // 重置成功提示
  const [inviteRequired, setInviteRequired] = useState(false)
  const [configFailed, setConfigFailed] = useState(false)

  // 跟随主题（AppRoot 未挂载时由本页兜底设置）
  useEffect(() => {
    const saved = localStorage.getItem('dev-workbench:theme')
    const dark = saved ? saved === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches
    document.documentElement.classList.toggle('dark', dark)
  }, [])

  // 探测注册是否需要邀请码
  useEffect(() => {
    let alive = true
    authApi
      .config()
      .then((c) => alive && setInviteRequired(c.inviteRequired))
      .catch(() => alive && setConfigFailed(true))
    return () => {
      alive = false
    }
  }, [])

  const validUsername = USERNAME_RE.test(username.trim())
  const validPassword = password.length >= 8
  const showInvite = view === 'forgot' || (view === 'register' && (inviteRequired || configFailed))
  const validInvite = view !== 'forgot' || showInvite === false || inviteCode.trim().length > 0
  const canSubmit = validUsername && validPassword && validInvite && !busy

  function switchView(v: View) {
    setView(v)
    setErr('')
    setDone('')
  }

  async function submit() {
    if (!canSubmit) return
    setBusy(true)
    setErr('')
    setDone('')
    try {
      if (view === 'login') {
        await auth.login({ username: username.trim(), password, remember })
      } else if (view === 'register') {
        await auth.register({
          username: username.trim(),
          password,
          inviteCode: inviteCode.trim(),
          remember,
        })
      } else {
        await auth.resetPassword({
          username: username.trim(),
          inviteCode: inviteCode.trim(),
          newPassword: password,
        })
        setDone('密码已重置，请使用新密码登录')
        setPassword('')
        setInviteCode('')
        setView('login')
      }
    } catch (e) {
      setErr(friendlyError(e, view === 'login' ? '登录失败，请检查后重试' : view === 'register' ? '注册失败，请检查后重试' : '重置失败，请检查后重试'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 px-4 py-10 dark:bg-[#0b1220]">
      <div className="w-full max-w-sm">
        {/* 品牌 */}
        <div className="mb-8 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-indigo-600 text-white shadow-sm">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2" y="6" width="20" height="12" rx="2" />
              <path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M8 14h8" />
            </svg>
          </div>
          <h1 className="text-xl font-semibold text-slate-800 dark:text-slate-100">开发工作台</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">需求管理 · 待办 · 多端同步</p>
        </div>

        <div className="card p-6 sm:p-8">
          {/* 视图切换 */}
          {view !== 'forgot' && (
            <div className="mb-5 inline-flex rounded-lg border border-slate-200 bg-slate-50 p-1 dark:border-slate-700 dark:bg-slate-800">
              {(['login', 'register'] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => switchView(v)}
                  className={`rounded-md px-4 py-1.5 text-sm font-medium transition ${
                    view === v
                      ? 'bg-white text-indigo-600 shadow-sm dark:bg-slate-700 dark:text-indigo-400'
                      : 'text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'
                  }`}
                >
                  {v === 'login' ? '登录' : '注册'}
                </button>
              ))}
            </div>
          )}

          {view === 'forgot' && (
            <div className="mb-5">
              <h2 className="text-base font-semibold text-slate-800 dark:text-slate-100">重置密码</h2>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                个人服务无邮件通道：凭用户名 + 邀请码验证身份后直接设置新密码。
              </p>
            </div>
          )}

          {err && (
            <div className="mb-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-600 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-400">
              {err}
            </div>
          )}
          {done && (
            <div className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-400">
              {done}
            </div>
          )}

          <div className="space-y-4">
            <div>
              <label className="label">用户名</label>
              <input
                className="input"
                placeholder="3-20 位小写字母 / 数字 / 下划线"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoFocus
                autoComplete="username"
                spellCheck={false}
              />
              {!validUsername && username.length > 0 && (
                <p className="mt-1 text-xs text-rose-500">格式不正确</p>
              )}
            </div>

            <div>
              <label className="label">
                {view === 'forgot' ? '新密码' : '密码'}
              </label>
              <input
                className="input"
                type="password"
                placeholder="≥ 8 位"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete={view === 'login' ? 'current-password' : 'new-password'}
                onKeyDown={(e) => e.key === 'Enter' && submit()}
              />
              {!validPassword && password.length > 0 && (
                <p className="mt-1 text-xs text-rose-500">密码至少 8 位</p>
              )}
            </div>

            {showInvite && (
              <div>
                <label className="label">邀请码</label>
                <input
                  className="input"
                  placeholder={view === 'forgot' ? '注册时使用的邀请码' : configFailed ? '邀请码（如不确定请留空）' : '联系管理员获取'}
                  value={inviteCode}
                  onChange={(e) => setInviteCode(e.target.value)}
                  spellCheck={false}
                />
              </div>
            )}

            {view !== 'forgot' && (
              <label className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                <input
                  type="checkbox"
                  checked={remember}
                  onChange={(e) => setRemember(e.target.checked)}
                  className="h-3.5 w-3.5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                />
                保持登录（30 天）
              </label>
            )}
          </div>

          <button
            className="btn-primary mt-6 w-full"
            disabled={!canSubmit}
            onClick={submit}
          >
            {busy ? '…' : view === 'login' ? '登录' : view === 'register' ? '注册并登录' : '重置密码'}
          </button>

          <div className="mt-4 flex items-center justify-between text-xs">
            {view === 'login' && (
              <button
                type="button"
                className="text-indigo-600 transition hover:text-indigo-500 dark:text-indigo-400 dark:hover:text-indigo-300"
                onClick={() => switchView('forgot')}
              >
                忘记密码？
              </button>
            )}
            {view === 'forgot' && (
              <button
                type="button"
                className="text-indigo-600 transition hover:text-indigo-500 dark:text-indigo-400 dark:hover:text-indigo-300"
                onClick={() => switchView('login')}
              >
                返回登录
              </button>
            )}
            <span className="text-slate-400 dark:text-slate-500">
              {view === 'login' ? '还没有账号？切到「注册」' : ''}
            </span>
          </div>
        </div>

        {/* 本地模式入口 */}
        <div className="mt-6 text-center">
          <button
            type="button"
            className="text-xs text-slate-400 transition hover:text-slate-600 dark:text-slate-500 dark:hover:text-slate-300"
            onClick={auth.enterLocalMode}
          >
            暂不登录，使用本地模式（数据不同步）
          </button>
        </div>
      </div>
    </div>
  )
}
