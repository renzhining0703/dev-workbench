/**
 * 每用户快照数据访问（SQLite）
 *
 * 快照按 JSON 列整包存（合并逻辑与 v1 完全一致，前端零感知）。
 * update() 用 BEGIN IMMEDIATE 事务包住「读-改-写」——
 * v1 的并发丢更新 bug 在这里被事务结构性修复。
 */
import { emptySnapshot, normalizeSnapshot } from '../lib/merge.mjs'

export class SnapshotStore {
  /** @param {import('node:sqlite').DatabaseSync} db */
  constructor(db) {
    this.db = db
    this._get = db.prepare('SELECT data FROM snapshots WHERE username = ?')
    this._set = db.prepare(`
      INSERT INTO snapshots (username, data) VALUES (?, ?)
      ON CONFLICT(username) DO UPDATE SET data = excluded.data
    `)
  }

  /** 读取原始快照对象；不存在返回 null（调用方决定是否 normalize） */
  get(username) {
    const row = this._get.get(username)
    return row ? JSON.parse(row.data) : null
  }

  /** 读取并补默认值（GET /api/snapshot 路径用，与 v1 loadSnapshot 行为一致） */
  getNormalized(username) {
    return normalizeSnapshot(this.get(username) ?? undefined)
  }

  set(username, data) {
    this._set.run(username, JSON.stringify(data))
  }

  /** 不存在则写入空快照（register 路径用，对应 v1 注册后写空文件） */
  ensure(username) {
    if (!this._get.get(username)) this.set(username, emptySnapshot())
  }

  /**
   * 事务化读-改-写。
   * @param {(remote: object) => object} fn 接收当前快照，返回新快照
   * @returns {object} fn 的返回值（已落盘）
   */
  update(username, fn) {
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const remote = this.get(username) ?? emptySnapshot()
      const next = fn(remote)
      this.set(username, next)
      this.db.exec('COMMIT')
      return next
    } catch (e) {
      this.db.exec('ROLLBACK')
      throw e
    }
  }
}
