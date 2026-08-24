/**
 * 用户表数据访问（SQLite）
 *
 * 逻辑自 v1 users.mjs 平移；getByToken 的 O(n) 扫描改由 sessions 表索引查询承担。
 */
export const USERNAME_RE = /^[a-z0-9_]{3,20}$/

/** 校验用户名；返回 true/false */
export function isValidUsername(u) {
  return typeof u === 'string' && USERNAME_RE.test(u)
}

export class UserStore {
  /** @param {import('node:sqlite').DatabaseSync} db */
  constructor(db) {
    this.db = db
    this._count = db.prepare('SELECT COUNT(*) AS n FROM users')
    this._get = db.prepare(
      'SELECT username, pw_hash, salt, created_at, updated_at FROM users WHERE username = ?',
    )
    this._insert = db.prepare(
      'INSERT INTO users (username, pw_hash, salt, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
    )
    this._setPassword = db.prepare(
      'UPDATE users SET pw_hash = ?, salt = ?, updated_at = ? WHERE username = ?',
    )
    this._touch = db.prepare('UPDATE users SET updated_at = ? WHERE username = ?')
  }

  count() {
    return this._count.get().n
  }

  has(username) {
    return this._get.get(username) != null
  }

  /** 返回 { username, pwHashHex, saltHex, createdAt, updatedAt } | null */
  get(username) {
    const row = this._get.get(username)
    if (!row) return null
    return {
      username: row.username,
      pwHashHex: row.pw_hash,
      saltHex: row.salt,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }
  }

  /**
   * 创建用户。返回 { ok: true, user } 或 { ok: false, error: 'taken' }
   * 主键冲突（并发/重复）→ taken，与 v1 语义一致。
   * node:sqlite 的约束错误：code='ERR_SQLITE_ERROR'，errstr 含 'UNIQUE constraint'
   */
  create({ username, pwHashHex, saltHex }) {
    const now = new Date().toISOString()
    try {
      this._insert.run(username, pwHashHex, saltHex, now, now)
    } catch (e) {
      const isConstraint =
        e?.code === 'ERR_SQLITE_ERROR' &&
        (String(e?.errstr ?? '').includes('UNIQUE constraint') ||
          [19, 1555].includes(e?.errcode))
      if (isConstraint) {
        return { ok: false, error: 'taken' }
      }
      throw e
    }
    return { ok: true, user: this.get(username) }
  }

  /** 更新密码 hash（CLI / 运维用） */
  setPassword(username, pwHashHex, saltHex) {
    const r = this._setPassword.run(pwHashHex, saltHex, new Date().toISOString(), username)
    return r.changes > 0
  }

  /** 仅刷新 updated_at（登录等场景，与 v1 setToken 副作用一致） */
  touch(username) {
    this._touch.run(new Date().toISOString(), username)
  }
}
