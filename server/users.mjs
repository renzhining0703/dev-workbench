/**
 * 用户表 IO：
 *   - data/users.json          → [{ username, pwHashHex, saltHex, tokenHex|null, createdAt, updatedAt }]
 *   - data/users/<username>.json → snapshot（每用户独立）
 *
 * 全部走 atomicWriteJson（tmp + rename）保证原子写。
 * 内存里维护 cache；启动时 loadList() 一次，运行期直接读写。
 */
import { randomBytes } from 'node:crypto'
import { existsSync } from 'node:fs'
import { atomicWriteJson, loadSnapshot, saveSnapshot } from './storage.mjs'

export const USERNAME_RE = /^[a-z0-9_]{3,20}$/

/** 校验用户名；返回 true/false */
export function isValidUsername(u) {
  return typeof u === 'string' && USERNAME_RE.test(u)
}

/** 生成 32 字节十六进制 token */
export function genToken() {
  return randomBytes(16).toString('hex')
}

/**
 * 用户表 CRUD（内存 + 磁盘同步）
 */
export class UserStore {
  constructor({ usersFile, userDataDir }) {
    this.usersFile = usersFile
    this.userDataDir = userDataDir
    /** @type {Map<string, { username, pwHashHex, saltHex, tokenHex|null, createdAt, updatedAt }>} */
    this.byName = new Map()
  }

  async loadList() {
    let list = []
    try {
      const { readFile } = await import('node:fs/promises')
      const raw = await readFile(this.usersFile, 'utf8')
      list = JSON.parse(raw)
    } catch (e) {
      if (e.code !== 'ENOENT') throw e
    }
    if (!Array.isArray(list)) list = []
    this.byName = new Map(list.map((u) => [u.username, u]))
    return [...this.byName.values()]
  }

  /** 全部写回 users.json（原子） */
  async _saveAll() {
    const arr = [...this.byName.values()]
    await atomicWriteJson(this.usersFile, arr)
  }

  list() {
    return [...this.byName.values()].map((u) => ({
      username: u.username,
      createdAt: u.createdAt,
      updatedAt: u.updatedAt,
      hasToken: typeof u.tokenHex === 'string' && u.tokenHex.length > 0,
    }))
  }

  get(username) {
    return this.byName.get(username) ?? null
  }

  getByToken(token) {
    if (!token) return null
    for (const u of this.byName.values()) {
      if (u.tokenHex && u.tokenHex === token) return u
    }
    return null
  }

  /**
   * 创建用户（要求 username 唯一）
   * 返回 { ok, user, error }；并发冲突返回 { ok:false, error:'taken' }
   */
  async create({ username, pwHashHex, saltHex }) {
    if (this.byName.has(username)) {
      return { ok: false, error: 'taken' }
    }
    const now = new Date().toISOString()
    const record = {
      username,
      pwHashHex,
      saltHex,
      tokenHex: null,
      createdAt: now,
      updatedAt: now,
    }
    this.byName.set(username, record)
    try {
      await this._saveAll()
      return { ok: true, user: record }
    } catch (e) {
      // 写盘失败回滚
      this.byName.delete(username)
      throw e
    }
  }

  /** 更新密码 hash（v1 未提供 UI；CLI 用） */
  async setPassword(username, pwHashHex, saltHex) {
    const u = this.byName.get(username)
    if (!u) return false
    u.pwHashHex = pwHashHex
    u.saltHex = saltHex
    u.updatedAt = new Date().toISOString()
    await this._saveAll()
    return true
  }

  /** 写入 token（登录 / 续期）；token 已存在则覆盖 */
  async setToken(username, tokenHex) {
    const u = this.byName.get(username)
    if (!u) return false
    u.tokenHex = tokenHex
    u.updatedAt = new Date().toISOString()
    await this._saveAll()
    return true
  }

  /** 清掉 token（logout / 强制下线） */
  async clearToken(tokenHex) {
    for (const u of this.byName.values()) {
      if (u.tokenHex === tokenHex) {
        u.tokenHex = null
        u.updatedAt = new Date().toISOString()
        await this._saveAll()
        return true
      }
    }
    return false
  }

  /** 该用户名是否已存在 */
  has(username) {
    return this.byName.has(username)
  }

  /* ---------------- per-user snapshot ---------------- */

  userSnapshotFile(username) {
    // userDataDir 已经以 '/' 结尾；去掉前缀斜杠避免出现 data//users//alice.json
    const dir = this.userDataDir.endsWith('/') ? this.userDataDir : `${this.userDataDir}/`
    return `${dir}${username}.json`
  }

  /** 读取某用户的快照；不存在返回 emptySnapshot() */
  async loadUserSnapshot(username) {
    return loadSnapshot(this.userSnapshotFile(username))
  }

  /** 写某用户的快照 */
  async saveUserSnapshot(username, data) {
    await saveSnapshot(this.userSnapshotFile(username), data)
  }

  /** 该用户文件是否已存在（用于 O_EXCL 唯一性兜底） */
  hasUserFile(username) {
    return existsSync(this.userSnapshotFile(username))
  }
}