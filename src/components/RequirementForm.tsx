import { useEffect, useMemo, useState } from 'react'
import { format } from 'date-fns'
import type { Requirement } from '../types'
import { useStore } from '../store/StoreContext'
import { Modal } from './ui'
import { Select, statusSelectOptions } from './Select'

export type RequirementDraft = Omit<Requirement, 'id' | 'createdAt' | 'updatedAt'>

/** 新建需求时的分支前缀：`feature/YYYYMMDD/REQ-`，日期按当时动态计算 */
const newRequirementBranchPrefix = (): string =>
  `feature/${format(new Date(), 'yyyyMMdd')}/REQ-`

const emptyDraft = (): RequirementDraft => ({
  name: '',
  project: '',
  branch: newRequirementBranchPrefix(),
  publishModule: '',
  status: 'pending',
  devStartTime: null,
  devEndTime: null,
  testTime: null,
  publishTime: null,
  remark: '',
})

/** 时间字段：ISO -> yyyy-MM-dd，供 input[type=date] 使用 */
function toDateInput(iso: string | null): string {
  if (!iso) return ''
  return iso.slice(0, 10)
}

/** 时间字段以 yyyy-MM-dd 存储（无时区问题，便于导出/判断） */
export function RequirementFormModal({
  open,
  initial,
  onClose,
  onSave,
}: {
  open: boolean
  initial: Requirement | null
  onClose: () => void
  onSave: (draft: RequirementDraft) => void
}) {
  const [draft, setDraft] = useState<RequirementDraft>(emptyDraft)
  // 创建时间只读展示：编辑时取原值，新建时为今天
  const [createdAtStr, setCreatedAtStr] = useState(() => new Date().toISOString())

  const { projects } = useStore()

  /** 项目下拉选项（来自项目库） */
  const projectOptions = useMemo(
    () => projects.map((p) => ({ value: p.name, label: p.name })),
    [projects],
  )

  useEffect(() => {
    if (!open) return
    if (initial) {
      setCreatedAtStr(initial.createdAt)
      setDraft({
        name: initial.name,
        project: initial.project,
        branch: initial.branch,
        publishModule: initial.publishModule,
        status: initial.status,
        devStartTime: initial.devStartTime,
        devEndTime: initial.devEndTime,
        testTime: initial.testTime,
        publishTime: initial.publishTime,
        remark: initial.remark,
      })
    } else {
      setCreatedAtStr(new Date().toISOString())
      setDraft(emptyDraft())
    }
  }, [open, initial])

  const set = <K extends keyof RequirementDraft>(key: K, value: RequirementDraft[K]) =>
    setDraft((d) => ({ ...d, [key]: value }))

  const valid = draft.name.trim().length > 0

  const submit = () => {
    if (!valid) return
    onSave({
      ...draft,
      name: draft.name.trim(),
      project: draft.project.trim(),
      branch: draft.branch.trim(),
      publishModule: draft.publishModule.trim(),
      remark: draft.remark.trim(),
    })
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={initial ? '编辑需求' : '新建需求'}
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className="label">需求名称 *</label>
          <input
            className="input"
            placeholder="如：首页改版 - 登录态优化"
            value={draft.name}
            onChange={(e) => set('name', e.target.value)}
            autoFocus
          />
        </div>

        <div>
          <label className="label">所属项目</label>
          <Select
            value={draft.project || null}
            onChange={(p) => set('project', p)}
            options={projectOptions}
            placeholder="从项目库选择"
            searchable
            clearable
            onClear={() => set('project', '')}
          />
          <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">
            选项来自「项目管理」，可到顶栏维护
          </p>
        </div>

        <div>
          <label className="label">代码分支</label>
          <input
            className="input"
            placeholder="如：feature/login-optimize"
            value={draft.branch}
            onChange={(e) => set('branch', e.target.value)}
          />
          <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">
            新建时自动填入 <code className="rounded bg-slate-100 px-1 py-0.5 dark:bg-slate-800">feature/&lt;今日&gt;/REQ-</code>，可继续修改
          </p>
        </div>

        <div>
          <label className="label">
            发布模块
            <span className="ml-1 text-xs text-slate-400">支持分模块发布，如 make/、admin/</span>
          </label>
          <input
            className="input"
            placeholder="如：make 或 make/"
            value={draft.publishModule}
            onChange={(e) => set('publishModule', e.target.value)}
          />
        </div>

        <div>
          <label className="label">当前状态</label>
          <Select
            value={draft.status}
            onChange={(s) => set('status', s)}
            options={statusSelectOptions}
          />
        </div>

        <div>
          <label className="label">创建时间</label>
          <input
            type="date"
            className="input"
            value={toDateInput(createdAtStr)}
            disabled
          />
        </div>

        <div>
          <label className="label">开发开始时间</label>
          <input
            type="date"
            className="input"
            value={toDateInput(draft.devStartTime)}
            onChange={(e) => set("devStartTime", e.target.value || null)}
          />
        </div>

        <div>
          <label className="label">开发结束时间</label>
          <input
            type="date"
            className="input"
            value={toDateInput(draft.devEndTime)}
            onChange={(e) => set("devEndTime", e.target.value || null)}
          />
        </div>

        <div>
          <label className="label">提测时间</label>
          <input
            type="date"
            className="input"
            value={toDateInput(draft.testTime)}
            onChange={(e) => set("testTime", e.target.value || null)}
          />
        </div>

        <div>
          <label className="label">上线时间</label>
          <input
            type="date"
            className="input"
            value={toDateInput(draft.publishTime)}
            onChange={(e) => set("publishTime", e.target.value || null)}
          />
        </div>

        <div className="sm:col-span-2">
          <label className="label">备注</label>
          <textarea
            className="input min-h-[72px] resize-y"
            placeholder="补充说明（可选）"
            value={draft.remark}
            onChange={(e) => set('remark', e.target.value)}
          />
        </div>
      </div>

      <div className="mt-6 flex justify-end gap-2">
        <button className="btn-ghost" onClick={onClose}>取消</button>
        <button className="btn-primary" disabled={!valid} onClick={submit}>
          {initial ? '保存修改' : '创建需求'}
        </button>
      </div>
    </Modal>
  )
}
