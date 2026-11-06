/**
 * Web Push 每日定时推送（上线提醒）
 *
 * 用法：node --no-warnings scripts/push-daily.mjs
 *       node --no-warnings scripts/push-daily.mjs --dry-run   # 只打印不发
 *       node --no-warnings scripts/push-daily.mjs --print-digest <username>
 *       #   ↑ 只输出该用户的详细摘要纯文本（不发送），供外部投递方调用拿文案
 * 定时：pm2 按 ecosystem.config.cjs 的 cron 每天 09:05 触发
 *       （autorestart:false —— 跑完即退，pm2 不重启，到点再起一次）。
 * 手动：ssh 上服务器后 `cd /var/www/dev-workbench-sync && node scripts/push-daily.mjs`
 *
 * 逻辑：遍历所有订阅 → 按用户分组（同用户多设备只算一次快照）→
 *       buildPushDigest 生成文案 → 双通道发送：
 *         1. web-push 浏览器推送（VAPID 已配置时；404/410 清理失效订阅）
 *         2. Server酱 微信推送（SERVERCHAN_SENDKEY 已配置时，每用户一条）
 * 前置：server/data/env.local 按需配置：
 *       VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY（npx web-push generate-vapid-keys 生成）
 *       SERVERCHAN_SENDKEY（https://sct.ftqq.com 微信扫码登录获取）
 *       两通道均未配置时脚本直接退出（不发不报错，避免 cron 噪音）。
 */
import { loadServerEnv, loadConfig } from '../config.mjs'
import { openDatabase } from '../db.mjs'
import { SnapshotStore } from '../store/snapshots.mjs'
import { PushSubscriptionStore } from '../store/push-subscriptions.mjs'
import { buildPushDigest, buildDigestText } from '../lib/push-digest.mjs'

const DRY_RUN = process.argv.includes('--dry-run')

const env = loadServerEnv()
const cfg = loadConfig(env)

const hasVapid = Boolean(cfg.vapidPublicKey && cfg.vapidPrivateKey)
const hasServerchan = Boolean(cfg.serverchanSendKey)

if (!hasVapid && !hasServerchan) {
  console.log(
    '[push-daily] VAPID 与 SERVERCHAN_SENDKEY 均未配置，跳过。请先在 server/data/env.local 写入：\n' +
      '  VAPID_PUBLIC_KEY=...\n  VAPID_PRIVATE_KEY=...\n' +
      '  生成：cd server && npx web-push generate-vapid-keys\n' +
      '  或 SERVERCHAN_SENDKEY=SCTxxx（https://sct.ftqq.com 获取）',
  )
  process.exit(0)
}

let webpush = null
if (hasVapid) {
  try {
    webpush = (await import('web-push')).default
  } catch (e) {
    console.error('[push-daily] 未安装 web-push 依赖：', e.message)
    process.exit(1)
  }
  webpush.setVapidDetails(cfg.vapidSubject, cfg.vapidPublicKey, cfg.vapidPrivateKey)
}

const db = openDatabase(cfg.dbFile)
const snapshotStore = new SnapshotStore(db)
const pushStore = new PushSubscriptionStore(db)

// --print-digest <username>：只输出该用户的详细摘要纯文本，不发送任何通知。
// 供外部投递方（如 OpenClaw cron）调用拿文案。
const printIdx = process.argv.indexOf('--print-digest')
if (printIdx !== -1) {
  const username =
    process.argv[printIdx + 1] && !process.argv[printIdx + 1].startsWith('-')
      ? process.argv[printIdx + 1]
      : ''
  if (!username) {
    console.error('[push-daily] 用法：node scripts/push-daily.mjs --print-digest <username>')
    process.exit(1)
  }
  const snapshot = snapshotStore.getNormalized(username)
  console.log(buildDigestText(snapshot))
  db.close()
  process.exit(0)
}

const TTL = 60 * 60 * 24 // 24h，miss 掉的可不补发

/** 同一用户的多个设备合并（快照只取一次，避免 N 次读） */
function groupByUser(subs) {
  const map = new Map()
  for (const s of subs) {
    if (!map.has(s.username)) map.set(s.username, [])
    map.get(s.username).push(s)
  }
  return map
}

/** Server酱推送（推送到微信服务号消息）。成功 code===0，其它视为失败。 */
async function sendServerchan(sendKey, title, desp) {
  const res = await fetch(`https://sctapi.ftqq.com/${sendKey}.send`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ title, desp }),
  })
  const data = await res.json().catch(() => ({}))
  if (data.code !== 0) {
    throw new Error(`Server酱 code=${data.code ?? res.status} ${data.message ?? ''}`.trim())
  }
}

async function main() {
  const all = pushStore.listAll()
  if (all.length === 0) {
    console.log('[push-daily] 暂无任何订阅（Server酱按订阅用户发送，无人可发），跳过')
    process.exit(0)
  }

  let sent = 0
  let removed = 0
  let failed = 0
  let scSent = 0
  let scFailed = 0

  for (const [username, subs] of groupByUser(all)) {
    const snapshot = snapshotStore.getNormalized(username)
    const digest = buildPushDigest(snapshot)

    console.log(`[push-daily] ${username}: ${digest.title}（订阅 ${subs.length} 台设备）`)

    // 通道 1：Server酱 微信推送（每用户一条，与设备数无关）
    if (hasServerchan) {
      const desp = `${digest.body}\n\n[打开 dev-workbench](${cfg.appPublicUrl})`
      if (DRY_RUN) {
        console.log(`  [dry-run] → Server酱微信: ${digest.body}`)
      } else {
        try {
          await sendServerchan(cfg.serverchanSendKey, digest.title, desp)
          scSent += 1
          console.log('  ✓ Server酱已发送')
        } catch (err) {
          scFailed += 1
          console.log(`  ✗ Server酱发送失败: ${err.message}`)
        }
      }
    }

    // 通道 2：Web Push 浏览器推送（逐设备）
    for (const sub of subs) {
      if (!hasVapid) break
      const subscription = { endpoint: sub.endpoint, keys: sub.keys }
      if (DRY_RUN) {
        console.log(`  [dry-run] → ${sub.endpoint.slice(0, 60)}… ${digest.body}`)
        continue
      }
      try {
        await webpush.sendNotification(
          subscription,
          JSON.stringify(digest),
          { TTL },
        )
        pushStore.clearError(username, sub.endpoint)
        sent += 1
      } catch (err) {
        const status = err?.statusCode
        if (status === 404 || status === 410) {
          // 订阅已失效（浏览器卸载/过期）→ 清理
          pushStore.remove(username, sub.endpoint)
          removed += 1
          console.log(`  ✗ 订阅失效(${status})，已删除: ${sub.endpoint.slice(0, 60)}…`)
        } else {
          const reason =
            [status, err?.name, err?.message, err?.code]
              .map((x) => (typeof x === 'string' ? x.trim() : x))
              .filter(Boolean)
              .join(' ') || 'unknown error'
          pushStore.markError(username, sub.endpoint, reason)
          failed += 1
          console.log(`  ✗ 发送失败(${status ?? '?'}): ${reason}`)
        }
      }
    }
  }

  db.close()
  console.log(
    `[push-daily] 完成：Web Push ${sent} 条${DRY_RUN ? '（dry-run 未实际发送）' : ''} · 清理失效 ${removed} · 失败 ${failed}` +
      (hasServerchan ? ` · Server酱 ${scSent} 条 / 失败 ${scFailed}` : ''),
  )
  process.exit(0)
}

main().catch((e) => {
  console.error('[push-daily] 执行异常：', e)
  try {
    db.close()
  } catch {
    /* 已关闭 */
  }
  process.exit(1)
})
