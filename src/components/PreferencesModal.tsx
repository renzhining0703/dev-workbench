import { useEffect, useState } from 'react'
import { Modal } from './ui'
import { ARCHIVE_MONTHS_RANGE } from '../lib/archive'
import { REQUIREMENT_FIELDS, isVisible } from '../lib/fields'
import { isStatusVisible } from '../lib/statuses'
import { STATUS_FLOW, statusMeta } from '../types'
import { useStore } from '../store/StoreContext'

interface Props {
  open: boolean
  onClose: () => void
}

/**
 * 偏好设置弹窗
 * 包含"自动归档月份"（同步）与"需求字段显示"（本设备）两个区块
 *
 * 数据来源：store.archiveMonths / store.setArchiveMonths（走同步通道）
 * 字段显隐：store.visibleFields / store.setVisibleField（本地，即时生效）
 */
export function PreferencesModal({ open, onClose }: Props) {
  const { archiveMonths, setArchiveMonths, visibleFields, setVisibleField, visibleStatuses, setVisibleStatus } = useStore()
  const [months, setMonths] = useState(archiveMonths)

  // 打开时从 store 重新读取（处理跨标签页 / 服务端推送的更新）
  useEffect(() => {
    if (open) setMonths(archiveMonths)
  }, [open, archiveMonths])

  const save = () => {
    setArchiveMonths(months)
    onClose()
  }

  return (
    <Modal open={open} onClose={onClose} title="偏好设置" width="max-w-md">
      <div className="space-y-5">
        {/* 自动归档设置 */}
        <div>
          <label className="mb-1 flex items-baseline justify-between">
            <span className="text-sm font-medium" style={{ color: 'var(--wb-ink)' }}>
              自动归档月份
            </span>
            <span className="text-[11px]" style={{ color: 'var(--wb-ink-3)' }}>
              范围 {ARCHIVE_MONTHS_RANGE.min} ~ {ARCHIVE_MONTHS_RANGE.max} 个月
            </span>
          </label>
          <p className="mb-3 text-xs leading-relaxed" style={{ color: 'var(--wb-ink-2)' }}>
            已上线超过设定月份的需求，下次启动时自动移入归档列表（状态改为「已归档」），
            保持主列表干净。如需恢复，在「更多 → 已归档」视图里手动改回「已上线」即可。
          </p>
          <p className="mb-3 text-xs leading-relaxed" style={{ color: 'var(--wb-ink-2)' }}>
            💡 此设置会同步到云端，所有设备共享。
          </p>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={ARCHIVE_MONTHS_RANGE.min}
              max={ARCHIVE_MONTHS_RANGE.max}
              value={months}
              onChange={(e) => setMonths(parseInt(e.target.value, 10) || ARCHIVE_MONTHS_RANGE.min)}
              className="wb-input w-24 text-center"
            />
            <span className="text-sm" style={{ color: 'var(--wb-ink-2)' }}>个月</span>
          </div>
        </div>

        {/* 需求字段显示 */}
        <div>
          <label className="mb-1 block text-sm font-medium" style={{ color: 'var(--wb-ink)' }}>
            需求字段显示
          </label>
          <p className="mb-3 text-xs leading-relaxed" style={{ color: 'var(--wb-ink-2)' }}>
            勾选才会在新建/编辑弹窗与列表中展示；取消勾选则隐藏。
            「需求名称」为标识字段恒显，不在此列。
          </p>
          <p className="mb-3 text-xs leading-relaxed" style={{ color: 'var(--wb-ink-2)' }}>
            💡 此设置即时生效，仅保存在本设备，不同设备可各自配置。
          </p>
          <div className="grid grid-cols-2 gap-x-4 gap-y-2">
            {REQUIREMENT_FIELDS.map((f) => (
              <label
                key={f.key}
                className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1 transition hover:bg-[var(--wb-surface-2)]"
              >
                <input
                  type="checkbox"
                  checked={isVisible(visibleFields, f.key)}
                  onChange={(e) => setVisibleField(f.key, e.target.checked)}
                  className="h-3.5 w-3.5 rounded border-[var(--wb-line-2)]"
                  style={{ accentColor: 'var(--wb-brand-500)' }}
                />
                <span className="text-sm" style={{ color: 'var(--wb-ink-2)' }}>{f.label}</span>
              </label>
            ))}
          </div>
        </div>

        {/* 需求状态显示 */}
        <div>
          <label className="mb-1 block text-sm font-medium" style={{ color: 'var(--wb-ink)' }}>
            需求状态显示
          </label>
          <p className="mb-3 text-xs leading-relaxed" style={{ color: 'var(--wb-ink-2)' }}>
            勾选才会在筛选、状态下拉与看板列中展示；取消勾选则隐藏。
            隐藏状态的需求仍保留在「全部」视图中，不会丢失。
          </p>
          <p className="mb-3 text-xs leading-relaxed" style={{ color: 'var(--wb-ink-2)' }}>
            💡 此设置即时生效，仅保存在本设备，不同设备可各自配置。
          </p>
          <div className="grid grid-cols-2 gap-x-4 gap-y-2">
            {STATUS_FLOW.map((s) => (
              <label
                key={s}
                className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1 transition hover:bg-[var(--wb-surface-2)]"
              >
                <input
                  type="checkbox"
                  checked={isStatusVisible(visibleStatuses, s)}
                  onChange={(e) => setVisibleStatus(s, e.target.checked)}
                  className="h-3.5 w-3.5 rounded border-[var(--wb-line-2)]"
                  style={{ accentColor: 'var(--wb-brand-500)' }}
                />
                <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${statusMeta(s).dot}`} />
                <span className="text-sm" style={{ color: 'var(--wb-ink-2)' }}>{statusMeta(s).label}</span>
              </label>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-6 flex justify-end gap-2">
        <button className="wb-btn-ghost" onClick={onClose}>
          取消
        </button>
        <button className="wb-btn-primary" onClick={save}>
          保存
        </button>
      </div>
    </Modal>
  )
}
