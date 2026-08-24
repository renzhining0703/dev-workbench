/**
 * 配置：读环境变量
 *
 * - PORT: HTTP 监听端口（默认 8787）
 * - HOST: 监听地址（默认 127.0.0.1，仅本机访问，由 nginx 反代）
 * - DATA_DIR: 数据根目录（含 users.json 和 users/<u>.json）
 * - LEGACY_STORE_FILE: 旧版单 token 的 store.json，启动时自动迁移到 bootstrap 用户
 * - BOOTSTRAP_USER: 首次启动时自动创建的账户名（配合 LEGACY_STORE_FILE）
 * - INVITE_CODE: 注册时校验；空字符串 = 不校验（开放注册）
 * - RATE_LIMIT_PER_MIN: /api/auth/* 每 IP 每分钟请求上限（默认 20）
 * - ALLOWED_ORIGINS: 逗号分隔的允许 origin 列表
 */
function envOrDefault(name, fallback) {
  const v = process.env[name]
  return v && v.length > 0 ? v : fallback
}

function parseList(s) {
  return (s ?? '')
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean)
}

function parseInt10(name, fallback) {
  const v = parseInt(process.env[name] ?? '', 10)
  return Number.isFinite(v) && v > 0 ? v : fallback
}

const dataDir = envOrDefault(
  'DATA_DIR',
  new URL('./data/', import.meta.url).pathname,
)

export const config = {
  port: parseInt10('PORT', 8787),
  host: envOrDefault('HOST', '127.0.0.1'),
  dataDir,
  usersFile: envOrDefault('USERS_FILE', `${dataDir}users.json`),
  userDataDir: envOrDefault('USER_DATA_DIR', `${dataDir}users/`),
  rateLimitPerMin: parseInt10('RATE_LIMIT_PER_MIN', 20),
  allowedOrigins: parseList(
    envOrDefault('ALLOWED_ORIGINS', 'http://localhost:5173,http://211.159.169.153'),
  ),
}