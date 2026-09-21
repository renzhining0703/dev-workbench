import { useMemo, useState } from 'react'
import { useStore } from '../store/StoreContext'
import { THEME_OPTIONS, useTheme } from '../store/ThemeContext'
import { STATUS_FLOW, statusMeta } from '../types'
import type { RequirementStatus } from '../types'
import {
  FIELD_BLOCKS,
  FIELD_GROUPS,
  defaultFieldOrder,
  fieldLabel,
  isVisible,
  moveFieldBlock,
  orderedSortableBlocks,
  shiftFieldBlock,
  type FieldBlockId,
  type RequirementFieldKey,
} from '../lib/fields'
import { isStatusVisible } from '../lib/statuses'
import { ROLE_PRESETS } from '../lib/rolePresets'
import { Switch } from './ui'

/**
 * 设置中心 · 外观与显示面板
 *
 * 四块内容：
 *   使用视角  —— 开发 / 产品一键预设（打包下方三块配置），手动调整后变自定义
 *   主题      —— 跟随系统 / 浅色 / 深色（与顶栏切换按钮共享同一份状态）
 *   字段显示  —— 逐字段开关，作用于表单、列表、看板、详情抽屉
 *   列表列顺序 —— 按「展示块」拖拽调整列表列 / 移动端卡片块的顺序
 */

/** 区块小标题 + 右侧操作 */
function SectionHead({
  title,
  desc,
  action,
}: {
  title: string
  desc?: string
  action?: React.ReactNode
}) {
  return (
    <div className="mb-2 flex items-end justify-between gap-3">
      <div className="min-w-0">
        <h4 className="text-sm font-semibold" style={{ color: 'var(--wb-ink)' }}>
          {title}
        </h4>
        {desc && (
          <p className="mt-0.5 text-xs leading-relaxed" style={{ color: 'var(--wb-ink-3)' }}>
            {desc}
          </p>
        )}
      </div>
      {action}
    </div>
  )
}

/** 一行开关项：左侧文案 + 右侧 Switch */
function ToggleRow({
  label,
  hint,
  checked,
  onChange,
  leading,
}: {
  label: string
  hint?: string
  checked: boolean
  onChange: (next: boolean) => void
  leading?: React.ReactNode
}) {
  return (
    <div className="wb-set-row">
      {leading}
      <div className="min-w-0 flex-1">
        <span className="text-sm" style={{ color: 'var(--wb-ink-2)' }}>
          {label}
        </span>
        {hint && (
          <p className="mt-0.5 text-[11px]" style={{ color: 'var(--wb-ink-3)' }}>
            {hint}
          </p>
        )}
      </div>
      <Switch checked={checked} onChange={onChange} label={label} />
    </div>
  )
}

/* ---------------- 使用视角 ---------------- */

/**
 * 使用视角（开发 / 产品 / 自定义）。
 *
 * - 两个预设会一次性覆盖下方「字段显示 / 状态显示 / 列表列顺序」三块配置，切换前弹确认
 * - 「自定义」也可直接点选：只解除与预设的绑定，**不改动**当前三块配置；
 *   在下方手动调整任意配置后也会自动落到这里
 */
function RoleSection() {
  const { uiRole, applyRolePreset, setUiRole } = useStore()

  /**
   * 点击预设 = 一键覆盖下方三块配置。
   * 已选中的预设也允许「重新应用」——预设定义会随版本演进而调整，
   * 老用户需要一条无需手动重配就能对齐新预设的路径。
   */
  const select = (id: 'dev' | 'pm') => {
    const preset = ROLE_PRESETS.find((p) => p.id === id)
    if (!preset) return
    const ok = window.confirm(
      uiRole === id
        ? `重新应用「${preset.label}」预设：会用最新预设覆盖你之后的任何手动调整（字段显示、状态显示、列顺序）。\n数据本身不受影响，确定吗？`
        : `切换到「${preset.label}」会用预设覆盖当前的字段显示、状态显示与列顺序配置。\n数据本身不受影响，确定切换吗？`,
    )
    if (ok) applyRolePreset(id)
  }

  /** 选中「自定义」：保留当前配置，仅把视角标记切到 custom（无覆盖，故不弹确认） */
  const selectCustom = () => {
    if (uiRole === 'custom') return
    setUiRole('custom')
  }

  const cardStyle = (active: boolean) => ({
    borderColor: active ? 'var(--wb-brand-500)' : 'var(--wb-line)',
    background: active ? 'var(--wb-brand-soft, rgba(42,112,86,.1))' : 'var(--wb-surface)',
    cursor: 'pointer' as const,
  })

  const titleStyle = (active: boolean, muted = false) => ({
    color: active
      ? 'var(--wb-brand-600, var(--wb-brand-500))'
      : muted
        ? 'var(--wb-ink-2)'
        : 'var(--wb-ink)',
  })

  return (
    <section>
      <SectionHead
        title="使用视角"
        desc="一键应用预设：自动配置下方三块的显隐与顺序。前端开发与产品经理按各自习惯选择即可。"
      />
      <div className="grid gap-2 sm:grid-cols-3">
        {ROLE_PRESETS.map((p) => {
          const active = uiRole === p.id
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => select(p.id)}
              aria-pressed={active}
              className="rounded-xl border p-3 text-left transition hover:opacity-85"
              style={cardStyle(active)}
            >
              <span className="text-sm font-medium" style={titleStyle(active)}>
                {active ? '✓ ' : ''}
                {p.label}
                {active && (
                  <span className="ml-1 font-normal" style={{ color: 'var(--wb-ink-3)', fontSize: 11 }}>
                    点击可重新应用
                  </span>
                )}
              </span>
              <p className="mt-1 text-[11px] leading-relaxed" style={{ color: 'var(--wb-ink-3)' }}>
                {p.desc}
              </p>
            </button>
          )
        })}
        {/* 自定义：可点选（不覆盖配置），也是手动调整后的落点状态 */}
        <button
          type="button"
          onClick={selectCustom}
          aria-pressed={uiRole === 'custom'}
          className="rounded-xl border p-3 text-left transition hover:opacity-85"
          style={cardStyle(uiRole === 'custom')}
        >
          <span className="text-sm font-medium" style={titleStyle(uiRole === 'custom', true)}>
            {uiRole === 'custom' ? '✓ ' : ''}自定义
          </span>
          <p className="mt-1 text-[11px] leading-relaxed" style={{ color: 'var(--wb-ink-3)' }}>
            保留当前配置，不跟预设绑定；在下方手动调整字段、状态或顺序后也会自动落到这里
          </p>
        </button>
      </div>
    </section>
  )
}

/* ---------------- 主题 ---------------- */

function ThemeSection() {
  const { pref, setPref } = useTheme()
  return (
    <section>
      <SectionHead title="主题" desc="与顶栏的明暗切换按钮是同一份设置，改哪边都会同步。" />
      <div className="wb-pills">
        {THEME_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            type="button"
            className={`wb-pill ${pref === opt.value ? 'active' : ''}`}
            onClick={() => setPref(opt.value)}
            title={opt.desc}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </section>
  )
}

/* ---------------- 字段显示 ---------------- */

function FieldVisibilitySection() {
  const { visibleFields, setVisibleField } = useStore()
  const hiddenCount = FIELD_GROUPS.reduce(
    (n, g) => n + g.keys.filter((k) => !isVisible(visibleFields, k)).length,
    0,
  )

  const showAll = (keys: RequirementFieldKey[]) => {
    for (const k of keys) setVisibleField(k, true)
  }

  return (
    <section>
      <SectionHead
        title="字段显示"
        desc="关闭的字段在需求表单、列表、看板与详情里都不再展示；数据仍然保留，随时可以重新打开。"
        action={
          hiddenCount > 0 ? (
            <button
              type="button"
              className="shrink-0 text-xs transition hover:opacity-70"
              style={{ color: 'var(--wb-brand-500)' }}
              onClick={() => showAll(FIELD_GROUPS.flatMap((g) => g.keys))}
            >
              全部显示（{hiddenCount} 项已隐藏）
            </button>
          ) : undefined
        }
      />
      <div className="space-y-3">
        {FIELD_GROUPS.map((group) => (
          <div key={group.label}>
            <p
              className="mb-1.5 text-[11px] font-medium tracking-wide"
              style={{ color: 'var(--wb-ink-3)' }}
            >
              {group.label}
            </p>
            <div className="wb-set-card">
              {group.keys.map((k) => (
                <ToggleRow
                  key={k}
                  label={fieldLabel(k)}
                  checked={isVisible(visibleFields, k)}
                  onChange={(next) => setVisibleField(k, next)}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
      <p className="mt-2 text-xs" style={{ color: 'var(--wb-ink-3)' }}>
        💡 随账号云端同步（settings.uiPrefs 通道），换设备无需重配；「需求名称」为标识字段，恒显。
      </p>
    </section>
  )
}

/* ---------------- 需求状态显示 ---------------- */

function StatusVisibilitySection() {
  const { visibleStatuses, setVisibleStatus } = useStore()
  const hidden = STATUS_FLOW.filter((s) => !isStatusVisible(visibleStatuses, s))

  return (
    <section>
      <SectionHead
        title="需求状态显示"
        desc="关闭的状态不会出现在筛选、状态下拉与看板列里；「全部」视图仍能看到这些需求，数据不会丢。"
        action={
          hidden.length > 0 ? (
            <button
              type="button"
              className="shrink-0 text-xs transition hover:opacity-70"
              style={{ color: 'var(--wb-brand-500)' }}
              onClick={() => STATUS_FLOW.forEach((s) => setVisibleStatus(s, true))}
            >
              全部显示（{hidden.length} 项已隐藏）
            </button>
          ) : undefined
        }
      />
      <div className="wb-set-card">
        {STATUS_FLOW.map((s: RequirementStatus) => {
          const meta = statusMeta(s)
          return (
            <ToggleRow
              key={s}
              label={meta.label}
              checked={isStatusVisible(visibleStatuses, s)}
              onChange={(next) => setVisibleStatus(s, next)}
              leading={
                <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${meta.dot}`} aria-hidden />
              }
            />
          )
        })}
      </div>
      <p className="mt-2 text-xs" style={{ color: 'var(--wb-ink-3)' }}>
        💡 随账号云端同步；统计页与筛选口径跟随此处配置，不影响数据与自动归档逻辑。
      </p>
    </section>
  )
}

/* ---------------- 列表列顺序 ---------------- */

function FieldOrderSection() {
  const { fieldOrder, setFieldOrder, resetFieldOrder } = useStore()
  const blocks = useMemo(() => orderedSortableBlocks(fieldOrder), [fieldOrder])
  const pinned = FIELD_BLOCKS.filter((b) => b.pinned)
  const [dragId, setDragId] = useState<FieldBlockId | null>(null)
  const [overId, setOverId] = useState<FieldBlockId | null>(null)

  const isDefault = useMemo(() => {
    const defaultIds = orderedSortableBlocks(defaultFieldOrder()).map((b) => b.id)
    return blocks.map((b) => b.id).join(',') === defaultIds.join(',')
  }, [blocks])

  const drop = (targetId: FieldBlockId) => {
    if (!dragId || dragId === targetId) return
    const to = blocks.findIndex((b) => b.id === targetId)
    if (to < 0) return
    setFieldOrder(moveFieldBlock(fieldOrder, dragId, to))
  }

  return (
    <section>
      <SectionHead
        title="列表列顺序"
        desc="拖拽调整需求列表的列顺序（含移动端卡片）；也可用箭头微调。"
        action={
          !isDefault ? (
            <button
              type="button"
              className="shrink-0 text-xs transition hover:opacity-70"
              style={{ color: 'var(--wb-brand-500)' }}
              onClick={resetFieldOrder}
            >
              恢复默认
            </button>
          ) : undefined
        }
      />
      <ul className="space-y-1.5">
        {blocks.map((b, i) => (
          <li
            key={b.id}
            draggable
            onDragStart={(e) => {
              setDragId(b.id)
              e.dataTransfer.effectAllowed = 'move'
              // Firefox 需要写入数据才会触发拖拽
              e.dataTransfer.setData('text/plain', b.id)
            }}
            onDragOver={(e) => {
              e.preventDefault()
              e.dataTransfer.dropEffect = 'move'
              if (dragId && dragId !== b.id) setOverId(b.id)
            }}
            onDragLeave={() => setOverId((cur) => (cur === b.id ? null : cur))}
            onDrop={(e) => {
              e.preventDefault()
              drop(b.id)
              setDragId(null)
              setOverId(null)
            }}
            onDragEnd={() => {
              setDragId(null)
              setOverId(null)
            }}
            className={`wb-drag-item flex items-center gap-2 rounded-xl border px-2.5 py-2 ${
              dragId === b.id ? 'dragging' : ''
            } ${overId === b.id ? 'drop-target' : ''}`}
            style={{
              borderColor: 'var(--wb-line)',
              background: 'var(--wb-surface)',
              cursor: 'grab',
            }}
          >
            <span
              className="shrink-0"
              style={{ color: 'var(--wb-ink-3)' }}
              aria-hidden
              title="按住拖拽排序"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                <circle cx="9" cy="6" r="1.4" />
                <circle cx="15" cy="6" r="1.4" />
                <circle cx="9" cy="12" r="1.4" />
                <circle cx="15" cy="12" r="1.4" />
                <circle cx="9" cy="18" r="1.4" />
                <circle cx="15" cy="18" r="1.4" />
              </svg>
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm" style={{ color: 'var(--wb-ink)' }}>
                {b.label}
              </p>
              <p className="truncate text-[11px]" style={{ color: 'var(--wb-ink-3)' }}>
                {b.keys.map(fieldLabel).join(' · ')}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-0.5">
              <button
                type="button"
                className="wb-icon-sm"
                disabled={i === 0}
                onClick={() => setFieldOrder(shiftFieldBlock(fieldOrder, b.id, -1))}
                aria-label={`${b.label} 上移`}
                title="上移"
                style={i === 0 ? { opacity: 0.3, cursor: 'not-allowed' } : undefined}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="m18 15-6-6-6 6" />
                </svg>
              </button>
              <button
                type="button"
                className="wb-icon-sm"
                disabled={i === blocks.length - 1}
                onClick={() => setFieldOrder(shiftFieldBlock(fieldOrder, b.id, 1))}
                aria-label={`${b.label} 下移`}
                title="下移"
                style={
                  i === blocks.length - 1 ? { opacity: 0.3, cursor: 'not-allowed' } : undefined
                }
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="m6 9 6 6 6-6" />
                </svg>
              </button>
            </div>
          </li>
        ))}
      </ul>
      <div className="mt-2 space-y-1">
        {pinned.map((b) => (
          <p key={b.id} className="text-xs" style={{ color: 'var(--wb-ink-3)' }}>
            📌 <b style={{ color: 'var(--wb-ink-2)' }}>{b.label}</b>：{b.pinnedHint}
          </p>
        ))}
        <p className="text-xs" style={{ color: 'var(--wb-ink-3)' }}>
          💡 顺序不影响表单与详情抽屉的字段排列。
        </p>
      </div>
    </section>
  )
}

export function SettingsDisplayPanel() {
  return (
    <div className="space-y-7">
      <RoleSection />
      <ThemeSection />
      <FieldVisibilitySection />
      <StatusVisibilitySection />
      <FieldOrderSection />
    </div>
  )
}
