/**
 * 会话表数据访问（SQLite）
 *
 * - token 只存 SHA-256 哈希（sessions.token_hash），明文不落库
 * - 单会话互踢语义与 v1 一致：登录时删旧插新（issue）
 * - 查询走主键索引，替代 v1 的 O(n) 全表扫描
 */
import { hashToken, genToken } from '../lib/token.mjs'

export class SessionStore {
  /** @param {import('node:sqlite').DatabaseSync} db */
  constructor(db) {
    this.db = db
    this._lookup = db.prepare('SELECT username, created_at FROM sessions WHERE token_hash = ?')
    this._deleteForUser = db.prepare('DELETE FROM sessions WHERE username = ?')
    this._insert = db.prepare(
      'INSERT INTO sessions (token_hash, username, created_at) VALUES (?, ?, ?)',
    )
    this._deleteByHash = db.prepare('DELETE FROM sessions WHERE token_hash = ?')
  }

  /** 明文 token → { username } | null */
  lookup(token) {
    if (!token) return null
    const row = this._lookup.get(hashToken(token))
    return row ?? null
  }

  /**
   * 签发会话（单会话：先删该用户旧会话再插新，事务保证原子）。
   * 不传 token 则现场生成，返回明文 token（只在响应里出现一次，不落库）。
   */
  issue(username, token = genToken()) {
    const now = new Date().toISOString()
    this.db.exec('BEGIN IMMEDIATE')
    try {
      this._deleteForUser.run(username)
      this._insert.run(hashToken(token), username, now)
      this.db.exec('COMMIT')
    } catch (e) {
      this.db.exec('ROLLBACK')
      throw e
    }
    return token
  }

  /** 按 token 注销会话（logout）；返回是否删到了 */
  revoke(token) {
    if (!token) return false
    return this._deleteByHash.run(hashToken(token)).changes > 0
  }

  /** 直接写入已知 token 的会话行（迁移旧 users.json 的 tokenHex 时用） */
  importToken(username, tokenHex) {
    this._insert.run(hashToken(tokenHex), username, new Date().toISOString())
  }
}
