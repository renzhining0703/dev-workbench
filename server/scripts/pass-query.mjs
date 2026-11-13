/**
 * 密码查询脚本（供 OpenClaw 小龙虾接企微问答调用）
 *
 * 前置：data/env.local 配置
 *   PASSWORD_MASTER=<主密码>   ← 与浏览器端解锁用同一个；忘了 = 数据永久解不开
 *
 * 用法：node --no-warnings scripts/pass-query.mjs --user <用户名> <关键词>
 *   --user 必填且必须与 env.local 的 PASSWORD_USER 一致（owner 白名单，脚本层硬校验），
 *   与机器人层身份判定构成双层防线；密码查询仅限账号所有者
 *
 * 安全边界：本脚本输出明文密码，仅供服务器上的可信调用方使用；
 *           不要把 stdout 转发到不可信渠道。
 */
import { loadServerEnv, loadConfig } from '../config.mjs'
import { openDatabase } from '../db.mjs'
import { SnapshotStore } from '../store/snapshots.mjs'
import { decryptJson, CipherError } from '../lib/cipher.mjs'

// --user 必填：多用户环境下静默兜底 = 同事一句话就能查到 owner 的密码，绝不允许
const argv = process.argv.slice(2)
const userFlagIdx = argv.indexOf('--user')
const userFlag = userFlagIdx !== -1 ? argv[userFlagIdx + 1] : undefined
if (!userFlag || userFlag.startsWith('-') || !userFlag.trim()) {
  console.error('ERR: --user required（密码查询必须显式指定用户名，且仅限账号所有者）')
  process.exit(1)
}
const user = userFlag.trim()
// 关键词 = 非选项参数，剔除 --user 及其值
const args = argv.filter((a, i) => !a.startsWith('-') && i !== userFlagIdx + 1)
const keyword = args.join(' ').trim().toLowerCase()

if (!keyword) {
  console.error('[pass-query] 用法：node scripts/pass-query.mjs --user <用户名> <关键词>')
  process.exit(1)
}

const env = loadServerEnv()
const cfg = loadConfig(env)

// owner 白名单：只允许 PASSWORD_USER 指定的账号查密码（机器层硬校验，不依赖调用方自律）
const allowedUser = (env.PASSWORD_USER ?? '').trim()
if (!allowedUser || user !== allowedUser) {
  console.error('ERR: 密码查询仅限账号所有者（--user 必须与 PASSWORD_USER 配置一致）')
  process.exit(1)
}

const master = (env.PASSWORD_MASTER ?? '').trim()

if (!master) {
  console.error('[pass-query] PASSWORD_MASTER 未配置（data/env.local）')
  process.exit(1)
}

const db = openDatabase(cfg.dbFile)
try {
  const snapshot = new SnapshotStore(db).getNormalized(user)
  const all = Array.isArray(snapshot.passwords) ? snapshot.passwords : []
  const active = all.filter((p) => !p.deletedAt)

  // 全量解密后匹配（个人库量级很小，PBKDF2 按 salt 有缓存，AES 本身开销可忽略；
  // 这样备注-only 的命中不会因明文粗筛命中而漏掉）
  const keys = keyword.split(/\s+/)
  const hits = []
  for (const p of active) {
    if (!p.enc) continue
    let secret
    try {
      secret = await decryptJson(master, p.enc)
    } catch (e) {
      if (e instanceof CipherError) {
        console.error(`[pass-query] 「${p.title}」解密失败：主密码不匹配或密文损坏，跳过`)
        continue
      }
      throw e
    }
    const hay = [p.title ?? '', p.url ?? '', ...(p.tags ?? []), secret.username ?? '', secret.notes ?? '']
      .join(' ')
      .toLowerCase()
    if (keys.every((k) => hay.includes(k))) hits.push({ entry: p, secret })
  }

  if (hits.length === 0) {
    console.log(`未找到匹配「${keyword}」的密码条目（共 ${active.length} 条）`)
    process.exit(2)
  }

  for (const { entry, secret } of hits) {
    const lines = [
      `🔑 ${entry.title}`,
      entry.url ? `   网址：${entry.url}` : null,
      secret.username ? `   用户名：${secret.username}` : null,
      `   密码：${secret.password}`,
      (entry.tags ?? []).length ? `   标签：${entry.tags.join(', ')}` : null,
      secret.notes ? `   备注：${secret.notes}` : null,
    ].filter(Boolean)
    console.log(lines.join('\n'))
  }
  if (hits.length > 1) console.log(`\n（共 ${hits.length} 条匹配）`)
} finally {
  db.close()
}
