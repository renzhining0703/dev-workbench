/**
 * 密码哈希与比较（逻辑自 v1 authRoutes.mjs 原样平移）
 *
 * - scrypt (N=16384, r=8, p=1) + 16 字节 salt
 * - 时序安全比较（timingSafeEqual）
 * - 登录失败仍跑一次 dummy scrypt，防时序枚举
 */
import { scryptSync, randomBytes, timingSafeEqual } from 'node:crypto'

const SCRYPT_KEYLEN = 64
// Node scrypt 默认 N=16384, r=8, p=1（不传 options 走默认）
const SCRYPT_OPTS = { N: 16384, r: 8, p: 1 }

/** 16 字节 salt → hex */
export function genSalt() {
  return randomBytes(16).toString('hex')
}

/** 同步 scrypt 哈希；返回 hex */
export function hashPassword(password, saltHex) {
  const salt = Buffer.from(saltHex, 'hex')
  return scryptSync(password, salt, SCRYPT_KEYLEN, SCRYPT_OPTS).toString('hex')
}

/** 时序安全比较两个 hex hash */
export function safeEqualHex(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false
  if (a.length !== b.length) return false
  return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'))
}

/** dummy hash 用于登录失败时等长 scrypt 计算（防时序枚举） */
export const DUMMY_SALT = '00'.repeat(16)
export const DUMMY_HASH = hashPassword('__not_a_real_password__', DUMMY_SALT)
