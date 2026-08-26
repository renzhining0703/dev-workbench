#!/usr/bin/env node
/**
 * 行为基线冒烟测试 —— 新旧后端通用对拍工具
 *
 * 用法：
 *   node test/smoke.mjs [BASE_URL]
 *   BASE_URL 默认 http://127.0.0.1:8787
 *
 * 前置：目标服务需以 INVITE_CODE=smoke-invite-1234 启动（见 test/run-old.sh / npm run test:smoke）
 * 覆盖：health / register / login / me / snapshot / push(LWW 合并) / logout / 404 / CORS / body 校验
 *
 * 断言全部对照旧版（node:http 手写版）的真实行为，新 Express 版必须逐条通过。
 */
const T = (s) => `2026-0${s}T00:00:00.000Z` // 确定性时间戳辅助

/**
 * 运行全部冒烟断言。
 * - CLI：node test/smoke.mjs [BASE_URL]（BASE_URL 默认 http://127.0.0.1:8787）
 * - 库模式：import { runSmoke } from './smoke.mjs'（供 api.test.mjs in-process 复用）
 * 返回 { passed, failed, failures }
 */
export async function runSmoke(baseUrl, { inviteCode = 'smoke-invite-1234' } = {}) {
  const BASE_URL = baseUrl
  const INVITE_CODE = inviteCode
  const USERNAME = `smoke_${Date.now().toString(36).slice(-5)}`
  const PASSWORD = 'smoke-password-123'

  let passed = 0
  let failed = 0
  const failures = []

  function check(name, cond, detail = '') {
    if (cond) {
      passed++
    } else {
      failed++
      failures.push(`${name}${detail ? ` :: ${detail}` : ''}`)
      console.error(`  ✗ ${name}${detail ? ` :: ${detail}` : ''}`)
    }
  }

async function req(method, path, { token, body, rawBody, origin } = {}) {
  const headers = {}
  if (token) headers.authorization = `Bearer ${token}`
  if (origin) headers.origin = origin
  let payload
  if (rawBody !== undefined) {
    payload = rawBody
  } else if (body !== undefined) {
    headers['content-type'] = 'application/json'
    payload = JSON.stringify(body)
  }
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: payload,
  })
  const text = await res.text()
  let json = null
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    json = null
  }
  return { status: res.status, json, text, headers: res.headers }
}

/** 忽略 serverTs 后比较业务字段（serverTs 每次都变，无法对拍） */
function stripVolatile(data) {
  if (!data || typeof data !== 'object') return data
  const { serverTs, ...rest } = data
  return rest
}

  /* ---------- 1. health ---------- */
  {
    const r = await req('GET', '/api/health')
    check('health → 200', r.status === 200)
    check('health → ok:true', r.json?.ok === true)
    check('health → version:1', r.json?.data?.version === 1)
  }

  /* ---------- 2. CORS 预检 ---------- */
  {
    const r = await req('OPTIONS', '/api/auth/login', { origin: 'http://localhost:5173' })
    check('OPTIONS → 204', r.status === 204)
    check('OPTIONS → ACAO 回显', r.headers.get('access-control-allow-origin') === 'http://localhost:5173')
  }
  {
    const r = await req('OPTIONS', '/api/auth/login', { origin: 'http://evil.example.com' })
    check('OPTIONS 非白名单 origin → 无 ACAO', r.headers.get('access-control-allow-origin') === null)
  }

  /* ---------- 3. register 校验 ---------- */
  {
    const r = await req('POST', '/api/auth/register', { body: { username: 'BAD NAME!', password: '12345678' } })
    check('register 非法用户名 → 400', r.status === 400, `got ${r.status}`)
    check('register 非法用户名 → invalid input', r.json?.error === 'invalid input', JSON.stringify(r.json))
  }
  {
    const r = await req('POST', '/api/auth/register', { body: { username: 'shortpw_user', password: '123' } })
    check('register 短密码 → 400', r.status === 400)
  }
  {
    const r = await req('POST', '/api/auth/register', { body: { username: USERNAME, password: PASSWORD, inviteCode: 'wrong-code' } })
    check('register 错邀请码 → 401', r.status === 401)
    check('register 错邀请码 → invalid credentials（防枚举）', r.json?.error === 'invalid credentials')
  }

  /* ---------- 4. register 成功 ---------- */
  let registerToken = ''
  {
    const r = await req('POST', '/api/auth/register', { body: { username: USERNAME, password: PASSWORD, inviteCode: INVITE_CODE } })
    check('register → 200', r.status === 200, `got ${r.status} ${r.text}`)
    check('register → token', typeof r.json?.data?.token === 'string' && r.json.data.token.length > 0)
    check('register → user.username', r.json?.data?.user?.username === USERNAME)
    check('register 未传昵称 → nickname 回退 username', r.json?.data?.user?.nickname === USERNAME)
    registerToken = r.json?.data?.token ?? ''
  }
  {
    const r = await req('POST', '/api/auth/register', { body: { username: USERNAME, password: PASSWORD, inviteCode: INVITE_CODE } })
    check('register 重复用户名 → 401 invalid credentials', r.status === 401 && r.json?.error === 'invalid credentials')
  }

  /* ---------- 4b. 昵称：注册携带 + 修改 + 非法输入 ---------- */
  {
    const r = await req('POST', '/api/auth/register', {
      body: { username: `${USERNAME}_n`, password: PASSWORD, inviteCode: INVITE_CODE, nickname: '测试昵称' },
    })
    check('register 带昵称 → nickname 生效', r.status === 200 && r.json?.data?.user?.nickname === '测试昵称', r.text)
  }
  {
    const r = await req('POST', '/api/auth/nickname', {
      token: registerToken,
      body: { nickname: '新昵称' },
    })
    check('nickname 修改 → 200', r.status === 200, `got ${r.status} ${r.text}`)
    check('nickname 修改 → 返回新昵称', r.json?.data?.user?.nickname === '新昵称')
  }
  {
    const r = await req('GET', '/api/auth/me', { token: registerToken })
    check('me 修改后 → nickname 已更新', r.json?.data?.user?.nickname === '新昵称')
  }
  {
    const r = await req('POST', '/api/auth/nickname', { token: registerToken, body: { nickname: '' } })
    check('nickname 空串 → 400 invalid input', r.status === 400 && r.json?.error === 'invalid input')
  }
  {
    const r = await req('POST', '/api/auth/nickname', { token: registerToken, body: { nickname: 'x'.repeat(31) } })
    check('nickname 超 30 字符 → 400 invalid input', r.status === 400 && r.json?.error === 'invalid input')
  }
  {
    const r = await req('POST', '/api/auth/nickname', { token: 'deadbeef'.repeat(4), body: { nickname: 'x' } })
    check('nickname 坏 token → 401', r.status === 401)
  }

  /* ---------- 5. me（register token 可用） ---------- */
  {
    const r = await req('GET', '/api/auth/me', { token: registerToken })
    check('me(register token) → 200', r.status === 200)
    check('me → username', r.json?.data?.user?.username === USERNAME)
  }
  {
    const r = await req('GET', '/api/auth/me', { token: 'deadbeef'.repeat(4) })
    check('me 坏 token → 401', r.status === 401)
    check('me 坏 token → invalid credentials', r.json?.error === 'invalid credentials')
  }
  {
    const r = await req('GET', '/api/auth/me', {})
    check('me 无 token → 401', r.status === 401)
  }

  /* ---------- 6. login ---------- */
  {
    const r = await req('POST', '/api/auth/login', { body: { username: 'no_such_user_1', password: 'whatever-xx' } })
    check('login 不存在用户 → 401 invalid credentials', r.status === 401 && r.json?.error === 'invalid credentials')
  }
  {
    const r = await req('POST', '/api/auth/login', { body: { username: USERNAME, password: 'wrong-password' } })
    check('login 错密码 → 401 invalid credentials', r.status === 401 && r.json?.error === 'invalid credentials')
  }
  let loginToken = ''
  {
    const r = await req('POST', '/api/auth/login', { body: { username: USERNAME, password: PASSWORD } })
    check('login → 200', r.status === 200, `got ${r.status}`)
    check('login → token', typeof r.json?.data?.token === 'string' && r.json.data.token.length > 0)
    loginToken = r.json?.data?.token ?? ''
  }
  {
    // token rotation：登录后旧 token 应失效（单会话互踢语义）
    const r = await req('GET', '/api/auth/me', { token: registerToken })
    check('login 后旧 token 失效（rotation）', r.status === 401, `got ${r.status}`)
    check('login 后旧 token → invalid credentials', r.json?.error === 'invalid credentials')
  }

  /* ---------- 7. push 合并语义（LWW） ---------- */
  const itemV1 = { id: 'a1', title: 'v1', createdAt: T('1'), updatedAt: T('1') }
  const itemV2 = { id: 'a1', title: 'v2', createdAt: T('1'), updatedAt: T('2') }
  const itemV0 = { id: 'a1', title: 'v0-old', createdAt: T('1'), updatedAt: '2025-12-01T00:00:00.000Z' }
  const itemB = { id: 'b2', title: 'b', createdAt: T('3'), updatedAt: T('3') }
  const itemCNoUpdated = { id: 'c3', title: 'c', createdAt: '2026-01-01T00:00:00.000Z' } // 无 updatedAt → 降级 createdAt
  const itemCNewer = { id: 'c3', title: 'c-new', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-06-01T00:00:00.000Z' }

  {
    // 7.1 首次 push（服务端为空）→ 原样收下
    const r = await req('POST', '/api/push', {
      token: loginToken,
      body: { requirements: [itemV1], todos: [], projects: [], settings: { autoArchiveMonths: 3, theme: 'dark' } },
    })
    check('push#1 → 200 ok', r.status === 200 && r.json?.ok === true, r.text)
    const d = stripVolatile(r.json?.data)
    check('push#1 requirements 收下', JSON.stringify(d?.requirements) === JSON.stringify([itemV1]), JSON.stringify(d?.requirements))
    check('push#1 settings 收下', JSON.stringify(d?.settings) === JSON.stringify({ autoArchiveMonths: 3, theme: 'dark' }))
    check('push#1 version:1', d?.version === 1)
  }
  {
    // 7.2 push 更新版本（updatedAt 更大）→ 本地胜
    const r = await req('POST', '/api/push', {
      token: loginToken,
      body: { requirements: [itemV2], todos: [], projects: [], settings: {} },
    })
    const d = stripVolatile(r.json?.data)
    check('push#2 新版本胜出（LWW）', JSON.stringify(d?.requirements) === JSON.stringify([itemV2]), JSON.stringify(d?.requirements))
    check('push#2 settings 保留服务端值（本地空覆盖）', JSON.stringify(d?.settings) === JSON.stringify({ autoArchiveMonths: 3, theme: 'dark' }))
  }
  {
    // 7.3 push 旧版本（updatedAt 更小）→ 服务端胜
    const r = await req('POST', '/api/push', {
      token: loginToken,
      body: { requirements: [itemV0], todos: [], projects: [], settings: {} },
    })
    const d = stripVolatile(r.json?.data)
    check('push#3 旧版本被拒（服务端胜）', JSON.stringify(d?.requirements) === JSON.stringify([itemV2]), JSON.stringify(d?.requirements))
  }
  {
    // 7.4 push 新增 id + 无 updatedAt 降级 createdAt
    const r = await req('POST', '/api/push', {
      token: loginToken,
      body: { requirements: [itemB, itemCNoUpdated], todos: [], projects: [], settings: { theme: 'light' } },
    })
    const d = stripVolatile(r.json?.data)
    const ids = (d?.requirements ?? []).map((x) => x.id).sort()
    check('push#4 新增 id 被收下', JSON.stringify(ids) === JSON.stringify(['a1', 'b2', 'c3']), JSON.stringify(ids))
    check('push#4 settings 字段级合并', JSON.stringify(d?.settings) === JSON.stringify({ autoArchiveMonths: 3, theme: 'light' }), JSON.stringify(d?.settings))
  }
  {
    // 7.5 createdAt 降级路径：c3 无 updatedAt，本地新 updatedAt → 本地胜
    const r = await req('POST', '/api/push', {
      token: loginToken,
      body: { requirements: [itemCNewer], todos: [], projects: [], settings: {} },
    })
    const d = stripVolatile(r.json?.data)
    const c3 = (d?.requirements ?? []).find((x) => x.id === 'c3')
    check('push#5 createdAt 降级 → 更新者胜', c3?.title === 'c-new', JSON.stringify(c3))
  }

  /* ---------- 8. snapshot ---------- */
  {
    const r = await req('GET', '/api/snapshot', { token: loginToken })
    check('snapshot → 200 ok', r.status === 200 && r.json?.ok === true)
    const d = r.json?.data
    check('snapshot → serverTs', typeof d?.serverTs === 'string')
    check('snapshot → 三类集合齐全', Array.isArray(d?.requirements) && Array.isArray(d?.todos) && Array.isArray(d?.projects))
    check('snapshot → settings 持久化', d?.settings?.autoArchiveMonths === 3 && d?.settings?.theme === 'light')
    const a1 = d?.requirements?.find((x) => x.id === 'a1')
    check('snapshot → a1 保持 v2', a1?.title === 'v2')
  }
  {
    const r = await req('GET', '/api/snapshot', {})
    check('snapshot 无 token → 401', r.status === 401)
  }

  /* ---------- 9. push body 校验 ---------- */
  {
    const r = await req('POST', '/api/push', { token: loginToken, rawBody: '{not-json', })
    check('push 坏 JSON → 400', r.status === 400, `got ${r.status}`)
    check('push 坏 JSON → error 字段', r.json?.ok === false && typeof r.json?.error === 'string')
  }
  {
    const r = await req('POST', '/api/push', { token: loginToken })
    check('push 空 body → 200（空对象合并）', r.status === 200 && r.json?.ok === true, `got ${r.status} ${r.text}`)
  }

  /* ---------- 10. 404 ---------- */
  {
    const r = await req('GET', '/api/no-such-route')
    check('未知路由 → 404', r.status === 404)
    check('未知路由 → {ok:false,error:not found}', r.json?.ok === false && r.json?.error === 'not found')
  }

  /* ---------- 11. logout ---------- */
  {
    const r = await req('POST', '/api/auth/logout', { token: loginToken })
    check('logout → 204', r.status === 204, `got ${r.status}`)
  }
  {
    const r = await req('GET', '/api/auth/me', { token: loginToken })
    check('logout 后 token 失效 → 401', r.status === 401)
  }

  /* ---------- 结果 ---------- */
  console.log(`\n[smoke] ${passed} passed, ${failed} failed`)
  return { passed, failed, failures }
}

async function main() {
  const baseUrl = process.argv[2] ?? process.env.SMOKE_BASE_URL ?? 'http://127.0.0.1:8787'
  console.log(`[smoke] target: ${baseUrl}`)
  const { passed, failed, failures } = await runSmoke(baseUrl)
  if (failed > 0) {
    console.error('[smoke] FAILED cases:')
    for (const f of failures) console.error(`  - ${f}`)
    process.exit(1)
  }
  console.log('[smoke] ALL PASSED ✓')
}

// CLI 直跑时才执行（被 import 时不执行）
import { pathToFileURL } from 'node:url'
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error('[smoke] fatal:', e)
    process.exit(1)
  })
}
