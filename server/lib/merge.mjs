/**
 * 快照合并纯函数（逻辑自 v1 routes.mjs / storage.mjs 原样平移，仅做纯函数化）
 *
 * 合并策略：字段级 LWW（同 id 两边都有 → updatedAt 大的胜；缺 updatedAt 降级 createdAt）
 * settings：对象展开合并（本地键覆盖服务端同名键，服务端独有键保留）
 *
 * 本模块零 IO、零依赖 —— test/merge.test.mjs 固化其行为。
 */

export const SNAPSHOT_VERSION = 1

/** 空快照（新用户默认值，与 v1 emptySnapshot 一致） */
export function emptySnapshot() {
  return {
    version: SNAPSHOT_VERSION,
    serverTs: new Date(0).toISOString(),
    requirements: [],
    todos: [],
    projects: [],
    settings: { autoArchiveMonths: 3 },
  }
}

/**
 * 补默认值（向前兼容缺字段的老数据，与 v1 loadSnapshot 的归一化一致）。
 * 注意：不覆盖已有字段的值。
 */
export function normalizeSnapshot(parsed) {
  if (!parsed || typeof parsed !== 'object') return emptySnapshot()
  const base = emptySnapshot()
  return {
    ...base,
    ...parsed,
    settings: { ...base.settings, ...(parsed.settings ?? {}) },
  }
}

/**
 * 基于 updatedAt 的字段级 LWW（v1 mergeByUpdatedAt 原样平移）
 * - 本地有而服务端没有 → 本地胜（新增）
 * - 两边都有 → updatedAt（缺则 createdAt）大的胜；相等 → 服务端胜
 */
export function mergeByUpdatedAt(remote, local) {
  const byId = new Map()
  const remoteIds = new Set(remote.map((r) => r.id))

  // 1. 先放服务端
  for (const r of remote) byId.set(r.id, r)

  // 2. 本地新增 / 3. 同 id 比 updatedAt
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

/** settings 对象合并：本地键覆盖，服务端独有键保留（v1 mergeSettings 平移） */
export function mergeSettings(remote, local) {
  return { ...remote, ...local }
}

/** 墓碑保留天数：软删除条目超过该天数被物理清理（与前端 lib/tombstone.ts 一致） */
export const TOMBSTONE_GC_DAYS = 90

const DAY_MS = 86_400_000

/**
 * 物理清理超期墓碑（> GC 天数）。
 * 墓碑参与 LWW 合并以传播删除；不清理会无限膨胀。
 * deletedAt 无法解析时保守保留。
 */
export function gcTombstones(list, nowMs = Date.now()) {
  if (!Array.isArray(list)) return []
  const cutoff = nowMs - TOMBSTONE_GC_DAYS * DAY_MS
  return list.filter((x) => {
    if (!x || !x.deletedAt) return true
    const t = new Date(x.deletedAt).getTime()
    return Number.isFinite(t) ? t >= cutoff : true
  })
}

/**
 * push 全量合并（v1 push handler 的合并逻辑平移）。
 * 非数组集合与 v1 一样按空数组处理；返回带新 serverTs 的完整快照。
 */
export function mergeSnapshot(remote, body, nowIso = new Date().toISOString()) {
  return {
    version: SNAPSHOT_VERSION,
    serverTs: nowIso,
    requirements: gcTombstones(mergeByUpdatedAt(
      Array.isArray(remote.requirements) ? remote.requirements : [],
      Array.isArray(body.requirements) ? body.requirements : [],
    )),
    todos: gcTombstones(mergeByUpdatedAt(
      Array.isArray(remote.todos) ? remote.todos : [],
      Array.isArray(body.todos) ? body.todos : [],
    )),
    projects: gcTombstones(mergeByUpdatedAt(
      Array.isArray(remote.projects) ? remote.projects : [],
      Array.isArray(body.projects) ? body.projects : [],
    )),
    settings: mergeSettings(remote.settings ?? {}, body.settings ?? {}),
  }
}
