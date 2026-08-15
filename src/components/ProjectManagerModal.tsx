import { useMemo, useState } from 'react'
import { useStore } from '../store/StoreContext'
import { extractProjectNames } from '../lib/projects'
import { ConfirmDialog, EmptyState, Modal } from './ui'

/**
 * 项目管理弹窗：项目下拉的数据源维护入口。
 * 支持新增 / 行内改名 / 删除（删除仅影响下拉选项，历史需求记录保留）。
 */
export function ProjectManagerModal({
  open,
  onClose,
}: {
  open: boolean
  onClose: () => void
}) {
  const { projects, requirements, addProject, updateProject, removeProject } = useStore()

  // 新增
  const [newName, setNewName] = useState('')
  // 行内编辑中的项目 id（null 表示未编辑）
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  // 删除确认
  const [deleting, setDeleting] = useState<{ id: string; name: string } | null>(null)
  // 操作反馈
  const [msg, setMsg] = useState('')

  /** 每个项目被需求引用的条数（按项目名拆分匹配历史数据） */
  const usageCount = useMemo(() => {
    const map = new Map<string, number>()
    for (const r of requirements) {
      for (const name of extractProjectNames(r.project)) {
        map.set(name, (map.get(name) ?? 0) + 1)
      }
    }
    return map
  }, [requirements])

  const flash = (m: string) => {
    setMsg(m)
    window.setTimeout(() => setMsg(''), 2500)
  }

  const handleAdd = () => {
    const ok = addProject(newName)
    if (ok) {
      setNewName('')
      flash(`已添加项目「${newName.trim()}」`)
    } else {
      flash('添加失败：项目名为空或已存在')
    }
  }

  const handleSaveEdit = () => {
    if (!editingId) return
    const ok = updateProject(editingId, editName)
    if (ok) {
      setEditingId(null)
      setEditName('')
      flash('项目已重命名')
    } else {
      flash('重命名失败：项目名为空或与其他项目重复')
    }
  }

  const startEdit = (id: string, name: string) => {
    setEditingId(id)
    setEditName(name)
  }

  const confirmDelete = () => {
    if (!deleting) return
    removeProject(deleting.id)
    flash(`已删除项目「${deleting.name}」（历史需求记录不受影响）`)
    setDeleting(null)
  }

  return (
    <>
      <Modal open={open} onClose={onClose} title="项目管理" width="max-w-xl">
        <p className="mb-4 text-xs text-slate-400 dark:text-slate-500">
          维护需求表单与列表筛选中的项目下拉数据。删除仅影响下拉选项，历史需求记录不会丢失。
        </p>

        {msg && (
          <div className="mb-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
            {msg}
          </div>
        )}

        {/* 新增 */}
        <div className="mb-4 flex gap-2">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleAdd()
            }}
            placeholder="输入新项目名，如 icare-xxx"
            className="input flex-1"
          />
          <button className="btn-primary" onClick={handleAdd}>
            添加
          </button>
        </div>

        {/* 列表 */}
        {projects.length === 0 ? (
          <EmptyState title="还没有项目" subtitle="在上方输入项目名添加" />
        ) : (
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {projects.map((p) => {
              const count = usageCount.get(p.name) ?? 0
              const editing = editingId === p.id
              return (
                <li key={p.id} className="flex items-center gap-3 py-2.5">
                  {editing ? (
                    <>
                      <input
                        autoFocus
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleSaveEdit()
                          if (e.key === 'Escape') {
                            setEditingId(null)
                            setEditName('')
                          }
                        }}
                        className="input flex-1"
                      />
                      <button className="btn-primary" onClick={handleSaveEdit}>
                        保存
                      </button>
                      <button
                        className="btn-ghost"
                        onClick={() => {
                          setEditingId(null)
                          setEditName('')
                        }}
                      >
                        取消
                      </button>
                    </>
                  ) : (
                    <>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium text-slate-700 dark:text-slate-200">
                          {p.name}
                        </div>
                        <div className="mt-0.5 text-xs text-slate-400 dark:text-slate-500">
                          关联需求 {count} 条
                        </div>
                      </div>
                      <button
                        className="btn-ghost px-2 py-1 text-xs"
                        onClick={() => startEdit(p.id, p.name)}
                      >
                        编辑
                      </button>
                      <button
                        className="btn-ghost px-2 py-1 text-xs text-rose-500 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950/50"
                        onClick={() => setDeleting({ id: p.id, name: p.name })}
                      >
                        删除
                      </button>
                    </>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </Modal>

      <ConfirmDialog
        open={!!deleting}
        title={`删除项目「${deleting?.name ?? ''}」？`}
        message={
          (usageCount.get(deleting?.name ?? '') ?? 0) > 0
            ? `该项目被 ${usageCount.get(deleting?.name ?? '') ?? 0} 条需求引用，删除后这些需求记录不受影响，但下拉中将不再显示该项目。`
            : '该项目未被需求引用，删除后下拉中将不再显示。'
        }
        onCancel={() => setDeleting(null)}
        onConfirm={confirmDelete}
      />
    </>
  )
}
