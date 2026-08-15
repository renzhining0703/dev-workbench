import { useMemo, useRef, useState } from 'react'
import { addMonths, format, parse } from 'date-fns'
import type { Requirement } from '../types'
import { STATUS_META } from '../types'
import { copyToClipboard, exportCsv, fmtDate } from '../lib/utils'
import { Modal } from './ui'

/** 按"开发开始时间"落在指定月份筛选 */
function filterByDevMonth(requirements: Requirement[], month: string): Requirement[] {
  return requirements.filter((r) => {
    if (!r.devStartTime) return false
    return r.devStartTime.slice(0, 7) === month // yyyy-MM
  })
}

export function ExportModal({
  open,
  requirements,
  onClose,
}: {
  open: boolean
  requirements: Requirement[]
  onClose: () => void
}) {
  const now = new Date()
  const [month, setMonth] = useState(format(now, 'yyyy-MM'))
  const [copied, setCopied] = useState(false)
  const copyTimer = useRef<number | null>(null)

  const list = useMemo(() => filterByDevMonth(requirements, month), [requirements, month])
  const monthLabel = format(parse(month, 'yyyy-MM', new Date()), 'yyyy年M月')

  /** 复制当月需求清单：表头 + 每行「需求名称\t开发开始时间」（tab 分隔，可直接粘 Excel） */
  function copyList() {
    if (list.length === 0) return
    const lines = ['需求名称\t开发开始时间', ...list.map((r) => `${r.name}\t${fmtDate(r.devStartTime)}`)]
    const done = () => {
      setCopied(true)
      if (copyTimer.current) window.clearTimeout(copyTimer.current)
      copyTimer.current = window.setTimeout(() => setCopied(false), 1500)
    }
    copyToClipboard(lines.join('\n')).then((ok) => {
      if (ok) done()
    })
  }

  const doExport = () => {
    exportCsv(
      `需求清单-${month}.csv`,
      [
        '需求名称',
        '所属项目',
        '代码分支',
        '发布模块',
        '状态',
        '创建时间',
        '开发开始时间',
        '开发结束时间',
        '提测时间',
        '上线时间',
        '备注',
      ],
      list.map((r) => [
        r.name,
        r.project,
        r.branch,
        r.publishModule,
        STATUS_META[r.status].label,
        fmtDate(r.createdAt),
        fmtDate(r.devStartTime),
        fmtDate(r.devEndTime),
        fmtDate(r.testTime),
        fmtDate(r.publishTime),
        r.remark,
      ]),
    )
  }

  return (
    <Modal open={open} onClose={onClose} title="导出需求清单" width="max-w-lg">
      <p className="mb-4 text-sm text-slate-500 dark:text-slate-400">
        按「开发开始时间」所在月份导出，生成 CSV 文件，可用 Excel / WPS 直接打开。
      </p>

      <div className="mb-1 flex items-center gap-2">
        <button
          className="btn-ghost px-2.5"
          onClick={() => setMonth(format(addMonths(parse(month, 'yyyy-MM', new Date()), -1), 'yyyy-MM'))}
          aria-label="上个月"
        >
          ‹
        </button>
        <input
          type="month"
          className="input w-44 text-center"
          value={month}
          onChange={(e) => e.target.value && setMonth(e.target.value)}
        />
        <button
          className="btn-ghost px-2.5"
          onClick={() => setMonth(format(addMonths(parse(month, 'yyyy-MM', new Date()), 1), 'yyyy-MM'))}
          aria-label="下个月"
        >
          ›
        </button>
      </div>

      <div className="relative mt-4 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm dark:border-slate-700 dark:bg-slate-800/50">
        <button
          className="absolute right-2 top-2 inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-xs text-slate-400 transition hover:bg-slate-200/70 hover:text-slate-600 dark:hover:bg-slate-700 dark:hover:text-slate-300"
          onClick={copyList}
          disabled={list.length === 0}
          title="复制当月需求清单"
        >
          {copied ? (
            <span className="font-medium text-emerald-600 dark:text-emerald-400">✓ 已复制</span>
          ) : (
            <>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
              </svg>
              复制
            </>
          )}
        </button>
        <p className="text-slate-600 dark:text-slate-300">
          {monthLabel} 共 <span className="font-semibold text-indigo-600 dark:text-indigo-400">{list.length}</span> 个开发需求
        </p>
        {list.length > 0 && (
          <ul className="mt-2 max-h-40 space-y-1 overflow-y-auto pr-1">
            {list.map((r) => (
              <li key={r.id} className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
                <span className="truncate pr-2">{r.name}</span>
                <span className="shrink-0">{fmtDate(r.devStartTime)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="mt-6 flex justify-end gap-2">
        <button className="btn-ghost" onClick={onClose}>取消</button>
        <button className="btn-primary" disabled={list.length === 0} onClick={doExport}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" />
          </svg>
          导出 CSV（{list.length} 条）
        </button>
      </div>
    </Modal>
  )
}
