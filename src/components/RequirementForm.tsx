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
  projects: [],
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
  prefill,
  onClose,
  onSave,
}: {
  open: boolean
  initial: Requirement | null
  /** 克隆模式：以某个需求为模板新建；时间字段清空、状态重置 pending */
  prefill?: Requirement | null
  onClose: () => void
  onSave: (draft: RequirementDraft) => void
}) {
  const [draft, setDraft] = useState<RequirementDraft>(emptyDraft)
  // 「+ 添加项目」下拉的开关
  const [addingProject, setAddingProject] = useState(false)
  // 创建时间只读展示：编辑时取原值，新建/克隆时为今天
  const [createdAtStr, setCreatedAtStr] = useState(() => new Date().toISOString())

  const { projects } = useStore()

  /** 项目名 → 是否支持分模块发布 */
  const moduleBasedMap = useMemo(() => {
    const map = new Map<string, boolean>()
    for (const p of projects) map.set(p.name, p.moduleBased ?? false)
    return map
  }, [projects])

  /** 项目下拉选项（来自项目库，排除已选中的） */
  const projectOptions = useMemo(
    () =>
      projects
        .filter((p) => !draft.projects.some((x) => x.project === p.name))
        .map((p) => ({ value: p.name, label: p.name })),
    [projects, draft.projects],
  )

  useEffect(() => {
    if (!open) return
    if (initial) {
      // 编辑模式：所有字段原样回填
      setCreatedAtStr(initial.createdAt)
      setDraft({
        name: initial.name,
        project: initial.project,
        projects: initial.projects ?? [],
        branch: initial.branch,
        publishModule: initial.publishModule,
        status: initial.status,
        devStartTime: initial.devStartTime,
        devEndTime: initial.devEndTime,
        testTime: initial.testTime,
        publishTime: initial.publishTime,
        remark: initial.remark,
      })
    } else if (prefill) {
      // 克隆模式：复制模板字段，时间清空、状态重置 pending、分支用今日新前缀
      setCreatedAtStr(new Date().toISOString())
      setDraft({
        name: prefill.name ? `${prefill.name} (副本)` : '',
        project: prefill.project ?? '',
        projects: (prefill.projects ?? []).map((p) => ({ ...p })),
        branch: newRequirementBranchPrefix(),
        publishModule: prefill.publishModule ?? '',
        status: 'pending',
        devStartTime: null,
        devEndTime: null,
        testTime: null,
        publishTime: null,
        remark: prefill.remark ?? '',
      })
    } else {
      // 新建模式
      setCreatedAtStr(new Date().toISOString())
      setDraft(emptyDraft())
    }
    setAddingProject(false)
  }, [open, initial, prefill])

  const set = <K extends keyof RequirementDraft>(key: K, value: RequirementDraft[K]) =>
    setDraft((d) => ({ ...d, [key]: value }))

  const valid = draft.name.trim().length > 0

  /** 项目关联行操作 */
  const addProjectRef = (name: string) => {
    setDraft((d) => ({
      ...d,
      projects: [...d.projects, { project: name, publishModule: '' }],
    }))
    setAddingProject(false)
  }
  const removeProjectRef = (name: string) => {
    setDraft((d) => ({ ...d, projects: d.projects.filter((x) => x.project !== name) }))
  }
  const setProjectModule = (name: string, module: string) => {
    setDraft((d) => ({
      ...d,
      projects: d.projects.map((x) => (x.project === name ? { ...x, publishModule: module } : x)),
    }))
  }

  const submit = () => {
    if (!valid) return
    // 兼容字段与结构化字段保持一致（旧版本前端/导出/同步兜底）
    const primary = draft.projects[0]
    onSave({
      ...draft,
      name: draft.name.trim(),
      project: primary?.project ?? '',
      publishModule: primary?.publishModule ?? '',
      projects: draft.projects.map((p) => ({
        project: p.project.trim(),
        publishModule: p.publishModule.trim(),
      })),
      branch: draft.branch.trim(),
      remark: draft.remark.trim(),
    })
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={initial ? '编辑需求' : prefill ? '克隆需求' : '新建需求'}
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className="mb-1.5 block text-xs font-medium" style={{ color: 'var(--wb-ink-2)' }}>需求名称 *</label>
          <input
            className="wb-input"
            placeholder="如：首页改版 - 登录态优化"
            value={draft.name}
            onChange={(e) => set('name', e.target.value)}
            autoFocus
          />
        </div>

        <div className="sm:col-span-2">
          <label className="mb-1.5 block text-xs font-medium" style={{ color: 'var(--wb-ink-2)' }}>
            所属项目
            <span className="ml-1 text-xs" style={{ color: 'var(--wb-ink-3)' }}>一个需求可关联多个项目，各自指定发布方式</span>
          </label>
          <div className="space-y-2">
            {draft.projects.map((ref) => {
              const moduleBased = moduleBasedMap.get(ref.project) ?? false
              return (
                <div
                  key={ref.project}
                  className="flex items-center gap-2 rounded-lg border border-[var(--wb-line)] px-2.5 py-1.5"
                >
                  <span className="shrink-0 rounded-md bg-[var(--wb-surface-2)] px-2 py-0.5 text-xs font-medium" style={{ color: 'var(--wb-ink-2)' }}>
                    {ref.project}
                  </span>
                  {moduleBased ? (
                    <input
                      className="wb-input h-8 flex-1 py-1 text-xs"
                      placeholder="发布模块，如 make/（留空 = 全量）"
                      value={ref.publishModule}
                      onChange={(e) => setProjectModule(ref.project, e.target.value)}
                    />
                  ) : (
                    <span className="flex-1 text-xs" style={{ color: 'var(--wb-ink-3)' }}>
                      全量发布
                    </span>
                  )}
                  <button
                    type="button"
                    className="shrink-0 rounded-md p-1 transition hover:bg-[var(--wb-surface-2)] hover:text-[var(--wb-danger)]"
                    style={{ color: 'var(--wb-ink-3)' }}
                    title="移除该项目"
                    onClick={() => removeProjectRef(ref.project)}
                  >
                    <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                      <path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z" />
                    </svg>
                  </button>
                </div>
              )
            })}
            {addingProject ? (
              <Select
                value={null}
                onChange={(p) => p && addProjectRef(p)}
                options={projectOptions}
                placeholder="搜索并选择项目"
                searchable
                clearable
                onClear={() => setAddingProject(false)}
              />
            ) : (
              <button
                type="button"
                className="w-full rounded-lg border border-dashed border-[var(--wb-line-2)] px-3 py-1.5 text-xs transition hover:border-[var(--wb-brand-400)] hover:text-[var(--wb-brand-500)]"
                style={{ color: 'var(--wb-ink-2)' }}
                disabled={projectOptions.length === 0}
                onClick={() => setAddingProject(true)}
              >
                + 添加项目
                {projectOptions.length === 0 && '（项目库已全部选中，可到顶栏「项目管理」维护）'}
              </button>
            )}
          </div>
          <p className="mt-1 text-xs" style={{ color: 'var(--wb-ink-3)' }}>
            选项来自「项目管理」，可到顶栏维护；项目是否支持分模块发布也在那里配置
          </p>
        </div>

        <div>
          <label className="mb-1.5 block text-xs font-medium" style={{ color: 'var(--wb-ink-2)' }}>代码分支</label>
          <input
            className="wb-input"
            placeholder="如：feature/login-optimize"
            value={draft.branch}
            onChange={(e) => set('branch', e.target.value)}
          />
          <p className="mt-1 text-xs" style={{ color: 'var(--wb-ink-3)' }}>
            新建时自动填入 <code className="rounded bg-[var(--wb-surface-2)] px-1 py-0.5">feature/&lt;今日&gt;/REQ-</code>，可继续修改
          </p>
        </div>

        <div>
          <label className="mb-1.5 block text-xs font-medium" style={{ color: 'var(--wb-ink-2)' }}>当前状态</label>
          <Select
            value={draft.status}
            onChange={(s) => set('status', s)}
            options={statusSelectOptions}
          />
        </div>

        <div>
          <label className="mb-1.5 block text-xs font-medium" style={{ color: 'var(--wb-ink-2)' }}>创建时间</label>
          <input
            type="date"
            className="wb-input"
            value={toDateInput(createdAtStr)}
            disabled
          />
        </div>

        <div>
          <label className="mb-1.5 block text-xs font-medium" style={{ color: 'var(--wb-ink-2)' }}>开发开始时间</label>
          <input
            type="date"
            className="wb-input"
            value={toDateInput(draft.devStartTime)}
            onChange={(e) => set("devStartTime", e.target.value || null)}
          />
        </div>

        <div>
          <label className="mb-1.5 block text-xs font-medium" style={{ color: 'var(--wb-ink-2)' }}>开发结束时间</label>
          <input
            type="date"
            className="wb-input"
            value={toDateInput(draft.devEndTime)}
            onChange={(e) => set("devEndTime", e.target.value || null)}
          />
        </div>

        <div>
          <label className="mb-1.5 block text-xs font-medium" style={{ color: 'var(--wb-ink-2)' }}>提测时间</label>
          <input
            type="date"
            className="wb-input"
            value={toDateInput(draft.testTime)}
            onChange={(e) => set("testTime", e.target.value || null)}
          />
        </div>

        <div>
          <label className="mb-1.5 block text-xs font-medium" style={{ color: 'var(--wb-ink-2)' }}>上线时间</label>
          <input
            type="date"
            className="wb-input"
            value={toDateInput(draft.publishTime)}
            onChange={(e) => set("publishTime", e.target.value || null)}
          />
        </div>

        <div className="sm:col-span-2">
          <label className="mb-1.5 block text-xs font-medium" style={{ color: 'var(--wb-ink-2)' }}>备注</label>
          <textarea
            className="wb-input min-h-[72px] resize-y"
            placeholder="补充说明（可选）"
            value={draft.remark}
            onChange={(e) => set('remark', e.target.value)}
          />
        </div>
      </div>

      <div className="mt-6 flex justify-end gap-2">
        <button className="wb-btn-ghost" onClick={onClose}>取消</button>
        <button className="wb-btn-primary" disabled={!valid} onClick={submit}>
          {initial ? '保存修改' : '创建需求'}
        </button>
      </div>
    </Modal>
  )
}
