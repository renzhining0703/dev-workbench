import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import type { Requirement, RequirementStatus } from '../types'
import { STATUS_FLOW, statusMeta } from '../types'
import { fmtDate, isDateToday, copyToClipboard } from '../lib/utils'
import { requirementModuleDisplay, requirementProjectDisplay } from '../lib/projects'
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

/** 区块标题（NOVA 风格小字标签） */
function FieldLabel({ children }: { children: ReactNode }) {
  return (
    <p className="mb-1.5 block text-xs font-medium" style={{ color: 'var(--wb-ink-2)' }}>
      {children}
    </p>
  )
}

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
  const meta = statusMeta(r.status)

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
      <div
        className="fixed right-0 top-0 z-50 h-full w-full max-w-md overflow-y-auto shadow-2xl animate-[slideIn_0.2s_ease-out]"
        style={{ background: 'var(--wb-surface)' }}
      >
        <style>{`@keyframes slideIn{from{transform:translateX(100%)}to{transform:translateX(0)}}`}</style>
        {/* 头部 */}
        <div
          className="sticky top-0 z-10 px-5 py-4 backdrop-blur"
          style={{ borderBottom: '1px solid var(--wb-line)', background: 'var(--wb-surface)' }}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <h3 className="text-base font-semibold leading-snug" style={{ color: 'var(--wb-ink)' }}>
                {r.name}
              </h3>
              <div className="mt-1.5 flex items-center gap-2">
                <span className={`wb-chip st-${r.status}`}>
                  <span className="dot" />
                  {meta.label}
                </span>
                <span className="text-xs" style={{ color: 'var(--wb-ink-3)' }}>
                  创建于 {fmtDate(r.createdAt)}
                </span>
              </div>
            </div>
            <button
              onClick={onClose}
              className="shrink-0 rounded-lg p-1.5 transition"
              style={{ color: 'var(--wb-ink-3)' }}
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
            <FieldLabel>状态</FieldLabel>
            <Select
              value={r.status}
              onChange={(s) => onStatusChange(r.id, s)}
              options={statusSelectOptions}
            />
          </div>

          {/* 关键字段 */}
          <div className="space-y-3">
            <DrawerField label="所属项目" value={requirementProjectDisplay(r)} />
            <DrawerField
              label="代码分支"
              value={r.branch}
              copyable
              copied={copiedField === 'branch'}
              onCopy={() => copyField('branch', r.branch)}
            />
            <DrawerField
              label="发布模块"
              value={requirementModuleDisplay(r)}
              copyable
              copied={copiedField === 'module'}
              onCopy={() => copyField('module', requirementModuleDisplay(r))}
            />
          </div>

          {/* 时间线 */}
          <div>
            <FieldLabel>时间线</FieldLabel>
            <div className="relative space-y-3 pl-4">
              <div
                className="absolute bottom-2 left-[5px] top-2 w-px"
                style={{ background: 'var(--wb-line)' }}
              />
              {TIMELINE.map(({ key, label }) => {
                const iso = r[key] as string | null
                const date = fmtDate(iso)
                const today = isDateToday(iso)
                const hasValue = date !== '—'
                return (
                  <div key={String(key)} className="relative flex items-center gap-2">
                    <span
                      className="absolute -left-4 h-2.5 w-2.5 rounded-full ring-2"
                      style={{
                        background: hasValue ? (today ? 'var(--wb-danger)' : 'var(--wb-brand-500)') : 'var(--wb-ink-3)',
                        boxShadow: `0 0 0 2px var(--wb-surface)`,
                        opacity: hasValue ? 1 : 0.5,
                      }}
                    />
                    <span className="w-20 shrink-0 text-xs" style={{ color: 'var(--wb-ink-3)' }}>{label}</span>
                    <span
                      className="text-sm"
                      style={{
                        color: hasValue ? (today ? 'var(--wb-danger)' : 'var(--wb-ink)') : 'var(--wb-ink-3)',
                        fontWeight: today ? 600 : 400,
                      }}
                    >
                      {date}
                      {today && (
                        <span
                          className="ml-1.5 rounded px-1 py-0.5 text-[10px] font-semibold"
                          style={{ background: 'var(--wb-danger-soft)', color: 'var(--wb-danger)' }}
                        >
                          今日
                        </span>
                      )}
                    </span>
                  </div>
                )
              })}
            </div>
          </div>

          {/* 备注 */}
          {r.remark && (
            <div>
              <FieldLabel>备注</FieldLabel>
              <div
                className="whitespace-pre-wrap rounded-lg border p-3 text-sm"
                style={{ borderColor: 'var(--wb-line)', background: 'var(--wb-surface-2)', color: 'var(--wb-ink-2)' }}
              >
                {r.remark}
              </div>
            </div>
          )}

          {/* 状态流转 */}
          <div>
            <FieldLabel>状态流转</FieldLabel>
            <div className="flex flex-wrap items-center gap-1">
              {STATUS_FLOW.map((s, i) => {
                const active = s === r.status
                const passed = STATUS_FLOW.indexOf(r.status) > i
                return (
                  <div key={s} className="flex items-center gap-1">
                    <span
                      className="rounded px-1.5 py-0.5 text-[11px]"
                      style={
                        active
                          ? { background: 'var(--wb-brand-600)', color: '#F6EFDF', fontWeight: 600 }
                          : passed
                            ? { color: 'var(--wb-success)' }
                            : { color: 'var(--wb-ink-3)' }
                      }
                    >
                      {statusMeta(s).label}
                    </span>
                    {i < STATUS_FLOW.length - 1 && (
                      <span style={{ color: 'var(--wb-ink-3)', opacity: 0.6 }}>→</span>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        </div>

        {/* 底部操作栏 */}
        <div
          className="sticky bottom-0 px-5 py-3 backdrop-blur"
          style={{ borderTop: '1px solid var(--wb-line)', background: 'var(--wb-surface)' }}
        >
          <button
            className="wb-btn-primary w-full"
            style={{ justifyContent: 'center' }}
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
      <span className="shrink-0 text-xs" style={{ color: 'var(--wb-ink-3)' }}>{label}</span>
      <div className="flex min-w-0 items-center gap-1.5">
        <span className="truncate text-sm" style={{ color: 'var(--wb-ink)' }}>
          {value || '—'}
        </span>
        {copyable && value && (
          <button
            onClick={onCopy}
            className="shrink-0 rounded p-1 transition"
            style={{ color: copied ? 'var(--wb-success)' : 'var(--wb-ink-3)' }}
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
