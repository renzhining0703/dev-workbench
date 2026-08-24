/**
 * 项目名解析：从需求记录的 project 字段（可能是历史遗留的脏数据）中提取规范项目名。
 * 浏览器运行时（筛选匹配）与 Node 种子脚本共用，单一逻辑来源。
 *
 * 规则：
 * 1. 按 , ; ，； 拆分（一条需求可能对应多个项目）
 * 2. 去掉括号说明（如 "icare-zfl-febase (ks)" 中 (ks) 是发布模块，不是项目）
 * 3. 提取英文项目 token：`[a-zA-Z][a-zA-Z0-9]*(?:\s*-\s*[a-zA-Z0-9]+)+`
 *    - 至少含一个连字符（避开 "C端:" 的 C），连字符两侧允许空格（"icare- yecai" / "icare- magi - git"）
 *    - 中文自然截断 token（"后台: icare-forms C端: ..." 只取 icare-forms）
 * 4. 去内部空格统一格式（"icare- company" → "icare-company"），去重
 */
export function extractProjectNames(project: string | undefined | null): string[] {
  if (!project) return []
  const out = new Set<string>()
  const segments = project.split(/[;,，；]/)
  for (let seg of segments) {
    seg = seg.replace(/[（(][^（）()]*[）)]/g, ' ')
    const matches = seg.matchAll(/[a-zA-Z][a-zA-Z0-9]*(?:\s*-\s*[a-zA-Z0-9]+)+/g)
    for (const m of matches) {
      const name = m[0].replace(/\s+/g, '').toLowerCase()
      if (name) out.add(name)
    }
  }
  return [...out]
}

/* ---------------- 多项目需求（v3 数据模型） ---------------- */

import type { Requirement, RequirementProject } from '../types'

/** project 字段各分段里的括号说明（视为该项目的发布模块），如 "icare-febase (make/)" → "make/" */
function extractSegmentModule(segment: string): string {
  const m = segment.match(/[（(]([^（）()]*)[）)]/)
  return m ? m[1].trim() : ''
}

/**
 * 旧格式需求 → 结构化多项目。
 * - project 含多个项目（逗号分隔脏数据）→ 拆成多条关联，括号说明作为该项目的发布模块
 * - 单项目 → 一条关联，继承原 publishModule（或括号说明）
 */
function migrateLegacyProjects(r: {
  project?: string
  publishModule?: string
}): RequirementProject[] {
  const raw = (r.project ?? '').trim()
  if (!raw) return []
  const segments = raw.split(/[;,，；]/).map((s) => s.trim()).filter(Boolean)
  const out: RequirementProject[] = []
  const seen = new Set<string>()
  segments.forEach((seg, i) => {
    const [name] = extractProjectNames(seg)
    if (!name || seen.has(name)) return
    seen.add(name)
    // 括号说明优先；否则旧 publishModule 归给第一个项目
    const module = extractSegmentModule(seg) || (i === 0 ? (r.publishModule ?? '').trim() : '')
    out.push({ project: name, publishModule: module })
  })
  return out
}

/**
 * 规范化一条需求（来自 localStorage / 云端同步 / 导入）：
 * - 缺 projects（旧数据）→ 从 project/publishModule 文本迁移
 * - 有 projects → 清洗去重，并回写兼容字段 project/publishModule = 第一条关联
 * 幂等：重复执行无副作用。
 */
export function normalizeRequirement<T>(r: T): T & Requirement {
  const rec = r as unknown as Partial<Requirement>
  let refs: RequirementProject[] = Array.isArray(rec.projects)
    ? rec.projects
        .filter((p): p is RequirementProject => !!p && typeof p.project === 'string')
        .map((p) => ({ project: p.project.trim(), publishModule: (p.publishModule ?? '').trim() }))
        .filter((p) => p.project.length > 0)
    : []

  // 去重（按项目名，保留首个）
  const seen = new Set<string>()
  refs = refs.filter((p) => {
    const key = p.project.toLowerCase()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })

  // 旧数据迁移：projects 缺失或为空，但 project 文本有值
  if (refs.length === 0 && (rec.project ?? '').trim()) {
    refs = migrateLegacyProjects({
      project: rec.project,
      publishModule: rec.publishModule,
    })
  }

  return {
    ...r,
    projects: refs,
    project: refs[0]?.project ?? '',
    publishModule: refs[0]?.publishModule ?? '',
  } as T & Requirement
}

/** 需求关联的项目名列表（优先结构化字段，兜底解析 project 文本） */
export function requirementProjectNames(r: {
  project?: string
  projects?: RequirementProject[]
}): string[] {
  if (r.projects && r.projects.length > 0) return r.projects.map((p) => p.project)
  return extractProjectNames(r.project)
}

/** 项目展示文本："a / b"；空 → '' */
export function requirementProjectDisplay(r: {
  project?: string
  projects?: RequirementProject[]
}): string {
  return requirementProjectNames(r).join(' / ')
}

/** 发布模块展示文本："a: make/ · b: 全量"；单项目只显示模块本身，空 → '全量发布' */
export function requirementModuleDisplay(r: {
  publishModule?: string
  projects?: RequirementProject[]
}): string {
  if (r.projects && r.projects.length > 0) {
    return r.projects
      .map((p) => (p.publishModule ? `${p.project}: ${p.publishModule}` : `${p.project}: 全量`))
      .join(' · ')
  }
  return r.publishModule ? r.publishModule : ''
}
