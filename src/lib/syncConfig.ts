/**
 * 同步配置：构建期注入的 API 地址
 *
 * dev:    VITE_SYNC_API=/api   (vite proxy 转发到 127.0.0.1:8787)
 * prod:   VITE_SYNC_API=/dev-workbench/api  (nginx 反代)
 *
 * token 不再是构建期常量：每个用户登录后从服务端拿到，存 localStorage。
 */
export const SYNC_API: string =
  (import.meta.env.VITE_SYNC_API as string | undefined) ?? ''

/** 同步 API 是否配置（仅看 API 地址；token 是否可用看当前 session） */
export const SYNC_ENABLED: boolean = SYNC_API.length > 0