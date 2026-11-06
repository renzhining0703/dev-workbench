/**
 * 同构加密模块 · 服务端镜像（Node 22，webcrypto 全局可用）
 *
 * ⚠️ 同步护栏：本文件是 src/lib/cipher.ts 的 JS 镜像（KDF 参数 / blob 布局必须一致），
 *   改任一处务必同步另一处，否则服务端 pass-query.mjs 将解不开浏览器加密的数据。
 *
 * 密文自描述：base64( salt[16] || iv[12] || ciphertext )；PBKDF2-SHA256 310k → AES-256-GCM
 */

export const KDF_ITERATIONS = 310_000
const SALT_LEN = 16
const IV_LEN = 12

export class CipherError extends Error {
  constructor(message) {
    super(message)
    this.name = 'CipherError'
  }
}

const te = new TextEncoder()
const td = new TextDecoder()

function toB64(bytes) {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s)
}

function fromB64(s) {
  const bin = atob(s)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

const keyCache = new Map()

async function deriveKey(master, salt) {
  const cacheKey = `${toB64(salt)}::${master}`
  const hit = keyCache.get(cacheKey)
  if (hit) return hit
  const base = await crypto.subtle.importKey('raw', te.encode(master), 'PBKDF2', false, [
    'deriveKey',
  ])
  const key = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: KDF_ITERATIONS, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
  keyCache.set(cacheKey, key)
  return key
}

export async function encryptJson(master, data) {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LEN))
  const iv = crypto.getRandomValues(new Uint8Array(IV_LEN))
  const key = await deriveKey(master, salt)
  const ct = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, te.encode(JSON.stringify(data))),
  )
  const out = new Uint8Array(SALT_LEN + IV_LEN + ct.length)
  out.set(salt, 0)
  out.set(iv, SALT_LEN)
  out.set(ct, SALT_LEN + IV_LEN)
  return toB64(out)
}

export async function decryptJson(master, blob) {
  const raw = fromB64(blob)
  if (raw.length < SALT_LEN + IV_LEN + 16) throw new CipherError('密文格式非法')
  const salt = raw.slice(0, SALT_LEN)
  const iv = raw.slice(SALT_LEN, SALT_LEN + IV_LEN)
  const ct = raw.slice(SALT_LEN + IV_LEN)
  const key = await deriveKey(master, salt)
  let plain
  try {
    plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct)
  } catch {
    throw new CipherError('解密失败：主密码错误或密文损坏')
  }
  return JSON.parse(td.decode(plain))
}
