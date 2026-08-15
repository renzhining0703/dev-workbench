import { useRef, useState } from 'react'
import { format } from 'date-fns'
import { Modal, ConfirmDialog } from './ui'
import { exportAllData, type BackupData } from '../lib/storage'
import type { Requirement, TodoItem, Project } from '../types'

interface Props {
  open: boolean
  onClose: () => void
  onRestore: (data: BackupData) => boolean
  counts: { requirements: number; todos: number; projects: number }
}

export function BackupModal({ open, onClose, onRestore, counts }: Props) {
  const [restorePreview, setRestorePreview] = useState<BackupData | null>(null)
  const [error, setError] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  /** 导出完整备份 JSON */
  function doExport() {
    const data = exportAllData()
    const json = JSON.stringify(data, null, 2)
    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `dev-workbench-backup-${format(new Date(), 'yyyy-MM-dd')}.json`
    a.click()
    URL.revokeObjectURL(url)
    onClose()
  }

  /** 读取备份文件并预览 */
  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    setError('')
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result)) as Partial<BackupData>
        if (!parsed || !Array.isArray(parsed.requirements)) {
          setError('文件格式不正确：缺少 requirements 数组')
          return
        }
        setRestorePreview({
          version: parsed.version ?? 1,
          exportedAt: parsed.exportedAt ?? '',
          requirements: parsed.requirements as Requirement[],
          todos: (parsed.todos ?? []) as TodoItem[],
          projects: (parsed.projects ?? []) as Project[],
        })
      } catch {
        setError('无法解析文件，请确认是工作台导出的 JSON 备份')
      }
    }
    reader.onerror = () => setError('文件读取失败')
    reader.readAsText(file)
    // 清空 input 允许重复选同一文件
    e.target.value = ''
  }

  function confirmRestore() {
    if (!restorePreview) return
    const ok = onRestore(restorePreview)
    if (ok) {
      setRestorePreview(null)
      onClose()
    }
  }

  return (
    <>
      <Modal open={open && !restorePreview} onClose={onClose} title="数据备份" width="max-w-md">
        {error && (
          <div className="mb-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-600 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-400">
            {error}
          </div>
        )}

        {/* 当前数据概览 */}
        <div className="mb-5 rounded-lg border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800/50">
          <p className="mb-2 text-xs font-medium text-slate-500 dark:text-slate-400">当前数据</p>
          <div className="grid grid-cols-3 gap-3 text-center">
            <div>
              <div className="text-2xl font-bold text-slate-800 dark:text-slate-100">{counts.requirements}</div>
              <div className="text-xs text-slate-400">需求</div>
            </div>
            <div>
              <div className="text-2xl font-bold text-slate-800 dark:text-slate-100">{counts.todos}</div>
              <div className="text-xs text-slate-400">待办</div>
            </div>
            <div>
              <div className="text-2xl font-bold text-slate-800 dark:text-slate-100">{counts.projects}</div>
              <div className="text-xs text-slate-400">项目</div>
            </div>
          </div>
        </div>

        {/* 导出 */}
        <div className="mb-4 flex items-start gap-3 rounded-lg border border-slate-200 p-4 dark:border-slate-700">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-400">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" />
            </svg>
          </div>
          <div className="flex-1">
            <p className="text-sm font-medium text-slate-700 dark:text-slate-200">导出完整备份</p>
            <p className="mt-0.5 text-xs text-slate-400">将所有需求、待办、项目导出为 JSON 文件，可用于恢复或迁移</p>
            <button className="btn-primary mt-2.5 !py-1.5 text-xs" onClick={doExport}>
              下载备份文件
            </button>
          </div>
        </div>

        {/* 导入 */}
        <div className="flex items-start gap-3 rounded-lg border border-slate-200 p-4 dark:border-slate-700">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600 dark:bg-indigo-500/15 dark:text-indigo-400">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12" />
            </svg>
          </div>
          <div className="flex-1">
            <p className="text-sm font-medium text-slate-700 dark:text-slate-200">从备份恢复</p>
            <p className="mt-0.5 text-xs text-slate-400">选择备份 JSON 文件，确认后覆盖当前全部数据</p>
            <button className="btn-ghost mt-2.5 !py-1.5 text-xs" onClick={() => fileRef.current?.click()}>
              选择备份文件
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={handleFile}
            />
          </div>
        </div>

        <div className="mt-5 flex items-center gap-1.5 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-600 dark:bg-amber-500/10 dark:text-amber-400">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0ZM12 9v4M12 17h.01" />
          </svg>
          恢复操作会覆盖当前全部数据，请确认备份文件来源可信
        </div>
      </Modal>

      {/* 恢复确认弹窗 */}
      <ConfirmDialog
        open={!!restorePreview}
        title="确认恢复数据"
        message={
          restorePreview
            ? `备份包含 ${restorePreview.requirements.length} 条需求、${restorePreview.todos.length} 条待办、${restorePreview.projects.length} 个项目。恢复后将覆盖当前全部数据，确定继续吗？`
            : ''
        }
        onCancel={() => setRestorePreview(null)}
        onConfirm={confirmRestore}
      />
    </>
  )
}
