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
 * ## 密钥类变量（INVITE_CODE 等）的持久化注入
 *
 * publish.sh 部署时远端执行 `pm2 reload --update-env`（非交互 shell），
 * 会清掉手动注入的 CLI 环境变量；ecosystem.config.cjs 又随部署包被覆盖。
 * 唯一跨部署保留的目录是 data/，因此支持 `<DATA_DIR>env.local`（KEY=VALUE 每行一条，
 * '#' 开头为注释），进程环境变量优先级更高。建议 chmod 600 且不进 git。
 *
 * loadConfig(env) 接受显式 env，便于测试注入。
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/** 解析 KEY=VALUE 行（忽略空行与 # 注释），返回平面对象 */
function parseEnvFile(raw) {
  const out = {}
  for (const line of raw.split('\n')) {
    const s = line.trim()
    if (!s || s.startsWith('#')) continue
    const eq = s.indexOf('=')
    if (eq <= 0) continue
    const key = s.slice(0, eq).trim()
    const val = s.slice(eq + 1).trim().replace(/^["']|["']$/g, '')
    if (key) out[key] = val
  }
  return out
}

/**
 * 合并后的运行环境：{ ...<DATA_DIR>env.local 文件, ...process.env }
 * 文件不存在/不可读时静默退化为纯 process.env（本地开发零配置）。
 */
export function loadServerEnv(env = process.env) {
  const dataDir = (env.DATA_DIR && env.DATA_DIR.length > 0
    ? env.DATA_DIR
    : new URL('./data/', import.meta.url).pathname)
  try {
    const fileEnv = parseEnvFile(readFileSync(resolve(dataDir, 'env.local'), 'utf8'))
    return { ...fileEnv, ...env }
  } catch {
    return env
  }
}
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

    // Web Push（VAPID 密钥走 data/env.local 注入，跨部署保留）
    // 生成方式：cd server && npx web-push generate-vapid-keys
    vapidPublicKey: (env.VAPID_PUBLIC_KEY ?? '').trim(),
    vapidPrivateKey: (env.VAPID_PRIVATE_KEY ?? '').trim(),
    vapidSubject: envOrDefault(env, 'VAPID_SUBJECT', 'mailto:dev@dev-workbench.local'),
  }
}
