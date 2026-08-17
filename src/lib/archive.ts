import { differenceInMonths, parseISO } from 'date-fns'
import type { Requirement } from '../types'

/** 自动归档设置：localStorage key */
const ARCHIVE_MONTHS_KEY = 'dev-workbench:auto-archive-months'

/** 默认 N 个月；最小 1，最大 12 */
const DEFAULT_MONTHS = 3
const MIN_MONTHS = 1
const MAX_MONTHS = 12

/** clamp 月份到合法区间 */
function clampMonths(n: number): number {
  if (Number.isNaN(n)) return DEFAULT_MONTHS
  return Math.max(MIN_MONTHS, Math.min(MAX_MONTHS, Math.floor(n)))
}

/** 读自动归档设置（月数） */
export function getArchiveMonths(): number {
  const raw = localStorage.getItem(ARCHIVE_MONTHS_KEY)
  if (!raw) return DEFAULT_MONTHS
  const n = parseInt(raw, 10)
  return clampMonths(n)
}

/** 写自动归档设置 */
export function setArchiveMonths(months: number): void {
  localStorage.setItem(ARCHIVE_MONTHS_KEY, String(clampMonths(months)))
}

/** 最小/最大月份常量（暴露给 UI 显示范围） */
export const ARCHIVE_MONTHS_RANGE = { min: MIN_MONTHS, max: MAX_MONTHS, default: DEFAULT_MONTHS }

/**
 * 找出需要自动归档的已上线需求：
 *   status === 'published' 且 publishTime 早于 (now - months) 个月
 * 早于 = N 个月前那个月已经过完（即 differenceInMonths >= months）
 */
export function findAutoArchiveTargets(
  items: Requirement[],
  months: number,
  now = new Date(),
): Requirement[] {
  const m = clampMonths(months)
  return items.filter((r) => {
    if (r.status !== 'published' || !r.publishTime) return false
    try {
      const published = parseISO(r.publishTime)
      return differenceInMonths(now, published) >= m
    } catch {
      return false
    }
  })
}