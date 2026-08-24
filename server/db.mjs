/**
 * SQLite 数据库初始化（node:sqlite，Node ≥ 22.5 内置，零原生编译）
 *
 * - WAL 模式：读写并发安全，pm2 reload 不丢事务
 * - 外键约束开启
 * - PRAGMA user_version 做 schema 版本迁移（未来加表只需 bump SCHEMA_VERSION）
 *
 * 全部数据库访问都经由本模块创建的连接；
 * 若 node:sqlite 实验性 API 出问题，替换为 better-sqlite3 只需改本文件。
 */
import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

export const SCHEMA_VERSION = 1

const SCHEMA_V1 = `
CREATE TABLE IF NOT EXISTS users (
  username   TEXT PRIMARY KEY,
  pw_hash    TEXT NOT NULL,
  salt       TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,          -- 存 token 的 SHA-256，不存明文
  username   TEXT NOT NULL REFERENCES users(username) ON DELETE CASCADE,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_username ON sessions(username);

CREATE TABLE IF NOT EXISTS snapshots (
  username TEXT PRIMARY KEY REFERENCES users(username) ON DELETE CASCADE,
  data     TEXT NOT NULL                 -- 快照整包 JSON（LWW 合并逻辑与 v1 完全一致）
);
`

/**
 * 打开（或创建）数据库并应用 schema。
 * @param {string} file 数据库文件路径
 * @returns {import('node:sqlite').DatabaseSync}
 */
export function openDatabase(file) {
  mkdirSync(dirname(file), { recursive: true })
  const db = new DatabaseSync(file)
  db.exec('PRAGMA journal_mode = WAL')
  db.exec('PRAGMA foreign_keys = ON')
  migrate(db)
  return db
}

function migrate(db) {
  const current = db.prepare('PRAGMA user_version').get().user_version
  if (current >= SCHEMA_VERSION) return
  if (current !== 0) {
    throw new Error(`数据库 schema 版本 ${current} 比本程序支持的更高，请升级程序`)
  }
  db.exec(SCHEMA_V1)
  db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`)
}
