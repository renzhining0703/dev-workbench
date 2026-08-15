import { format, isToday, parseISO } from 'date-fns'

/** yyyy-MM-dd -> '2026-08-14' */
export function toDateStr(d: Date): string {
  return format(d, 'yyyy-MM-dd')
}

/**
 * 日期展示：兼容两种存储格式
 * - 'yyyy-MM-dd'（新数据，直接返回）
 * - ISO datetime（旧数据，本地时区转日期）
 */
export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso
  try {
    return format(parseISO(iso), 'yyyy-MM-dd')
  } catch {
    return iso
  }
}

/**
 * 短日期展示：今年显示 MM-dd，跨年显示 yyyy-MM-dd。
 * 用于表格内联展示，减少列宽压力。
 */
export function fmtDateShort(iso: string | null | undefined): string {
  const d = fmtDate(iso)
  if (d === '—') return '—'
  const thisYear = new Date().getFullYear()
  const prefix = `${thisYear}-`
  if (d.startsWith(prefix)) return d.slice(prefix.length)
  return d
}

/** 日期是否为今天（兼容两种存储格式） */
export function isDateToday(iso: string | null | undefined): boolean {
  if (!iso) return false
  const today = toDateStr(new Date())
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso === today
  return isToday(parseISO(iso))
}

/**
 * 复制文本到剪贴板，返回是否成功。
 * 优先使用 Clipboard API；非 https（非 localhost）环境自动降级为 execCommand。
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch {
      /* 权限被拒则走降级 */
    }
  }
  try {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    document.execCommand('copy')
    document.body.removeChild(ta)
    return true
  } catch {
    return false
  }
}

export function isValidDateStr(s: string): boolean {
  return !Number.isNaN(Date.parse(s))
}

/** 导出 CSV（带 BOM，Excel 直接打开中文不乱码） */
export function exportCsv(filename: string, headers: string[], rows: (string | number)[][]) {
  const escape = (v: string | number) => {
    const s = String(v ?? '')
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const lines = [headers, ...rows].map((row) => row.map(escape).join(','))
  const blob = new Blob(['\uFEFF' + lines.join('\n')], {
    type: 'text/csv;charset=utf-8;',
  })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
