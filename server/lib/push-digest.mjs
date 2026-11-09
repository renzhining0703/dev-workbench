/**
 * 推送文案生成（纯函数，零 IO 零第三方依赖，便于单测）
 *
 * 每日定时推送调用：给定用户快照 + 当前时间，产出推送通知的标题/正文/跳转 URL。
 * 逻辑：
 *   - 今日待上线需求（status === 'ready' 且未被墓碑删除）→ 标题主信息，正文列名称（最多 3 条）
 *   - 待办三分类（均要求未完成且未被墓碑删除）：
 *       今日待办（date === 今天）
 *       顺延待办（date < 今天，标注原定日期与延期天数 = 今天 − 原定日期）
 *       未排期（无 date）
 *   - 都为空 → 「今日无待上线需求」
 */

const NAME_MAX = 3
const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六']
const PRIORITY_ORDER = { high: 0, normal: 1, low: 2 }

function pad2(n) {
  return String(n).padStart(2, '0')
}

/** 本地时区 yyyy-MM-dd（服务器时区即用户时区，避免 toISOString 的 UTC 偏移） */
export function localDateStr(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

/** 「M月d日 周X」 */
export function localHumanDate(d) {
  return `${d.getMonth() + 1}月${d.getDate()}日 周${WEEKDAYS[d.getDay()]}`
}

/** 「YYYY-MM-DD」→ 本地当天零点 Date（无效返回 null） */
function parseLocalDate(s) {
  if (typeof s !== 'string') return null
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s)
  if (!m) return null
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  return Number.isNaN(d.getTime()) ? null : d
}

/** 自然日差 a − b（两个「YYYY-MM-DD」字符串），任一无效返回 null */
export function dayDiff(a, b) {
  const da = parseLocalDate(a)
  const db = parseLocalDate(b)
  if (!da || !db) return null
  return Math.round((da.getTime() - db.getTime()) / 86400000)
}

/** 待办排序：高优先级在前，同级按 date 倒序（无 date 的排最后） */
function sortTodos(list) {
  return [...list].sort((a, b) => {
    const pa = PRIORITY_ORDER[a.priority ?? 'normal'] ?? 1
    const pb = PRIORITY_ORDER[b.priority ?? 'normal'] ?? 1
    if (pa !== pb) return pa - pb
    const da = a.date ?? ''
    const db = b.date ?? ''
    return da < db ? 1 : da > db ? -1 : 0
  })
}

/**
 * @param {object} snapshot 服务端快照（normalize 后的结构）
 * @param {Date} [now]
 * @returns {{ title: string, body: string, url: string, readyCount: number, todoCount: number, overdueCount: number }}
 */
export function buildPushDigest(snapshot, now = new Date()) {
  const today = localDateStr(now)

  const alive = (x) => !x?.deletedAt
  const ready = (snapshot.requirements ?? []).filter(
    (r) => alive(r) && r.status === 'ready',
  )
  const openTodos = (snapshot.todos ?? []).filter((t) => alive(t) && !t.done)
  const todayTodos = openTodos.filter((t) => t.date === today)
  const overdueTodos = openTodos.filter(
    (t) => typeof t.date === 'string' && t.date < today && parseLocalDate(t.date),
  )

  const readyCount = ready.length
  const todoCount = todayTodos.length
  const overdueCount = overdueTodos.length

  const overdueSuffix = overdueCount > 0 ? ` · 顺延 ${overdueCount} 条` : ''

  let title
  let body
  if (readyCount > 0) {
    title = `📦 今日 ${readyCount} 项需求待上线`
    const names = ready.slice(0, NAME_MAX).map((r) => r.name)
    body = names.join('、')
    if (readyCount > NAME_MAX) body += ` 等 ${readyCount} 项`
    if (todoCount > 0) body += ` · 还有 ${todoCount} 条待办未完成`
    else if (overdueCount > 0) body += ` · 另有顺延待办 ${overdueCount} 条`
  } else if (todoCount > 0) {
    title = `📋 今日还有 ${todoCount} 条待办${overdueSuffix}`
    body = `${localHumanDate(now)}，记得清一清`
  } else if (overdueCount > 0) {
    title = `📋 有 ${overdueCount} 条待办已顺延`
    body = `${localHumanDate(now)}，记得清一清`
  } else {
    title = '☀️ 今日无待上线需求'
    body = `${localHumanDate(now)}，工作愉快`
  }

  return {
    title,
    body,
    url: today, // 通知点击 → 前端定位到「今日待办」
    readyCount,
    todoCount,
    overdueCount,
  }
}

/** ISO 时间 → 「MM-DD HH:mm」（无效值返回空串） */
function formatTime(iso) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return `${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`
}

/**
 * 详细版纯文本摘要（push-daily.mjs --print-digest 用，供外部投递渠道转发）。
 * 在 buildPushDigest 的标题基础上，列出全部待上线需求（名称｜项目｜上线时间）
 * 与待办三分类（今日 / 顺延 / 未排期），全量不截断。
 * 顺延条目标注「原定 MM-DD，延 X 天」，X = 今天 − 原定日期（与展示的原定日期一致，不用 createdAt 口径）。
 * @param {object} snapshot 服务端快照（normalize 后的结构）
 * @param {Date} [now]
 * @returns {string} 多行纯文本
 */
export function buildDigestText(snapshot, now = new Date()) {
  const digest = buildPushDigest(snapshot, now)
  const today = localDateStr(now)
  const lines = [digest.title]

  const alive = (x) => !x?.deletedAt
  const ready = (snapshot.requirements ?? []).filter(
    (r) => alive(r) && r.status === 'ready',
  )
  const openTodos = (snapshot.todos ?? []).filter((t) => alive(t) && !t.done)
  const todayTodos = openTodos.filter((t) => t.date === today)
  const overdueTodos = openTodos.filter(
    (t) => typeof t.date === 'string' && t.date < today && parseLocalDate(t.date),
  )
  const unscheduledTodos = openTodos.filter((t) => !t.date)

  if (ready.length > 0) {
    lines.push('', `【今日待上线 ${ready.length}】`)
    for (const r of ready) {
      const parts = [`· ${r.name}`]
      const projects = (r.projects ?? [])
        .map((p) => p?.project)
        .filter(Boolean)
      if (projects.length > 0) parts.push(projects.join('/'))
      if (r.publishTime) {
        const t = formatTime(r.publishTime)
        if (t) parts.push(`上线 ${t}`)
      }
      lines.push(parts.join('｜'))
    }
  }

  const todoLine = (t) => `· ${t.priority === 'high' ? '🔴' : ''}${t.content}`.trim()

  if (todayTodos.length > 0) {
    lines.push('', `【今日待办 ${todayTodos.length}】`)
    for (const t of sortTodos(todayTodos)) lines.push(todoLine(t))
  }

  if (overdueTodos.length > 0) {
    lines.push('', `【顺延待办 ${overdueTodos.length}】`)
    for (const t of sortTodos(overdueTodos)) {
      const delay = dayDiff(today, t.date)
      const mmdd = `${t.date.slice(5, 7)}-${t.date.slice(8, 10)}`
      const suffix = delay !== null && delay > 0 ? `｜原定 ${mmdd}，延 ${delay} 天` : ''
      lines.push(`${todoLine(t)}${suffix}`)
    }
  }

  if (unscheduledTodos.length > 0) {
    lines.push('', `【未排期 ${unscheduledTodos.length}】`)
    for (const t of sortTodos(unscheduledTodos)) lines.push(todoLine(t))
  }

  lines.push('', `—— dev-workbench · ${localHumanDate(now)}`)
  return lines.join('\n')
}
