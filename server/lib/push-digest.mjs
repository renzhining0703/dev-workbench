/**
 * 推送文案生成（纯函数，零 IO 零第三方依赖，便于单测）
 *
 * 每日定时推送调用：给定用户快照 + 当前时间，产出推送通知的标题/正文/跳转 URL。
 * 逻辑：
 *   - 今日待上线需求（status === 'ready' 且未被墓碑删除）→ 标题主信息，正文列名称（最多 3 条）
 *   - 今日未完成待办（date === 今天 且未完成 且未被墓碑删除）→ 正文补充条数
 *   - 都为空 → 「今日无待上线需求」
 */

const NAME_MAX = 3
const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六']

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

/**
 * @param {object} snapshot 服务端快照（normalize 后的结构）
 * @param {Date} [now]
 * @returns {{ title: string, body: string, url: string, readyCount: number, todoCount: number }}
 */
export function buildPushDigest(snapshot, now = new Date()) {
  const today = localDateStr(now)

  const alive = (x) => !x?.deletedAt
  const ready = (snapshot.requirements ?? []).filter(
    (r) => alive(r) && r.status === 'ready',
  )
  const openTodos = (snapshot.todos ?? []).filter(
    (t) => alive(t) && t.date === today && !t.done,
  )

  const readyCount = ready.length
  const todoCount = openTodos.length

  let title
  let body
  if (readyCount > 0) {
    title = `📦 今日 ${readyCount} 项需求待上线`
    const names = ready.slice(0, NAME_MAX).map((r) => r.name)
    body = names.join('、')
    if (readyCount > NAME_MAX) body += ` 等 ${readyCount} 项`
    if (todoCount > 0) body += ` · 还有 ${todoCount} 条待办未完成`
  } else if (todoCount > 0) {
    title = `📋 今日还有 ${todoCount} 条待办`
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
 * 与今日待办（优先级标记 + 内容），全量不截断。
 * @param {object} snapshot 服务端快照（normalize 后的结构）
 * @param {Date} [now]
 * @returns {string} 多行纯文本
 */
export function buildDigestText(snapshot, now = new Date()) {
  const digest = buildPushDigest(snapshot, now)
  const lines = [digest.title]

  const alive = (x) => !x?.deletedAt
  const ready = (snapshot.requirements ?? []).filter(
    (r) => alive(r) && r.status === 'ready',
  )
  const openTodos = (snapshot.todos ?? []).filter(
    (t) => alive(t) && t.date === localDateStr(now) && !t.done,
  )

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

  if (openTodos.length > 0) {
    lines.push('', `【今日待办 ${openTodos.length}】`)
    for (const t of openTodos) {
      const flag = t.priority === 'high' ? '🔴' : ''
      lines.push(`· ${flag}${t.content}`.trim())
    }
  }

  lines.push('', `—— dev-workbench · ${localHumanDate(now)}`)
  return lines.join('\n')
}
