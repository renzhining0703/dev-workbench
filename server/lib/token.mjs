/**
 * 会话 token 工具
 *
 * - genToken: 32 字节随机 hex（与 v1 一致，前端无需改动）
 * - hashToken: token 只以 SHA-256 哈希落库——数据库文件泄露不等于会话被劫持
 */
import { createHash, randomBytes } from 'node:crypto'

/** 生成 32 字节十六进制 token */
export function genToken() {
  return randomBytes(16).toString('hex')
}

/** token → SHA-256 hex（落库形态） */
export function hashToken(token) {
  return createHash('sha256').update(token).digest('hex')
}
