/**
 * Web Push 前端逻辑：订阅 / 退订 / 状态探测
 *
 * 流程（enable）：
 *   1. 探测能力（serviceWorker / PushManager / Notification）
 *   2. GET /api/push/vapid-public-key（服务端未配 VAPID → 503 → unconfigured）
 *   3. 注册 Service Worker（sw.js，injectManifest 构建的自定义 SW，含 push 事件处理）
 *   4. Notification.requestPermission()（denied → 引导去站点设置）
 *   5. pushManager.subscribe({ userVisibleOnly: true, applicationServerKey })
 *   6. POST /api/push/register 保存订阅（绑定当前登录账号）
 *
 * 401 处理：与 sync 层一致，触发 AuthContext 的登录框。
 */
import { SYNC_API } from './syncConfig'
import { emitUnauthorized } from '../store/AuthContext'

export type PushStatus =
  | 'unsupported' // 浏览器不支持（SW / PushManager / Notification 缺失）
  | 'unconfigured' // 服务端未配置 VAPID
  | 'denied' // 通知权限被拒绝
  | 'off' // 支持且可开启，当前未开启
  | 'on' // 已开启
  | 'error' // 其它错误

export interface PushProbe {
  status: PushStatus
  error?: string
}

/** base64url 数组（Uint8Array → 无 padding 的 base64url 字符串） */
function bufToBase64Url(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf)
  let bin = ''
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** base64url 字符串 → Uint8Array（applicationServerKey 需要原始字节） */
export function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4)
  const base64norm = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64norm)
  const out = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}

async function readJson(res: Response): Promise<unknown> {
  const text = await res.text()
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

/** 拉取服务端 VAPID 公钥；未配置 → null；401 → 触发登录框 */
export async function fetchVapidPublicKey(): Promise<string | null> {
  const res = await fetch(`${SYNC_API}/push/vapid-public-key`, { credentials: 'omit' })
  if (res.status === 401) {
    emitUnauthorized('')
    return null
  }
  if (res.status === 503) return null // 服务端未配置
  if (!res.ok) return null
  const body = (await readJson(res)) as { ok?: boolean; data?: { publicKey?: string } } | null
  return body?.ok && body.data?.publicKey ? body.data.publicKey : null
}

/** 当前账号是否已有服务端订阅 */
export async function hasServerSubscription(token: string): Promise<boolean> {
  const res = await fetch(`${SYNC_API}/push/list`, {
    headers: { Authorization: `Bearer ${token}` },
    credentials: 'omit',
  })
  if (res.status === 401) {
    emitUnauthorized('')
    return false
  }
  if (!res.ok) return false
  const body = (await readJson(res)) as {
    ok?: boolean
    data?: { subscriptions?: unknown[] }
  } | null
  return Boolean(body?.ok && (body.data?.subscriptions?.length ?? 0) > 0)
}

/**
 * 开启推送订阅（幂等：已订阅时静默返回 on）。
 * 返回最终状态；error 附带可展示的 message。
 */
export async function enablePush(token: string): Promise<PushProbe> {
  try {
    if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
      return { status: 'unsupported' }
    }
    const publicKey = await fetchVapidPublicKey()
    if (!publicKey) return { status: 'unconfigured' }

    // 注册自定义 SW（injectManifest 产物，含 push / notificationclick 处理）
    const swUrl = `${import.meta.env.BASE_URL}sw.js`
    const reg = await navigator.serviceWorker.register(swUrl)
    await navigator.serviceWorker.ready

    // 已订阅（例如换账号后服务端还有记录）→ 直接补登记并返回 on
    const existing = await reg.pushManager.getSubscription()
    if (existing) {
      await registerToServer(token, existing)
      return { status: 'on' }
    }

    // 请求通知权限
    let permission = Notification.permission
    if (permission === 'default') {
      permission = await Notification.requestPermission()
    }
    if (permission !== 'granted') {
      return { status: 'denied' }
    }

    // 订阅
    const subscription = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    })
    await registerToServer(token, subscription)
    return { status: 'on' }
  } catch (e) {
    return { status: 'error', error: e instanceof Error ? e.message : String(e) }
  }
}

/** 把浏览器 PushSubscription 登记到服务端（绑定当前账号） */
async function registerToServer(
  token: string,
  subscription: PushSubscription,
): Promise<void> {
  const res = await fetch(`${SYNC_API}/push/register`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      endpoint: subscription.endpoint,
      keys: {
        p256dh: bufToBase64Url(subscription.getKey('p256dh')!),
        auth: bufToBase64Url(subscription.getKey('auth')!),
      },
      userAgent: navigator.userAgent,
    }),
    credentials: 'omit',
  })
  if (res.status === 401) {
    emitUnauthorized('')
    throw new Error('登录已过期，请重新登录')
  }
  if (!res.ok) {
    throw new Error(`服务端保存订阅失败（${res.status}）`)
  }
}

/** 关闭推送（退订 + 服务端注销）；返回是否成功 */
export async function disablePush(token: string): Promise<boolean> {
  try {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return false
    const reg = await navigator.serviceWorker.getRegistration()
    const sub = reg ? await reg.pushManager.getSubscription() : null
    if (sub) {
      // 先注销服务端，再退订本地（顺序无关紧要，但保证至少一端清理）
      await fetch(`${SYNC_API}/push/unregister`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ endpoint: sub.endpoint }),
        credentials: 'omit',
      }).catch(() => {})
      await sub.unsubscribe()
    }
    return true
  } catch {
    return false
  }
}
