/**
 * Web Push 路由：
 *   GET  /api/push/vapid-public-key → public（前端订阅前拉公钥，部署换 key 无需重 build）
 *   GET  /api/push/list             → bearer（当前用户已订阅的 endpoint 列表）
 *   POST /api/push/register         → bearer（保存浏览器 PushSubscription）
 *   POST /api/push/unregister       → bearer（退订）
 *
 * VAPID 未配置（本地没写 env.local）时：register 照常保存（配置好即可推送），
 * vapid-public-key 返回 503，前端据此提示「服务端未配置推送」。
 */
import { Router } from 'express'

const isPushConfigured = (config) =>
  Boolean(config.vapidPublicKey && config.vapidPrivateKey)

export function createPushRouter({ config, pushStore, requireAuth }) {
  const router = Router()

  /** 前端订阅前拉取 VAPID 公钥（无鉴权；公钥本来就是公开的） */
  router.get('/vapid-public-key', (_req, res) => {
    if (!isPushConfigured(config)) {
      return res.status(503).json({
        ok: false,
        error: 'push not configured',
        hint: '服务端未配置 VAPID 密钥，请在 server/data/env.local 写入 VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY',
      })
    }
    res.status(200).json({ ok: true, data: { publicKey: config.vapidPublicKey } })
  })

  /** 当前用户的订阅列表（前端判断「是否已开启」） */
  router.get('/list', requireAuth, (req, res) => {
    const subs = pushStore.listByUser(req.user.username)
    res.status(200).json({ ok: true, data: { subscriptions: subs } })
  })

  /** 保存订阅（浏览器 subscribe 成功后的 PushSubscription 对象） */
  router.post('/register', requireAuth, (req, res) => {
    const { endpoint, keys, userAgent } = req.body ?? {}
    if (typeof endpoint !== 'string' || endpoint.length === 0) {
      return res.status(400).json({ ok: false, error: 'endpoint required' })
    }
    if (!keys || typeof keys.p256dh !== 'string' || typeof keys.auth !== 'string') {
      return res.status(400).json({ ok: false, error: 'keys.p256dh / keys.auth required' })
    }
    const sub = pushStore.upsert(req.user.username, {
      endpoint,
      keys: { p256dh: keys.p256dh, auth: keys.auth },
      userAgent: typeof userAgent === 'string' ? userAgent.slice(0, 300) : '',
    })
    res.status(200).json({ ok: true, data: { subscription: sub } })
  })

  /** 退订（按 endpoint 删除当前用户的这条） */
  router.post('/unregister', requireAuth, (req, res) => {
    const { endpoint } = req.body ?? {}
    if (typeof endpoint !== 'string' || endpoint.length === 0) {
      return res.status(400).json({ ok: false, error: 'endpoint required' })
    }
    pushStore.remove(req.user.username, endpoint)
    res.status(200).json({ ok: true, data: { removed: true } })
  })

  return router
}
