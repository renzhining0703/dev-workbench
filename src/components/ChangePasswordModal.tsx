import { useState } from 'react'
import { Modal } from './ui'
import { useAuth } from '../store/AuthContext'
import { AuthError } from '../lib/authClient'

/**
 * 修改密码弹窗（用户菜单入口）
 *
 * - 需验证旧密码；新密码 ≥ 8 位且两次输入一致
 * - 成功后当前会话保持有效，直接关闭
 */
interface Props {
  open: boolean
  onClose: () => void
}

export function ChangePasswordModal({ open, onClose }: Props) {
  const auth = useAuth()
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [okMsg, setOkMsg] = useState('')

  const validCurrent = currentPassword.length > 0
  const validNew = newPassword.length >= 8
  const validConfirm = confirmPassword === newPassword && newPassword.length > 0
  const canSubmit = validCurrent && validNew && validConfirm && !busy

  function close() {
    setCurrentPassword('')
    setNewPassword('')
    setConfirmPassword('')
    setErr('')
    setOkMsg('')
    onClose()
  }

  async function submit() {
    if (!canSubmit) return
    setBusy(true)
    setErr('')
    try {
      await auth.changePassword({ currentPassword, newPassword })
      setOkMsg('密码已更新')
      window.setTimeout(close, 900)
    } catch (e) {
      if (e instanceof AuthError) {
        if (e.message === 'invalid credentials') setErr('当前密码不正确')
        else if (e.message === 'too many attempts') setErr('尝试过于频繁，请稍后再试')
        else setErr(e.message)
      } else {
        setErr('修改失败：网络错误')
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open={open} onClose={close} title="修改密码" width="max-w-sm">
      <div className="space-y-4">
        {err && (
          <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-600 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-400">
            {err}
          </div>
        )}
        {okMsg && (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-400">
            {okMsg}
          </div>
        )}

        <div>
          <label className="label">当前密码</label>
          <input
            className="input"
            type="password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            autoComplete="current-password"
            autoFocus
          />
        </div>

        <div>
          <label className="label">新密码</label>
          <input
            className="input"
            type="password"
            placeholder="≥ 8 位"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            autoComplete="new-password"
          />
          {!validNew && newPassword.length > 0 && (
            <p className="mt-1 text-xs text-rose-500">密码至少 8 位</p>
          )}
        </div>

        <div>
          <label className="label">确认新密码</label>
          <input
            className="input"
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            autoComplete="new-password"
            onKeyDown={(e) => e.key === 'Enter' && submit()}
          />
          {!validConfirm && confirmPassword.length > 0 && (
            <p className="mt-1 text-xs text-rose-500">两次输入不一致</p>
          )}
        </div>
      </div>

      <div className="mt-6 flex justify-end gap-2">
        <button className="btn-ghost" onClick={close}>
          取消
        </button>
        <button className="btn-primary" disabled={!canSubmit} onClick={submit}>
          {busy ? '…' : '确认修改'}
        </button>
      </div>
    </Modal>
  )
}
