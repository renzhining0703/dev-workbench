import { useEffect, useState } from 'react'
import { Modal } from './ui'
import { useAuth } from '../store/AuthContext'

/**
 * 登录 / 注册弹窗
 *
 * - 默认显示「登录」；通过 mode prop 切到「注册」
 * - 注册时显示邀请码输入框（服务端 INVITE_CODE 未配置时不显示）
 * - 错误由 useAuth().notify() toast；本组件只显示 inline 错误
 */
interface Props {
  open: boolean
  /** 服务端是否需要邀请码（读 build-time env，由调用方传入） */
  inviteRequired?: boolean
}

const USERNAME_RE = /^[a-z0-9_]{3,20}$/

export function LoginModal({ open, inviteRequired = false }: Props) {
  const auth = useAuth()
  const [mode, setMode] = useState<'login' | 'register'>(auth.loginMode)
  const [username, setUsername] = useState(auth.prefillUsername)
  const [password, setPassword] = useState('')
  const [inviteCode, setInviteCode] = useState('')
  const [remember, setRemember] = useState(true)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  // 弹窗打开时根据 auth 状态切换表单
  useEffect(() => {
    if (open) {
      setMode(auth.loginMode)
      setUsername(auth.prefillUsername)
      setPassword('')
      setInviteCode('')
      setErr('')
    }
  }, [open, auth.loginMode, auth.prefillUsername])

  const validUsername = USERNAME_RE.test(username.trim())
  const validPassword = password.length >= 8
  const validInvite = !inviteRequired || inviteCode.trim().length > 0
  const canSubmit = validUsername && validPassword && validInvite && !busy

  async function submit() {
    if (!canSubmit) return
    setBusy(true)
    setErr('')
    try {
      if (mode === 'login') {
        await auth.login({ username: username.trim(), password, remember })
      } else {
        await auth.register({
          username: username.trim(),
          password,
          inviteCode: inviteCode.trim(),
          remember,
        })
      }
    } catch {
      // 错误已在 AuthContext 内通过 notify toast 弹出；这里只在表单内显示一句简洁版
      setErr(mode === 'login' ? '登录失败，请检查后重试' : '注册失败，请检查后重试')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open={open} onClose={auth.hideLogin} title="登录 / 同步数据" width="max-w-sm">
      <div className="space-y-4">
        {/* tab 切换 */}
        <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-1 dark:border-slate-700 dark:bg-slate-800">
          {(['login', 'register'] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${
                mode === m
                  ? 'bg-white text-indigo-600 shadow-sm dark:bg-slate-700 dark:text-indigo-400'
                  : 'text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'
              }`}
            >
              {m === 'login' ? '登录' : '注册'}
            </button>
          ))}
        </div>

        {err && (
          <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-600 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-400">
            {err}
          </div>
        )}

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
          <label className="label">密码</label>
          <input
            className="input"
            type="password"
            placeholder="≥ 8 位"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
          />
          {!validPassword && password.length > 0 && (
            <p className="mt-1 text-xs text-rose-500">密码至少 8 位</p>
          )}
        </div>

        {mode === 'register' && inviteRequired && (
          <div>
            <label className="label">邀请码</label>
            <input
              className="input"
              placeholder="联系管理员获取"
              value={inviteCode}
              onChange={(e) => setInviteCode(e.target.value)}
              spellCheck={false}
            />
          </div>
        )}

        <label className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
          <input
            type="checkbox"
            checked={remember}
            onChange={(e) => setRemember(e.target.checked)}
            className="h-3.5 w-3.5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
          />
          保持登录（30 天）
        </label>
      </div>

      <div className="mt-6 flex justify-end gap-2">
        <button className="btn-ghost" onClick={auth.hideLogin}>
          取消
        </button>
        <button className="btn-primary" disabled={!canSubmit} onClick={submit}>
          {busy ? '…' : mode === 'login' ? '登录' : '注册并登录'}
        </button>
      </div>
    </Modal>
  )
}