/**
 * Web Push 测试：
 *  1) buildPushDigest 文案生成（纯函数，多场景）
 *  2) /api/push/* 路由（register / list / unregister / vapid-public-key / 鉴权 / 校验）
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDatabase } from '../db.mjs'
import { UserStore } from '../store/users.mjs'
import { SessionStore } from '../store/sessions.mjs'
import { SnapshotStore } from '../store/snapshots.mjs'
import { PushSubscriptionStore } from '../store/push-subscriptions.mjs'
import { createApp } from '../app.mjs'
import { genSalt, hashPassword } from '../lib/password.mjs'
import { buildPushDigest, localDateStr } from '../lib/push-digest.mjs'

/* ---------------- 1. buildPushDigest ---------------- */

const TEST_PUB_KEY = 'BPubKey0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
const TEST_PRIV_KEY = 'BPrivKey0123456789abcdef0123456789abcdef0123456789ab'

test('push-digest：有今日待上线 → 标题含数量，正文列名称', () => {
  const now = new Date('2026-08-27T10:00:00')
  const d = buildPushDigest(
    {
      requirements: [
        { name: 'A 需求', status: 'ready' },
        { name: 'B 需求', status: 'ready' },
        { name: 'C 需求', status: 'developing' },
      ],
      todos: [],
    },
    now,
  )
  assert.equal(d.title, '📦 今日 2 项需求待上线')
  assert.equal(d.body, 'A 需求、B 需求')
  assert.equal(d.readyCount, 2)
  assert.equal(d.url, localDateStr(now))
})

test('push-digest：超过 3 条截断并加「等 N 项」', () => {
  const d = buildPushDigest(
    {
      requirements: ['R1', 'R2', 'R3', 'R4', 'R5'].map((name) => ({ name, status: 'ready' })),
      todos: [],
    },
    new Date('2026-08-27T10:00:00'),
  )
  assert.equal(d.title, '📦 今日 5 项需求待上线')
  assert.ok(d.body.startsWith('R1、R2、R3'))
  assert.ok(d.body.includes('等 5 项'))
})

test('push-digest：墓碑删除的需求不计入', () => {
  const d = buildPushDigest(
    {
      requirements: [
        { name: '活的', status: 'ready' },
        { name: '死的', status: 'ready', deletedAt: '2026-08-01T00:00:00' },
      ],
      todos: [],
    },
    new Date('2026-08-27T10:00:00'),
  )
  assert.equal(d.readyCount, 1)
  assert.equal(d.title, '📦 今日 1 项需求待上线')
})

test('push-digest：无待上线但今日有待办 → 待办标题；已完成/他日/墓碑待办不计入', () => {
  const now = new Date('2026-08-27T10:00:00')
  const today = localDateStr(now)
  const d = buildPushDigest(
    {
      requirements: [],
      todos: [
        { content: '未完成-今天', date: today, done: false },
        { content: '已完成-今天', date: today, done: true },
        { content: '未完成-昨天', date: '2026-08-26', done: false },
        { content: '未完成-删除', date: today, done: false, deletedAt: '2026-08-01T00:00:00' },
      ],
    },
    now,
  )
  assert.equal(d.todoCount, 1)
  assert.equal(d.title, '📋 今日还有 1 条待办')
})

test('push-digest：今日待上线 + 未完成待办 → 正文合并提示', () => {
  const d = buildPushDigest(
    {
      requirements: [{ name: '发布模块', status: 'ready' }],
      todos: [{ content: 'x', date: '2026-08-27', done: false }],
    },
    new Date('2026-08-27T10:00:00'),
  )
  assert.ok(d.body.includes('还有 1 条待办未完成'))
})

test('push-digest：全空 → 今日无待上线', () => {
  const d = buildPushDigest({ requirements: [], todos: [] }, new Date('2026-08-27T10:00:00'))
  assert.equal(d.title, '☀️ 今日无待上线需求')
  assert.equal(d.readyCount, 0)
  assert.equal(d.todoCount, 0)
})

/* ---------------- 2. /api/push/* 路由 ---------------- */

function setupServer({ vapid = false } = {}) {
  const tmp = mkdtempSync(join(tmpdir(), 'push-api-test-'))
  const db = openDatabase(join(tmp, 'test.db'))
  const userStore = new UserStore(db)
  const sessionStore = new SessionStore(db)
  const snapshotStore = new SnapshotStore(db)
  const pushStore = new PushSubscriptionStore(db)

  const salt = genSalt()
  userStore.create({ username: 'alice', pwHashHex: hashPassword('pw123456', salt), saltHex: salt })

  const app = createApp({
    config: {
      allowedOrigins: ['http://localhost:5173'],
      inviteCode: '',
      rateLimitPerMin: 100,
      vapidPublicKey: vapid ? TEST_PUB_KEY : '',
      vapidPrivateKey: vapid ? TEST_PRIV_KEY : '',
      vapidSubject: 'mailto:test@example.com',
    },
    userStore,
    sessionStore,
    snapshotStore,
    pushStore,
  }).listen(0)
  const port = app.address().port
  const base = `http://127.0.0.1:${port}`

  const cleanup = () =>
    new Promise((resolve) => {
      app.close(() => {
        db.close()
        rmSync(tmp, { recursive: true, force: true })
        resolve()
      })
    })

  return { base, cleanup, pushStore, sessionStore }
}

async function loginToken(base, username, password) {
  const res = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  })
  const body = await res.json()
  assert.equal(res.status, 200, JSON.stringify(body))
  return body.data.token
}

const SUB = {
  endpoint: 'https://fcm.googleapis.com/fcm/send/test-endpoint-001',
  keys: { p256dh: 'p256dh-key', auth: 'auth-key' },
}

test('push API：未配置 VAPID 时 vapid-public-key 返回 503', async () => {
  const { base, cleanup } = setupServer({ vapid: false })
  try {
    const res = await fetch(`${base}/api/push/vapid-public-key`)
    assert.equal(res.status, 503)
    const body = await res.json()
    assert.equal(body.ok, false)
    assert.ok(body.hint.includes('VAPID'))
  } finally {
    await cleanup()
  }
})

test('push API：配置 VAPID 后返回公钥', async () => {
  const { base, cleanup } = setupServer({ vapid: true })
  try {
    const res = await fetch(`${base}/api/push/vapid-public-key`)
    assert.equal(res.status, 200)
    const body = await res.json()
    assert.equal(body.data.publicKey, TEST_PUB_KEY)
  } finally {
    await cleanup()
  }
})

test('push API：未登录 register → 401', async () => {
  const { base, cleanup } = setupServer()
  try {
    const res = await fetch(`${base}/api/push/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(SUB),
    })
    assert.equal(res.status, 401)
  } finally {
    await cleanup()
  }
})

test('push API：register 参数校验（缺 endpoint / 缺 keys）→ 400', async () => {
  const { base, cleanup } = setupServer()
  try {
    const token = await loginToken(base, 'alice', 'pw123456')
    const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }

    const r1 = await fetch(`${base}/api/push/register`, {
      method: 'POST', headers, body: JSON.stringify({ keys: SUB.keys }),
    })
    assert.equal(r1.status, 400)

    const r2 = await fetch(`${base}/api/push/register`, {
      method: 'POST', headers, body: JSON.stringify({ endpoint: SUB.endpoint }),
    })
    assert.equal(r2.status, 400)
  } finally {
    await cleanup()
  }
})

test('push API：register → list → unregister 全流程；重复注册去重', async () => {
  const { base, cleanup, pushStore } = setupServer()
  try {
    const token = await loginToken(base, 'alice', 'pw123456')
    const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }

    // 注册两次（同 endpoint）→ upsert 覆盖，不重复
    for (let i = 0; i < 2; i++) {
      const res = await fetch(`${base}/api/push/register`, {
        method: 'POST', headers, body: JSON.stringify({ ...SUB, userAgent: 'Chrome 126' }),
      })
      assert.equal(res.status, 200)
    }
    assert.equal(pushStore.count(), 1)

    // list → 1 条，keys 与 UA 正确
    const listRes = await fetch(`${base}/api/push/list`, { headers })
    const listBody = await listRes.json()
    assert.equal(listBody.data.subscriptions.length, 1)
    const sub = listBody.data.subscriptions[0]
    assert.equal(sub.endpoint, SUB.endpoint)
    assert.deepEqual(sub.keys, SUB.keys)
    assert.equal(sub.userAgent, 'Chrome 126')

    // 第二个用户注册同 endpoint → 各自一行（多账号多设备互不影响）
    const reg = await fetch(`${base}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'bob', password: 'pw123456' }),
    })
    assert.equal(reg.status, 200)
    const bobToken = await loginToken(base, 'bob', 'pw123456')
    const bobHeaders = { 'Content-Type': 'application/json', Authorization: `Bearer ${bobToken}` }
    const bobReg = await fetch(`${base}/api/push/register`, {
      method: 'POST', headers: bobHeaders, body: JSON.stringify(SUB),
    })
    assert.equal(bobReg.status, 200)
    assert.equal(pushStore.count(), 2)

    // alice 删除自己的订阅，bob 的不受影响
    const del = await fetch(`${base}/api/push/unregister`, {
      method: 'POST', headers, body: JSON.stringify({ endpoint: SUB.endpoint }),
    })
    assert.equal(del.status, 200)
    assert.equal(pushStore.count(), 1)
    assert.equal(pushStore.listByUser('bob').length, 1)
    assert.equal(pushStore.listByUser('alice').length, 0)
  } finally {
    await cleanup()
  }
})
