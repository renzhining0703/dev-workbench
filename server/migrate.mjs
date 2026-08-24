/**
 * v1（JSON 文件后端）→ v2（SQLite）数据导入
 *
 * 供两处复用：
 *   - startup.mjs：服务首次启动且 users 表为空时自动导入
 *   - scripts/migrate-json-to-sqlite.mjs：手动迁移 + 逐字段校验
 *
 * 导入内容：
 *   users.json 的每条记录   → users 表（pwHashHex→pw_hash, saltHex→salt）
 *   data/users/<u>.json     → snapshots 表（整包 JSON 原样入库）
 *   记录里的 tokenHex       → sessions 表（保持已登录会话不失效）
 */
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

/**
 * 从 v1 JSON 数据目录导入到已打开（且 users 为空）的数据库。
 * @param {object} opts
 * @param {import('node:sqlite').DatabaseSync} opts.db
 * @param {string} opts.usersFile   data/users.json 路径
 * @param {string} opts.userDataDir data/users/ 目录
 * @param {import('./store/users.mjs').UserStore} opts.userStore
 * @param {import('./store/sessions.mjs').SessionStore} opts.sessionStore
 * @param {import('./store/snapshots.mjs').SnapshotStore} opts.snapshotStore
 * @returns {{ users: number, snapshots: number, sessions: number, skipped: string[] }}
 */
export function importLegacyJson({ db, usersFile, userDataDir, userStore, sessionStore, snapshotStore }) {
  const report = { users: 0, snapshots: 0, sessions: 0, skipped: [], already: 0 }
  if (!existsSync(usersFile)) return report

  let list
  try {
    list = JSON.parse(readFileSync(usersFile, 'utf8'))
  } catch (e) {
    throw new Error(`users.json 解析失败: ${e.message}`)
  }
  if (!Array.isArray(list)) throw new Error('users.json 不是数组，格式异常')

  const dir = userDataDir.endsWith('/') ? userDataDir : `${userDataDir}/`

  db.exec('BEGIN IMMEDIATE')
  try {
    for (const u of list) {
      if (!u?.username || !u.pwHashHex || !u.saltHex) {
        report.skipped.push(String(u?.username ?? '<无名>'))
        continue
      }
      // 幂等：库里已有的用户跳过（不覆盖密码/快照/会话）
      if (userStore.has(u.username)) {
        report.already += 1
        continue
      }
      const created = userStore.create({
        username: u.username,
        pwHashHex: u.pwHashHex,
        saltHex: u.saltHex,
      })
      if (!created.ok) {
        report.skipped.push(u.username)
        continue
      }
      report.users += 1

      // 快照（存在才导入；不存在保持空）
      const snapFile = join(dir, `${u.username}.json`)
      if (existsSync(snapFile)) {
        const data = JSON.parse(readFileSync(snapFile, 'utf8'))
        snapshotStore.set(u.username, data)
        report.snapshots += 1
      }

      // 已登录会话保持有效
      if (typeof u.tokenHex === 'string' && u.tokenHex.length > 0) {
        sessionStore.importToken(u.username, u.tokenHex)
        report.sessions += 1
      }
    }
    db.exec('COMMIT')
  } catch (e) {
    db.exec('ROLLBACK')
    throw e
  }
  return report
}

/**
 * 导入后校验：逐用户对比 SQLite 内容与源 JSON。
 * @returns {{ ok: boolean, problems: string[] }}
 */
export function verifyImport({ db, usersFile, userDataDir }) {
  const problems = []
  const list = JSON.parse(readFileSync(usersFile, 'utf8'))
  const dir = userDataDir.endsWith('/') ? userDataDir : `${userDataDir}/`

  const userRows = db.prepare('SELECT username, pw_hash, salt FROM users').all()
  const userMap = new Map(userRows.map((r) => [r.username, r]))

  if (userRows.length !== list.length) {
    problems.push(`用户数不一致：源 ${list.length}，库 ${userRows.length}`)
  }

  for (const u of list) {
    const row = userMap.get(u.username)
    if (!row) {
      problems.push(`用户 ${u.username} 未入库`)
      continue
    }
    if (row.pw_hash !== u.pwHashHex) problems.push(`${u.username}: pw_hash 不一致`)
    if (row.salt !== u.saltHex) problems.push(`${u.username}: salt 不一致`)

    const snapFile = join(dir, `${u.username}.json`)
    if (existsSync(snapFile)) {
      const want = JSON.parse(readFileSync(snapFile, 'utf8'))
      const got = db
        .prepare('SELECT data FROM snapshots WHERE username = ?')
        .get(u.username)
      if (!got) {
        problems.push(`${u.username}: 快照未入库`)
      } else {
        const gotObj = JSON.parse(got.data)
        if (JSON.stringify(gotObj) !== JSON.stringify(want)) {
          problems.push(`${u.username}: 快照内容不一致`)
        }
      }
    }

    if (u.tokenHex) {
      const s = db
        .prepare('SELECT 1 AS x FROM sessions s WHERE s.username = ?')
        .get(u.username)
      if (!s) problems.push(`${u.username}: 会话未迁移`)
    }
  }
  return { ok: problems.length === 0, problems }
}
