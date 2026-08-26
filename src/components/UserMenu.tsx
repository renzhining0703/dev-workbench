import { useEffect, useRef, useState } from 'react'
import { useAuth } from '../store/AuthContext'
import { ConfirmDialog } from './ui'
import { ChangePasswordModal } from './ChangePasswordModal'
import { NicknameModal } from './NicknameModal'
import type { SyncHandle, SyncState } from '../lib/sync'
import { SyncBadge } from './SyncBadge'

/**
 * 已登录用户菜单：
 *   - 圆形头像（首字母）
 *   - 下拉：用户名 + 立即同步 + 修改密码 + 退出登录
 *   - 嵌入 SyncBadge（同位置）
 */
interface Props {
  sync: SyncHandle
}

export function UserMenu({ sync }: Props) {
  const auth = useAuth()
  const [open, setMenuOpen] = useState(false)
  const [confirmLogout, setConfirmLogout] = useState(false)
  const [changePwOpen, setChangePwOpen] = useState(false)
  const [nicknameOpen, setNicknameOpen] = useState(false)
  const popRef = useRef<HTMLDivElement>(null)
  const [syncState, setSyncState] = useState<SyncState>(() => sync.getState())

  useEffect(() => sync.subscribe(setSyncState), [sync])

  // 点外面关闭
  useEffect(() => {
    if (!open) return
    const onClick = (e: MouseEvent) => {
      if (popRef.current && !popRef.current.contains(e.target as Node)) {
        setMenuOpen(false)
      }
    }
    window.addEventListener('mousedown', onClick)
    return () => window.removeEventListener('mousedown', onClick)
  }, [open])

  if (!auth.session) return null

  const initial = auth.session.user.username.charAt(0).toUpperCase()

  const doSync = () => {
    if (syncState.pendingChanges) void sync.pushNow()
    else void sync.pullNow()
    setMenuOpen(false)
  }

  const doLogout = () => {
    setConfirmLogout(false)
    setMenuOpen(false)
    void auth.logout()
  }

  return (
    <>
      <div className="relative flex items-center gap-1">
        <SyncBadge sync={sync} />
        <button
          type="button"
          onClick={() => setMenuOpen((v) => !v)}
          className="wb-avatar"
          title={auth.session.user.username}
          aria-label="用户菜单"
        >
          <span className="wb-avatar-badge">{initial}</span>
          <span className="hidden sm:inline">
            {auth.session.user.nickname || auth.session.user.username}
          </span>
        </button>

        {open && (
          <div
            ref={popRef}
            className="wb-card absolute right-0 top-full z-50 mt-1.5 w-56 py-1"
          >
            <div className="px-3 py-2 text-xs" style={{ color: 'var(--wb-ink-3)' }}>
              已登录为 <span className="font-medium" style={{ color: 'var(--wb-ink)' }}>{auth.session.user.nickname || auth.session.user.username}</span>
            </div>
            <div className="my-1 border-t" style={{ borderColor: 'var(--wb-line)' }} />
            <button
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition hover:bg-[var(--wb-surface-2)]"
              style={{ color: 'var(--wb-ink-2)' }}
              onClick={doSync}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M23 4v6h-6M1 20v-6h6" />
                <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
              </svg>
              立即同步
            </button>
            <button
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition hover:bg-[var(--wb-surface-2)]"
              style={{ color: 'var(--wb-ink-2)' }}
              onClick={() => {
                setMenuOpen(false)
                setNicknameOpen(true)
              }}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M17 3a2.8 2.8 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
              </svg>
              修改昵称
            </button>
            <button
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition hover:bg-[var(--wb-surface-2)]"
              style={{ color: 'var(--wb-ink-2)' }}
              onClick={() => {
                setMenuOpen(false)
                setChangePwOpen(true)
              }}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="11" width="18" height="11" rx="2" />
                <path d="M7 11V7a5 5 0 0 1 10 0v4" />
              </svg>
              修改密码
            </button>
            <button
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition hover:bg-[var(--wb-surface-2)]"
              style={{ color: 'var(--wb-ink-2)' }}
              onClick={() => {
                setMenuOpen(false)
                setConfirmLogout(true)
              }}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" />
              </svg>
              退出登录
            </button>
          </div>
        )}
      </div>

      <ChangePasswordModal open={changePwOpen} onClose={() => setChangePwOpen(false)} />

      <NicknameModal open={nicknameOpen} onClose={() => setNicknameOpen(false)} />

      <ConfirmDialog
        open={confirmLogout}
        title="确认退出登录？"
        message={`退出后数据仍保留在本地与云端，重新登录「${auth.session?.user.username ?? ''}」即可恢复同步。`}
        confirmLabel="退出登录"
        onCancel={() => setConfirmLogout(false)}
        onConfirm={doLogout}
      />
    </>
  )
}