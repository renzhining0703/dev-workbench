/**
 * 配置：读环境变量（v2 · Express + node:sqlite）
 *
 * - PORT: HTTP 监听端口（默认 8787）
 * - HOST: 监听地址（默认 127.0.0.1，仅本机访问，由 nginx 反代）
 * - DATA_DIR: 数据根目录（SQLite 数据库与旧版 JSON 数据都在这里）
 * - DB_FILE: SQLite 数据库文件路径（默认 <DATA_DIR>sync.db）
 * - LEGACY_USERS_FILE / LEGACY_USER_DATA_DIR: 旧版 JSON 后端的用户表/快照目录，
 *   首次启动且数据库无用户时自动导入（v1 → v2 迁移）
 * - LEGACY_STORE_FILE: 更早期（单 token 共享）的 store.json，导入为 BOOTSTRAP_USER 的快照
 * - BOOTSTRAP_USER: 首次启动时自动创建的账户名；随机密码写入 <DATA_DIR>bootstrap-password.txt
 * - INVITE_CODE: 注册时校验；空字符串 = 不校验（开放注册）
 * - RATE_LIMIT_PER_MIN: /api/auth/* 每 IP 每分钟请求上限（默认 20）
 * - ALLOWED_ORIGINS: 逗号分隔的允许 origin 列表
 *
 * loadConfig(env) 接受显式 env，便于测试注入。
 */
function envOrDefault(env, name, fallback) {
  const v = env[name]
  return v && v.length > 0 ? v : fallback
}

function parseList(s) {
  return (s ?? '')
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean)
}

function parseInt10(env, name, fallback) {
  const v = parseInt(env[name] ?? '', 10)
  return Number.isFinite(v) && v > 0 ? v : fallback
}

export function loadConfig(env = process.env) {
  const dataDir = envOrDefault(
    env,
    'DATA_DIR',
    new URL('./data/', import.meta.url).pathname,
  )
  const dataDirSlash = dataDir.endsWith('/') ? dataDir : `${dataDir}/`

  return {
    port: parseInt10(env, 'PORT', 8787),
    host: envOrDefault(env, 'HOST', '127.0.0.1'),
    dataDir: dataDirSlash,
    dbFile: envOrDefault(env, 'DB_FILE', `${dataDirSlash}sync.db`),

    // 旧版 JSON 数据位置（迁移用）
    legacyUsersFile: envOrDefault(env, 'LEGACY_USERS_FILE', `${dataDirSlash}users.json`),
    legacyUserDataDir: envOrDefault(env, 'LEGACY_USER_DATA_DIR', `${dataDirSlash}users/`),
    legacyStoreFile: (env.LEGACY_STORE_FILE ?? '').trim(),
    bootstrapUser: (env.BOOTSTRAP_USER ?? '').trim(),

    inviteCode: env.INVITE_CODE ?? '',
    rateLimitPerMin: parseInt10(env, 'RATE_LIMIT_PER_MIN', 20),
    allowedOrigins: parseList(
      envOrDefault(env, 'ALLOWED_ORIGINS', 'http://localhost:5173,http://211.159.169.153'),
    ),
  }
}
