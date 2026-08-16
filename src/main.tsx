/// <reference types="vite/client" />
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import './index.css'
import App from './App'
import { StoreProvider } from './store/StoreContext'

// 注册 Service Worker（vite-plugin-pwa autoUpdate 模式）
// immediate: true 让 SW 在页面加载后立即检查并激活
registerSW({ immediate: true })

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <StoreProvider>
      <App />
    </StoreProvider>
  </StrictMode>,
)