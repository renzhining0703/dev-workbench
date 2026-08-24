/**
 * 墓碑（软删除）工具
 *
 * 同步协议：删除不再从数组里移除，而是打 deletedAt 墓碑（updatedAt 同步刷新），
 * 墓碑作为普通条目参与现有 LWW 合并 —— updatedAt 更新 → 删除随 push 传播。
 * UI 层一律过滤掉墓碑条目；超过 GC 天数的墓碑被物理清理，防止数组无限膨胀。
 *
 * 前后端行为保持一致（server/lib/merge.mjs 有同款 GC）。
 */

/** 墓碑保留天数：超期物理清理 */
export const TOMBSTONE_GC_DAYS = 90

const DAY_MS = 86_400_000

/** 软删除可打墓碑的实体 */
export interface Tombstoned {
  deletedAt?: string
}

/** 过滤出未删除（活跃）条目 —— UI 读取处统一走这里 */
export function active<T extends Tombstoned>(list: T[]): T[] {
  return list.filter((x) => !x.deletedAt)
}

/**
 * 物理清理超期墓碑（> GC 天数）。
 * deletedAt 无效（无法解析）时保守保留，等下次再判。
 */
export function gcTombstones<T extends Tombstoned>(list: T[], now = Date.now()): T[] {
  const cutoff = now - TOMBSTONE_GC_DAYS * DAY_MS
  return list.filter((x) => {
    if (!x.deletedAt) return true
    const t = new Date(x.deletedAt).getTime()
    return Number.isFinite(t) ? t >= cutoff : true
  })
}
