import { useEffect, useRef, useState } from 'react'
import type { SyncHandle, SyncState } from '../lib/sync'

/**
 * 顶栏同步状态徽章
 *
 * - idle: 灰色 ✓
 * - syncing: 蓝色转圈
 * - offline: 橙色 ⚠
 * - error: 红色 ✕
 *
 * 点击 / hover 弹 Popover：显示 lastSyncAt / pendingChanges / 手动同步按钮
 */

interface Props {
  sync: SyncHandle
}

const STATE_META: Record<
  SyncState['status'],
  { color: string; bg: string; label: string; spin?: boolean }
> = {
  idle: {
    color: 'text-emerald-300',
    bg: 'bg-emerald-500/15',
    label: '已同步',
  },
  syncing: {
    color: 'text-sky-300',
    bg: 'bg-sky-500/15',
    label: '同步中…',
    spin: true,
  },
  offline: {
    color: 'text-amber-300',
    bg: 'bg-amber-500/15',
    label: '离线',
  },
  error: {
    color: 'text-rose-300',
    bg: 'bg-rose-500/15',
    label: '同步出错',
  },
}

function fmtTime(iso: string | null): string {
  if (!iso) return '从未'
  try {
    const d = new Date(iso)
    return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  } catch {
    return iso
  }
}

export function SyncBadge({ sync }: Props) {
  const [state, setState] = useState<SyncState>(() => sync.getState())
  const [open, setOpen] = useState(false)
  const popRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    return sync.subscribe(setState)
  }, [sync])

  // 点外面关闭
  useEffect(() => {
    if (!open) return
    const onClick = (e: MouseEvent) => {
      if (popRef.current && !popRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    window.addEventListener('mousedown', onClick)
    return () => window.removeEventListener('mousedown', onClick)
  }, [open])

  const meta = STATE_META[state.status]

  const handleSyncNow = () => {
    if (state.pendingChanges) {
      void sync.pushNow()
    } else {
      void sync.pullNow()
    }
    setOpen(false)
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title={meta.label}
        aria-label={meta.label}
        className={`wb-icon-btn ${meta.color}`}
      >
        {state.status === 'idle' && (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M20 6 9 17l-5-5" />
          </svg>
        )}
        {state.status === 'syncing' && (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="animate-spin">
            <path d="M21 12a9 9 0 1 1-6.219-8.56" />
          </svg>
        )}
        {state.status === 'offline' && (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0zM12 9v4M12 17h.01" />
          </svg>
        )}
        {state.status === 'error' && (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <path d="M15 9l-6 6M9 9l6 6" />
          </svg>
        )}
      </button>

      {open && (
        <div
          ref={popRef}
          className="wb-card absolute right-0 top-full z-50 mt-1.5 w-64 p-3"
        >
          <div className="mb-2 flex items-center gap-2">
            <span className={`flex h-7 w-7 items-center justify-center rounded-lg ${meta.bg} ${meta.color}`}>
              {meta.spin ? (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="animate-spin">
                  <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                </svg>
              ) : (
                <span className="text-xs font-semibold">{meta.label.charAt(0)}</span>
              )}
            </span>
            <span className="text-sm font-medium" style={{ color: 'var(--wb-ink)' }}>
              {meta.label}
            </span>
          </div>
          <dl className="space-y-1 text-xs" style={{ color: 'var(--wb-ink-2)' }}>
            <div className="flex justify-between">
              <dt>最近同步</dt>
              <dd style={{ color: 'var(--wb-ink)' }}>{fmtTime(state.lastSyncAt)}</dd>
            </div>
            <div className="flex justify-between">
              <dt>本地变更</dt>
              <dd className={state.pendingChanges ? 'font-medium' : ''} style={{ color: state.pendingChanges ? 'var(--wb-warn)' : 'var(--wb-ink)' }}>
                {state.pendingChanges ? '有未同步' : '无'}
              </dd>
            </div>
            {state.lastError && (
              <div
                className="mt-1 rounded px-2 py-1"
                style={{ background: 'var(--wb-danger-soft)', color: 'var(--wb-danger)' }}
              >
                {state.lastError}
              </div>
            )}
          </dl>
          <button
            type="button"
            onClick={handleSyncNow}
            disabled={state.status === 'syncing'}
            className="wb-btn-primary mt-3 w-full justify-center text-xs disabled:opacity-50"
          >
            {state.pendingChanges ? '立即推送' : '立即拉取'}
          </button>
        </div>
      )}
    </div>
  )
}
