import type { ReactNode } from 'react'

/**
 * 高亮搜索关键词：将文本中匹配 keyword 的部分用 <mark> 包裹。
 * 大小写不敏感，支持多次出现。返回 ReactNode 数组。
 */
export function highlight(text: string, keyword: string): ReactNode {
  if (!text) return text
  const kw = keyword.trim()
  if (!kw) return text

  const lower = text.toLowerCase()
  const kwLower = kw.toLowerCase()
  const parts: ReactNode[] = []
  let lastIdx = 0
  let idx = lower.indexOf(kwLower)

  while (idx !== -1) {
    if (idx > lastIdx) parts.push(text.slice(lastIdx, idx))
    parts.push(
      <mark
        key={idx}
        className="rounded bg-amber-200 px-0.5 text-slate-900 dark:bg-amber-400/30 dark:text-amber-200"
      >
        {text.slice(idx, idx + kw.length)}
      </mark>,
    )
    lastIdx = idx + kw.length
    idx = lower.indexOf(kwLower, lastIdx)
  }
  if (lastIdx < text.length) parts.push(text.slice(lastIdx))
  return parts
}
