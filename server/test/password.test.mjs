/**
 * 完整认证流程集成测试：change-password / reset-password / config
 *
 * 场景：
 *   1. GET /api/auth/config → inviteRequired 与 INVITE_CODE 配置一致
 *   2. change-password：旧密码错 → 401；改成功 → 旧密码登录失败、新密码登录成功、当前 token 仍有效
 *   3. reset-password：服务端未配置邀请码 → 403；配置后邀请码错/用户不存在 → 401；
 *      重置成功 → 新密码可登录、旧 token 全部失效
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
import { createApp } from '../app.mjs'

async function startServer(config) {
  const tmp = mkdtempSync(join(tmpdir(), 'sync-pw-test-'))
  const db = openDatabase(join(tmp, 'test.db'))
  const server = createApp({
    config: {
      allowedOrigins: ['http://localhost:5173'],
      rateLimitPerMin: 100,
      ...config,
    },
    userStore: new UserStore(db),
    sessionStore: new SessionStore(db),
    snapshotStore: new SnapshotStore(db),
  }).listen(0)
  const base = `http://127.0.0.1:${server.address().port}`
  const stop = async () => {
    await new Promise((r) => server.close(r))
    db.close()
    rmSync(tmp, { recursive: true, force: true })
  }
  const json = async (method, path, body, token) => {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const text = await res.text()
    let data = null
    try {
      data = text ? JSON.parse(text) : null
    } catch {
      data = null
    }
    return { status: res.status, data }
  }
  return { base, json, stop }
}

test('完整认证流程：config / change-password / reset-password', async () => {
  // ---------- 阶段一：未配置邀请码 ----------
  {
    const s = await startServer({ inviteCode: '' })
    try {
      // config: 开放注册
      const cfg = await s.json('GET', '/api/auth/config')
      assert.equal(cfg.status, 200)
      assert.equal(cfg.data.data.inviteRequired, false)

      // reset-password 通道关闭
      const reset = await s.json('POST', '/api/auth/reset-password', {
        username: 'alice',
        inviteCode: 'whatever',
        newPassword: 'new-password-9',
      })
      assert.equal(reset.status, 403)
      assert.equal(reset.data.error, 'reset disabled')
    } finally {
      await s.stop()
    }
  }

  // ---------- 阶段二：配置邀请码的完整流程 ----------
  const s = await startServer({ inviteCode: 'invite-xyz' })
  try {
    // config: 需要邀请码
    const cfg = await s.json('GET', '/api/auth/config')
    assert.equal(cfg.data.data.inviteRequired, true)

    // 注册 alice
    const reg = await s.json('POST', '/api/auth/register', {
      username: 'alice',
      password: 'old-password-1',
      inviteCode: 'invite-xyz',
    })
    assert.equal(reg.status, 200)
    const tokenA = reg.data.data.token

    // --- change-password ---
    // 旧密码错 → 401
    const bad = await s.json(
      'POST',
      '/api/auth/change-password',
      { currentPassword: 'wrong-password', newPassword: 'new-password-9' },
      tokenA,
    )
    assert.equal(bad.status, 401)
    assert.equal(bad.data.error, 'invalid credentials')

    // 新密码不合法 → 400
    const short = await s.json(
      'POST',
      '/api/auth/change-password',
      { currentPassword: 'old-password-1', newPassword: 'short' },
      tokenA,
    )
    assert.equal(short.status, 400)

    // 改成功 → 204，当前 token 仍有效
    const ok = await s.json(
      'POST',
      '/api/auth/change-password',
      { currentPassword: 'old-password-1', newPassword: 'changed-password-2' },
      tokenA,
    )
    assert.equal(ok.status, 204)
    const me = await s.json('GET', '/api/auth/me', undefined, tokenA)
    assert.equal(me.status, 200)

    // 旧密码登录失败、新密码登录成功
    const oldLogin = await s.json('POST', '/api/auth/login', {
      username: 'alice',
      password: 'old-password-1',
    })
    assert.equal(oldLogin.status, 401)
    const newLogin = await s.json('POST', '/api/auth/login', {
      username: 'alice',
      password: 'changed-password-2',
    })
    assert.equal(newLogin.status, 200)
    const tokenB = newLogin.data.data.token

    // --- reset-password ---
    // 邀请码错 → 401
    const wrongInvite = await s.json('POST', '/api/auth/reset-password', {
      username: 'alice',
      inviteCode: 'wrong-invite',
      newPassword: 'reset-password-3',
    })
    assert.equal(wrongInvite.status, 401)

    // 用户不存在 → 401（同文案，防枚举）
    const noUser = await s.json('POST', '/api/auth/reset-password', {
      username: 'ghost_user',
      inviteCode: 'invite-xyz',
      newPassword: 'reset-password-3',
    })
    assert.equal(noUser.status, 401)
    assert.equal(noUser.data.error, wrongInvite.data.error)

    // 新密码不合法 → 401（不泄露具体原因）
    const badPw = await s.json('POST', '/api/auth/reset-password', {
      username: 'alice',
      inviteCode: 'invite-xyz',
      newPassword: 'short',
    })
    assert.equal(badPw.status, 401)

    // 重置成功 → 204
    const reset = await s.json('POST', '/api/auth/reset-password', {
      username: 'alice',
      inviteCode: 'invite-xyz',
      newPassword: 'reset-password-3',
    })
    assert.equal(reset.status, 204)

    // 重置后：旧 tokenB 全部失效，新密码可登录
    const meB = await s.json('GET', '/api/auth/me', undefined, tokenB)
    assert.equal(meB.status, 401)
    const login3 = await s.json('POST', '/api/auth/login', {
      username: 'alice',
      password: 'reset-password-3',
    })
    assert.equal(login3.status, 200)

    console.log('[password-test] change/reset password flows all passed')
  } finally {
    await s.stop()
  }
})
