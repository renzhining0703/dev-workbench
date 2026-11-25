/**
 * AI 面板聊天历史（SQLite，跨端同步）
 *
 * 每用户一行：messages 为最近 20 条消息 JSON，updated_at 为服务端写入时间。
 * 同步策略为整体 LWW：保存即覆盖，最近活跃设备的列表胜出；
 * 另一端打开面板时比较 updatedAt，较旧的一方拉取较新列表。
 */
export class AiChatHistoryStore {
  /** @param {import('node:sqlite').DatabaseSync} db */
  constructor(db) {
    this.db = db
    this._get = db.prepare('SELECT messages, updated_at FROM ai_chat_history WHERE username = ?')
    this._upsert = db.prepare(
      'INSERT INTO ai_chat_history (username, messages, updated_at) VALUES (?, ?, ?) ' +
        'ON CONFLICT(username) DO UPDATE SET messages = excluded.messages, updated_at = excluded.updated_at',
    )
    this._delete = db.prepare('DELETE FROM ai_chat_history WHERE username = ?')
  }

  /** 某用户的聊天历史；不存在返回 null */
  get(username) {
    const row = this._get.get(username)
    if (!row) return null
    let messages = []
    try {
      messages = JSON.parse(row.messages)
    } catch {
      // 理论上只写合法 JSON；损坏时按空历史处理，下次保存即修复
    }
    return { messages: Array.isArray(messages) ? messages : [], updatedAt: row.updated_at }
  }

  /** 覆盖保存并返回服务端写入时间 */
  save(username, messages, updatedAt) {
    this._upsert.run(username, JSON.stringify(messages), updatedAt)
    return updatedAt
  }

  /** 清除某用户历史，返回删除条数 */
  remove(username) {
    return this._delete.run(username).changes
  }
}
