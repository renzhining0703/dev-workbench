import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import type { Project, Requirement, TodoItem } from '../types'
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
import type { MigratedRequirement } from '../lib/migrate'

interface Store {
  requirements: Requirement[]
  todos: TodoItem[]
  projects: Project[]
  addRequirement: (draft: Omit<Requirement, 'id' | 'createdAt' | 'updatedAt'>) => void
  updateRequirement: (draft: Requirement) => void
  removeRequirement: (id: string) => void
  /** 批量导入（id 去重合并），返回实际导入条数 */
  importRequirements: (items: MigratedRequirement[]) => number
  addTodo: (content: string, date: string) => void
  toggleTodo: (id: string) => void
  removeTodo: (id: string) => void
  /** 项目库维护（名称去重），返回是否成功 */
  addProject: (name: string) => boolean
  updateProject: (id: string, name: string) => boolean
  removeProject: (id: string) => void
  /** 首次启动写入种子项目，返回是否执行了写入 */
  initProjects: (seed: string[]) => boolean
  /** 从备份恢复全部数据（覆盖现有），返回是否成功 */
  restoreAll: (data: BackupData) => boolean
}

const StoreContext = createContext<Store | null>(null)

export function StoreProvider({ children }: { children: ReactNode }) {
  const [requirements, setRequirements] = useState<Requirement[]>(() =>
    loadRequirements(),
  )
  const [todos, setTodos] = useState<TodoItem[]>(() => loadTodos())
  const [projects, setProjects] = useState<Project[]>(() => loadProjects())

  // 跨标签页同步
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === 'dev-workbench:requirements') setRequirements(loadRequirements())
      if (e.key === 'dev-workbench:todos') setTodos(loadTodos())
      if (e.key === 'dev-workbench:projects') setProjects(loadProjects())
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
      return next
    })
  }, [])

  const removeRequirement = useCallback((id: string) => {
    setRequirements((prev) => {
      const next = prev.filter((r) => r.id !== id)
      saveRequirements(next)
      return next
    })
  }, [])

  /** 批量导入：按 id 去重合并，返回新增条数 */
  const importRequirements = useCallback(
    (items: MigratedRequirement[]): number => {
      const existing = new Set(requirements.map((r) => r.id))
      const fresh = items.filter((it) => !existing.has(it.id))
      if (fresh.length === 0) return 0
      const next = [...(fresh as Requirement[]), ...requirements]
      saveRequirements(next)
      setRequirements(next)
      return fresh.length
    },
    [requirements],
  )

  const addTodo = useCallback((content: string, date: string) => {
    setTodos((prev) => {
      const item: TodoItem = {
        id: uid(),
        content,
        date,
        done: false,
        createdAt: nowISO(),
      }
      const next = [item, ...prev]
      saveTodos(next)
      return next
    })
  }, [])

  const toggleTodo = useCallback((id: string) => {
    setTodos((prev) => {
      const next = prev.map((t) => (t.id === id ? { ...t, done: !t.done } : t))
      saveTodos(next)
      return next
    })
  }, [])

  const removeTodo = useCallback((id: string) => {
    setTodos((prev) => {
      const next = prev.filter((t) => t.id !== id)
      saveTodos(next)
      return next
    })
  }, [])

  /** 项目名规范化（trim + 去重判断用） */
  const normalizeName = (name: string) => name.trim()

  const addProject = useCallback(
    (name: string): boolean => {
      const n = normalizeName(name)
      if (!n) return false
      if (projects.some((p) => p.name.toLowerCase() === n.toLowerCase())) return false
      const next = [...projects, { id: uid(), name: n, createdAt: nowISO() }].sort((a, b) =>
        a.name.localeCompare(b.name),
      )
      saveProjects(next)
      setProjects(next)
      return true
    },
    [projects],
  )

  const updateProject = useCallback(
    (id: string, name: string): boolean => {
      const n = normalizeName(name)
      if (!n) return false
      if (projects.some((p) => p.id !== id && p.name.toLowerCase() === n.toLowerCase())) return false
      const next = projects
        .map((p) => (p.id === id ? { ...p, name: n } : p))
        .sort((a, b) => a.name.localeCompare(b.name))
      saveProjects(next)
      setProjects(next)
      return true
    },
    [projects],
  )

  const removeProject = useCallback((id: string) => {
    setProjects((prev) => {
      const next = prev.filter((p) => p.id !== id)
      saveProjects(next)
      return next
    })
  }, [])

  /** 首次启动写入种子项目（只执行一次，由 App 调用） */
  const initProjects = useCallback(
    (seed: string[]): boolean => {
      if (projects.length > 0) return false
      const next: Project[] = seed.map((name) => ({
        id: uid(),
        name,
        createdAt: nowISO(),
      }))
      saveProjects(next)
      setProjects(next)
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
      saveRequirements(reqs)
      saveTodos(todos)
      saveProjects(projs)
      setRequirements(reqs)
      setTodos(todos)
      setProjects(projs)
      return true
    },
    [],
  )

  const value = useMemo(
    () => ({
      requirements,
      todos,
      projects,
      addRequirement,
      updateRequirement,
      removeRequirement,
      importRequirements,
      addTodo,
      toggleTodo,
      removeTodo,
      addProject,
      updateProject,
      removeProject,
      initProjects,
      restoreAll,
    }),
    [requirements, todos, projects, addRequirement, updateRequirement, removeRequirement, importRequirements, addTodo, toggleTodo, removeTodo, addProject, updateProject, removeProject, initProjects, restoreAll],
  )

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>
}

export function useStore(): Store {
  const ctx = useContext(StoreContext)
  if (!ctx) throw new Error('useStore must be used within StoreProvider')
  return ctx
}
