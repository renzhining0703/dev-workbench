/**
 * 业务路由：/api/health, /api/snapshot, /api/push
 *
 * snapshot / push 现在按 req.user.username 选文件（每用户独立）
 * 合并策略：字段级 LWW（同 id 两边都有 → updatedAt 大的胜）
 */
import { send } from './auth.mjs'

const VERSION = 1

/**
 * 通用合并函数：基于 updatedAt 的字段级 LWW
 * 兼容 updatedAt 缺字段（降级到 createdAt）
 */
function mergeByUpdatedAt(remote, local) {
  const byId = new Map()
  const remoteIds = new Set(remote.map((r) => r.id))

  // 1. 先放服务端
  for (const r of remote) byId.set(r.id, r)

  // 2. 本地有而服务端没有 → 新增，本地胜
  // 3. 两边都有 → 比较 updatedAt，大的胜
  for (const l of local) {
    if (!remoteIds.has(l.id)) {
      byId.set(l.id, l)
      continue
    }
    const r = byId.get(l.id)
    const lts = new Date(l.updatedAt ?? l.createdAt ?? 0).getTime()
    const rts = new Date(r.updatedAt ?? r.createdAt ?? 0).getTime()
    if (lts > rts) byId.set(l.id, l)
  }
  return [...byId.values()]
}

function mergeSettings(remote, local) {
  return { ...remote, ...local }
}

async function readJsonBody(req, maxBytes = 4 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > maxBytes) {
        reject(new Error('payload too large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8')
      if (!raw) return resolve({})
      try {
        resolve(JSON.parse(raw))
      } catch (e) {
        reject(new Error('invalid json'))
      }
    })
    req.on('error', reject)
  })
}

export function makeRoutes({ userStore }) {
  return {
    /** GET /api/health：无需 token，用于前端判断存活 */
    async health(req, res) {
      send(res, 200, {
        ok: true,
        data: { version: VERSION, ts: new Date().toISOString() },
      })
    },

    /** GET /api/snapshot：返回当前用户的全量 */
    async snapshot(req, res) {
      const data = await userStore.loadUserSnapshot(req.user.username)
      send(res, 200, {
        ok: true,
        data: { ...data, serverTs: new Date().toISOString() },
      })
    },

    /** POST /api/push：接收客户端全量，服务端做字段级 LWW 合并后落盘并返回 */
    async push(req, res) {
      let body
      try {
        body = await readJsonBody(req)
      } catch (e) {
        send(res, 400, { ok: false, error: String(e.message ?? e) })
        return
      }

      const remote = await userStore.loadUserSnapshot(req.user.username)
      const merged = {
        version: VERSION,
        serverTs: new Date().toISOString(),
        requirements: mergeByUpdatedAt(
          Array.isArray(remote.requirements) ? remote.requirements : [],
          Array.isArray(body.requirements) ? body.requirements : [],
        ),
        todos: mergeByUpdatedAt(
          Array.isArray(remote.todos) ? remote.todos : [],
          Array.isArray(body.todos) ? body.todos : [],
        ),
        projects: mergeByUpdatedAt(
          Array.isArray(remote.projects) ? remote.projects : [],
          Array.isArray(body.projects) ? body.projects : [],
        ),
        settings: mergeSettings(
          remote.settings ?? {},
          body.settings ?? {},
        ),
      }

      await userStore.saveUserSnapshot(req.user.username, merged)
      send(res, 200, { ok: true, data: merged })
    },
  }
}