/**
 * Web Push 订阅访问（SQLite）
 *
 * 一个浏览器 = 一个 endpoint。同账号多设备各占一行；
 * 换账号登录（同浏览器）也会生成新的 username+endpoint 组合。
 * 退订按「当前用户 + endpoint」删除，避免误删他人订阅。
 */
export class PushSubscriptionStore {
  /** @param {import('node:sqlite').DatabaseSync} db */
  constructor(db) {
    this.db = db
    this._get = db.prepare(
      'SELECT username, endpoint, keys, user_agent, created_at, updated_at, last_error FROM push_subscriptions WHERE username = ? AND endpoint = ?',
    )
    this._upsert = db.prepare(`
      INSERT INTO push_subscriptions (username, endpoint, keys, user_agent, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(username, endpoint) DO UPDATE SET
        keys     = excluded.keys,
        user_agent = excluded.user_agent,
        updated_at = excluded.updated_at,
        last_error = NULL
    `)
    this._delete = db.prepare(
      'DELETE FROM push_subscriptions WHERE username = ? AND endpoint = ?',
    )
    this._listByUser = db.prepare(
      'SELECT username, endpoint, keys, user_agent, created_at, updated_at, last_error FROM push_subscriptions WHERE username = ? ORDER BY created_at',
    )
    this._all = db.prepare(
      'SELECT username, endpoint, keys, user_agent, created_at, updated_at, last_error FROM push_subscriptions ORDER BY username, created_at',
    )
    this._count = db.prepare('SELECT COUNT(*) AS n FROM push_subscriptions')
    this._markError = db.prepare(
      'UPDATE push_subscriptions SET last_error = ?, updated_at = ? WHERE username = ? AND endpoint = ?',
    )
    this._clearError = db.prepare(
      'UPDATE push_subscriptions SET last_error = NULL, updated_at = ? WHERE username = ? AND endpoint = ?',
    )
  }

  /** 行 → 纯对象（去掉内部无字段） */
  _row(row) {
    return {
      username: row.username,
      endpoint: row.endpoint,
      keys: JSON.parse(row.keys),
      userAgent: row.user_agent,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      lastError: row.last_error,
    }
  }

  /** 订阅或更新（同 endpoint 视为同一设备，整体覆盖并清空历史错误） */
  upsert(username, { endpoint, keys, userAgent = '' }) {
    const now = new Date().toISOString()
    this._upsert.run(
      username,
      endpoint,
      JSON.stringify({ p256dh: keys.p256dh, auth: keys.auth }),
      userAgent,
      now,
      now,
    )
    return this._row(this._get.get(username, endpoint))
  }

  /** 退订（只删当前用户的这条 endpoint） */
  remove(username, endpoint) {
    this._delete.run(username, endpoint)
  }

  /** 某用户全部订阅（含多设备） */
  listByUser(username) {
    return this._listByUser.all(username).map((r) => this._row(r))
  }

  /** 全部订阅（定时推送用，跨用户遍历） */
  listAll() {
    return this._all.all().map((r) => this._row(r))
  }

  count() {
    return this._count.get().n
  }

  /** 记录一次投递失败（运维排查用） */
  markError(username, endpoint, message) {
    this._markError.run(message, new Date().toISOString(), username, endpoint)
  }

  /** 投递成功：清空历史错误 */
  clearError(username, endpoint) {
    this._clearError.run(new Date().toISOString(), username, endpoint)
  }
}
