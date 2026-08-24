/**
 * 通用 JSON 响应工具。
 * 用户/Bearer 校验在 userAuth.mjs；旧 requireToken 已废弃。
 */
export function send(res, status, body) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(body))
}