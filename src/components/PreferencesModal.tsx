import { useEffect, useState } from 'react'
import { Modal } from './ui'
import { ARCHIVE_MONTHS_RANGE } from '../lib/archive'
import { useStore } from '../store/StoreContext'

interface Props {
  open: boolean
  onClose: () => void
}

/**
 * 偏好设置弹窗
 * 当前仅包含"自动归档月份"；其他偏好可在此扩展
 *
 * 数据来源：store.archiveMonths / store.setArchiveMonths（走同步通道）
 */
export function PreferencesModal({ open, onClose }: Props) {
  const { archiveMonths, setArchiveMonths } = useStore()
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
            <span className="text-sm font-medium text-slate-700 dark:text-slate-200">
              自动归档月份
            </span>
            <span className="text-[11px] text-slate-400">
              范围 {ARCHIVE_MONTHS_RANGE.min} ~ {ARCHIVE_MONTHS_RANGE.max} 个月
            </span>
          </label>
          <p className="mb-3 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
            已上线超过设定月份的需求，下次启动时自动移入归档列表（状态改为「已归档」），
            保持主列表干净。如需恢复，在「更多 → 已归档」视图里手动改回「已上线」即可。
          </p>
          <p className="mb-3 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
            💡 此设置会同步到云端，所有设备共享。
          </p>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={ARCHIVE_MONTHS_RANGE.min}
              max={ARCHIVE_MONTHS_RANGE.max}
              value={months}
              onChange={(e) => setMonths(parseInt(e.target.value, 10) || ARCHIVE_MONTHS_RANGE.min)}
              className="input w-24 text-center"
            />
            <span className="text-sm text-slate-500 dark:text-slate-400">个月</span>
          </div>
        </div>
      </div>

      <div className="mt-6 flex justify-end gap-2">
        <button className="btn-ghost" onClick={onClose}>
          取消
        </button>
        <button className="btn-primary" onClick={save}>
          保存
        </button>
      </div>
    </Modal>
  )
}
