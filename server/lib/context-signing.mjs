/**
 * 签名上下文 id：签发 / 校验（HMAC-SHA256）
 *
 * 前端不携带上下文明文与 agent 通信，只带 id；agent 用 id 向后端换取最小化上下文。
 * 签名存在 ai_contexts.signature，换取时重算 HMAC 比对，防止绕过签发接口伪造 id。
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

/** 合法 id 形态：ctx- + 32 位小写 hex */
export const CONTEXT_ID_RE = /^ctx-[0-9a-f]{32}$/

/** 生成新上下文 id（128 位随机） */
export function newContextId() {
  return 'ctx-' + randomBytes(16).toString('hex')
}

/** 计算 id 的 HMAC 签名（hex） */
export function signContextId(secret, id) {
  return createHmac('sha256', secret).update(id).digest('hex')
}

/** 恒定时间校验签名（长度不一致直接 false，不抛异常） */
export function verifyContextId(secret, id, signature) {
  const expected = Buffer.from(signContextId(secret, id), 'utf8')
  const actual = Buffer.from(String(signature ?? ''), 'utf8')
  return expected.length === actual.length && timingSafeEqual(expected, actual)
}

/** 恒定时间比较两个 token（agent 换取接口鉴权用） */
export function safeTokenEqual(a, b) {
  const x = Buffer.from(String(a ?? ''), 'utf8')
  const y = Buffer.from(String(b ?? ''), 'utf8')
  return x.length > 0 && x.length === y.length && timingSafeEqual(x, y)
}
