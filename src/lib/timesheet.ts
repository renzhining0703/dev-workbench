/**
 * 工时月报纯函数库：从待办 + 需求推导每月工时底稿。
 * 口径（经用户确认 2026-11-25/26，2026-11-26 补充时点与上线口径）：
 *  - 一天默认 8h；每个工作日（排除周末/法定节假日，含调休上班日）都算工时
 *  - 区间/智能推导只回算今天以前的日期：今天只按实际完成待办推导（无待办留空），
 *    未来日不推导、不进空白漏记提醒；手动指定归属 / 休假标记不受时点限制
 *  - 已上线需求不参与上线日之后的区间/智能推导（上线日当天及以前仍可归）；
 *    当天所有候选需求均已上线时留空，进空白清单标红提醒补记
 *  - 过去日期：当天有完成待办 → 按待办关联需求归属；未关联的先回退开发区间推导，
 *    区间也对不上时智能选一个最近需求归属（当天标 smart，UI 提示可手动改）
 *  - 过去日期无待办记录 → 落在某需求 devStartTime~devEndTime 开发区间内则归该需求，多需求平摊；
 *    区间也没命中时同样智能选一个最近需求归属（标 smart），需求列表为空才留空标红提醒补记
 *  - 手动指定归属 / 休假 / 改时数走 overrides（仅 localStorage，不进同步协议）
 *  - 永不出现「杂项」：仅当连一个可选需求都没有时才兜底「未关联待办」
 */
import { format, parseISO } from 'date-fns'
import type { Requirement, TodoItem } from '../types'
import { holidayDataOf } from './holidays'

export type DayType = 'workday' | 'weekend' | 'holiday' | 'makeup'

/** 一天的工时条目 */
export interface TimesheetEntry {
  /** 汇总行键：需求名 / 未关联待办 / 休假 */
  label: string
  /** 项目名（可空） */
  project?: string
  /** 关联需求 id（兜底行/休假无） */
  reqId?: string
  /** 来源：todo=完成待办推导 / range=开发区间推导 / manual=手动指定 / rest=休假 */
  source: 'todo' | 'range' | 'manual' | 'rest'
  hours: number
}

/** 一个月中的一天 */
export interface TimesheetDay {
  date: string
  dayType: DayType
  holidayName: string | null
  entries: TimesheetEntry[]
  /** 智能推导标记：当天有未关联待办且区间对不上，归属是猜的，UI 提示可手动改 */
  smart?: boolean
}

/** 汇总行：某「需求（项目）」整月的每日工时 */
export interface TimesheetRow {
  label: string
  project?: string
  reqId?: string
  /** key = yyyy-MM-dd（仅工作日），value = 小时 */
  perDay: Record<string, number>
  total: number
}

/** 手动微调（仅存 localStorage，不跨端同步） */
export interface TimesheetOverrides {
  /** 按日标记休全天（true = 8h 全归休假） */
  vacation: Record<string, boolean>
  /** 按日标记休半天（true = 休假 4h + 当天自动推导工作 4h） */
  vacationHalf: Record<string, boolean>
  /** 按 date+label 覆盖自动推导的小时数 */
  hours: Record<string, Record<string, number>>
  /** 按日手动指定归属需求（date → requirementId），指定后当天工时全归该需求 */
  attributions?: Record<string, string>
}

export const EMPTY_OVERRIDES: TimesheetOverrides = { vacation: {}, vacationHalf: {}, hours: {}, attributions: {} }

/** 本地时区 yyyy-MM-dd（completedAt 是完整 ISO，需归日避免 UTC 偏移） */
function toDateStr(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

/** ISO 串 → yyyy-MM-dd，解析失败返回 null */
function isoToDateStr(iso: string | null | undefined): string | null {
  if (!iso) return null
  try {
    return toDateStr(parseISO(iso))
  } catch {
    return null
  }
}

/** 判断某天类型：节假日 / 调休上班 / 周末 / 工作日 */
export function dayTypeOf(dateStr: string, year = Number(dateStr.slice(0, 4))): DayType {
  const data = holidayDataOf(year)
  if (data.holidays.includes(dateStr)) return 'holiday'
  if (data.makeupWorkdays.includes(dateStr)) return 'makeup'
  const d = new Date(dateStr + 'T00:00:00')
  const wd = d.getDay()
  return wd === 0 || wd === 6 ? 'weekend' : 'workday'
}

/** 列出整月每天（含前后补齐到整周的部分不在此处理，UI 层自行补） */
export function monthDayList(year: number, month: number): { date: string; dayType: DayType; holidayName: string | null }[] {
  const data = holidayDataOf(year)
  const days: { date: string; dayType: DayType; holidayName: string | null }[] = []
  const d = new Date(year, month - 1, 1)
  while (d.getMonth() === month - 1) {
    const date = toDateStr(d)
    const dayType = dayTypeOf(date, year)
    days.push({ date, dayType, holidayName: data.names[date] ?? null })
    d.setDate(d.getDate() + 1)
  }
  return days
}

/** 当月最后一个工作日（月底提醒用），无工作日返回 null */
export function lastWorkdayOfMonth(year: number, month: number): string | null {
  const list = monthDayList(year, month).filter((x) => x.dayType === 'workday' || x.dayType === 'makeup')
  return list.length ? list[list.length - 1].date : null
}

/** 把 total 小时按份数平摊：0.5h 粒度，尾差给最后一份（大差不差口径） */
export function splitHours(n: number, total = 8): number[] {
  if (n <= 0) return []
  if (n === 1) return [total]
  const base = Math.floor((total / n) * 2) / 2
  const out = Array.from({ length: n }, () => base)
  out[n - 1] = Math.round((total - base * (n - 1)) * 10) / 10
  return out
}

/** 智能选需求：开发区间边界距 date 最近者（同距取先）；无有效区间时取第一个需求，都没有返回 null */
function pickSmartReq(
  devRanges: { req: Requirement; start: string; end: string }[],
  reqs: Requirement[],
  date: string,
): Requirement | null {
  if (devRanges.length > 0) {
    const t = new Date(date + 'T00:00:00').getTime()
    let best = devRanges[0]
    let bestDist = Infinity
    for (const x of devRanges) {
      const s = new Date(x.start + 'T00:00:00').getTime()
      const e = new Date(x.end + 'T00:00:00').getTime()
      const dist = t < s ? s - t : t > e ? t - e : 0
      if (dist < bestDist) {
        bestDist = dist
        best = x
      }
    }
    return best.req
  }
  return reqs.length > 0 ? reqs[0] : null
}

/** 需求最早上线日（yyyy-MM-dd，多项目分批上线取最早），未上线返回 null */
function launchDateOf(r: Requirement): string | null {
  const cands: string[] = []
  const pub = isoToDateStr(r.publishTime)
  if (pub) cands.push(pub)
  for (const p of r.projects ?? []) {
    const d = isoToDateStr(p.publishedAt ?? null)
    if (d) cands.push(d)
  }
  return cands.length ? cands.sort()[0] : null
}

/**
 * 构建整月工时底稿：每天推导条目 + 汇总行 + 空白工作日清单。
 * 休全天覆盖全部自动条目；休半天把自动推导压缩到 4h，其余 4h 归休假。
 * overrides.attributions 指定归属后当天工时全归该需求（优先级最高）。
 * overrides.hours 仅在同名条目已存在时生效（改时数），不凭空造条目。
 * today 缺省取本地当天；区间/智能推导只对今天以前的日期生效，已上线需求不参与上线后的推导。
 */
export function buildMonthTimesheet(
  todos: TodoItem[],
  requirements: Requirement[],
  year: number,
  month: number,
  overrides: TimesheetOverrides = EMPTY_OVERRIDES,
  today?: string,
): { days: TimesheetDay[]; rows: TimesheetRow[]; totalHours: number; emptyWorkdays: string[] } {
  const todayStr = today ?? toDateStr(new Date())
  const reqMap = new Map(requirements.filter((r) => !r.deletedAt).map((r) => [r.id, r]))
  const reqList = [...reqMap.values()]

  // 需求开发区间 → 日期串（闭区间），解析失败的需求跳过区间推导
  const devRanges: { req: Requirement; start: string; end: string }[] = []
  for (const r of reqMap.values()) {
    const start = isoToDateStr(r.devStartTime)
    const end = isoToDateStr(r.devEndTime)
    if (start && end && start <= end) devRanges.push({ req: r, start, end })
  }

  // 需求最早上线日：上线日之后的日期不再把该需求当推导候选（上线当天及以前仍可归）
  const launchById = new Map<string, string | null>()
  for (const r of reqList) launchById.set(r.id, launchDateOf(r))
  const isLaunchedBefore = (reqId: string, date: string): boolean => {
    const ld = launchById.get(reqId)
    return ld != null && ld < date
  }

  // 每天完成的待办：关联的按 label 归组；未关联的只记「这天有」，归属延后到区间/智能推导
  const todosByDay = new Map<string, Map<string, { label: string; reqId?: string; project?: string }>>()
  const unlinkedDays = new Set<string>()
  for (const t of todos) {
    if (t.done === false || t.deletedAt) continue
    let day: string | null
    try {
      day = t.completedAt ? format(parseISO(t.completedAt), 'yyyy-MM-dd') : t.date
    } catch {
      day = t.date
    }
    if (!day) continue
    const req = t.requirementId ? reqMap.get(t.requirementId) : undefined
    if (req) {
      const map = todosByDay.get(day) ?? new Map()
      map.set(req.name, { label: req.name, reqId: req.id, project: req.projects?.[0]?.project })
      todosByDay.set(day, map)
    } else {
      unlinkedDays.add(day)
    }
  }

  const days: TimesheetDay[] = monthDayList(year, month).map(({ date, dayType, holidayName }) => {
    const entries: TimesheetEntry[] = []
    let smart = false
    const isVacFull = !!overrides.vacation[date]
    const isVacHalf = !isVacFull && !!overrides.vacationHalf[date]
    if (isVacFull) {
      // 休全天：8h 全归休假，覆盖一切工作条目
      entries.push({ label: '休假', source: 'rest', hours: 8 })
    } else if (dayType === 'workday' || dayType === 'makeup') {
      const workHours = isVacHalf ? 4 : 8
      // 手动指定归属优先级最高：当天工时全归该需求（可给空白日补记）
      const attrId = overrides.attributions?.[date]
      const attrReq = attrId ? reqMap.get(attrId) : undefined
      if (attrReq) {
        entries.push({
          label: attrReq.name,
          reqId: attrReq.id,
          project: attrReq.projects?.[0]?.project,
          source: 'manual',
          hours: workHours,
        })
      } else {
        const targets = new Map<string, { label: string; reqId?: string; project?: string }>()
        for (const [k, v] of todosByDay.get(date) ?? []) targets.set(k, v)
        const fromTodos = todosByDay.get(date) != null || unlinkedDays.has(date)
        // 区间回退：只回算今天以前的日期（今天只认实际待办，未来日不推导），
        // 且当天有未关联待办，或压根没有已关联待办覆盖时才走推导
        if (date < todayStr && (unlinkedDays.has(date) || targets.size === 0)) {
          // 上线日之后的已上线需求不参与候选
          const hitable = devRanges.filter((x) => !isLaunchedBefore(x.req.id, date))
          const hits = hitable.filter((x) => x.start <= date && date <= x.end)
          if (hits.length > 0) {
            for (const h of hits) {
              if (!targets.has(h.req.name))
                targets.set(h.req.name, { label: h.req.name, reqId: h.req.id, project: h.req.projects?.[0]?.project })
            }
          } else {
            // 区间对不上 → 智能选最近需求兜底（无待办日同样适用，标 smart，UI 提示可手动改）；
            // 候选为空说明当天所有需求均已上线 → 留空进空白清单提醒补记，不硬猜
            const activeReqs = reqList.filter((r) => !isLaunchedBefore(r.id, date))
            const picked = pickSmartReq(hitable, activeReqs, date)
            if (picked) {
              if (!targets.has(picked.name))
                targets.set(picked.name, { label: picked.name, reqId: picked.id, project: picked.projects?.[0]?.project })
              smart = true
            } else if (unlinkedDays.has(date) && targets.size === 0) {
              // 当天确有未关联待办但无任何可选需求 → 可读兜底标签；纯空白工作日保持留空（红圈提醒补记）
              targets.set('未关联待办', { label: '未关联待办' })
              smart = true
            }
          }
        }
        if (targets.size > 0) {
          const items = [...targets.values()]
          const hours = splitHours(items.length, workHours)
          items.forEach((it, i) => entries.push({ ...it, source: fromTodos ? 'todo' : 'range', hours: hours[i] }))
        }
      }
      if (isVacHalf) entries.push({ label: '休假', source: 'rest', hours: 4 })
    } else if (isVacHalf) {
      // 周末/节假日标记半天休假：仅记 4h（不参与自动推导）
      entries.push({ label: '休假', source: 'rest', hours: 4 })
    }
    // 手动改时数覆盖（仅同名条目已存在时生效）
    for (const e of entries) {
      const ov = overrides.hours[date]?.[e.label]
      if (typeof ov === 'number' && ov >= 0) e.hours = ov
    }
    return smart ? { date, dayType, holidayName, entries, smart } : { date, dayType, holidayName, entries }
  })

  // 汇总行：按 label 聚合，合计降序；休假最后
  const rowMap = new Map<string, TimesheetRow>()
  for (const day of days) {
    for (const e of day.entries) {
      if (e.hours <= 0) continue
      const row = rowMap.get(e.label) ?? { label: e.label, project: e.project, reqId: e.reqId, perDay: {}, total: 0 }
      row.perDay[day.date] = (row.perDay[day.date] ?? 0) + e.hours
      row.total = Math.round((row.total + e.hours) * 10) / 10
      rowMap.set(e.label, row)
    }
  }
  const rows = [...rowMap.values()].sort((a, b) => {
    const rank = (r: TimesheetRow) => (r.label === '休假' ? 1 : 0)
    if (rank(a) !== rank(b)) return rank(a) - rank(b)
    return b.total - a.total
  })

  const totalHours = Math.round(rows.reduce((s, r) => s + r.total, 0) * 10) / 10
  // 空白漏记清单只统计今天以前的工作日：今天还没过完、未来日不提醒
  const emptyWorkdays = days
    .filter(
      (d) =>
        (d.dayType === 'workday' || d.dayType === 'makeup') &&
        d.entries.length === 0 &&
        d.date < todayStr,
    )
    .map((d) => d.date)

  return { days, rows, totalHours, emptyWorkdays }
}

/** 导出列：工作日 + 休假标记日（有休假记 8h 行，也占列） */
export function exportDates(days: TimesheetDay[]): string[] {
  return days
    .filter((d) => d.dayType === 'workday' || d.dayType === 'makeup' || d.entries.length > 0)
    .map((d) => d.date)
}

/** Tab 分隔文本（粘贴进 Excel 自动分列），列 = 各日，末列 = 当月合计 */
export function toTsv(rows: TimesheetRow[], dates: string[]): string {
  const head = ['事项', '项目', ...dates.map(shortDate), '合计']
  const lines = [head.join('\t')]
  for (const r of rows) {
    const cells = [
      r.label,
      r.project ?? '',
      ...dates.map((d) => (r.perDay[d] ? String(r.perDay[d]) : '')),
      String(r.total),
    ]
    lines.push(cells.join('\t'))
  }
  return lines.join('\n')
}

/** CSV（UTF-8 BOM 由调用方加，Excel 直接打开不乱码） */
export function toCsv(rows: TimesheetRow[], dates: string[]): string {
  return toTsv(rows, dates).replace(/\t/g, ',')
}

/**
 * 纯工时区网格（粘贴进工时表日期区用）：无表头/无事项列/无合计，
 * 列 = 全月每一天（含周末节假日，空格子占位保证与工时表日期列对齐），行顺序与汇总表一致。
 */
export function toHoursGrid(rows: TimesheetRow[], allDates: string[]): string {
  return rows.map((r) => allDates.map((d) => (r.perDay[d] ? String(r.perDay[d]) : '')).join('\t')).join('\n')
}

/** MM/dd（导出列头） */
function shortDate(dateStr: string): string {
  return dateStr.slice(5).replace('-', '/')
}

/** 读取某月 overrides（localStorage，键按月隔离） */
export function loadOverrides(monthKey: string): TimesheetOverrides {
  try {
    const raw = localStorage.getItem(`dev-workbench:timesheet-overrides:${monthKey}`)
    if (!raw) return EMPTY_OVERRIDES
    const parsed = JSON.parse(raw) as Partial<TimesheetOverrides>
    return {
      vacation: parsed.vacation ?? {},
      vacationHalf: parsed.vacationHalf ?? {},
      hours: parsed.hours ?? {},
      attributions: parsed.attributions ?? {},
    }
  } catch {
    return EMPTY_OVERRIDES
  }
}

/** 保存某月 overrides */
export function saveOverrides(monthKey: string, ov: TimesheetOverrides): void {
  try {
    localStorage.setItem(`dev-workbench:timesheet-overrides:${monthKey}`, JSON.stringify(ov))
  } catch {
    /* 存储满/禁用：静默，UI 层不依赖它也能用 */
  }
}
