import { useEffect, useState } from 'react'
import type { Requirement, RequirementStatus } from '../types'
import { STATUS_META, STATUS_FLOW } from '../types'
import { fmtDate, isDateToday, copyToClipboard } from '../lib/utils'
import { Select, statusSelectOptions } from './Select'

interface Props {
  requirement: Requirement | null
  onClose: () => void
  onEdit: (r: Requirement) => void
  onStatusChange: (id: string, status: RequirementStatus) => void
}

/** 时间线展示顺序 */
const TIMELINE: { key: keyof Requirement; label: string }[] = [
  { key: 'createdAt', label: '创建时间' },
  { key: 'devStartTime', label: '开发开始' },
  { key: 'devEndTime', label: '开发结束' },
  { key: 'testTime', label: '提测时间' },
  { key: 'publishTime', label: '上线时间' },
]

export function RequirementDrawer({ requirement, onClose, onEdit, onStatusChange }: Props) {
  const [copiedField, setCopiedField] = useState<string | null>(null)

  useEffect(() => {
    if (!requirement) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [requirement, onClose])

  if (!requirement) return null
  const r = requirement
  const meta = STATUS_META[r.status]

  function copyField(field: string, text: string) {
    if (!text) return
    copyToClipboard(text).then((ok) => {
      if (ok) {
        setCopiedField(field)
        setTimeout(() => setCopiedField(null), 1500)
      }
    })
  }

  return (
    <>
      {/* 遮罩 */}
      <div
        className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm"
        onClick={onClose}
      />
      {/* 抽屉面板 */}
      <div className="fixed right-0 top-0 z-50 h-full w-full max-w-md overflow-y-auto bg-white shadow-2xl dark:bg-[#0f1521] animate-[slideIn_0.2s_ease-out]">
        <style>{`@keyframes slideIn{from{transform:translateX(100%)}to{transform:translateX(0)}}`}</style>
        {/* 头部 */}
        <div className="sticky top-0 z-10 border-b border-slate-200 bg-white/90 px-5 py-4 backdrop-blur dark:border-slate-800 dark:bg-[#0f1521]/90">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <h3 className="text-base font-semibold leading-snug text-slate-800 dark:text-slate-100">
                {r.name}
              </h3>
              <div className="mt-1.5 flex items-center gap-2">
                <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ${meta.color} bg-slate-100 dark:bg-slate-800`}>
                  <span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} />
                  {meta.label}
                </span>
                <span className="text-xs text-slate-400">创建于 {fmtDate(r.createdAt)}</span>
              </div>
            </div>
            <button
              onClick={onClose}
              className="shrink-0 rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-200"
              aria-label="关闭"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* 内容 */}
        <div className="space-y-5 px-5 py-5">
          {/* 状态切换 */}
          <div>
            <label className="mb-1.5 block text-xs font-medium text-slate-500 dark:text-slate-400">状态</label>
            <Select
              value={r.status}
              onChange={(s) => onStatusChange(r.id, s)}
              options={statusSelectOptions}
            />
          </div>

          {/* 关键字段 */}
          <div className="space-y-3">
            <DrawerField label="所属项目" value={r.project} />
            <DrawerField
              label="代码分支"
              value={r.branch}
              copyable
              copied={copiedField === 'branch'}
              onCopy={() => copyField('branch', r.branch)}
            />
            <DrawerField
              label="发布模块"
              value={r.publishModule}
              copyable
              copied={copiedField === 'module'}
              onCopy={() => copyField('module', r.publishModule)}
            />
          </div>

          {/* 时间线 */}
          <div>
            <p className="mb-2 text-xs font-medium text-slate-500 dark:text-slate-400">时间线</p>
            <div className="relative space-y-3 pl-4">
              <div className="absolute left-[5px] top-2 bottom-2 w-px bg-slate-200 dark:bg-slate-700" />
              {TIMELINE.map(({ key, label }) => {
                const iso = r[key] as string | null
                const date = fmtDate(iso)
                const today = isDateToday(iso)
                const hasValue = date !== '—'
                return (
                  <div key={String(key)} className="relative flex items-center gap-2">
                    <span
                      className={`absolute -left-4 h-2.5 w-2.5 rounded-full ring-2 ring-white dark:ring-[#0f1521] ${
                        hasValue ? (today ? 'bg-rose-500' : 'bg-indigo-500') : 'bg-slate-300 dark:bg-slate-600'
                      }`}
                    />
                    <span className="w-20 shrink-0 text-xs text-slate-400">{label}</span>
                    <span className={`text-sm ${hasValue ? (today ? 'font-semibold text-rose-600 dark:text-rose-400' : 'text-slate-700 dark:text-slate-200') : 'text-slate-300 dark:text-slate-600'}`}>
                      {date}
                      {today && <span className="ml-1.5 rounded bg-rose-100 px-1 py-0.5 text-[10px] font-semibold text-rose-600 dark:bg-rose-500/15 dark:text-rose-400">今日</span>}
                    </span>
                  </div>
                )
              })}
            </div>
          </div>

          {/* 备注 */}
          {r.remark && (
            <div>
              <p className="mb-1.5 text-xs font-medium text-slate-500 dark:text-slate-400">备注</p>
              <div className="whitespace-pre-wrap rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600 dark:border-slate-700 dark:bg-slate-800/50 dark:text-slate-300">
                {r.remark}
              </div>
            </div>
          )}

          {/* 状态流转 */}
          <div>
            <p className="mb-2 text-xs font-medium text-slate-500 dark:text-slate-400">状态流转</p>
            <div className="flex flex-wrap items-center gap-1">
              {STATUS_FLOW.map((s, i) => {
                const active = s === r.status
                const passed = STATUS_FLOW.indexOf(r.status) > i
                return (
                  <div key={s} className="flex items-center gap-1">
                    <span
                      className={`rounded px-1.5 py-0.5 text-[11px] ${
                        active
                          ? 'bg-indigo-600 font-medium text-white'
                          : passed
                            ? 'text-emerald-600 dark:text-emerald-400'
                            : 'text-slate-400 dark:text-slate-500'
                      }`}
                    >
                      {STATUS_META[s].label}
                    </span>
                    {i < STATUS_FLOW.length - 1 && (
                      <span className="text-slate-300 dark:text-slate-600">→</span>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        </div>

        {/* 底部操作栏 */}
        <div className="sticky bottom-0 border-t border-slate-200 bg-white/90 px-5 py-3 backdrop-blur dark:border-slate-800 dark:bg-[#0f1521]/90">
          <button
            className="btn-primary w-full"
            onClick={() => onEdit(r)}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
            </svg>
            编辑需求
          </button>
        </div>
      </div>
    </>
  )
}

/** 字段行 */
function DrawerField({
  label,
  value,
  copyable,
  copied,
  onCopy,
}: {
  label: string
  value: string
  copyable?: boolean
  copied?: boolean
  onCopy?: () => void
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="shrink-0 text-xs text-slate-400">{label}</span>
      <div className="flex min-w-0 items-center gap-1.5">
        <span className="truncate text-sm text-slate-700 dark:text-slate-200">
          {value || '—'}
        </span>
        {copyable && value && (
          <button
            onClick={onCopy}
            className={`shrink-0 rounded p-1 transition ${
              copied
                ? 'text-emerald-500'
                : 'text-slate-400 hover:text-slate-600 dark:hover:text-slate-200'
            }`}
            title={copied ? '已复制' : '点击复制'}
          >
            {copied ? (
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20 6 9 17l-5-5" />
              </svg>
            ) : (
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
              </svg>
            )}
          </button>
        )}
      </div>
    </div>
  )
}
