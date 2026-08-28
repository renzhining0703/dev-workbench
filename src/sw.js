/**
 * 自定义 Service Worker（vite-plugin-pwa injectManifest 构建）
 *
 * 在 workbox precache 基础上增加 Web Push 处理：
 *   - push 事件 → showNotification（标题/正文/图标来自服务端 JSON）
 *   - notificationclick → 聚焦已有窗口或新开窗口，跳转通知携带的日期
 *
 * 构建：vite.config.ts 的 strategies:'injectManifest'，__WB_MANIFEST 由 workbox-build 注入
 */
import { precacheAndRoute, cleanupOutdatedCaches, createHandlerBoundToURL } from 'workbox-precaching'
import { NavigationRoute, registerRoute } from 'workbox-routing'

precacheAndRoute(self.__WB_MANIFEST)
cleanupOutdatedCaches()

// SPA 导航回退：未知导航路径（如 /dev-workbench/stats 直接刷新）→ index.html
// injectManifest 模式下 workbox-build 不接受 navigateFallback 配置项，需自行注册
registerRoute(
  new NavigationRoute(createHandlerBoundToURL(new URL('index.html', self.registration.scope).href), {
    denylist: [/^\/api\//],
  }),
)

self.addEventListener('install', () => {
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

/** 通知内点击的落地 URL（相对 SW scope 解析） */
function resolveUrl(u) {
  try {
    return new URL(u, self.registration.scope).href
  } catch {
    return self.registration.scope
  }
}

self.addEventListener('push', (event) => {
  let payload = { title: '开发工作台', body: '', url: '' }
  if (event.data) {
    try {
      payload = { ...payload, ...event.data.json() }
    } catch {
      payload.body = event.data.text() || ''
    }
  }
  event.waitUntil(
    self.registration
      .showNotification(payload.title || '开发工作台', {
        body: payload.body || '',
        icon: new URL('pwa-192x192.png', self.registration.scope).href,
        badge: new URL('favicon.svg', self.registration.scope).href,
        data: { url: payload.url || '' },
        tag: 'dev-workbench-daily',
        renotify: true,
      })
      .catch(() => {}),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const target = resolveUrl(event.notification.data?.url || '')
  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((list) => {
        for (const client of list) {
          if ('focus' in client) {
            client.focus()
            if ('navigate' in client) client.navigate(target).catch(() => {})
            return
          }
        }
        return self.clients.openWindow(target)
      }),
  )
})
