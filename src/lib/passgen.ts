/**
 * 密码生成器 + 强度评估（纯函数，参考 passlock/src/utils/passwordGenerator.ts）
 * 改进：随机源用 crypto.getRandomValues（拒绝采样保证均匀），不用 Math.random
 */
import type { GeneratorOptions } from '../types'

const CHARS = {
  uppercase: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  lowercase: 'abcdefghijklmnopqrstuvwxyz',
  numbers: '0123456789',
  symbols: '!@#$%^&*()_+-=[]{}|;:,.<>?',
} as const

/** crypto 随机非负整数 [0, max)，拒绝采样避免模偏差 */
function randomInt(max: number): number {
  if (max <= 0) return 0
  const limit = Math.floor(0xffffffff / max) * max
  const buf = new Uint32Array(1)
  let v = 0
  do {
    crypto.getRandomValues(buf)
    v = buf[0]
  } while (v >= limit)
  return v % max
}

export function generatePassword(options: GeneratorOptions): string {
  const { length, uppercase, lowercase, numbers, symbols } = options

  let charset = ''
  const required: string[] = []
  const pick = (set: string) => set[randomInt(set.length)]

  if (uppercase) { charset += CHARS.uppercase; required.push(pick(CHARS.uppercase)) }
  if (lowercase) { charset += CHARS.lowercase; required.push(pick(CHARS.lowercase)) }
  if (numbers) { charset += CHARS.numbers; required.push(pick(CHARS.numbers)) }
  if (symbols) { charset += CHARS.symbols; required.push(pick(CHARS.symbols)) }
  if (!charset) { charset = CHARS.lowercase; required.push(pick(CHARS.lowercase)) }

  const remaining = Math.max(0, length - required.length)
  const allChars = [...required, ...Array.from({ length: remaining }, () => pick(charset))]

  // Fisher-Yates 洗牌（crypto 随机）
  for (let i = allChars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1)
    ;[allChars[i], allChars[j]] = [allChars[j], allChars[i]]
  }
  return allChars.join('')
}

export interface Strength {
  score: number // 0-7
  label: '弱' | '中' | '强' | '极强'
  color: string
}

export function assessStrength(password: string): Strength {
  let score = 0
  if (password.length >= 8) score++
  if (password.length >= 12) score++
  if (password.length >= 16) score++
  if (/[A-Z]/.test(password)) score++
  if (/[a-z]/.test(password)) score++
  if (/[0-9]/.test(password)) score++
  if (/[^A-Za-z0-9]/.test(password)) score++

  if (score <= 2) return { score, label: '弱', color: '#EF4444' }
  if (score <= 4) return { score, label: '中', color: '#F59E0B' }
  if (score <= 5) return { score, label: '强', color: '#10B981' }
  return { score, label: '极强', color: '#6366F1' }
}

export const DEFAULT_GENERATOR_OPTIONS: GeneratorOptions = {
  length: 16,
  uppercase: true,
  lowercase: true,
  numbers: true,
  symbols: false,
}
