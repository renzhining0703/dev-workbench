/**
 * src/lib/cipher.ts 单测 —— 固化加密行为
 * 1. 加解密往返；2. 错主密码解不开（CipherError）；3. 密文损坏检测；
 * 4. 前端 TS 版与服务端 mjs 镜像互通（同一 blob 双端都能解）—— 防两份实现漂移
 */
import { describe, it, expect } from 'vitest'
import { encryptJson, decryptJson, CipherError, KDF_ITERATIONS } from '../cipher'
import * as serverCipher from '../../../server/lib/cipher.mjs'

const MASTER = 'test-master-密码'
const SECRET = { username: 'ren@example.com', password: 'p@ss w0rd!', notes: '备注\n第二行' }

describe('cipher 往返', () => {
  it('加密后解密还原原文（含中文/换行/特殊字符）', async () => {
    const blob = await encryptJson(MASTER, SECRET)
    expect(blob).not.toContain('ren@example.com')
    const out = await decryptJson<typeof SECRET>(MASTER, blob)
    expect(out).toEqual(SECRET)
  })

  it('每次加密产生不同密文（随机 salt/iv）', async () => {
    const a = await encryptJson(MASTER, SECRET)
    const b = await encryptJson(MASTER, SECRET)
    expect(a).not.toBe(b)
  })

  it('KDF 迭代参数符合预期（防止被无意调低）', () => {
    expect(KDF_ITERATIONS).toBeGreaterThanOrEqual(100_000)
  })
})

describe('cipher 失败路径', () => {
  it('错主密码解密抛 CipherError，而非静默得到乱码', async () => {
    const blob = await encryptJson(MASTER, SECRET)
    await expect(decryptJson('wrong-password', blob)).rejects.toThrow(CipherError)
  })

  it('密文被篡改后解密抛 CipherError（GCM 完整性校验）', async () => {
    const blob = await encryptJson(MASTER, SECRET)
    const raw = atob(blob)
    const tampered = btoa(raw.slice(0, -1) + String.fromCharCode(raw.charCodeAt(raw.length - 1) ^ 0x01))
    await expect(decryptJson(MASTER, tampered)).rejects.toThrow(CipherError)
  })

  it('过短 blob 抛 CipherError', async () => {
    await expect(decryptJson(MASTER, btoa('short'))).rejects.toThrow(CipherError)
  })
})

describe('前后端双实现互通（漂移护栏）', () => {
  it('TS 加密 → mjs 解密', async () => {
    const blob = await encryptJson(MASTER, SECRET)
    const out = await serverCipher.decryptJson(MASTER, blob)
    expect(out).toEqual(SECRET)
  })

  it('mjs 加密 → TS 解密', async () => {
    const blob = await serverCipher.encryptJson(MASTER, SECRET)
    const out = await decryptJson<typeof SECRET>(MASTER, blob)
    expect(out).toEqual(SECRET)
  })

  it('两端 KDF 参数一致', () => {
    expect(serverCipher.KDF_ITERATIONS).toBe(KDF_ITERATIONS)
  })
})
