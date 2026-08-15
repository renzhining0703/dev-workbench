import type { Project, Requirement, TodoItem } from '../types'

const REQ_KEY = 'dev-workbench:requirements'
const TODO_KEY = 'dev-workbench:todos'
const PROJ_KEY = 'dev-workbench:projects'
const PROJ_INIT_KEY = 'dev-workbench:projects-initialized'

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

function write<T>(key: string, value: T) {
  localStorage.setItem(key, JSON.stringify(value))
}

export function uid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

export function nowISO(): string {
  return new Date().toISOString()
}

/* ---------------- 需求仓储 ---------------- */

export function loadRequirements(): Requirement[] {
  return read<Requirement[]>(REQ_KEY, [])
}

export function saveRequirements(list: Requirement[]) {
  write(REQ_KEY, list)
}

/* ---------------- 项目仓储 ---------------- */

export function loadProjects(): Project[] {
  return read<Project[]>(PROJ_KEY, [])
}

export function saveProjects(list: Project[]) {
  write(PROJ_KEY, list)
}

/** 是否已完成种子项目初始化（避免用户删光项目后又被自动填回） */
export function hasProjectInitFlag(): boolean {
  return localStorage.getItem(PROJ_INIT_KEY) === '1'
}

export function markProjectInit() {
  localStorage.setItem(PROJ_INIT_KEY, '1')
}

/* ---------------- 待办仓储 ---------------- */

export function loadTodos(): TodoItem[] {
  return read<TodoItem[]>(TODO_KEY, [])
}

export function saveTodos(list: TodoItem[]) {
  write(TODO_KEY, list)
}

/* ---------------- 完整备份 ---------------- */

/** 备份数据结构 */
export interface BackupData {
  version: number
  exportedAt: string
  requirements: Requirement[]
  todos: TodoItem[]
  projects: Project[]
}

/** 导出全部数据为备份对象 */
export function exportAllData(): BackupData {
  return {
    version: 1,
    exportedAt: nowISO(),
    requirements: loadRequirements(),
    todos: loadTodos(),
    projects: loadProjects(),
  }
}
