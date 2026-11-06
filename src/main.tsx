/// <reference types="vite/client" />
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import './index.css'
import App from './App'

// 注册 Service Worker（vite-plugin-pwa autoUpdate 模式）
// immediate: true 让 SW 在页面加载后立即检查并激活
registerSW({ immediate: true })

// 注意：StoreProvider 由 App 内部（AppShell）按认证状态挂载，
// 这里不要再包一层 —— 双层 Provider 会导致启动时重复做一次全量 localStorage 初始化。
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)