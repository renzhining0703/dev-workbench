/**
 * 快照合并纯函数（前端同步协议核心）
 *
 * 合并策略：字段级 LWW（同 id 两边都有 → updatedAt 大的胜；缺 updatedAt 降级 createdAt；
 * 时间相等 → 服务端胜，因为是「严格大于才覆盖」）。
 *
 * 本模块零 IO、零 DOM 依赖 —— 可直接在 node 环境（vitest）单测。
 * 服务端同款逻辑见 server/lib/merge.mjs，二者行为必须保持一致；
 * 墓碑常量 TOMBSTONE_GC_DAYS 同样前后端各一份（见 lib/tombstone.ts / server/lib/merge.mjs），
 * 修改任一处务必同步另一处，否则会出现「服务端已 GC、前端还在等墓碑」类漂移 bug。
 */
type WithTime = { id: string; updatedAt?: string; createdAt?: string }

function timeOf(x: WithTime): number {
  const t = x.updatedAt ?? x.createdAt ?? ''
  const n = new Date(t).getTime()
  return Number.isFinite(n) ? n : 0
}

/**
 * 基于 updatedAt 的字段级 LWW。
 * - 本地有而服务端没有 → 本地胜（新增）
 * - 两边都有 → updatedAt（缺则 createdAt）大的胜；相等 → 服务端胜
 */
export function mergeByUpdatedAt<T extends WithTime>(remote: T[], local: T[]): T[] {
  const byId = new Map<string, T>()
  const remoteIds = new Set(remote.map((r) => r.id))

  // 1. 先放服务端
  for (const r of remote) byId.set(r.id, r)

  // 2. 本地新增 / 3. 同 id 比 updatedAt
  for (const l of local) {
    if (!remoteIds.has(l.id)) {
      byId.set(l.id, l)
      continue
    }
    const r = byId.get(l.id)!
    if (timeOf(l) > timeOf(r)) byId.set(l.id, l)
  }
  return [...byId.values()]
}
