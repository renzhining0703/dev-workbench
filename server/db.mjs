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

export const SCHEMA_VERSION = 3

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
 * v2：users 增加昵称列。
 * - 旧用户回填 nickname = username（与注册默认行为一致，保证列非空）
 * - ALTER TABLE ADD COLUMN 不支持 IF NOT EXISTS，必须由 migrate() 按版本号门控执行
 */
const SCHEMA_V2 = `
ALTER TABLE users ADD COLUMN nickname TEXT;
UPDATE users SET nickname = username WHERE nickname IS NULL;
`

/**
 * v3：Web Push 订阅表。
 * - 复合主键 (username, endpoint)：同一浏览器多账号登录各自成行；
 *   同账号同设备重复注册走 upsert 覆盖（见 store）
 * - keys 存 subscription.getKey('p256dh') / getKey('auth') 的 base64url（web-push 可直接用）
 * - last_error：投递失败原因（404/410 等），供运维排查；成功推送后清空
 * - user_agent：订阅时浏览器的 UA，方便识别同一账号下不同设备
 */
const SCHEMA_V3 = `
CREATE TABLE IF NOT EXISTS push_subscriptions (
  username   TEXT NOT NULL REFERENCES users(username) ON DELETE CASCADE,
  endpoint   TEXT NOT NULL,
  keys       TEXT NOT NULL,             -- JSON: { p256dh, auth }
  user_agent TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_error TEXT,
  PRIMARY KEY (username, endpoint)
);
CREATE INDEX IF NOT EXISTS idx_push_subs_username ON push_subscriptions(username);
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
  if (current > SCHEMA_VERSION) {
    throw new Error(`数据库 schema 版本 ${current} 比本程序支持的更高，请升级程序`)
  }
  // 顺序升级：current=0 → v1；current=1 → v2；current=2 → v3；跳过已应用的版本
  if (current < 1) db.exec(SCHEMA_V1)
  if (current < 2) db.exec(SCHEMA_V2)
  if (current < 3) db.exec(SCHEMA_V3)
  db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`)
}
