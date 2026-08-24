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
    color: 'text-emerald-600 dark:text-emerald-400',
    bg: 'bg-emerald-50 dark:bg-emerald-500/10',
    label: '已同步',
  },
  syncing: {
    color: 'text-indigo-600 dark:text-indigo-400',
    bg: 'bg-indigo-50 dark:bg-indigo-500/10',
    label: '同步中…',
    spin: true,
  },
  offline: {
    color: 'text-amber-600 dark:text-amber-400',
    bg: 'bg-amber-50 dark:bg-amber-500/10',
    label: '离线',
  },
  error: {
    color: 'text-rose-600 dark:text-rose-400',
    bg: 'bg-rose-50 dark:bg-rose-500/10',
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
        className={`flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 transition hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800 sm:h-9 sm:w-9 ${meta.color}`}
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
          className="absolute right-0 top-full z-50 mt-1.5 w-64 rounded-xl border border-slate-200 bg-white p-3 shadow-lg dark:border-slate-700 dark:bg-slate-800"
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
            <span className="text-sm font-medium text-slate-700 dark:text-slate-200">
              {meta.label}
            </span>
          </div>
          <dl className="space-y-1 text-xs text-slate-500 dark:text-slate-400">
            <div className="flex justify-between">
              <dt>最近同步</dt>
              <dd className="text-slate-700 dark:text-slate-300">{fmtTime(state.lastSyncAt)}</dd>
            </div>
            <div className="flex justify-between">
              <dt>本地变更</dt>
              <dd className={state.pendingChanges ? 'text-amber-600 dark:text-amber-400' : 'text-slate-700 dark:text-slate-300'}>
                {state.pendingChanges ? '有未同步' : '无'}
              </dd>
            </div>
            {state.lastError && (
              <div className="mt-1 rounded bg-rose-50 px-2 py-1 text-rose-600 dark:bg-rose-500/10 dark:text-rose-400">
                {state.lastError}
              </div>
            )}
          </dl>
          <button
            type="button"
            onClick={handleSyncNow}
            disabled={state.status === 'syncing'}
            className="btn-primary mt-3 w-full text-xs disabled:opacity-50"
          >
            {state.pendingChanges ? '立即推送' : '立即拉取'}
          </button>
        </div>
      )}
    </div>
  )
}
