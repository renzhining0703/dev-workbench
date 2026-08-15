import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * 资源 base 策略：
 *   - dev (vite serve)   默认 `/`，本地访问 http://localhost:5173/ 直接可用
 *   - build              默认 `/dev-workbench/`，产物直接可部署到 nginx
 *   - 任意场景           通过环境变量 VITE_BASE 覆盖
 *       例如：VITE_BASE=./ npm run build   // 本地不带前缀构建
 */
export default defineConfig(({ command }) => ({
  base: process.env.VITE_BASE ?? (command === 'serve' ? '/' : '/dev-workbench/'),
  plugins: [react()],
  server: {
    port: 5173,
    host: true,
  },
}))