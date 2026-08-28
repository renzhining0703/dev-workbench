import { useCallback, useEffect, useState } from 'react'
import { Modal } from './ui'
import { SYNC_API } from '../lib/syncConfig'
import {
  disablePush,
  enablePush,
  fetchVapidPublicKey,
  hasServerSubscription,
  type PushStatus,
} from '../lib/push'

interface Props {
  open: boolean
  onClose: () => void
  /** 登录 token；null（本地模式）时不允许订阅 */
  token: string | null
}

type View =
  | { phase: 'checking' }
  | { phase: 'done'; status: PushStatus; error?: string }
  | { phase: 'busy'; status: PushStatus }

const STATUS_TEXT: Record<PushStatus, { label: string; tone: 'ok' | 'warn' | 'muted' }> = {
  unsupported: { label: '浏览器不支持 Web Push', tone: 'warn' },
  unconfigured: { label: '服务端未配置推送（VAPID）', tone: 'warn' },
  denied: { label: '通知权限已被拒绝', tone: 'warn' },
  off: { label: '未开启', tone: 'muted' },
  on: { label: '已开启', tone: 'ok' },
  error: { label: '发生错误', tone: 'warn' },
}

/**
 * Web Push 推送设置弹窗
 * 说明：每日 09:05 服务器推送「今日待上线需求 / 未完成待办」提醒，
 *       浏览器关闭也能收到（走系统通知）。
 */
export function PushModal({ open, onClose, token }: Props) {
  const [view, setView] = useState<View>({ phase: 'checking' })

  const probe = useCallback(async () => {
    if (!token) {
      setView({ phase: 'done', status: 'unsupported', error: '未登录' })
      return
    }
    if (
      !('serviceWorker' in navigator) ||
      !('PushManager' in window) ||
      !('Notification' in window)
    ) {
      setView({ phase: 'done', status: 'unsupported' })
      return
    }
    const publicKey = await fetchVapidPublicKey()
    if (!publicKey) {
      setView({ phase: 'done', status: 'unconfigured' })
      return
    }
    if (Notification.permission === 'denied') {
      setView({ phase: 'done', status: 'denied' })
      return
    }
    const subscribed = await hasServerSubscription(token)
    setView({ phase: 'done', status: subscribed ? 'on' : 'off' })
  }, [token])

  useEffect(() => {
    if (open) {
      setView({ phase: 'checking' })
      void probe()
    }
  }, [open, probe])

  const turnOn = async () => {
    if (!token) return
    setView({ phase: 'busy', status: 'off' })
    const r = await enablePush(token)
    setView({ phase: 'done', ...r })
  }

  const turnOff = async () => {
    if (!token) return
    setView({ phase: 'busy', status: 'on' })
    const ok = await disablePush(token)
    setView({ phase: 'done', status: ok ? 'off' : 'error', error: ok ? undefined : '退订失败，请重试' })
  }

  const status = view.phase === 'checking' ? null : STATUS_TEXT[view.status]
  const busy = view.phase === 'busy'
  const syncing = view.phase === 'checking'

  return (
    <Modal open={open} onClose={onClose} title="推送提醒" width="max-w-md">
      <div className="space-y-4">
        {/* 说明 */}
        <div className="rounded-xl border px-4 py-3 text-xs leading-relaxed" style={{ borderColor: 'var(--wb-line)', background: 'var(--wb-surface-2)' }}>
          <p style={{ color: 'var(--wb-ink-2)' }}>
            每天 <b style={{ color: 'var(--wb-ink)' }}>09:05</b> 推送一次「今日待上线需求 / 未完成待办」摘要。
            浏览器<strong>关闭也能收到</strong>（走系统通知），比页面内桌面提醒更可靠。
          </p>
          <p className="mt-1" style={{ color: 'var(--wb-ink-3)' }}>
            点击通知直接跳转到今日待办视图。需要登录账号使用，数据绑定当前账号。
          </p>
        </div>

        {/* 状态 */}
        {!syncing && status && (
          <div className="flex items-center gap-2.5">
            <span
              className="inline-block h-2 w-2 rounded-full"
              style={{
                background:
                  status.tone === 'ok'
                    ? 'var(--wb-success)'
                    : status.tone === 'warn'
                      ? 'var(--wb-accent)'
                      : 'var(--wb-ink-3)',
              }}
            />
            <span className="text-sm" style={{ color: 'var(--wb-ink)' }}>
              当前状态：{status.label}
            </span>
          </div>
        )}
        {syncing && (
          <div className="flex items-center gap-2.5 text-sm" style={{ color: 'var(--wb-ink-2)' }}>
            <span className="h-3.5 w-3.5 animate-spin rounded-full border-2" style={{ borderColor: 'var(--wb-brand-400) var(--wb-line) var(--wb-line) var(--wb-line)' }} />
            正在检测推送能力…
          </div>
        )}

        {/* 错误提示与引导 */}
        {!syncing && view.phase === 'done' && view.error && (
          <div className="rounded-lg px-3 py-2 text-xs" style={{ background: 'var(--wb-warn-soft)', color: 'var(--wb-warn)' }}>
            {view.error}
          </div>
        )}
        {!syncing && view.status === 'denied' && (
          <div className="rounded-lg px-3 py-2 text-xs" style={{ background: 'var(--wb-warn-soft)', color: 'var(--wb-warn)' }}>
            点击地址栏左侧的站点设置图标，把「通知」改为允许，再回到本页重新开启。
          </div>
        )}
        {!syncing && view.status === 'unconfigured' && (
          <div className="rounded-lg px-3 py-2 text-xs leading-relaxed" style={{ background: 'var(--wb-warn-soft)', color: 'var(--wb-warn)' }}>
            服务端还没配置推送密钥（VAPID）。在服务器执行：
            <code className="block rounded bg-black/10 px-1.5 py-0.5 font-mono" style={{ fontSize: 11 }}>
              cd /var/www/dev-workbench-sync && npx web-push generate-vapid-keys
            </code>
            并把输出的 VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY 写入 data/env.local 后重启服务。
          </div>
        )}
        {!syncing && view.status === 'unsupported' && !token && (
          <div className="rounded-lg px-3 py-2 text-xs" style={{ background: 'var(--wb-warn-soft)', color: 'var(--wb-warn)' }}>
            推送绑定账号，请先登录（本地模式不支持）。
          </div>
        )}

        {/* 操作按钮 */}
        <div className="flex justify-end gap-2 border-t pt-4" style={{ borderColor: 'var(--wb-line)' }}>
          {!syncing && view.phase === 'done' && (
            view.status === 'on' ? (
              <button className="wb-btn" onClick={turnOff} disabled={busy}>
                {busy ? '处理中…' : '关闭推送'}
              </button>
            ) : (
              <button className="wb-btn-primary" onClick={turnOn} disabled={busy}>
                {busy ? '处理中…' : '开启推送'}
              </button>
            )
          )}
        </div>

        {!syncing && view.status === 'on' && (
          <p className="text-[11px]" style={{ color: 'var(--wb-ink-3)' }}>
            当前账号 {SYNC_API ? '' : '（未配置同步 API 时无法推送）'}已订阅；如需测试，可在服务器手动执行
            <code className="mx-1 rounded bg-black/10 px-1 font-mono" style={{ fontSize: 10 }}>
              node scripts/push-daily.mjs
            </code>
            立即推送一条。
          </p>
        )}
      </div>
    </Modal>
  )
}
