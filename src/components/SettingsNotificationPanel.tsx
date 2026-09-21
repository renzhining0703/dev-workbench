import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '../store/AuthContext'
import { Switch } from './ui'
import { SYNC_API } from '../lib/syncConfig'
import {
  disablePush,
  enablePush,
  fetchVapidPublicKey,
  hasServerSubscription,
  type PushStatus,
} from '../lib/push'

/**
 * 设置中心 · 通知面板
 *
 * 两类通知，语义不同，这里分开呈现：
 *  1) 桌面提醒（Notification API）：本机 + 当前浏览器，需用户授权后才能发；
 *     由 TodoPanel（今日上线）与 TodoSummaryReminder（待办汇总）触发。
 *  2) 每日推送（Web Push，服务端 09:05）：绑定账号，浏览器关闭也能收到。
 *
 * 说明：浏览器权限一旦授权，JS 无法主动撤回，因此已授权/已拒绝时开关置灰，
 * 只给出「去哪里改」的引导，避免出现「关了但没关掉」的错觉。
 */

type NotifyPermission = 'unsupported' | 'default' | 'granted' | 'denied'

function readNotifyPermission(): NotifyPermission {
  if (typeof Notification === 'undefined') return 'unsupported'
  return Notification.permission
}

const NOTIFY_HINT: Record<NotifyPermission, string> = {
  unsupported: '当前浏览器不支持桌面通知（或处于非安全上下文），可改用页面内提醒。',
  default: '开启后，「今日上线提醒」与「今日待办汇总」会在本机弹出桌面通知。',
  granted: '已授权。浏览器不允许网页主动撤回权限，如需关闭请到站点设置里修改。',
  denied: '权限已被拒绝。点击地址栏左侧的站点设置图标，把「通知」改为允许后回到本页。',
}

/* ---------------- 桌面提醒 ---------------- */

function DesktopNotifySection() {
  const [permission, setPermission] = useState<NotifyPermission>(readNotifyPermission)
  const [busy, setBusy] = useState(false)

  const request = useCallback(async () => {
    if (typeof Notification === 'undefined') return
    if (Notification.permission === 'denied') {
      setPermission('denied')
      return
    }
    setBusy(true)
    try {
      const p = await Notification.requestPermission()
      setPermission(p)
    } finally {
      setBusy(false)
    }
  }, [])

  const locked = permission === 'unsupported' || permission === 'granted' || permission === 'denied'
  const warn = permission === 'denied' || permission === 'unsupported'

  return (
    <section>
      <h4 className="mb-2 text-sm font-semibold" style={{ color: 'var(--wb-ink)' }}>
        桌面提醒
      </h4>
      <div className="wb-set-card">
        <div className="wb-set-row">
          <div className="min-w-0 flex-1">
            <p className="text-sm" style={{ color: 'var(--wb-ink)' }}>
              上线提醒与待办汇总
            </p>
            <p className="mt-0.5 text-xs leading-relaxed" style={{ color: 'var(--wb-ink-3)' }}>
              {NOTIFY_HINT[permission]}
            </p>
          </div>
          <Switch
            checked={permission === 'granted'}
            disabled={locked || busy}
            label="桌面提醒"
            onChange={() => void request()}
          />
        </div>
        {warn && (
          <div
            className="mx-3.5 mb-3 rounded-lg px-3 py-2 text-xs leading-relaxed"
            style={{ background: 'var(--wb-warn-soft)', color: 'var(--wb-warn)' }}
          >
            {permission === 'denied'
              ? '已拒绝的权限只能由你手动恢复：地址栏左侧站点设置 → 通知 → 允许 → 刷新页面。'
              : '若已允许过通知仍看到此提示，请确认站点运行在 HTTPS 下（Push / Notification 强制要求安全上下文）。'}
          </div>
        )}
      </div>
    </section>
  )
}

/* ---------------- 每日推送（Web Push） ---------------- */

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

function DailyPushSection() {
  const auth = useAuth()
  const token = auth.session?.token ?? null
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
    setView({ phase: 'checking' })
    void probe()
  }, [probe])

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
  const needsServerSetup = !syncing && view.status === 'unconfigured'
  // 这些状态下开启必然失败，按钮置灰，避免「点了没反应」的困惑
  const turnOnBlocked =
    view.phase === 'done' &&
    (view.status === 'unsupported' ||
      view.status === 'unconfigured' ||
      view.status === 'denied')

  return (
    <section>
      <h4 className="mb-2 text-sm font-semibold" style={{ color: 'var(--wb-ink)' }}>
        每日定时推送
      </h4>
      <div className="wb-set-card">
        <div className="wb-set-row items-start">
          <div className="min-w-0 flex-1">
            <p className="text-sm" style={{ color: 'var(--wb-ink)' }}>
              每天 09:05 推送今日摘要
            </p>
            <p className="mt-0.5 text-xs leading-relaxed" style={{ color: 'var(--wb-ink-3)' }}>
              内容为「今日待上线需求 / 未完成待办」，由服务端发出、浏览器关闭也能收到，
              比页面内提醒更可靠。点击通知直接跳到待办视图；绑定当前登录账号。
            </p>
          </div>
          {!syncing && view.phase === 'done' && (
            <div className="flex shrink-0 flex-col items-end gap-1.5">
              <span className="inline-flex items-center gap-1.5 text-xs" style={{ color: 'var(--wb-ink-2)' }}>
                <span
                  className="inline-block h-2 w-2 rounded-full"
                  style={{
                    background:
                      status?.tone === 'ok'
                        ? 'var(--wb-success)'
                        : status?.tone === 'warn'
                          ? 'var(--wb-accent)'
                          : 'var(--wb-ink-3)',
                  }}
                />
                {status?.label}
              </span>
              {view.status === 'on' ? (
                <button className="wb-btn-ghost xs" onClick={turnOff} disabled={busy}>
                  {busy ? '处理中…' : '关闭推送'}
                </button>
              ) : (
                <button
                  className="wb-btn-primary xs"
                  onClick={turnOn}
                  disabled={busy || turnOnBlocked}
                >
                  {busy ? '处理中…' : '开启推送'}
                </button>
              )}
            </div>
          )}
          {syncing && (
            <span className="flex shrink-0 items-center gap-2 text-xs" style={{ color: 'var(--wb-ink-3)' }}>
              <span
                className="h-3.5 w-3.5 animate-spin rounded-full border-2"
                style={{ borderColor: 'var(--wb-brand-400) var(--wb-line) var(--wb-line) var(--wb-line)' }}
              />
              检测中…
            </span>
          )}
        </div>

        {!syncing && view.phase === 'done' && view.error && (
          <div
            className="mx-3.5 mb-3 rounded-lg px-3 py-2 text-xs"
            style={{ background: 'var(--wb-warn-soft)', color: 'var(--wb-warn)' }}
          >
            {view.error}
          </div>
        )}

        {!syncing && view.status === 'denied' && (
          <div
            className="mx-3.5 mb-3 rounded-lg px-3 py-2 text-xs"
            style={{ background: 'var(--wb-warn-soft)', color: 'var(--wb-warn)' }}
          >
            先在上方「桌面提醒」里恢复通知权限，再回来开启推送。
          </div>
        )}

        {needsServerSetup && (
          <div
            className="mx-3.5 mb-3 rounded-lg px-3 py-2 text-xs leading-relaxed"
            style={{ background: 'var(--wb-warn-soft)', color: 'var(--wb-warn)' }}
          >
            服务端还没配置推送密钥（VAPID）。在服务器执行：
            <code className="mt-1 block rounded bg-black/10 px-1.5 py-0.5 font-mono" style={{ fontSize: 11 }}>
              cd /var/www/dev-workbench-sync && npx web-push generate-vapid-keys
            </code>
            并把输出的 VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY 写入 data/env.local 后重启服务。
          </div>
        )}

        {!syncing && view.status === 'unsupported' && !token && (
          <div
            className="mx-3.5 mb-3 rounded-lg px-3 py-2 text-xs"
            style={{ background: 'var(--wb-warn-soft)', color: 'var(--wb-warn)' }}
          >
            推送绑定账号，请先登录（本地模式不支持）。
          </div>
        )}

        {!syncing && view.status === 'on' && (
          <p className="mx-3.5 mb-3 text-[11px] leading-relaxed" style={{ color: 'var(--wb-ink-3)' }}>
            当前账号已订阅{SYNC_API ? '' : '（未配置同步 API 时无法推送）'}；如需测试，可在服务器手动执行
            <code className="mx-1 rounded bg-black/10 px-1 font-mono" style={{ fontSize: 10 }}>
              node scripts/push-daily.mjs
            </code>
            立即推送一条。
          </p>
        )}
      </div>
    </section>
  )
}

export function SettingsNotificationPanel() {
  return (
    <div className="space-y-6">
      <div
        className="rounded-xl border px-4 py-3 text-xs leading-relaxed"
        style={{ borderColor: 'var(--wb-line)', background: 'var(--wb-surface-2)', color: 'var(--wb-ink-2)' }}
      >
        <p>
          <b style={{ color: 'var(--wb-ink)' }}>桌面提醒</b>是本机、当前浏览器内的即时通知；
          <b style={{ color: 'var(--wb-ink)' }}>每日推送</b>由服务端定时发出，换设备登录同一账号也能收到。
        </p>
      </div>

      <DesktopNotifySection />
      <DailyPushSection />
    </div>
  )
}
