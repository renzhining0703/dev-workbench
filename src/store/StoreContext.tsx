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
import type { Project, Requirement, TodoItem, TodoPriority } from '../types'
import { normalizeRequirement } from '../lib/projects'
import {
  loadProjects,
  loadRequirements,
  loadTodos,
  saveProjects,
  saveRequirements,
  saveTodos,
  uid,
  nowISO,
  type BackupData,
} from '../lib/storage'
import { getArchiveMonths, setArchiveMonths as persistArchiveMonths } from '../lib/archive'
import type { MigratedRequirement } from '../lib/migrate'
import { mergeByUpdatedAt } from '../lib/sync'
import { active, gcTombstones } from '../lib/tombstone'

/** 同步触发器：由外部（App 层 startSync）注入；mutation 后调用 */
export type PushTrigger = () => void

const noopPush: PushTrigger = () => {}

interface Store {
  /** 活跃数据（墓碑条目已过滤，UI 读取一律用这三个） */
  requirements: Requirement[]
  todos: TodoItem[]
  projects: Project[]
  /**
   * 同步层专用：完整数据（含墓碑）。
   * push 快照必须带墓碑，删除才能传播到服务端/其它设备；UI 禁用。
   */
  getSyncData: () => {
    requirements: Requirement[]
    todos: TodoItem[]
    projects: Project[]
    settings: { autoArchiveMonths: number }
  }
  /** 自动归档月份（同步通道） */
  archiveMonths: number
  addRequirement: (draft: Omit<Requirement, 'id' | 'createdAt' | 'updatedAt'>) => void
  updateRequirement: (draft: Requirement) => void
  removeRequirement: (id: string) => void
  /** 恢复已删除的需求（保留原始 id/createdAt，用于撤销删除） */
  restoreRequirement: (item: Requirement) => void
  /** 批量导入（id 去重合并），返回实际导入条数 */
  importRequirements: (items: MigratedRequirement[]) => number
  addTodo: (
    content: string,
    date: string,
    extra?: { priority?: TodoPriority; requirementId?: string },
  ) => void
  toggleTodo: (id: string) => void
  /** 编辑待办（内容 / 目标日期 / 优先级 / 关联需求）；done 变化时同步维护 completedAt */
  updateTodo: (
    id: string,
    patch: Partial<Pick<TodoItem, 'content' | 'date' | 'done' | 'priority' | 'requirementId'>>,
  ) => void
  removeTodo: (id: string) => void
  /** 项目库维护（名称去重），返回是否成功 */
  addProject: (name: string, moduleBased?: boolean) => boolean
  updateProject: (id: string, name: string, moduleBased?: boolean) => boolean
  removeProject: (id: string) => void
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
    settings?: { autoArchiveMonths?: number }
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
  const [archiveMonths, setArchiveMonthsState] = useState<number>(() =>
    getArchiveMonths(),
  )

  const trigger = pushTrigger ?? noopPush
  const triggerRef = useRef(trigger)
  triggerRef.current = trigger

  // 跨标签页同步（同 origin 内有效）
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === 'dev-workbench:requirements')
        setRequirements(loadRequirements().map(normalizeRequirement))
      if (e.key === 'dev-workbench:todos') setTodos(loadTodos())
      if (e.key === 'dev-workbench:projects') setProjects(loadProjects())
      if (e.key === 'dev-workbench:auto-archive-months') {
        setArchiveMonthsState(getArchiveMonths())
      }
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  const addRequirement = useCallback(
    (draft: Omit<Requirement, 'id' | 'createdAt' | 'updatedAt'>) => {
      setRequirements((prev) => {
        const item: Requirement = {
          ...draft,
          id: uid(),
          createdAt: nowISO(),
          updatedAt: nowISO(),
        }
        const next = [item, ...prev]
        saveRequirements(next)
        triggerRef.current()
        return next
      })
    },
    [],
  )

  const updateRequirement = useCallback((draft: Requirement) => {
    setRequirements((prev) => {
      const next = prev.map((r) =>
        r.id === draft.id ? { ...draft, updatedAt: nowISO() } : r,
      )
      saveRequirements(next)
      triggerRef.current()
      return next
    })
  }, [])

  /** 删除：打墓碑软删（同步协议需要墓碑传播删除；>90 天物理清理） */
  const removeRequirement = useCallback((id: string) => {
    setRequirements((prev) => {
      const t = nowISO()
      const next = prev.map((r) =>
        r.id === id ? { ...r, deletedAt: t, updatedAt: t } : r,
      )
      saveRequirements(next)
      triggerRef.current()
      return next
    })
  }, [])

  /** 恢复已删除的需求：优先复活墓碑（撤销删除场景），否则按新增插入 */
  const restoreRequirement = useCallback((item: Requirement) => {
    setRequirements((prev) => {
      const existing = prev.find((r) => r.id === item.id)
      if (existing?.deletedAt) {
        const t = nowISO()
        const next = prev.map((r) =>
          r.id === item.id ? { ...r, deletedAt: undefined, updatedAt: t } : r,
        )
        saveRequirements(next)
        triggerRef.current()
        return next
      }
      if (existing) return prev
      const next = [item, ...prev]
      saveRequirements(next)
      triggerRef.current()
      return next
    })
  }, [])

  /** 批量导入：按 id 去重合并，返回新增条数 */
  const importRequirements = useCallback(
    (items: MigratedRequirement[]): number => {
      const existing = new Set(requirements.map((r) => r.id))
      const fresh = items.filter((it) => !existing.has(it.id))
      if (fresh.length === 0) return 0
      const stamped = fresh
        .map((it) => ({
          ...it,
          updatedAt: it.updatedAt ?? it.createdAt ?? nowISO(),
        }))
        .map(normalizeRequirement) as Requirement[]
      const next = [...stamped, ...requirements]
      saveRequirements(next)
      setRequirements(next)
      triggerRef.current()
      return fresh.length
    },
    [requirements],
  )

  const addTodo = useCallback(
    (
      content: string,
      date: string,
      extra?: { priority?: TodoPriority; requirementId?: string },
    ) => {
      setTodos((prev) => {
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
        const next = [item, ...prev]
        saveTodos(next)
        triggerRef.current()
        return next
      })
    },
    [],
  )

  const toggleTodo = useCallback((id: string) => {
    setTodos((prev) => {
      const next = prev.map((t) => {
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
      saveTodos(next)
      triggerRef.current()
      return next
    })
  }, [])

  /** 编辑待办：patch 内 done 变化时同步维护 completedAt */
  const updateTodo = useCallback(
    (
      id: string,
      patch: Partial<Pick<TodoItem, 'content' | 'date' | 'done' | 'priority' | 'requirementId'>>,
    ) => {
      setTodos((prev) => {
        const next = prev.map((t) => {
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
        saveTodos(next)
        triggerRef.current()
        return next
      })
    },
    [],
  )

  /** 删除：打墓碑软删（同步协议需要墓碑传播删除；>90 天物理清理） */
  const removeTodo = useCallback((id: string) => {
    setTodos((prev) => {
      const t = nowISO()
      const next = prev.map((x) =>
        x.id === id ? { ...x, deletedAt: t, updatedAt: t } : x,
      )
      saveTodos(next)
      triggerRef.current()
      return next
    })
  }, [])

  /** 项目名规范化（trim + 去重判断用） */
  const normalizeName = (name: string) => name.trim()

  const addProject = useCallback(
    (name: string, moduleBased?: boolean): boolean => {
      const n = normalizeName(name)
      if (!n) return false
      if (projects.some((p) => p.name.toLowerCase() === n.toLowerCase())) return false
      const t = nowISO()
      const next = [
        ...projects,
        { id: uid(), name: n, moduleBased: !!moduleBased, createdAt: t, updatedAt: t },
      ].sort((a, b) => a.name.localeCompare(b.name))
      saveProjects(next)
      setProjects(next)
      triggerRef.current()
      return true
    },
    [projects],
  )

  const updateProject = useCallback(
    (id: string, name: string, moduleBased?: boolean): boolean => {
      const n = normalizeName(name)
      if (!n) return false
      if (projects.some((p) => p.id !== id && p.name.toLowerCase() === n.toLowerCase())) return false
      const next = projects
        .map((p) =>
          p.id === id
            ? { ...p, name: n, moduleBased: moduleBased ?? p.moduleBased ?? false, updatedAt: nowISO() }
            : p,
        )
        .sort((a, b) => a.name.localeCompare(b.name))
      saveProjects(next)
      setProjects(next)
      triggerRef.current()
      return true
    },
    [projects],
  )

  /** 删除：打墓碑软删（同步协议需要墓碑传播删除；>90 天物理清理） */
  const removeProject = useCallback((id: string) => {
    setProjects((prev) => {
      const t = nowISO()
      const next = prev.map((p) =>
        p.id === id ? { ...p, deletedAt: t, updatedAt: t } : p,
      )
      saveProjects(next)
      triggerRef.current()
      return next
    })
  }, [])

  /** 首次启动写入种子项目（只执行一次，由 App 调用） */
  const initProjects = useCallback(
    (seed: string[]): boolean => {
      if (projects.length > 0) return false
      const t = nowISO()
      const next: Project[] = seed.map((name) => ({
        id: uid(),
        name,
        createdAt: t,
        updatedAt: t,
      }))
      saveProjects(next)
      setProjects(next)
      triggerRef.current()
      return true
    },
    [projects.length],
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
      settings?: { autoArchiveMonths?: number }
    }) => {
      // 云端数据统一规范化（旧快照可能缺 projects 字段），合并后清理超期墓碑
      const mergedReqs = gcTombstones(mergeByUpdatedAt(
        snap.requirements.map(normalizeRequirement),
        requirements,
      ))
      const mergedTodos = gcTombstones(mergeByUpdatedAt(snap.todos, todos))
      const mergedProjects = gcTombstones(mergeByUpdatedAt(snap.projects, projects))
      saveRequirements(mergedReqs)
      saveTodos(mergedTodos)
      saveProjects(mergedProjects)
      setRequirements(mergedReqs)
      setTodos(mergedTodos)
      setProjects(mergedProjects)
      if (snap.settings?.autoArchiveMonths != null) {
        const m = clampMonths(snap.settings.autoArchiveMonths)
        persistArchiveMonths(m)
        setArchiveMonthsState(m)
      }
    },
    [requirements, todos, projects],
  )

  /**
   * 清空本地全部数据 + 业务 localStorage key
   * 切换用户 / 登出时调用；不触发 push
   */
  const clearAll = useCallback(() => {
    localStorage.removeItem('dev-workbench:requirements')
    localStorage.removeItem('dev-workbench:todos')
    localStorage.removeItem('dev-workbench:projects')
    localStorage.removeItem('dev-workbench:auto-archive-months')
    setRequirements([])
    setTodos([])
    setProjects([])
    setArchiveMonthsState(3)
  }, [])

  /** 同步层专用：完整数据（含墓碑）。push 快照必须带墓碑，删除才能传播 */
  const getSyncData = useCallback(
    () => ({
      requirements,
      todos,
      projects,
      settings: { autoArchiveMonths: archiveMonths },
    }),
    [requirements, todos, projects, archiveMonths],
  )

  const value = useMemo(
    () => ({
      // UI 消费的是活跃数据（墓碑已过滤）
      requirements: active(requirements),
      todos: active(todos),
      projects: active(projects),
      getSyncData,
      archiveMonths,
      addRequirement,
      updateRequirement,
      removeRequirement,
      restoreRequirement,
      importRequirements,
      addTodo,
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
      requirements, todos, projects, archiveMonths, getSyncData,
      addRequirement, updateRequirement, removeRequirement, restoreRequirement, importRequirements,
      addTodo, toggleTodo, updateTodo, removeTodo,
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
