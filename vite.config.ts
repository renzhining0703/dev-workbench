import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

/**
 * 资源 base 策略：
 *   - dev (vite serve)   默认 `/`，本地访问 http://localhost:5173/ 直接可用
 *   - build              默认 `/dev-workbench/`，产物直接可部署到 nginx
 *   - 任意场景           通过环境变量 VITE_BASE 覆盖
 *       例如：VITE_BASE=./ npm run build   // 本地不带前缀构建
 */
export default defineConfig(({ command }) => ({
  base: process.env.VITE_BASE ?? (command === 'serve' ? '/' : '/dev-workbench/'),
  plugins: [
    react(),
    VitePWA({
      // 个人项目无感刷新；切回 'prompt' 需要写 UI 提示
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      // dev 默认不启用 SW，方便本地调试不被缓存干扰
      devOptions: { enabled: false },
      // SW 缓存 favicon（默认不缓存 SVG）
      includeAssets: ['favicon.svg'],
      manifest: {
        name: '开发工作台',
        short_name: '工作台',
        description: '个人开发工作台：需求管理 + 待办 + 上线提醒',
        // 插件会自动根据 vite 的 base 改写成 /dev-workbench/
        start_url: '/',
        scope: '/',
        display: 'standalone',
        theme_color: '#6366f1',
        background_color: '#ffffff',
        icons: [
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'pwa-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,webp,woff,woff2}'],
        // SPA 路由兜底：子路径下写绝对路径最稳
        navigateFallback: '/dev-workbench/index.html',
        cleanupOutdatedCaches: true,
      },
    }),
  ],
  server: {
    port: 5173,
    host: true,
  },
}))