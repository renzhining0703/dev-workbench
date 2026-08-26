import { useEffect, useState } from 'react'
import { Modal } from './ui'
import { useAuth } from '../store/AuthContext'
import { AuthError } from '../lib/authClient'

/**
 * 修改昵称弹窗（用户菜单入口）
 *
 * - 初始值 = 当前昵称；校验非空、≤ 30 字符、且与当前值不同
 * - 成功后由 AuthContext 同步本地 session 并持久化（含 notify），此处直接关闭
 */
interface Props {
  open: boolean
  onClose: () => void
}

const NICKNAME_MAX = 30

export function NicknameModal({ open, onClose }: Props) {
  const auth = useAuth()
  const current = auth.session?.user.nickname ?? ''
  const [nickname, setNickname] = useState(current)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  // 打开时重置为最新昵称（换用户/改成功后重开都能拿到当前值）
  useEffect(() => {
    if (open) setNickname(auth.session?.user.nickname ?? '')
  }, [open, auth.session?.user.nickname])

  const trimmed = nickname.trim()
  const valid = trimmed.length > 0 && trimmed.length <= NICKNAME_MAX && trimmed !== current
  const canSubmit = valid && !busy

  function close() {
    setErr('')
    onClose()
  }

  async function submit() {
    if (!canSubmit) return
    setBusy(true)
    setErr('')
    try {
      await auth.updateNickname(trimmed)
      close()
    } catch (e) {
      if (e instanceof AuthError) {
        if (e.message === 'invalid credentials') setErr('登录已失效，请重新登录')
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
    <Modal open={open} onClose={close} title="修改昵称" width="max-w-sm">
      <div className="space-y-4">
        {err && (
          <div
            className="rounded-lg border px-3 py-2 text-sm"
            style={{ borderColor: 'var(--wb-line)', background: 'var(--wb-danger-soft)', color: 'var(--wb-danger)' }}
          >
            {err}
          </div>
        )}

        <div>
          <label className="mb-1.5 block text-xs font-medium" style={{ color: 'var(--wb-ink-2)' }}>
            昵称
          </label>
          <input
            className="wb-input"
            value={nickname}
            maxLength={NICKNAME_MAX}
            placeholder={`≤ ${NICKNAME_MAX} 字符`}
            onChange={(e) => setNickname(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
            autoFocus
          />
          <p className="mt-1 text-xs" style={{ color: 'var(--wb-ink-3)' }}>
            将显示在头像旁与欢迎语中；留空回退为用户名
          </p>
          {nickname.length > 0 && !valid && (
            <p className="mt-1 text-xs" style={{ color: 'var(--wb-danger)' }}>
              {nickname.trim().length === 0
                ? '昵称不能为空'
                : nickname.trim().length > NICKNAME_MAX
                  ? `昵称最多 ${NICKNAME_MAX} 字符`
                  : null}
            </p>
          )}
        </div>
      </div>

      <div className="mt-6 flex justify-end gap-2">
        <button className="wb-btn-ghost" onClick={close}>
          取消
        </button>
        <button className="wb-btn-primary" disabled={!canSubmit} onClick={submit}>
          {busy ? '…' : '保存'}
        </button>
      </div>
    </Modal>
  )
}
