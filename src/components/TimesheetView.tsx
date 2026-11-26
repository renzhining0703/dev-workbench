import { useEffect, useMemo, useState } from 'react'
import {
  addDays,
  endOfMonth,
  eachDayOfInterval,
  format,
  isSameDay,
  isSameMonth,
  parseISO,
  startOfWeek,
} from 'date-fns'
import type { Requirement, TodoItem } from '../types'
import {
  buildMonthTimesheet,
  exportDates,
  loadOverrides,
  monthDayList,
  saveOverrides,
  toHoursGrid,
  toCsv,
  type TimesheetOverrides,
} from '../lib/timesheet'
import { linkableRequirements } from '../lib/todos'

const WEEK_LABELS = ['一', '二', '三', '四', '五', '六', '日']
const SOURCE_META: Record<string, { label: string; color: string }> = {
  todo: { label: '待办', color: 'var(--wb-success)' },
  range: { label: '开发区间', color: 'var(--wb-purple)' },
  manual: { label: '手动指定', color: 'var(--wb-warn)' },
  rest: { label: '休假', color: 'var(--wb-ink-3)' },
}

interface TimesheetViewProps {
  todos: TodoItem[]
  requirements: Requirement[]
}

/** 月度工时月报 Tab：月历总览 + 汇总表 + 手动微调（仅本地）+ 导出 */
export function TimesheetView({ todos, requirements }: TimesheetViewProps) {
  const now = new Date()
  const [cursor, setCursor] = useState({ year: now.getFullYear(), month: now.getMonth() + 1 })
  const [selected, setSelected] = useState(() => format(now, 'yyyy-MM-dd'))
  const [copied, setCopied] = useState(false)
  const monthKey = `${cursor.year}-${String(cursor.month).padStart(2, '0')}`
  const [overrides, setOverrides] = useState<TimesheetOverrides>(() => loadOverrides(monthKey))

  // 切月时重载该月的本地微调数据
  useEffect(() => {
    setOverrides(loadOverrides(monthKey))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [monthKey])

  const sheet = useMemo(
    () => buildMonthTimesheet(todos, requirements, cursor.year, cursor.month, overrides),
    [todos, requirements, cursor, overrides],
  )

  const exportCols = useMemo(() => exportDates(sheet.days), [sheet.days])
  // 全月每一天（含周末节假日空列），纯工时区粘贴时与工时表日期列一一对齐
  const allMonthDates = useMemo(() => monthDayList(cursor.year, cursor.month).map((d) => d.date), [cursor])
  const workdayCount = sheet.days.filter((d) => d.dayType === 'workday' || d.dayType === 'makeup').length
  const missedCount = sheet.emptyWorkdays.length

  /** 更新微调并落盘（仅 localStorage） */
  const updateOverrides = (next: TimesheetOverrides) => {
    setOverrides(next)
    saveOverrides(monthKey, next)
  }

  /** 休假三态：none 不休假 / half 半天（4h 休假 + 4h 工作）/ full 全天（8h 休假） */
  const setVacation = (date: string, mode: 'none' | 'half' | 'full') => {
    const vacation = { ...overrides.vacation }
    const vacationHalf = { ...overrides.vacationHalf }
    delete vacation[date]
    delete vacationHalf[date]
    if (mode === 'full') vacation[date] = true
    if (mode === 'half') vacationHalf[date] = true
    updateOverrides({ ...overrides, vacation, vacationHalf })
  }

  const setHours = (date: string, label: string, value: string) => {
    const monthHours = { ...(overrides.hours[date] ?? {}) }
    const num = value.trim() === '' ? undefined : Number(value)
    if (num === undefined || Number.isNaN(num) || num < 0) delete monthHours[label]
    else monthHours[label] = num
    updateOverrides({ ...overrides, hours: { ...overrides.hours, [date]: monthHours } })
  }

  /** 手动指定当天归属需求（空值 = 恢复自动推导） */
  const setAttribution = (date: string, reqId: string) => {
    const attributions = { ...(overrides.attributions ?? {}) }
    if (reqId) attributions[date] = reqId
    else delete attributions[date]
    updateOverrides({ ...overrides, attributions })
  }

  const copyTsv = async () => {
    try {
      await navigator.clipboard.writeText(toHoursGrid(sheet.rows, allMonthDates))
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      /* 剪贴板不可用：静默，用户可改用 CSV 下载 */
    }
  }

  const downloadCsv = () => {
    const blob = new Blob(['\ufeff' + toCsv(sheet.rows, exportCols)], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `工时表-${monthKey}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  // 月历格子：补齐前后到整周（与待办日历同规则）
  const calendarDays = useMemo(() => {
    const monthStart = new Date(cursor.year, cursor.month - 1, 1)
    const start = startOfWeek(monthStart, { weekStartsOn: 1 })
    const end = endOfMonth(monthStart)
    const lastWeekStart = startOfWeek(end, { weekStartsOn: 1 })
    return eachDayOfInterval({ start, end: addDays(lastWeekStart, 6) })
  }, [cursor])

  const sheetByDate = useMemo(() => new Map(sheet.days.map((d) => [d.date, d])), [sheet])
  const selectedDate = (() => {
    try {
      return parseISO(selected)
    } catch {
      return now
    }
  })()
  const selectedSheet = sheetByDate.get(selected)

  return (
    <div className="space-y-[18px]">
      {/* 页头 */}
      <div className="wb-page-head">
        <div>
          <div className="wb-eyebrow">Timesheet</div>
          <h1 className="wb-page-title">工时 <em>月报</em></h1>
          <p className="wb-page-sub">
            每个工作日默认 8h，从待办完成记录与需求开发区间自动推导；休假、归属与时数微调仅存本机
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          <button className="wb-day-nav" onClick={() => setCursor(({ year, month }) => prevMonth(year, month))} aria-label="上个月">◀</button>
          <b className="min-w-[92px] text-center" style={{ fontFamily: 'var(--wb-serif)' }}>
            {cursor.year}年{cursor.month}月
          </b>
          <button className="wb-day-nav" onClick={() => setCursor(({ year, month }) => nextMonth(year, month))} aria-label="下个月">▶</button>
          <button
            className="wb-btn-ghost"
            style={{ padding: '5px 10px', fontSize: 12 }}
            onClick={() => {
              setCursor({ year: now.getFullYear(), month: now.getMonth() + 1 })
              setSelected(format(now, 'yyyy-MM-dd'))
            }}
          >
            回到本月
          </button>
        </div>
      </div>

      {/* 概览 */}
      <div className="wb-todo-stats">
        <div className="wb-card wb-stat-mini">
          <div className="num num-brand">{sheet.totalHours}</div>
          <div className="lbl">当月合计（小时）</div>
          <div className="cap">{workdayCount} 个工作日</div>
        </div>
        <div className="wb-card wb-stat-mini">
          <div className="num num-accent">{workdayCount - missedCount}/{workdayCount}</div>
          <div className="lbl">已覆盖工作日</div>
          <div className="cap">休假也算覆盖</div>
        </div>
        <div className="wb-card wb-stat-mini">
          <div className={`num ${missedCount > 0 ? '' : 'num-ink'}`} style={missedCount > 0 ? { color: 'var(--wb-danger)' } : undefined}>
            {missedCount}
          </div>
          <div className="lbl">待补记（天）</div>
          <div className="cap">{missedCount > 0 ? '红圈日期点开补记' : '本月没有漏记 👍'}</div>
        </div>
      </div>

      {/* 月历总览 */}
      <div className="wb-card" style={{ padding: 18 }}>
        <div className="wb-ts-cal-grid">
          {WEEK_LABELS.map((w) => (
            <span key={w} className="wk">{w}</span>
          ))}
          {calendarDays.map((d) => {
            const date = format(d, 'yyyy-MM-dd')
            const inMonth = isSameMonth(d, new Date(cursor.year, cursor.month - 1, 1))
            const sd = sheetByDate.get(date)
            const isSel = selected === date
            const isToday = isSameDay(d, now)
            const isMiss = !!sd && (sd.dayType === 'workday' || sd.dayType === 'makeup') && sd.entries.length === 0
            const isRest = !!sd && (sd.dayType === 'holiday' || sd.dayType === 'weekend')
            const isMakeup = sd?.dayType === 'makeup'
            return (
              <button
                key={date}
                className={[
                  'wb-ts-day',
                  isSel ? 'sel' : '',
                  isToday ? 'today' : '',
                  inMonth ? '' : 'out',
                  isMiss ? 'miss' : '',
                  isRest ? 'rest' : '',
                ].join(' ')}
                onClick={() => setSelected(date)}
              >
                <span className="d">{format(d, 'd')}</span>
                {isMakeup && <span className="tag tag-makeup">班</span>}
                {sd?.holidayName && !isMakeup && <span className="tag">{sd.holidayName}</span>}
                {sd?.entries.length ? (
                  <span className="wb-ts-dots">
                    {/* 移动端：每个事项一个点；PC 显示事项名 */}
                    {sd.entries.slice(0, 3).map((e, i) => (
                      <span key={i} className="wb-ts-dot-item">{e.label}</span>
                    ))}
                    {sd.entries.length > 3 && <span className="wb-ts-dot-item">+{sd.entries.length - 3}</span>}
                  </span>
                ) : null}
                {overrides.vacation[date] && <span className="tag tag-vac">休</span>}
                {!overrides.vacation[date] && overrides.vacationHalf[date] && <span className="tag tag-vac">半休</span>}
                {sd?.smart && <span className="tag tag-smart">智</span>}
              </button>
            )
          })}
        </div>
      </div>

      {/* 单日明细 + 微调 */}
      <div className="wb-card" style={{ padding: 18 }}>
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div>
            <b style={{ fontFamily: 'var(--wb-serif)' }}>
              {format(selectedDate, 'M月d日')}
              <span style={{ fontSize: 12, color: 'var(--wb-ink-3)', marginLeft: 8, fontFamily: 'inherit' }}>
                {WEEKDAY_CN(selectedDate)}{selectedSheet?.holidayName ? ` · ${selectedSheet.holidayName}` : ''}
              </span>
            </b>
          </div>
          <div className="wb-ts-vac-seg" role="group" aria-label="休假标记">
            {(
              [
                ['none', '不休假'],
                ['half', '休半天'],
                ['full', '休全天'],
              ] as const
            ).map(([mode, label]) => {
              const active =
                mode === 'full' ? !!overrides.vacation[selected] : mode === 'half' ? !!overrides.vacationHalf[selected] : !overrides.vacation[selected] && !overrides.vacationHalf[selected]
              return (
                <button
                  key={mode}
                  className={active ? 'active' : ''}
                  onClick={() => setVacation(selected, mode)}
                >
                  {label}
                </button>
              )
            })}
          </div>
        </div>

        {/* 归属需求手动指定（工作日且非休全天时可选；指定后当天工时全归该需求） */}
        {selectedSheet && (selectedSheet.dayType === 'workday' || selectedSheet.dayType === 'makeup') && !overrides.vacation[selected] && (
          <div className="wb-ts-attr-row">
            <span>归属需求</span>
            <select
              value={overrides.attributions?.[selected] ?? ''}
              onChange={(ev) => setAttribution(selected, ev.target.value)}
              aria-label="手动指定归属需求"
            >
              <option value="">自动推导</option>
              {linkableRequirements(requirements).map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                    {r.projects?.[0]?.project ? `（${r.projects[0].project}）` : ''}
                  </option>
                ))}
            </select>
          </div>
        )}

        {/* 智能推导提示：仅展示层，复制/导出内容不含此提示 */}
        {selectedSheet?.smart && (
          <p className="wb-ts-smart-hint">
            ⚠️ 这天没有可直接归属的待办记录，也不在任何需求开发区间内，工时已智能归属到「
            {selectedSheet.entries.find((e) => e.source !== 'rest')?.label ?? '未关联待办'}
            」，可在上方「归属需求」里手动改。
          </p>
        )}

        {selectedSheet && (selectedSheet.dayType === 'holiday' || selectedSheet.dayType === 'weekend') && !overrides.vacation[selected] && !overrides.vacationHalf[selected] ? (
          <p className="wb-todo-empty">周末/节假日不计工时{selectedSheet.holidayName ? `（${selectedSheet.holidayName}）` : ''}</p>
        ) : selectedSheet && selectedSheet.entries.length > 0 ? (
          <ul className="wb-ts-entries">
            {selectedSheet.entries.map((e, i) => (
              <li key={i} className="wb-ts-entry">
                <div className="wb-ts-entry-main">
                  <span className="label">{e.label}</span>
                  {e.project && <span className="proj">{e.project}</span>}
                  <span className="src" style={{ color: SOURCE_META[e.source]?.color }}>
                    {SOURCE_META[e.source]?.label ?? e.source}
                  </span>
                </div>
                <div className="wb-ts-entry-hours">
                  <input
                    type="number"
                    min={0}
                    max={24}
                    step={0.5}
                    value={e.hours}
                    onChange={(ev) => setHours(selected, e.label, ev.target.value)}
                    aria-label={`${e.label} 当日工时`}
                  />
                  <span>h</span>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="wb-todo-empty">
            这天没有工时记录。可在上方「归属需求」手动指定补记，或去待办 Tab 补记并勾选完成，或标记休假。
          </p>
        )}
        <p className="wb-ts-note">💡 休假、归属与时数微调仅保存在本机浏览器，不同步到服务器；智能推导提示只在页面显示，复制和导出的内容不含提示</p>
      </div>

      {/* 汇总表 */}
      <div className="wb-card" style={{ padding: 18 }}>
        <div className="flex items-center justify-between gap-2 flex-wrap mb-3">
          <b style={{ fontFamily: 'var(--wb-serif)' }}>当月工时汇总</b>
          <div className="flex gap-2">
            <button className="wb-btn-ghost" style={{ padding: '4px 10px', fontSize: 12 }} onClick={copyTsv}>
              {copied ? '✅ 已复制' : '复制工时（粘到日期列）'}
            </button>
            <button className="wb-btn-ghost" style={{ padding: '4px 10px', fontSize: 12 }} onClick={downloadCsv}>
              下载 CSV
            </button>
          </div>
        </div>
        {sheet.rows.length === 0 ? (
          <p className="wb-todo-empty">本月还没有可汇总的工时数据</p>
        ) : (
          <div className="wb-ts-table-wrap">
            <table className="wb-ts-table">
              <thead>
                <tr>
                  <th>事项</th>
                  {exportCols.map((d) => (
                    <th key={d}>{d.slice(8)}</th>
                  ))}
                  <th>合计</th>
                </tr>
              </thead>
              <tbody>
                {sheet.rows.map((r) => (
                  <tr key={r.label}>
                    <td className="lbl-cell">
                      {r.label}
                      {r.project && <span className="proj-sub">{r.project}</span>}
                    </td>
                    {exportCols.map((d) => (
                      <td key={d} className={r.perDay[d] ? 'on' : ''}>{r.perDay[d] || ''}</td>
                    ))}
                    <td className="total-cell">{r.total}</td>
                  </tr>
                ))}
                <tr className="sum-row">
                  <td className="lbl-cell">合计</td>
                  {exportCols.map((d) => (
                    <td key={d} className="on">
                      {Math.round(sheet.rows.reduce((s, r) => s + (r.perDay[d] ?? 0), 0) * 10) / 10 || ''}
                    </td>
                  ))}
                  <td className="total-cell">{sheet.totalHours}</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

/** 上一个月（跨年处理） */
function prevMonth(year: number, month: number): { year: number; month: number } {
  return month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 }
}

/** 下一个月（跨年处理） */
function nextMonth(year: number, month: number): { year: number; month: number } {
  return month === 12 ? { year: year + 1, month: 1 } : { year, month: month + 1 }
}

/** 中文星期几 */
function WEEKDAY_CN(d: Date): string {
  return ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][d.getDay()]
}
