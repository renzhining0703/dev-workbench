/**
 * 同步路由：GET /api/health, GET /api/snapshot, POST /api/push
 *
 * 合并策略与 v1 完全一致（字段级 LWW + settings 展开），前端零感知。
 * 唯一行为差异在并发安全：push 的读-改-写由 SnapshotStore.update 的事务保护。
 */
import { Router } from 'express'
import { SNAPSHOT_VERSION, mergeSnapshot } from '../lib/merge.mjs'

/**
 * @param {object} deps
 * @param {import('../store/snapshots.mjs').SnapshotStore} deps.snapshotStore
 */
export function createSyncRouter({ snapshotStore, requireAuth }) {
  const router = Router()

  /** GET /api/health：无需 token，用于前端判断存活 */
  router.get('/health', (_req, res) => {
    res.status(200).json({
      ok: true,
      data: { version: SNAPSHOT_VERSION, ts: new Date().toISOString() },
    })
  })

  /** GET /api/snapshot：返回当前用户的全量（+ 本次请求的 serverTs） */
  router.get('/snapshot', requireAuth, (req, res) => {
    const data = snapshotStore.getNormalized(req.user.username)
    res.status(200).json({
      ok: true,
      data: { ...data, serverTs: new Date().toISOString() },
    })
  })

  /** POST /api/push：接收客户端全量，事务内做 LWW 合并落盘并返回 */
  router.post('/push', requireAuth, (req, res) => {
    const body = req.body ?? {}
    const merged = snapshotStore.update(req.user.username, (remote) =>
      mergeSnapshot(remote, body),
    )
    res.status(200).json({ ok: true, data: merged })
  })

  return router
}
