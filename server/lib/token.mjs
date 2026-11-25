/**
 * 会话 token 工具
 *
 * - genToken: 16 字节随机 hex（128 位熵，会话 token 够用；注释按实际字节修正）
 * - hashToken: token 只以 SHA-256 哈希落库——数据库文件泄露不等于会话被劫持
 */
import { createHash, randomBytes } from 'node:crypto'

/** 生成 16 字节（32 位 hex 字符）会话 token */
export function genToken() {
  return randomBytes(16).toString('hex')
}

/** token → SHA-256 hex（落库形态） */
export function hashToken(token) {
  return createHash('sha256').update(token).digest('hex')
}
