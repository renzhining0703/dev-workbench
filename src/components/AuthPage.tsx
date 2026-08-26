import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from 'react'
import { useAuth } from '../store/AuthContext'
import { authApi, AuthError } from '../lib/authClient'

/**
 * 独立认证页（全屏，NOVA 设计稿还原：左侧品牌面板 + 右侧表单面板）
 *
 * - 登录 / 注册 Tab + 忘记密码视图（Tab 上方金色指示条动画）
 * - 注册视图按 GET /api/auth/config 探测是否需要邀请码
 * - 忘记密码：用户名 + 邀请码 + 新密码（服务端无邮件通道，邀请码即身份凭证）
 * - 字段级内联校验（提交时标错，输入即清除）+ 密码可见切换
 * - 微信登录按钮占位（仅提示「开发中」，未接入真实能力）
 * - 底部「本地模式」入口：不登录直接使用，数据只存本地
 * - ≤920px 隐藏品牌面板，单列表单；暗色主题由 .dark 变量覆盖
 */
type View = 'login' | 'register' | 'forgot'
type FieldKey = 'username' | 'password' | 'invite' | 'nickname'

const USERNAME_RE = /^[a-z0-9_]{3,20}$/
const NICKNAME_MAX = 30

function friendlyError(e: unknown, fallback: string): string {
  if (e instanceof AuthError) {
    if (e.message === 'invalid credentials') return '用户名或密码错误'
    if (e.message === 'too many attempts') return '尝试过于频繁，请稍后再试'
    if (e.message === 'reset disabled') return '服务端未配置邀请码，重置通道未开启'
    return e.message
  }
  return fallback
}

/* ---------- 图标 ---------- */

function EyeIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  )
}

function EyeOffIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" />
      <path d="M3.5 3.5l17 17" />
    </svg>
  )
}

function WeChatIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M9.1 3.9C5.4 3.9 2.4 6.4 2.4 9.5c0 1.7.9 3.2 2.4 4.3l-.6 1.9 2.2-1.1c.7.2 1.5.3 2.2.3h.4c-.1-.4-.2-.8-.2-1.2 0-3 2.7-5.4 6-5.4h.3c-.5-2.6-3.3-4.4-6-4.4zM6.7 8.1c-.5 0-.9-.4-.9-.9s.4-.9.9-.9.9.4.9.9-.4.9-.9.9zm4.8 0c-.5 0-.9-.4-.9-.9s.4-.9.9-.9.9.4.9.9-.4.9-.9.9z" />
      <path d="M21.6 14.1c0-2.6-2.5-4.7-5.6-4.7s-5.6 2.1-5.6 4.7 2.5 4.7 5.6 4.7c.6 0 1.2-.1 1.8-.2l1.9 1-.5-1.6c1.4-.9 2.4-2.1 2.4-3.9zM14.2 13.4c-.4 0-.7-.3-.7-.7s.3-.7.7-.7.7.3.7.7-.3.7-.7.7zm3.6 0c-.4 0-.7-.3-.7-.7s.3-.7.7-.7.7.3.7.7-.3.7-.7.7z" />
    </svg>
  )
}

/* ---------- 密码输入（带可见切换） ---------- */

function PasswordInput(props: {
  id: string
  value: string
  placeholder: string
  autoComplete: string
  invalid: boolean
  onChange: (v: string) => void
}) {
  const [show, setShow] = useState(false)
  return (
    <div className="auth-control">
      <input
        id={props.id}
        className="auth-input"
        type={show ? 'text' : 'password'}
        placeholder={props.placeholder}
        value={props.value}
        autoComplete={props.autoComplete}
        aria-invalid={props.invalid || undefined}
        onChange={(e) => props.onChange(e.target.value)}
      />
      <button
        type="button"
        className="auth-eye"
        onClick={() => setShow((v) => !v)}
        aria-label={show ? '隐藏密码' : '显示密码'}
        aria-pressed={show}
        tabIndex={-1}
      >
        {show ? <EyeOffIcon /> : <EyeIcon />}
      </button>
    </div>
  )
}

/* ---------- 认证页 ---------- */

export function AuthPage() {
  const auth = useAuth()
  const [view, setView] = useState<View>(auth.loginMode === 'forgot' ? 'forgot' : auth.loginMode)
  const [username, setUsername] = useState(auth.prefillUsername)
  const [nickname, setNickname] = useState('')
  const [password, setPassword] = useState('')
  const [inviteCode, setInviteCode] = useState('')
  const [remember, setRemember] = useState(true)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [done, setDone] = useState('') // 重置成功提示
  const [inviteRequired, setInviteRequired] = useState(false)
  const [configFailed, setConfigFailed] = useState(false)
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<FieldKey, true>>>({})
  const [toast, setToast] = useState<{ text: string; tone: 'ok' | 'warn' } | null>(null)
  const toastTimer = useRef<number | undefined>(undefined)

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

  useEffect(() => () => window.clearTimeout(toastTimer.current), [])

  function showToast(text: string, tone: 'ok' | 'warn' = 'warn') {
    setToast({ text, tone })
    window.clearTimeout(toastTimer.current)
    toastTimer.current = window.setTimeout(() => setToast(null), 2600)
  }

  /* ---- Tab 指示条定位 ---- */
  const tabRefs = useRef<Record<'login' | 'register', HTMLButtonElement | null>>({ login: null, register: null })
  const indicatorRef = useRef<HTMLSpanElement>(null)

  function positionIndicator() {
    const ind = indicatorRef.current
    const tab = tabRefs.current[view === 'forgot' ? 'login' : view]
    if (!ind || !tab) return
    ind.style.width = `${tab.offsetWidth}px`
    ind.style.transform = `translateX(${tab.offsetLeft}px)`
  }

  useLayoutEffect(positionIndicator, [view])

  useEffect(() => {
    window.addEventListener('resize', positionIndicator)
    return () => window.removeEventListener('resize', positionIndicator)
  }, [])

  /* ---- 校验 ---- */
  const validUsername = USERNAME_RE.test(username.trim())
  const validPassword = password.length >= 8
  /** 昵称可选：留空则服务端回退用户名；填写则 ≤ 30 字符 */
  const validNickname = nickname.trim().length <= NICKNAME_MAX
  const showInvite = view === 'forgot' || (view === 'register' && (inviteRequired || configFailed))
  /** 忘记密码必填邀请码；注册时仅服务端明确要求（inviteRequired）才必填，configFailed 时可留空 */
  const inviteMissing =
    (view === 'forgot' && inviteCode.trim().length === 0) ||
    (view === 'register' && inviteRequired && inviteCode.trim().length === 0)
  const canSubmit = validUsername && validPassword && validNickname && !inviteMissing && !busy

  function clearFieldError(key: FieldKey) {
    setFieldErrors((prev) => {
      if (!(key in prev)) return prev
      const next = { ...prev }
      delete next[key]
      return next
    })
  }

  function switchView(v: View) {
    setView(v)
    setErr('')
    setDone('')
    setFieldErrors({})
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!canSubmit) {
      const errs: Partial<Record<FieldKey, true>> = {}
      if (!validUsername) errs.username = true
      if (!validPassword) errs.password = true
      if (!validNickname) errs.nickname = true
      if (inviteMissing) errs.invite = true
      setFieldErrors(errs)
      return
    }
    setBusy(true)
    setErr('')
    setDone('')
    try {
      if (view === 'login') {
        await auth.login({ username: username.trim(), password, remember })
      } else if (view === 'register') {
        await auth.register({
          username: username.trim(),
          nickname: nickname.trim(),
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

  const submitLabel = view === 'login' ? '登 录' : view === 'register' ? '注册并登录' : '重置密码'
  const panelHead =
    view === 'login'
      ? { h2: '欢迎回来', p: '登录你的账户，继续未完成的工作' }
      : view === 'register'
        ? { h2: '创建账户', p: '注册后即可开启需求、待办与多端同步' }
        : { h2: '重置密码', p: '个人服务无邮件通道：凭用户名 + 邀请码验证身份后设置新密码' }

  return (
    <div className="auth-shell">
      {/* 左侧品牌面板（移动端隐藏） */}
      <aside className="auth-brand" aria-label="产品介绍">
        <div className="auth-brand-inner">
          <div className="auth-brand-logo">
            <span className="auth-brand-mark" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <rect x="2" y="6" width="20" height="12" rx="2" />
                <path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M8 14h8" />
              </svg>
            </span>
            <span className="auth-brand-name">开发工作台</span>
          </div>
          <h1>
            把复杂留给我们，
            <br />
            <em>把时间还给你。</em>
          </h1>
          <p className="auth-brand-lead">需求管理 · 今日待办 · 数据统计，一个账户串联你的完整工作流。</p>
          <div className="auth-brand-trust">
            <div>
              <strong>30s</strong>
              <span>自动云同步</span>
            </div>
            <div>
              <strong>90 天</strong>
              <span>软删可恢复</span>
            </div>
            <div>
              <strong>本地优先</strong>
              <span>断网可用</span>
            </div>
          </div>
        </div>
        <div className="auth-brand-footer">© 2026 dev-workbench · 本地优先 · 数据自主</div>
      </aside>

      {/* 右侧表单面板 */}
      <main className="auth-form-panel">
        <div className="auth-card">
          {view !== 'forgot' ? (
            <div className="auth-tabs" role="tablist" aria-label="认证方式">
              {(['login', 'register'] as const).map((v) => (
                <button
                  key={v}
                  ref={(el) => {
                    tabRefs.current[v] = el
                  }}
                  type="button"
                  role="tab"
                  className="auth-tab"
                  aria-selected={view === v}
                  tabIndex={view === v ? 0 : -1}
                  onClick={() => switchView(v)}
                  onKeyDown={(e) => {
                    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
                    const next = e.key === 'ArrowRight' ? 'register' : 'login'
                    switchView(next)
                    tabRefs.current[next]?.focus()
                  }}
                >
                  {v === 'login' ? '登录' : '注册'}
                </button>
              ))}
              <span className="auth-tab-indicator" ref={indicatorRef} aria-hidden="true" />
            </div>
          ) : null}

          <section className="auth-panel" key={view}>
            <div className="auth-panel-head">
              <h2>{panelHead.h2}</h2>
              <p>{panelHead.p}</p>
            </div>

            {err && <div className="auth-banner err" role="alert">{err}</div>}
            {done && <div className="auth-banner ok" role="status">{done}</div>}

            <form onSubmit={submit} noValidate>
              <div className="auth-field">
                <label htmlFor="auth-username">用户名</label>
                <div className="auth-control">
                  <input
                    id="auth-username"
                    className="auth-input"
                    placeholder="3-20 位小写字母 / 数字 / 下划线"
                    value={username}
                    autoComplete="username"
                    autoFocus
                    spellCheck={false}
                    aria-invalid={fieldErrors.username || undefined}
                    onChange={(e) => {
                      setUsername(e.target.value)
                      clearFieldError('username')
                    }}
                  />
                </div>
                <p className={`auth-error${fieldErrors.username ? ' show' : ''}`} id="auth-username-err">
                  用户名需为 3-20 位小写字母、数字或下划线
                </p>
              </div>

              {view === 'register' && (
                <div className="auth-field">
                  <label htmlFor="auth-nickname">昵称（可选）</label>
                  <div className="auth-control">
                    <input
                      id="auth-nickname"
                      className="auth-input"
                      placeholder={`≤ ${NICKNAME_MAX} 字符，默认与用户名相同`}
                      value={nickname}
                      maxLength={NICKNAME_MAX}
                      spellCheck={false}
                      aria-invalid={fieldErrors.nickname || undefined}
                      onChange={(e) => {
                        setNickname(e.target.value)
                        clearFieldError('nickname')
                      }}
                    />
                  </div>
                  <p className={`auth-error${fieldErrors.nickname ? ' show' : ''}`} id="auth-nickname-err">
                    昵称最多 {NICKNAME_MAX} 字符
                  </p>
                </div>
              )}

              <div className="auth-field">
                <label htmlFor="auth-password">{view === 'forgot' ? '新密码' : '密码'}</label>
                <PasswordInput
                  id="auth-password"
                  value={password}
                  placeholder="≥ 8 位"
                  autoComplete={view === 'login' ? 'current-password' : 'new-password'}
                  invalid={!!fieldErrors.password}
                  onChange={(v) => {
                    setPassword(v)
                    clearFieldError('password')
                  }}
                />
                <p className={`auth-error${fieldErrors.password ? ' show' : ''}`} id="auth-password-err">
                  密码至少 8 位
                </p>
              </div>

              {showInvite && (
                <div className="auth-field">
                  <label htmlFor="auth-invite">邀请码</label>
                  <div className="auth-control">
                    <input
                      id="auth-invite"
                      className="auth-input"
                      placeholder={view === 'forgot' ? '注册时使用的邀请码' : configFailed ? '邀请码（如不确定请留空）' : '联系管理员获取'}
                      value={inviteCode}
                      spellCheck={false}
                      aria-invalid={fieldErrors.invite || undefined}
                      onChange={(e) => {
                        setInviteCode(e.target.value)
                        clearFieldError('invite')
                      }}
                    />
                  </div>
                  <p className={`auth-error${fieldErrors.invite ? ' show' : ''}`} id="auth-invite-err">
                    {view === 'forgot' ? '请输入注册时使用的邀请码' : '请输入邀请码'}
                  </p>
                </div>
              )}

              {view !== 'forgot' && (
                <div className="auth-row">
                  <label className="auth-check">
                    <input
                      type="checkbox"
                      checked={remember}
                      onChange={(e) => setRemember(e.target.checked)}
                    />
                    <span className="auth-check-box" aria-hidden="true">
                      <svg viewBox="0 0 12 12">
                        <path d="M2 6.5L4.8 9 10 3" />
                      </svg>
                    </span>
                    保持登录（30 天）
                  </label>
                  {view === 'login' && (
                    <button type="button" className="auth-link" onClick={() => switchView('forgot')}>
                      忘记密码？
                    </button>
                  )}
                </div>
              )}

              <button type="submit" className={`auth-submit${busy ? ' loading' : ''}`}>
                {submitLabel}
                <span className="auth-spinner" aria-hidden="true" />
              </button>
            </form>

            {/* 微信登录占位（保留入口，暂未开发） */}
            {view === 'login' && (
              <>
                <div className="auth-divider">或使用以下方式登录</div>
                <div className="auth-social">
                  <button type="button" className="auth-social-btn" onClick={() => showToast('微信登录开发中', 'warn')}>
                    <WeChatIcon />
                    <span>微信登录</span>
                  </button>
                </div>
              </>
            )}

            <p className="auth-switch">
              {view === 'login' && (
                <>
                  还没有账户？
                  <button type="button" onClick={() => switchView('register')}>
                    立即注册
                  </button>
                </>
              )}
              {view === 'register' && (
                <>
                  已有账户？
                  <button type="button" onClick={() => switchView('login')}>
                    直接登录
                  </button>
                </>
              )}
              {view === 'forgot' && (
                <button type="button" onClick={() => switchView('login')}>
                  ← 返回登录
                </button>
              )}
            </p>
          </section>

          {/* 本地模式入口 */}
          <div className="auth-local">
            <button type="button" onClick={auth.enterLocalMode}>
              暂不登录，使用本地模式（数据不同步）
            </button>
          </div>
        </div>

        {/* Toast */}
        <div className={`auth-toast${toast ? ' show' : ''}${toast?.tone === 'ok' ? ' ok' : ''}`} role="status" aria-live="polite">
          <span className="dot" aria-hidden="true" />
          <span>{toast?.text ?? ''}</span>
        </div>
      </main>
    </div>
  )
}
