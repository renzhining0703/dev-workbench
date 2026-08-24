/**
 * API 集成测试：in-process 起 Express（临时 SQLite + ephemeral port），
 * 跑与旧版完全相同的冒烟断言（test/smoke.mjs 的 runSmoke）。
 *
 * 这是 v1 → v2 行为对拍的核心：旧版 49 项断言必须在新架构全绿。
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
import { runSmoke } from './smoke.mjs'

test('冒烟全量对拍：新 Express 版与旧版行为一致', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'sync-api-test-'))
  const db = openDatabase(join(tmp, 'test.db'))
  const server = createApp({
    config: {
      allowedOrigins: ['http://localhost:5173'],
      inviteCode: 'smoke-invite-1234',
      rateLimitPerMin: 20,
    },
    userStore: new UserStore(db),
    sessionStore: new SessionStore(db),
    snapshotStore: new SnapshotStore(db),
  }).listen(0)

  try {
    const port = server.address().port
    const { passed, failed, failures } = await runSmoke(`http://127.0.0.1:${port}`, {
      inviteCode: 'smoke-invite-1234',
    })
    assert.equal(failed, 0, `失败的断言:\n${failures.join('\n')}`)
    assert.ok(passed >= 45, `断言数量异常: ${passed}`)
    console.log(`[api-test] ${passed} assertions passed`)
  } finally {
    await new Promise((resolve) => server.close(resolve))
    db.close()
    rmSync(tmp, { recursive: true, force: true })
  }
})
