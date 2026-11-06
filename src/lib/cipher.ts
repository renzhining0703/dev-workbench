/**
 * 同构加密模块（浏览器 + Node 22 通用，零依赖，走标准 Web Crypto）
 *
 * 用途：密码管理条目的敏感字段（用户名/密码/备注）客户端加密。
 *   - 主密码 PBKDF2-SHA256 派生 AES-256-GCM 密钥（迭代 310k）
 *   - 密文自描述：base64( salt[16] || iv[12] || ciphertext )
 *     salt/iv 随每条密文内嵌，无需额外存储，任何端拿到 blob 即可解密
 *   - 派生密钥按 salt+主密码 内存缓存（PBKDF2 很慢，同一会话只派生一次）
 *
 * ⚠️ 同步护栏：server/lib/cipher.mjs 是本文件的 JS 镜像（服务端 pass-query.mjs
 *   解密用），两份逻辑必须保持一致（KDF 参数 / blob 布局），改任一处务必同步另一处。
 */

export const KDF_ITERATIONS = 310_000
const SALT_LEN = 16
const IV_LEN = 12

/** 加密/解密失败（主密码错误或密文损坏），与其它异常区分便于 UI 提示 */
export class CipherError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CipherError'
  }
}

const te = new TextEncoder()
const td = new TextDecoder()

function toB64(bytes: Uint8Array): string {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s)
}

function fromB64(s: string): Uint8Array {
  const bin = atob(s)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

/** 派生密钥缓存：salt b64 + 主密码 → CryptoKey（PBKDF2 很贵，别重复算） */
const keyCache = new Map<string, CryptoKey>()

async function deriveKey(master: string, salt: Uint8Array): Promise<CryptoKey> {
  const cacheKey = `${toB64(salt)}::${master}`
  const hit = keyCache.get(cacheKey)
  if (hit) return hit
  const base = await crypto.subtle.importKey('raw', te.encode(master), 'PBKDF2', false, [
    'deriveKey',
  ])
  const key = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations: KDF_ITERATIONS, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
  keyCache.set(cacheKey, key)
  return key
}

/** 加密任意可 JSON 序列化数据 → 自描述 base64 密文 */
export async function encryptJson(master: string, data: unknown): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LEN))
  const iv = crypto.getRandomValues(new Uint8Array(IV_LEN))
  const key = await deriveKey(master, salt)
  const ct = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv as BufferSource }, key, te.encode(JSON.stringify(data))),
  )
  const out = new Uint8Array(SALT_LEN + IV_LEN + ct.length)
  out.set(salt, 0)
  out.set(iv, SALT_LEN)
  out.set(ct, SALT_LEN + IV_LEN)
  return toB64(out)
}

/** 解密 encryptJson 的产物；主密码错误 / 密文损坏抛 CipherError */
export async function decryptJson<T = unknown>(master: string, blob: string): Promise<T> {
  const raw = fromB64(blob)
  if (raw.length < SALT_LEN + IV_LEN + 16) throw new CipherError('密文格式非法')
  const salt = raw.slice(0, SALT_LEN)
  const iv = raw.slice(SALT_LEN, SALT_LEN + IV_LEN)
  const ct = raw.slice(SALT_LEN + IV_LEN)
  const key = await deriveKey(master, salt)
  let plain: ArrayBuffer
  try {
    plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: iv as BufferSource }, key, ct as BufferSource)
  } catch {
    throw new CipherError('解密失败：主密码错误或密文损坏')
  }
  return JSON.parse(td.decode(plain)) as T
}
