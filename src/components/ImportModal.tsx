import { useRef, useState } from 'react'
import { parseImportData, type MigratedRequirement } from '../lib/migrate'
import { Modal } from './ui'

export function ImportModal({
  open,
  onClose,
  onImport,
}: {
  open: boolean
  onClose: () => void
  onImport: (items: MigratedRequirement[]) => number
}) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [fileName, setFileName] = useState('')
  const [error, setError] = useState('')
  const [result, setResult] = useState('')

  const handleFile = (file: File) => {
    setError('')
    setResult('')
    setFileName(file.name)
    const reader = new FileReader()
    reader.onload = () => {
      try {
        const data = JSON.parse(String(reader.result))
        const items = parseImportData(data)
        if (items.length === 0) {
          setError('未能识别文件格式：既不是旧版需求记录，也不是本系统的导出格式。')
          return
        }
        const imported = onImport(items)
        setResult(
          imported > 0
            ? `导入成功：新增 ${imported} 条需求。`
            : `未新增：文件中的 ${items.length} 条需求已存在（按 id 去重）。`,
        )
      } catch (e) {
        setError('解析失败：请确认选择的是 JSON 文件。')
      }
    }
    reader.onerror = () => setError('读取文件失败，请重试。')
    reader.readAsText(file)
  }

  return (
    <Modal open={open} onClose={onClose} title="导入需求数据" width="max-w-lg">
      <p className="mb-4 text-sm text-slate-500 dark:text-slate-400">
        支持导入：旧版需求记录导出文件（自动转换字段）、本系统的 JSON 导出文件。
        按 id 去重合并，不会覆盖已有数据。
      </p>

      <div
        className="flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 px-6 py-10 text-center transition hover:border-indigo-400 hover:bg-indigo-50/50 dark:border-slate-700 dark:bg-slate-800/40 dark:hover:border-indigo-500 dark:hover:bg-indigo-500/10"
        onClick={() => fileRef.current?.click()}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault()
          const f = e.dataTransfer.files?.[0]
          if (f) handleFile(f)
        }}
      >
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="mb-3 text-slate-400">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" />
        </svg>
        <p className="text-sm font-medium text-slate-600 dark:text-slate-300">
          {fileName || '点击选择或拖拽 JSON 文件到此处'}
        </p>
        <p className="mt-1 text-xs text-slate-400">推荐：需求记录_2026-08-14.json</p>
        <input
          ref={fileRef}
          type="file"
          accept=".json,application/json"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) handleFile(f)
            e.target.value = ''
          }}
        />
      </div>

      {error && (
        <p className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-600 dark:bg-rose-500/10 dark:text-rose-400">
          {error}
        </p>
      )}
      {result && (
        <p className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-400">
          {result}
        </p>
      )}

      <div className="mt-6 flex justify-end gap-2">
        <button className="btn-ghost" onClick={onClose}>关闭</button>
      </div>
    </Modal>
  )
}
