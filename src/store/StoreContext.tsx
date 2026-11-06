import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import type { PasswordEntry, Project, Requirement, RequirementStatus, TodoItem, TodoPriority } from '../types'
import { normalizeRequirement } from '../lib/projects'
import {
  loadPasswords,
  loadProjects,
  loadRequirements,
  loadTodos,
  savePasswords,
  saveProjects,
  saveRequirements,
  saveTodos,
  uid,
  nowISO,
  StorageError,
  type BackupData,
} from '../lib/storage'
import { getArchiveMonths, setArchiveMonths as persistArchiveMonths } from '../lib/archive'
import type { MigratedRequirement } from '../lib/migrate'
import { mergeByUpdatedAt } from '../lib/merge'
import { active, gcTombstones } from '../lib/tombstone'
import {
  defaultFieldOrder,
  defaultVisibleFields,
  loadFieldOrder,
  loadVisibleFields,
  mergeFieldOrder,
  saveFieldOrder,
  saveVisibleFields,
  type RequirementFieldKey,
  type VisibleFields,
} from '../lib/fields'
import {
  buildStatusHistory,
  defaultVisibleStatuses,
  loadVisibleStatuses,
  saveVisibleStatuses,
  type VisibleStatuses,
} from '../lib/statuses'
import {
  findRolePreset,
  loadUiRole,
  saveUiRole,
  type UiRole,
} from '../lib/rolePresets'
import {
  isTsAfter,
  loadUiPrefsTs,
  saveUiPrefsTs,
  mergeUiPrefs,
  type UiPrefs,
} from '../lib/uiPrefs'

/** 同步触发器：由外部（App 层 startSync）注入；mutation 后调用 */
export type PushTrigger = () => void

const noopPush: PushTrigger = () => {}

interface Store {
  /** 活跃数据（墓碑条目已过滤，UI 读取一律用这三个） */
  requirements: Requirement[]
  todos: TodoItem[]
  projects: Project[]
  /** 密码条目（敏感字段已加密，墓碑已过滤） */
  passwords: PasswordEntry[]
  /**
   * 同步层专用：完整数据（含墓碑）。
   * push 快照必须带墓碑，删除才能传播到服务端/其它设备；UI 禁用。
   */
  getSyncData: () => {
    requirements: Requirement[]
    todos: TodoItem[]
    projects: Project[]
    passwords: PasswordEntry[]
    settings: { autoArchiveMonths: number; uiPrefs: UiPrefs }
  }
  /** 自动归档月份（同步通道） */
  archiveMonths: number
  /** 需求字段显隐配置 */
  visibleFields: VisibleFields
  /** 切换某个需求字段的显隐 */
  setVisibleField: (key: RequirementFieldKey, visible: boolean) => void
  /** 需求状态显隐配置 */
  visibleStatuses: VisibleStatuses
  /** 切换某个需求状态的显隐 */
  setVisibleStatus: (key: RequirementStatus, visible: boolean) => void
  /**
   * 需求列表的字段展示顺序。
   * 只影响列表渲染（表格列 / 移动端卡片块），不影响表单与详情抽屉。
   */
  fieldOrder: RequirementFieldKey[]
  /** 覆盖字段顺序（会做合法性校验，非法项被忽略、缺失项自动补齐） */
  setFieldOrder: (order: RequirementFieldKey[]) => void
  /** 恢复默认字段顺序 */
  resetFieldOrder: () => void
  /**
   * 当前使用视角（开发 / 产品 / 自定义）。
   * 选择预设 = 一键覆盖下方三份配置；手动调整任意配置后自动降级为 custom。
   */
  uiRole: UiRole
  /** 应用视角预设（一次性写入字段显隐 / 状态显隐 / 列顺序） */
  applyRolePreset: (id: 'dev' | 'pm') => void
  /** 直接设置视角标记（用于选中「自定义」：保留当前配置，仅解除预设绑定） */
  setUiRole: (role: UiRole) => void
  addRequirement: (draft: Omit<Requirement, 'id' | 'updatedAt'>) => { ok: boolean; error?: string }
  updateRequirement: (draft: Requirement) => { ok: boolean; error?: string }
  removeRequirement: (id: string) => { ok: boolean; error?: string }
  /** 恢复已删除的需求（保留原始 id/createdAt，用于撤销删除） */
  restoreRequirement: (item: Requirement) => { ok: boolean; error?: string }
  /** 批量导入（id 去重合并），返回实际导入条数 */
  importRequirements: (items: MigratedRequirement[]) => number
  addTodo: (
    content: string,
    date: string,
    extra?: { priority?: TodoPriority; requirementId?: string },
  ) => { ok: boolean; error?: string }
  /** 密码条目：新增或整体覆盖（enc 密文由 UI 层用主密码加密后传入） */
  upsertPassword: (entry: PasswordEntry) => { ok: boolean; error?: string }
  /** 删除密码条目：打墓碑软删 */
  removePassword: (id: string) => { ok: boolean; error?: string }
  toggleTodo: (id: string) => { ok: boolean; error?: string }
  /** 编辑待办（内容 / 目标日期 / 优先级 / 关联需求）；done 变化时同步维护 completedAt */
  updateTodo: (
    id: string,
    patch: Partial<Pick<TodoItem, 'content' | 'date' | 'done' | 'priority' | 'requirementId'>>,
  ) => { ok: boolean; error?: string }
  removeTodo: (id: string) => { ok: boolean; error?: string }
  /** 项目库维护（名称去重），返回是否成功 */
  addProject: (name: string, moduleBased?: boolean) => { ok: boolean; error?: string }
  updateProject: (id: string, name: string, moduleBased?: boolean) => { ok: boolean; error?: string }
  removeProject: (id: string) => { ok: boolean; error?: string }
  /** 首次启动写入种子项目，返回是否执行了写入 */
  initProjects: (seed: string[]) => boolean
  /** 从备份恢复全部数据（覆盖现有），返回是否成功 */
  restoreAll: (data: BackupData) => boolean
  /**
   * 清空全部本地数据 + localStorage（不触发 push）
   * 切换用户 / 登出时调用
   */
  clearAll: () => void
  /** 修改自动归档月份（走同步通道） */
  setArchiveMonths: (months: number) => void
  /**
   * 用服务端合并结果覆盖本地（由 sync 层调用）
   * 同时写 localStorage。不触发自身 push（避免循环）。
   */
  applyRemote: (snap: {
    requirements: Requirement[]
    todos: TodoItem[]
    projects: Project[]
    passwords?: PasswordEntry[]
    settings?: { autoArchiveMonths?: number; uiPrefs?: unknown }
  }) => void
}

const StoreContext = createContext<Store | null>(null)

/**
 * 提供同步触发器的容器（不消费 store 本身，避免循环）
 * 在 StoreProvider 外层使用，注入 push trigger 给 store
 */
const PushTriggerContext = createContext<PushTrigger>(noopPush)
export function usePushTrigger(): PushTrigger {
  return useContext(PushTriggerContext)
}

/** 把日期 clamp 到合法区间（1-12），与 archive.ts 保持一致 */
function clampMonths(n: number): number {
  if (Number.isNaN(n)) return 3
  return Math.max(1, Math.min(12, Math.floor(n)))
}

export function StoreProvider({
  children,
  pushTrigger,
}: {
  children: ReactNode
  /** 由外层 startSync 注入；未注入时为 noop（不推服务端） */
  pushTrigger?: PushTrigger
}) {
  const [requirements, setRequirements] = useState<Requirement[]>(() =>
    loadRequirements().map(normalizeRequirement),
  )
  const [todos, setTodos] = useState<TodoItem[]>(() => loadTodos())
  const [projects, setProjects] = useState<Project[]>(() => loadProjects())
  const [passwords, setPasswords] = useState<PasswordEntry[]>(() => loadPasswords())
  const [archiveMonths, setArchiveMonthsState] = useState<number>(() =>
    getArchiveMonths(),
  )
  const [visibleFields, setVisibleFieldsState] = useState<VisibleFields>(() =>
    loadVisibleFields(),
  )
  const [visibleStatuses, setVisibleStatusesState] = useState<VisibleStatuses>(() =>
    loadVisibleStatuses(),
  )
  const [fieldOrder, setFieldOrderState] = useState<RequirementFieldKey[]>(() =>
    loadFieldOrder(),
  )
  const [uiRole, setUiRoleState] = useState<UiRole>(() => loadUiRole())
  /** 偏好时间戳（跨设备 LWW 判定；纪元值 = 本地无变更，远端任意有效偏好胜出） */
  const [uiPrefsTs, setUiPrefsTsState] = useState<string>(() => loadUiPrefsTs())

  const trigger = pushTrigger ?? noopPush
  const triggerRef = useRef(trigger)
  triggerRef.current = trigger

  // 当前状态的同步镜像：mutation 先算出 next（基于 ref 而非 setState updater），
  // 再「落盘 → 更新 ref → setState」。保证 setState updater 是纯函数
  //（StrictMode 不再双写 localStorage，配额满的 StorageError 也不会从 updater 里炸渲染）。
  const requirementsRef = useRef(requirements)
  requirementsRef.current = requirements
  const todosRef = useRef(todos)
  todosRef.current = todos
  const projectsRef = useRef(projects)
  projectsRef.current = projects
  const passwordsRef = useRef(passwords)
  passwordsRef.current = passwords

  /** 统一提交需求集合：落盘（带错误捕获）→ 更新镜像 → setState → 触发 push */
  function commitRequirements(next: Requirement[]): { ok: boolean; error?: string } {
    try {
      saveRequirements(next)
    } catch (e) {
      const msg = e instanceof StorageError ? e.message : '保存失败'
      console.error('[store] 需求保存失败:', msg)
      return { ok: false, error: msg }
    }
    requirementsRef.current = next
    setRequirements(next)
    triggerRef.current()
    return { ok: true }
  }

  /** 统一提交待办集合：同上 */
  function commitTodos(next: TodoItem[]): { ok: boolean; error?: string } {
    try {
      saveTodos(next)
    } catch (e) {
      const msg = e instanceof StorageError ? e.message : '保存失败'
      console.error('[store] 待办保存失败:', msg)
      return { ok: false, error: msg }
    }
    todosRef.current = next
    setTodos(next)
    triggerRef.current()
    return { ok: true }
  }

  /** 统一提交项目集合：同上 */
  function commitProjects(next: Project[]): { ok: boolean; error?: string } {
    try {
      saveProjects(next)
    } catch (e) {
      const msg = e instanceof StorageError ? e.message : '保存失败'
      console.error('[store] 项目保存失败:', msg)
      return { ok: false, error: msg }
    }
    projectsRef.current = next
    setProjects(next)
    triggerRef.current()
    return { ok: true }
  }

  /** 统一提交密码集合：同上（列表内是含 enc 密文的条目） */
  function commitPasswords(next: PasswordEntry[]): { ok: boolean; error?: string } {
    try {
      savePasswords(next)
    } catch (e) {
      const msg = e instanceof StorageError ? e.message : '保存失败'
      console.error('[store] 密码保存失败:', msg)
      return { ok: false, error: msg }
    }
    passwordsRef.current = next
    setPasswords(next)
    triggerRef.current()
    return { ok: true }
  }

  // 跨标签页同步（同 origin 内有效）
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === 'dev-workbench:requirements')
        setRequirements(loadRequirements().map(normalizeRequirement))
      if (e.key === 'dev-workbench:todos') setTodos(loadTodos())
      if (e.key === 'dev-workbench:projects') setProjects(loadProjects())
      if (e.key === 'dev-workbench:passwords') setPasswords(loadPasswords())
      if (e.key === 'dev-workbench:auto-archive-months') {
        setArchiveMonthsState(getArchiveMonths())
      }
      if (e.key === 'dev-workbench:requirement-fields') {
        setVisibleFieldsState(loadVisibleFields())
      }
      if (e.key === 'dev-workbench:requirement-statuses') {
        setVisibleStatusesState(loadVisibleStatuses())
      }
      if (e.key === 'dev-workbench:requirement-field-order') {
        setFieldOrderState(loadFieldOrder())
      }
      if (e.key === 'dev-workbench:ui-role') {
        setUiRoleState(loadUiRole())
      }
      if (e.key === 'dev-workbench:ui-prefs-ts') {
        setUiPrefsTsState(loadUiPrefsTs())
      }
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  const addRequirement = useCallback(
    (draft: Omit<Requirement, 'id' | 'updatedAt'>) => {
      const t = nowISO()
      const item: Requirement = {
        ...draft,
        id: uid(),
        // 初始状态也记入历史（周报/流转统计的起点）
        statusHistory: [{ status: draft.status, at: t }],
        updatedAt: t,
      }
      return commitRequirements([item, ...requirementsRef.current])
    },
    [],
  )

  const updateRequirement = useCallback((draft: Requirement) => {
    const next = requirementsRef.current.map((r) => {
      if (r.id !== draft.id) return r
      const t = nowISO()
      // 状态变化 → 追加流转历史（status 没变时 buildStatusHistory 原样返回，不产生噪音）
      const history = buildStatusHistory(r, draft.status, t)
      return { ...draft, statusHistory: history, updatedAt: t }
    })
    return commitRequirements(next)
  }, [])

  /** 删除：打墓碑软删（同步协议需要墓碑传播删除；>90 天物理清理） */
  const removeRequirement = useCallback((id: string) => {
    const t = nowISO()
    const next = requirementsRef.current.map((r) =>
      r.id === id ? { ...r, deletedAt: t, updatedAt: t } : r,
    )
    return commitRequirements(next)
  }, [])

  /** 恢复已删除的需求：优先复活墓碑（撤销删除场景），否则按新增插入 */
  const restoreRequirement = useCallback((item: Requirement) => {
    const prev = requirementsRef.current
    const existing = prev.find((r) => r.id === item.id)
    if (existing && !existing.deletedAt) return { ok: true as const } // 已在且活跃，无需恢复
    let next: Requirement[]
    if (existing) {
      const t = nowISO()
      next = prev.map((r) =>
        r.id === item.id ? { ...r, deletedAt: undefined, updatedAt: t } : r,
      )
    } else {
      next = [item, ...prev]
    }
    return commitRequirements(next)
  }, [])

  /** 批量导入：按 id 去重合并，返回新增条数 */
  const importRequirements = useCallback(
    (items: MigratedRequirement[]): number => {
      const existing = new Set(requirementsRef.current.map((r) => r.id))
      const fresh = items.filter((it) => !existing.has(it.id))
      if (fresh.length === 0) return 0
      const stamped = fresh
        .map((it) => ({
          ...it,
          updatedAt: it.updatedAt ?? it.createdAt ?? nowISO(),
        }))
        .map(normalizeRequirement) as Requirement[]
      const next = [...stamped, ...requirementsRef.current]
      const res = commitRequirements(next)
      return res.ok ? fresh.length : 0
    },
    [],
  )

  /** 密码条目：按 id 新增或整体覆盖（加密由 UI 层完成，这里只管持久化 + 触发同步） */
  const upsertPassword = useCallback((entry: PasswordEntry) => {
    const exists = passwordsRef.current.some((p) => p.id === entry.id)
    const next = exists
      ? passwordsRef.current.map((p) => (p.id === entry.id ? entry : p))
      : [entry, ...passwordsRef.current]
    return commitPasswords(next)
  }, [])

  /** 删除密码条目：打墓碑软删（同步协议同其余实体） */
  const removePassword = useCallback((id: string) => {
    const t = nowISO()
    const next = passwordsRef.current.map((p) =>
      p.id === id ? { ...p, deletedAt: t, updatedAt: t } : p,
    )
    return commitPasswords(next)
  }, [])

  const addTodo = useCallback(
    (
      content: string,
      date: string,
      extra?: { priority?: TodoPriority; requirementId?: string },
    ) => {
      const t = nowISO()
      const item: TodoItem = {
        id: uid(),
        content,
        date,
        done: false,
        priority: extra?.priority ?? 'normal',
        requirementId: extra?.requirementId,
        createdAt: t,
        updatedAt: t,
      }
      return commitTodos([item, ...todosRef.current])
    },
    [],
  )

  const toggleTodo = useCallback((id: string) => {
    const next = todosRef.current.map((t) => {
      if (t.id !== id) return t
      const done = !t.done
      return {
        ...t,
        done,
        // 勾选时记录完成时间，取消勾选清除（历史/统计用）
        completedAt: done ? nowISO() : undefined,
        updatedAt: nowISO(),
      }
    })
    return commitTodos(next)
  }, [])

  /** 编辑待办：patch 内 done 变化时同步维护 completedAt */
  const updateTodo = useCallback(
    (
      id: string,
      patch: Partial<Pick<TodoItem, 'content' | 'date' | 'done' | 'priority' | 'requirementId'>>,
    ) => {
      const next = todosRef.current.map((t) => {
        if (t.id !== id) return t
        const done = patch.done ?? t.done
        const completedAt =
          patch.done === undefined
            ? t.completedAt
            : done
              ? (t.completedAt ?? nowISO())
              : undefined
        return { ...t, ...patch, done, completedAt, updatedAt: nowISO() }
      })
      return commitTodos(next)
    },
    [],
  )

  /** 删除：打墓碑软删（同步协议需要墓碑传播删除；>90 天物理清理） */
  const removeTodo = useCallback((id: string) => {
    const t = nowISO()
    const next = todosRef.current.map((x) =>
      x.id === id ? { ...x, deletedAt: t, updatedAt: t } : x,
    )
    return commitTodos(next)
  }, [])

  /** 项目名规范化（trim + 去重判断用） */
  const normalizeName = (name: string) => name.trim()

  const addProject = useCallback(
    (name: string, moduleBased?: boolean): { ok: boolean; error?: string } => {
      const n = normalizeName(name)
      if (!n) return { ok: false, error: '项目名为空' }
      if (projectsRef.current.some((p) => p.name.toLowerCase() === n.toLowerCase())) return { ok: false, error: '项目已存在' }
      const t = nowISO()
      const next = [
        ...projectsRef.current,
        { id: uid(), name: n, moduleBased: !!moduleBased, createdAt: t, updatedAt: t },
      ].sort((a, b) => a.name.localeCompare(b.name))
      return commitProjects(next)
    },
    [],
  )

  const updateProject = useCallback(
    (id: string, name: string, moduleBased?: boolean): { ok: boolean; error?: string } => {
      const n = normalizeName(name)
      if (!n) return { ok: false, error: '项目名为空' }
      if (projectsRef.current.some((p) => p.id !== id && p.name.toLowerCase() === n.toLowerCase())) {
        return { ok: false, error: '与其他项目重复' }
      }
      const next = projectsRef.current
        .map((p) =>
          p.id === id
            ? { ...p, name: n, moduleBased: moduleBased ?? p.moduleBased ?? false, updatedAt: nowISO() }
            : p,
        )
        .sort((a, b) => a.name.localeCompare(b.name))
      return commitProjects(next)
    },
    [],
  )

  /** 删除：打墓碑软删（同步协议需要墓碑传播删除；>90 天物理清理） */
  const removeProject = useCallback((id: string): { ok: boolean; error?: string } => {
    const t = nowISO()
    const next = projectsRef.current.map((p) =>
      p.id === id ? { ...p, deletedAt: t, updatedAt: t } : p,
    )
    return commitProjects(next)
  }, [])

  /** 首次启动写入种子项目（只执行一次，由 App 调用） */
  const initProjects = useCallback(
    (seed: string[]): boolean => {
      if (projectsRef.current.length > 0) return false
      const t = nowISO()
      const next: Project[] = seed.map((name) => ({
        id: uid(),
        name,
        createdAt: t,
        updatedAt: t,
      }))
      return commitProjects(next).ok
    },
    [],
  )

  /** 从备份恢复：覆盖现有全部数据 */
  const restoreAll = useCallback(
    (data: BackupData): boolean => {
      if (!data || !Array.isArray(data.requirements)) return false
      const reqs = data.requirements
      const todos = Array.isArray(data.todos) ? data.todos : []
      const projs = Array.isArray(data.projects) ? data.projects : []
      const t = nowISO()
      // 给旧数据补 updatedAt（合并降级用），并规范化为多项目结构
      const stampedReqs = reqs
        .map((r) => ({ ...r, updatedAt: r.updatedAt ?? r.createdAt ?? t }))
        .map(normalizeRequirement)
      const stampedTodos = todos.map((x) => ({
        ...x,
        updatedAt: (x as TodoItem).updatedAt ?? (x as TodoItem).createdAt ?? t,
      }))
      const stampedProjs = projs.map((p) => ({
        ...p,
        updatedAt: (p as Project).updatedAt ?? (p as Project).createdAt ?? t,
      }))
      // 备份里保留墓碑（恢复后删除状态不丢），但超期墓碑顺手清理
      const gcReqs = gcTombstones(stampedReqs)
      const gcTodos = gcTombstones(stampedTodos)
      const gcProjs = gcTombstones(stampedProjs)
      saveRequirements(gcReqs)
      saveTodos(gcTodos)
      saveProjects(gcProjs)
      requirementsRef.current = gcReqs
      todosRef.current = gcTodos
      projectsRef.current = gcProjs
      setRequirements(gcReqs)
      setTodos(gcTodos)
      setProjects(gcProjs)
      triggerRef.current()
      return true
    },
    [],
  )

  /** 修改自动归档月份：走同步通道 */
  const setArchiveMonths = useCallback((months: number) => {
    const v = clampMonths(months)
    persistArchiveMonths(v)
    setArchiveMonthsState(v)
    triggerRef.current()
  }, [])

  /** 偏好发生本地变更：打时间戳 + 触发推送（settings.uiPrefs 随账号同步） */
  const bumpPrefsTs = useCallback(() => {
    const t = nowISO()
    saveUiPrefsTs(t)
    setUiPrefsTsState(t)
    triggerRef.current()
  }, [])

  /** 手动调整任意偏好 → 视角降级为自定义（已选中预设时才写入，避免无谓 IO） */
  const demoteToCustom = useCallback(() => {
    setUiRoleState((prev) => {
      if (prev === 'custom') return prev
      saveUiRole('custom')
      return 'custom'
    })
  }, [])

  /** 切换某个需求字段的显隐 */
  const setVisibleField = useCallback(
    (key: RequirementFieldKey, visible: boolean) => {
      setVisibleFieldsState((prev) => {
        const next = { ...prev, [key]: visible }
        saveVisibleFields(next)
        return next
      })
      demoteToCustom()
      bumpPrefsTs()
    },
    [demoteToCustom, bumpPrefsTs],
  )

  /** 切换某个需求状态的显隐 */
  const setVisibleStatus = useCallback(
    (key: RequirementStatus, visible: boolean) => {
      setVisibleStatusesState((prev) => {
        const next = { ...prev, [key]: visible }
        saveVisibleStatuses(next)
        return next
      })
      demoteToCustom()
      bumpPrefsTs()
    },
    [demoteToCustom, bumpPrefsTs],
  )

  /** 覆盖字段展示顺序 */
  const setFieldOrder = useCallback(
    (order: RequirementFieldKey[]) => {
      const next = mergeFieldOrder(order)
      setFieldOrderState(next)
      saveFieldOrder(next)
      demoteToCustom()
      bumpPrefsTs()
    },
    [demoteToCustom, bumpPrefsTs],
  )

  /** 恢复默认字段顺序 */
  const resetFieldOrder = useCallback(() => {
    const next = defaultFieldOrder()
    setFieldOrderState(next)
    saveFieldOrder(next)
    demoteToCustom()
    bumpPrefsTs()
  }, [demoteToCustom, bumpPrefsTs])

  /**
   * 应用视角预设：一次性写入三份配置（字段显隐 / 状态显隐 / 列顺序）。
   * 由 UI 层负责确认（覆盖手动配置），这里只做写入。
   */
  const applyRolePreset = useCallback((id: 'dev' | 'pm') => {
    const preset = findRolePreset(id)
    if (!preset) return
    saveVisibleFields(preset.visibleFields)
    setVisibleFieldsState(preset.visibleFields)
    saveVisibleStatuses(preset.visibleStatuses)
    setVisibleStatusesState(preset.visibleStatuses)
    saveFieldOrder(preset.fieldOrder)
    setFieldOrderState(preset.fieldOrder)
    saveUiRole(id)
    setUiRoleState(id)
    const t = nowISO()
    saveUiPrefsTs(t)
    setUiPrefsTsState(t)
    triggerRef.current()
  }, [])

  /**
   * 直接设置使用视角标记（不动三份配置）。
   *
   * 用途：设置中心里「自定义」卡片可被直接选中 —— 语义是「保留当前字段/状态/顺序
   * 配置，但解除与预设的绑定」，因此只写 ui-role + 打同步时间戳。
   * 预设有配置语义，仍走 applyRolePreset。
   */
  const setUiRole = useCallback(
    (role: UiRole) => {
      if (role === uiRole) return
      saveUiRole(role)
      setUiRoleState(role)
      bumpPrefsTs()
    },
    [uiRole, bumpPrefsTs],
  )

  /**
   * 应用远端 UI 偏好（由 applyRemote 调用）。
   * 仅当远端时间戳严格更新时覆盖本地（LWW），避免旧偏好冲掉刚改好的配置。
   */
  const applyRemoteUiPrefs = useCallback((prefs: UiPrefs) => {
    saveVisibleFields(prefs.visibleFields)
    setVisibleFieldsState(prefs.visibleFields)
    saveVisibleStatuses(prefs.visibleStatuses)
    setVisibleStatusesState(prefs.visibleStatuses)
    saveFieldOrder(prefs.fieldOrder)
    setFieldOrderState(prefs.fieldOrder)
    saveUiRole(prefs.role)
    setUiRoleState(prefs.role)
    saveUiPrefsTs(prefs.updatedAt)
    setUiPrefsTsState(prefs.updatedAt)
  }, [])

  /**
   * 用服务端合并结果覆盖本地（由 sync 层调用）
   * 改用 LWW merge（不再 wholesale replace）：
   *   - 本地独有的记录保留
   *   - 远端独有 / 双方共有且远端更新的记录覆盖本地
   * 这样任何本地未推送的改动都不会被远端覆盖。
   * 不再触发 push（避免循环）
   */
  const applyRemote = useCallback(
    (snap: {
      requirements: Requirement[]
      todos: TodoItem[]
      projects: Project[]
      passwords?: PasswordEntry[]
      settings?: { autoArchiveMonths?: number; uiPrefs?: unknown }
    }) => {
      // 云端数据统一规范化（旧快照可能缺 projects 字段），合并后清理超期墓碑
      const mergedReqs = gcTombstones(mergeByUpdatedAt(
        snap.requirements.map(normalizeRequirement),
        requirements,
      ))
      const mergedTodos = gcTombstones(mergeByUpdatedAt(snap.todos, todos))
      const mergedProjects = gcTombstones(mergeByUpdatedAt(snap.projects, projects))
      // 密码条目：旧服务端快照可能缺 passwords 字段，按空数组容错
      const mergedPasswords = gcTombstones(mergeByUpdatedAt(snap.passwords ?? [], passwords))
      saveRequirements(mergedReqs)
      saveTodos(mergedTodos)
      saveProjects(mergedProjects)
      savePasswords(mergedPasswords)
      requirementsRef.current = mergedReqs
      todosRef.current = mergedTodos
      projectsRef.current = mergedProjects
      passwordsRef.current = mergedPasswords
      setRequirements(mergedReqs)
      setTodos(mergedTodos)
      setProjects(mergedProjects)
      setPasswords(mergedPasswords)
      if (snap.settings?.autoArchiveMonths != null) {
        const m = clampMonths(snap.settings.autoArchiveMonths)
        persistArchiveMonths(m)
        setArchiveMonthsState(m)
      }
      // UI 偏好：远端时间戳更新时才覆盖本地（见 lib/uiPrefs.ts）
      const remotePrefs = mergeUiPrefs(snap.settings?.uiPrefs)
      if (remotePrefs && isTsAfter(remotePrefs.updatedAt, uiPrefsTs)) {
        applyRemoteUiPrefs(remotePrefs)
      }
    },
    [requirements, todos, projects, passwords, uiPrefsTs, applyRemoteUiPrefs],
  )

  /**
   * 清空本地全部数据 + 业务 localStorage key
   * 切换用户 / 登出时调用；不触发 push
   *
   * UI 偏好也一并重置：偏好已随账号同步，切换账号后本地旧偏好（时间戳可能更新）
   * 会挡住新账号的服务端偏好，必须清干净（时间戳回纪元）。
   */
  const clearAll = useCallback(() => {
    localStorage.removeItem('dev-workbench:requirements')
    localStorage.removeItem('dev-workbench:todos')
    localStorage.removeItem('dev-workbench:projects')
    localStorage.removeItem('dev-workbench:auto-archive-months')
    localStorage.removeItem('dev-workbench:passwords')
    // 偏好三件套 + 角色 + 时间戳全部重置为默认
    const defFields = defaultVisibleFields()
    const defStatuses = defaultVisibleStatuses()
    const defOrder = defaultFieldOrder()
    saveVisibleFields(defFields)
    saveVisibleStatuses(defStatuses)
    saveFieldOrder(defOrder)
    saveUiRole('custom')
    saveUiPrefsTs(new Date(0).toISOString())
    requirementsRef.current = []
    todosRef.current = []
    projectsRef.current = []
    passwordsRef.current = []
    setRequirements([])
    setTodos([])
    setProjects([])
    setPasswords([])
    setArchiveMonthsState(3)
    setVisibleFieldsState(defFields)
    setVisibleStatusesState(defStatuses)
    setFieldOrderState(defOrder)
    setUiRoleState('custom')
    setUiPrefsTsState(new Date(0).toISOString())
  }, [])

  /** 同步层专用：完整数据（含墓碑）。push 快照必须带墓碑，删除才能传播 */
  const getSyncData = useCallback(
    () => ({
      requirements,
      todos,
      projects,
      passwords,
      settings: {
        autoArchiveMonths: archiveMonths,
        uiPrefs: {
          updatedAt: uiPrefsTs,
          role: uiRole,
          visibleFields,
          visibleStatuses,
          fieldOrder,
        },
      },
    }),
    [requirements, todos, projects, passwords, archiveMonths, uiPrefsTs, uiRole, visibleFields, visibleStatuses, fieldOrder],
  )

  const value = useMemo(
    () => ({
      // UI 消费的是活跃数据（墓碑已过滤）
      requirements: active(requirements),
      todos: active(todos),
      projects: active(projects),
      passwords: active(passwords),
      getSyncData,
      archiveMonths,
      visibleFields,
      setVisibleField,
      visibleStatuses,
      setVisibleStatus,
      fieldOrder,
      setFieldOrder,
      resetFieldOrder,
      uiRole,
      applyRolePreset,
      setUiRole,
      addRequirement,
      updateRequirement,
      removeRequirement,
      restoreRequirement,
      importRequirements,
      addTodo,
      upsertPassword,
      removePassword,
      toggleTodo,
      updateTodo,
      removeTodo,
      addProject,
      updateProject,
      removeProject,
      initProjects,
      restoreAll,
      setArchiveMonths,
      applyRemote,
      clearAll,
    }),
    [
      requirements, todos, projects, passwords, archiveMonths, getSyncData,
      visibleFields, setVisibleField, visibleStatuses, setVisibleStatus,
      fieldOrder, setFieldOrder, resetFieldOrder,
      uiRole, applyRolePreset, setUiRole, uiPrefsTs,
      addRequirement, updateRequirement, removeRequirement, restoreRequirement, importRequirements,
      addTodo, upsertPassword, removePassword, toggleTodo, updateTodo, removeTodo,
      addProject, updateProject, removeProject,
      initProjects, restoreAll, setArchiveMonths, applyRemote, clearAll,
    ],
  )

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>
}

export function useStore(): Store {
  const ctx = useContext(StoreContext)
  if (!ctx) throw new Error('useStore must be used within StoreProvider')
  return ctx
}
