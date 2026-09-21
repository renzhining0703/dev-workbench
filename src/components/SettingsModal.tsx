import { useEffect, useState, type ReactNode } from 'react'
import { Modal } from './ui'
import { useStore } from '../store/StoreContext'
import { ARCHIVE_MONTHS_RANGE } from '../lib/archive'
import { SHORTCUTS, SHORTCUTS_FOOTNOTE } from '../lib/shortcuts'
import { SettingsDisplayPanel } from './SettingsDisplayPanel'
import { SettingsNotificationPanel } from './SettingsNotificationPanel'

/**
 * 设置中心
 *
 * 把原先散落的三处设置收敛到一个弹窗：
 *   - 「偏好设置」弹窗（自动归档 / 字段显隐 / 状态显隐）
 *   - 「推送提醒」弹窗
 *   - 「更多」菜单里的「开启上线提醒」开关
 *
 * 结构：左侧分类导航 + 右侧内容区（各自独立滚动）。
 * 设计取向：开关型设置即时生效，不做「保存 / 取消」；
 * 需要显式确认的数值型设置（自动归档月份）在失焦或回车时提交。
 */

type SectionId = 'general' | 'display' | 'notifications' | 'shortcuts'

const SECTIONS: { id: SectionId; label: string; icon: ReactNode }[] = [
  {
    id: 'general',
    label: '常规',
    icon: (
      <>
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6h.09A1.65 1.65 0 0 0 10.6 3.09V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9v.09a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" />
      </>
    ),
  },
  {
    id: 'display',
    label: '外观与显示',
    icon: (
      <>
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <path d="M3 9h18M9 21V9" />
      </>
    ),
  },
  {
    id: 'notifications',
    label: '通知',
    icon: (
      <>
        <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
        <path d="M13.73 21a2 2 0 0 1-3.46 0" />
      </>
    ),
  },
  {
    id: 'shortcuts',
    label: '快捷键',
    icon: (
      <>
        <rect x="2" y="6" width="20" height="12" rx="2" />
        <path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M8 14h8" />
      </>
    ),
  },
]

/* ---------------- 常规 ---------------- */

/** 常用档位（落在合法区间内的才会渲染） */
const ARCHIVE_PRESETS = [1, 3, 6, 12]

function GeneralPanel() {
  const { archiveMonths, setArchiveMonths } = useStore()
  // 输入框用字符串本地态：允许中途清空，提交时才 clamp
  const [input, setInput] = useState(String(archiveMonths))

  // 云端推送 / 其它来源更新时同步回输入框
  useEffect(() => setInput(String(archiveMonths)), [archiveMonths])

  const clamp = (n: number) =>
    Math.max(ARCHIVE_MONTHS_RANGE.min, Math.min(ARCHIVE_MONTHS_RANGE.max, Math.floor(n)))

  const commit = (value: number) => {
    const next = clamp(Number.isNaN(value) ? ARCHIVE_MONTHS_RANGE.default : value)
    setInput(String(next))
    if (next !== archiveMonths) setArchiveMonths(next)
  }

  return (
    <div className="space-y-6">
      <section>
        <div className="mb-2">
          <h4 className="text-sm font-semibold" style={{ color: 'var(--wb-ink)' }}>
            自动归档月份
          </h4>
          <p className="mt-0.5 text-xs leading-relaxed" style={{ color: 'var(--wb-ink-3)' }}>
            已上线超过设定月份的需求，下次启动时自动移入归档（状态改为「已归档」），保持主列表干净。
            需要恢复时，在「更多 → 已归档」视图里把状态改回「已上线」即可。
            范围 {ARCHIVE_MONTHS_RANGE.min} ~ {ARCHIVE_MONTHS_RANGE.max} 个月。
          </p>
        </div>
        <div className="wb-set-card">
          <div className="wb-set-row">
            <div className="min-w-0 flex-1">
              <p className="text-sm" style={{ color: 'var(--wb-ink-2)' }}>
                归档阈值
              </p>
              <p className="mt-0.5 text-[11px]" style={{ color: 'var(--wb-ink-3)' }}>
                输入框失焦或回车后生效
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <input
                type="number"
                inputMode="numeric"
                min={ARCHIVE_MONTHS_RANGE.min}
                max={ARCHIVE_MONTHS_RANGE.max}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onBlur={(e) => commit(parseInt(e.target.value, 10))}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                }}
                className="wb-input w-20 text-center"
                aria-label="自动归档月份"
              />
              <span className="text-sm" style={{ color: 'var(--wb-ink-2)' }}>
                个月
              </span>
            </div>
          </div>
          {/* 窄屏时档位换到标签下方，避免「常用档位」被挤成竖排 */}
          <div className="wb-set-row stack">
            <div className="min-w-0">
              <p className="text-sm" style={{ color: 'var(--wb-ink-2)' }}>
                常用档位
              </p>
            </div>
            <div className="wb-pills shrink-0">
              {ARCHIVE_PRESETS.filter(
                (m) => m >= ARCHIVE_MONTHS_RANGE.min && m <= ARCHIVE_MONTHS_RANGE.max,
              ).map((m) => (
                <button
                  key={m}
                  type="button"
                  className={`wb-pill ${archiveMonths === m ? 'active' : ''}`}
                  onClick={() => commit(m)}
                >
                  {m} 个月
                </button>
              ))}
            </div>
          </div>
        </div>
        <p className="mt-2 text-xs" style={{ color: 'var(--wb-ink-3)' }}>
          💡 此设置会同步到云端，所有设备共享。
        </p>
      </section>
    </div>
  )
}

/* ---------------- 快捷键 ---------------- */

function ShortcutsPanel() {
  return (
    <div className="space-y-3">
      <div className="wb-set-card">
        {SHORTCUTS.map((s) => (
          <div key={s.keys[0]} className="wb-set-row">
            <span className="min-w-0 flex-1 text-sm" style={{ color: 'var(--wb-ink-2)' }}>
              {s.desc}
            </span>
            <div className="flex shrink-0 items-center gap-1">
              {s.keys.map((k) => (
                <kbd
                  key={k}
                  className="inline-flex min-w-[28px] items-center justify-center rounded-md border border-[var(--wb-line)] bg-[var(--wb-surface-2)] px-2 py-1 text-xs font-medium shadow-sm"
                  style={{ color: 'var(--wb-ink-2)' }}
                >
                  {k}
                </kbd>
              ))}
            </div>
          </div>
        ))}
      </div>
      <p className="text-xs" style={{ color: 'var(--wb-ink-3)' }}>
        {SHORTCUTS_FOOTNOTE}随时按 <kbd className="rounded border border-[var(--wb-line)] px-1">?</kbd> 打开这个列表。
      </p>
    </div>
  )
}

/* ---------------- 外壳 ---------------- */

interface Props {
  open: boolean
  onClose: () => void
  /** 初始分类（默认「常规」） */
  defaultSection?: SectionId
}

export function SettingsModal({ open, onClose, defaultSection = 'general' }: Props) {
  const [section, setSection] = useState<SectionId>(defaultSection)

  // 每次打开回到初始分类（与「记住上次」相比更可预期）
  useEffect(() => {
    if (open) setSection(defaultSection)
  }, [open, defaultSection])

  return (
    <Modal open={open} onClose={onClose} title="设置" width="max-w-3xl" flush>
      <div className="flex h-[68vh] max-h-[600px] min-h-[340px] flex-col sm:flex-row">
        <nav
          className="flex shrink-0 gap-1 overflow-x-auto border-b p-2 sm:w-44 sm:flex-col sm:overflow-visible sm:border-b-0 sm:border-r sm:p-2.5"
          style={{ borderColor: 'var(--wb-line)' }}
          aria-label="设置分类"
        >
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => setSection(s.id)}
              className={`wb-set-nav-item ${section === s.id ? 'active' : ''}`}
              aria-current={section === s.id ? 'true' : undefined}
            >
              <svg
                width="15"
                height="15"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.9"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="shrink-0"
                aria-hidden
              >
                {s.icon}
              </svg>
              {s.label}
            </button>
          ))}
        </nav>

        {/* min-h-0 必须保留：否则 flex 子项不会收缩，内部 overflow-y-auto 失效 */}
        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          {section === 'general' && <GeneralPanel />}
          {section === 'display' && <SettingsDisplayPanel />}
          {section === 'notifications' && <SettingsNotificationPanel />}
          {section === 'shortcuts' && <ShortcutsPanel />}
        </div>
      </div>
    </Modal>
  )
}
