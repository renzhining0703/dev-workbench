/**
 * AI 上下文访问（SQLite）
 *
 * 一条上下文 = 面板一次「发送时快照」。可重复读取（agent 重试不丢上下文），
 * 过期由换取接口判定，过期超 24h 的行在下次签发时惰性清理。
 */
export class AiContextStore {
  /** @param {import('node:sqlite').DatabaseSync} db */
  constructor(db) {
    this.db = db
    this._insert = db.prepare(
      'INSERT INTO ai_contexts (id, username, payload, signature, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)',
    )
    this._get = db.prepare(
      'SELECT id, username, payload, signature, created_at, expires_at, fetched_at FROM ai_contexts WHERE id = ?',
    )
    this._markFetched = db.prepare('UPDATE ai_contexts SET fetched_at = ? WHERE id = ?')
    this._gc = db.prepare('DELETE FROM ai_contexts WHERE expires_at < ?')
  }

  /** 行 → 纯对象 */
  _row(row) {
    return {
      id: row.id,
      username: row.username,
      payload: JSON.parse(row.payload),
      signature: row.signature,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
      fetchedAt: row.fetched_at,
    }
  }

  /** 写入一条上下文（payload 为已最小化的对象） */
  insert({ id, username, payload, signature, createdAt, expiresAt }) {
    this._insert.run(
      id,
      username,
      JSON.stringify(payload),
      signature,
      createdAt,
      expiresAt,
    )
    return this._row(this._get.get(id))
  }

  /** 按 id 查上下文（不存在返回 null） */
  get(id) {
    const row = this._get.get(id)
    return row ? this._row(row) : null
  }

  /** 记录 agent 取回时间 */
  markFetched(id, at) {
    this._markFetched.run(at, id)
  }

  /** 清理过期时间早于 cutoff（ISO）的行，返回删除条数 */
  removeExpiredBefore(cutoff) {
    return this._gc.run(cutoff).changes
  }
}
