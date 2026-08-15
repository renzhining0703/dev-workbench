/**
 * 旧版需求记录格式迁移
 *
 * 兼容导入两类数据：
 * 1. 旧版格式（version 2.0.0，字段为 requirementName / projectModules / startTime 等）
 * 2. 本系统格式（字段为 name / publishModule / devStartTime 等）
 *
 * 本模块自包含（不 import 其他模块），可在浏览器与 Node 脚本中复用。
 */

/** 本系统需求结构（与 src/types 中 Requirement 同构） */
export interface MigratedRequirement {
  id: string
  name: string
  project: string
  branch: string
  publishModule: string
  status: string
  createdAt: string
  devStartTime: string | null
  devEndTime: string | null
  testTime: string | null
  publishTime: string | null
  remark: string
  updatedAt: string
}

/** 旧版导出结构 */
export interface LegacyRequirement {
  id?: string
  requirementName?: string
  projectName?: string
  projectModules?: Record<string, string>
  branch?: string
  testTime?: string
  releaseTime?: string
  startTime?: string
  endTime?: string
  status?: string
  notes?: string
  workCode?: string
  createTime?: string
  updateTime?: string
}

export interface LegacyExport {
  requirements?: LegacyRequirement[]
}

/** 中文状态 → 系统状态 */
const STATUS_MAP: Record<string, string> = {
  待开始: 'pending',
  待开发: 'pending',
  开发中: 'developing',
  测试中: 'testing',
  待测试: 'testing',
  待上线: 'ready',
  暂停: 'paused',
  已上线: 'published',
  已归档: 'archived',
}

function pick<T>(v: T | undefined, fallback: T): T {
  return v === undefined || v === null || v === '' ? fallback : v
}

/** 提取发布模块：优先 projectModules 值，其次从 projectName 括号中解析 */
function extractModule(r: LegacyRequirement): string {
  const set = new Set<string>()
  const push = (s: unknown) => {
    String(s ?? '')
      .split(/[,，;；/、\s]+/)
      .filter(Boolean)
      .forEach((p) => set.add(p.trim()))
  }
  if (r.projectModules) {
    for (const v of Object.values(r.projectModules)) push(v)
  }
  const name = String(r.projectName ?? '')
  for (const m of name.matchAll(/[（(]([^（）()]+)[)）]/g)) push(m[1])
  return Array.from(set).join(', ')
}

function buildRemark(r: LegacyRequirement): string {
  const parts: string[] = []
  if (r.workCode) parts.push(`【迭代】${r.workCode}`)
  if (r.notes) parts.push(r.notes)
  return parts.join('\n')
}

function convertOne(r: LegacyRequirement): MigratedRequirement {
  const createTime = pick(r.createTime, new Date().toISOString())
  return {
    id: pick(r.id, `legacy-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`),
    name: pick(r.requirementName, '未命名需求').trim(),
    project: pick(r.projectName, '').trim(),
    branch: pick(r.branch, '').trim(),
    publishModule: extractModule(r),
    status: STATUS_MAP[pick(r.status, '待开始').trim()] ?? 'pending',
    createdAt: createTime,
    devStartTime: pick(r.startTime, null),
    devEndTime: pick(r.endTime, null),
    testTime: pick(r.testTime, null),
    publishTime: pick(r.releaseTime, null),
    remark: buildRemark(r).trim(),
    updatedAt: pick(r.updateTime, createTime),
  }
}

/** 判断是否为旧版导出格式（含 requirements 数组） */
export function isLegacyExport(data: unknown): data is LegacyExport {
  if (!data || typeof data !== 'object') return false
  const arr = (data as { requirements?: unknown }).requirements
  return Array.isArray(arr) && arr.length > 0 && 'requirementName' in arr[0]
}

/** 判断是否为本系统格式（Requirement 数组） */
export function isSystemExport(data: unknown): boolean {
  return Array.isArray(data) && data.length > 0 && 'name' in data[0] && 'status' in data[0]
}

/** 旧版导出 → 系统格式 */
export function migrateLegacyExport(data: LegacyExport): MigratedRequirement[] {
  return (data.requirements ?? [])
    .filter((r) => r && typeof r === 'object')
    .map(convertOne)
}

/** 系统格式数据清洗（补缺省字段、去掉脏数据） */
export function normalizeSystemExport(data: unknown[]): MigratedRequirement[] {
  return data
    .filter((r): r is Record<string, unknown> => !!r && typeof r === 'object')
    .map((r) => {
      const createTime = pick(String(r.createdAt ?? ''), new Date().toISOString())
      return {
        id: pick(String(r.id ?? ''), `imported-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`),
        name: pick(String(r.name ?? ''), '未命名需求').trim(),
        project: pick(String(r.project ?? ''), '').trim(),
        branch: pick(String(r.branch ?? ''), '').trim(),
        publishModule: pick(String(r.publishModule ?? ''), '').trim(),
        status: String(r.status ?? 'pending'),
        createdAt: createTime,
        devStartTime: pick(r.devStartTime == null ? '' : String(r.devStartTime), null),
        devEndTime: pick(r.devEndTime == null ? '' : String(r.devEndTime), null),
        testTime: pick(r.testTime == null ? '' : String(r.testTime), null),
        publishTime: pick(r.publishTime == null ? '' : String(r.publishTime), null),
        remark: pick(String(r.remark ?? ''), '').trim(),
        updatedAt: pick(String(r.updatedAt ?? ''), createTime),
      }
    })
    .filter((r) => r.name !== '未命名需求')
}

/** 统一入口：识别旧版/系统格式并转换 */
export function parseImportData(data: unknown): MigratedRequirement[] {
  if (isLegacyExport(data)) return migrateLegacyExport(data)
  if (isSystemExport(data)) return normalizeSystemExport(data as unknown[])
  return []
}
