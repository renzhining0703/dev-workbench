/**
 * 密码查询脚本（供 OpenClaw 小龙虾接企微问答调用）
 *
 * 用法：node --no-warnings scripts/pass-query.mjs <关键词>
 *   关键词匹配：名称 / 网址 / 标签 / 用户名 / 备注（大小写不敏感，多关键词 AND）
 * 输出：匹配条目的纯文本（含解密后的用户名/密码/备注），无匹配输出提示并 exit 2
 *
 * 前置：data/env.local 配置
 *   PASSWORD_MASTER=<主密码>   ← 与浏览器端解锁用同一个；忘了 = 数据永久解不开
 *   PASSWORD_USER=<用户名>     ← 缺省 renzhining
 *
 * 安全边界：本脚本输出明文密码，仅供服务器上的可信调用方使用；
 *           不要把 stdout 转发到不可信渠道。
 */
import { loadServerEnv, loadConfig } from '../config.mjs'
import { openDatabase } from '../db.mjs'
import { SnapshotStore } from '../store/snapshots.mjs'
import { decryptJson, CipherError } from '../lib/cipher.mjs'

const args = process.argv.slice(2).filter((a) => !a.startsWith('-'))
const keyword = args.join(' ').trim().toLowerCase()

if (!keyword) {
  console.error('[pass-query] 用法：node scripts/pass-query.mjs <关键词>')
  process.exit(1)
}

const env = loadServerEnv()
const cfg = loadConfig(env)
const master = (env.PASSWORD_MASTER ?? '').trim()
const user = (env.PASSWORD_USER ?? 'renzhining').trim()

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
