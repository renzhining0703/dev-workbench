import { useEffect, useState } from 'react'

/**
 * 安装引导组件（按 UA 分流到四条路径）：
 *   1. 微信内置浏览器 → 顶部固定悬浮条，引导到 Safari/Chrome 打开
 *   2. iOS Safari → 居中 Modal，步骤化教用户在分享菜单里"添加到主屏幕"
 *   3. 中国定制浏览器（小米/QQ/UC/华为/Vivo/Oppo/夸克等）
 *      - 不发 beforeinstallprompt，1.5s 后底部弹通用引导条
 *      - 教用户从浏览器菜单手动"添加到主屏幕"
 *   4. 标准 Chromium 浏览器（Chrome / Edge / Samsung / Brave 等）
 *      - Chrome 默认要用户停留 ≥30s 才触发 beforeinstallprompt
 *      - 我们等 30s：收到了 → Chrome PWA 浮窗（带"安装"按钮）；没收到（说明 PWA
 *        配置有问题或浏览器禁用）→ 通用引导条兜底
 *
 * 每个场景独立 dismiss，写入 localStorage 后不再弹
 */

const DISMISS_KEY_CHROME = 'pwa:dismissed-chrome'
const DISMISS_KEY_IOS = 'pwa:dismissed-ios'
const DISMISS_KEY_WECHAT = 'pwa:dismissed-wechat'
// 不发 beforeinstallprompt 事件的浏览器（小米/QQ/UC/华为等）的通用引导
const DISMISS_KEY_GENERIC = 'pwa:dismissed-generic'

// 设备/环境检测（SSR 安全）
function detectEnv() {
  if (typeof navigator === 'undefined') {
    return { isIOS: false, isWeChat: false, isStandalone: false }
  }
  const ua = navigator.userAgent
  return {
    isIOS: /iPad|iPhone|iPod/.test(ua) && !('MSStream' in window),
    isWeChat: /micromessenger/i.test(ua),
    isStandalone:
      // iOS 添加到主屏幕后启动
      (navigator as Navigator & { standalone?: boolean }).standalone === true ||
      // Android/Chrome standalone
      window.matchMedia('(display-mode: standalone)').matches,
  }
}

/**
 * 是否为中国定制 Android 浏览器（不发 beforeinstallprompt）
 * 覆盖：小米 MIUI Browser / QQ MQQBrowser / UC / 华为 / Vivo / Oppo ColorOS /
 *       夸克 / 一加 HeyTap / 魅族 / 360 / 搜狗
 * 这些浏览器虽然基于 Chromium fork，但都没有实现 PWA install 协议
 */
function isCNModifiedBrowser() {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent
  return /MiuiBrowser|XiaoMi\/MiuiBrowser|MQQBrowser|UCBrowser|HuaweiBrowser|Quark|VivoBrowser|OppoBrowser|HeyTapBrowser|MEIZU|360SE|SogouMobileBrowser/i.test(
    ua,
  )
}

// BeforeInstallPromptEvent 在 TS DOM lib 里没有定义，这里手动声明
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>
}

export function InstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null)
  const [showChromeToast, setShowChromeToast] = useState(false)
  const [showIOSModal, setShowIOSModal] = useState(false)
  const [showWechatBar, setShowWechatBar] = useState(false)
  const [showGenericBar, setShowGenericBar] = useState(false)

  useEffect(() => {
    const env = detectEnv()

    // 微信引导：即使已 standalone 也算装好了，可以隐藏；但用户体验上仍给一条提示
    if (env.isWeChat) {
      const dismissed = localStorage.getItem(DISMISS_KEY_WECHAT)
      if (!dismissed) setShowWechatBar(true)
      return
    }

    // iOS：未添加到主屏幕时引导
    if (env.isIOS && !env.isStandalone) {
      const dismissed = localStorage.getItem(DISMISS_KEY_IOS)
      if (!dismissed) setShowIOSModal(true)
      return
    }

    // 中国定制 Android 浏览器（小米/QQ/UC/华为/Vivo/Oppo/夸克等）
    // 这些浏览器不发 beforeinstallprompt，1.5s 后直接弹通用引导条
    if (isCNModifiedBrowser()) {
      if (!localStorage.getItem(DISMISS_KEY_GENERIC)) {
        const t = window.setTimeout(() => {
          if (!localStorage.getItem(DISMISS_KEY_GENERIC)) {
            setShowGenericBar(true)
          }
        }, 1500)
        return () => window.clearTimeout(t)
      }
      return
    }

    // 标准 Chromium 浏览器（Chrome / Edge / Samsung / Brave 等）
    // Chrome 默认要用户停留 ≥30s 才触发 beforeinstallprompt，等 30s 再决定：
    //   - 收到了 → PWA 可装 → Chrome 浮窗（带"安装"按钮）
    //   - 没收到 → PWA 不可装 → 通用引导条兜底（教用户去菜单手动加）
    const chromeDismissed = !!localStorage.getItem(DISMISS_KEY_CHROME)
    const genericDismissed = !!localStorage.getItem(DISMISS_KEY_GENERIC)
    if (chromeDismissed && genericDismissed) return

    let gotEvent = false
    const onBeforeInstall = (e: Event) => {
      gotEvent = true
      e.preventDefault()
      setDeferredPrompt(e as BeforeInstallPromptEvent)
    }
    window.addEventListener('beforeinstallprompt', onBeforeInstall)

    const decideTimer = window.setTimeout(() => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall)
      if (gotEvent) {
        if (!chromeDismissed) setShowChromeToast(true)
      } else {
        if (!genericDismissed) setShowGenericBar(true)
      }
    }, 30_000)

    return () => {
      window.clearTimeout(decideTimer)
      window.removeEventListener('beforeinstallprompt', onBeforeInstall)
    }
  }, [])

  const dismissChrome = () => {
    setShowChromeToast(false)
    localStorage.setItem(DISMISS_KEY_CHROME, '1')
  }

  const dismissIOS = () => {
    setShowIOSModal(false)
    localStorage.setItem(DISMISS_KEY_IOS, '1')
  }

  const dismissWechat = () => {
    setShowWechatBar(false)
    localStorage.setItem(DISMISS_KEY_WECHAT, '1')
  }

  const dismissGeneric = () => {
    setShowGenericBar(false)
    localStorage.setItem(DISMISS_KEY_GENERIC, '1')
  }

  const installChrome = async () => {
    if (!deferredPrompt) return
    await deferredPrompt.prompt()
    const { outcome } = await deferredPrompt.userChoice
    // 用户接受后浏览器自动安装，写入 localStorage 不再弹
    if (outcome === 'accepted') localStorage.setItem(DISMISS_KEY_CHROME, '1')
    setShowChromeToast(false)
    setDeferredPrompt(null)
  }

  return (
    <>
      {/* 微信顶部条 */}
      {showWechatBar && (
        <div className="fixed inset-x-0 top-0 z-[100] border-b border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 shadow-sm dark:border-amber-500/40 dark:bg-amber-500/15 dark:text-amber-200">
          <div className="mx-auto flex max-w-6xl items-center gap-2">
            <span aria-hidden>👆</span>
            <span className="flex-1">
              点击右上角 <strong>···</strong> → 选择「<strong>在浏览器中打开</strong>」，可添加到桌面
            </span>
            <button
              type="button"
              onClick={dismissWechat}
              className="rounded px-1.5 py-0.5 text-amber-700 hover:bg-amber-100 dark:text-amber-300 dark:hover:bg-amber-500/20"
              aria-label="关闭提示"
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {/* iOS Safari Modal */}
      {showIOSModal && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm"
          onClick={dismissIOS}
        >
          <div
            className="card relative w-full max-w-sm overflow-hidden p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={dismissIOS}
              className="absolute right-3 top-3 rounded p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
              aria-label="关闭"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
            <div className="mb-3 flex items-center gap-2">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-600 text-white shadow-sm">
                <svg width="18" height="18" viewBox="0 0 32 32" fill="none">
                  <path d="M8 10.5h16M8 16h16M8 21.5h10" stroke="#fff" strokeWidth="3" strokeLinecap="round" />
                </svg>
              </div>
              <div>
                <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">
                  添加到主屏幕
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">像 App 一样使用</p>
              </div>
            </div>
            <ol className="space-y-2.5 text-sm text-slate-600 dark:text-slate-300">
              <li className="flex items-start gap-2">
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-xs font-semibold text-indigo-600 dark:bg-indigo-500/20 dark:text-indigo-400">
                  1
                </span>
                <span>
                  点击底部的 <strong className="text-indigo-600 dark:text-indigo-400">分享按钮</strong>
                  <span className="ml-1 inline-block translate-y-0.5 text-base">⬆</span>
                </span>
              </li>
              <li className="flex items-start gap-2">
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-xs font-semibold text-indigo-600 dark:bg-indigo-500/20 dark:text-indigo-400">
                  2
                </span>
                <span>在弹出菜单里选择「<strong>添加到主屏幕</strong>」</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-xs font-semibold text-indigo-600 dark:bg-indigo-500/20 dark:text-indigo-400">
                  3
                </span>
                <span>点击右上角「<strong>添加</strong>」即可</span>
              </li>
            </ol>
            <button
              type="button"
              onClick={dismissIOS}
              className="btn-primary mt-4 w-full"
            >
              我知道了
            </button>
          </div>
        </div>
      )}

      {/* Chrome / Android 底部浮窗 */}
      {showChromeToast && deferredPrompt && (
        <div className="fixed inset-x-0 bottom-0 z-[100] p-3">
          <div className="mx-auto flex max-w-md items-center gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-lg dark:border-slate-700 dark:bg-slate-900">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-indigo-600 text-white shadow-sm">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 3v12m0 0l-4-4m4 4l4-4M5 21h14" />
              </svg>
            </div>
            <div className="flex-1 text-sm text-slate-700 dark:text-slate-200">
              <p className="font-medium">添加到桌面</p>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                像 App 一样启动，浏览器 UI 全部隐藏
              </p>
            </div>
            <button
              type="button"
              onClick={dismissChrome}
              className="rounded p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
              aria-label="关闭"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
            <button type="button" onClick={installChrome} className="btn-primary text-sm">
              安装
            </button>
          </div>
        </div>
      )}

      {/* 通用引导条（小米/QQ/UC/华为等不发 beforeinstallprompt 的浏览器） */}
      {showGenericBar && (
        <div className="fixed inset-x-0 bottom-0 z-[100] p-3">
          <div className="mx-auto flex max-w-md items-center gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-lg dark:border-slate-700 dark:bg-slate-900">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-indigo-600 text-white shadow-sm">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="7" y="2" width="10" height="20" rx="2" />
                <path d="M11 18h2" />
              </svg>
            </div>
            <div className="flex-1 text-sm text-slate-700 dark:text-slate-200">
              <p className="font-medium">添加到桌面</p>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                浏览器菜单（右上角 ···）→ 添加到主屏幕
              </p>
            </div>
            <button
              type="button"
              onClick={dismissGeneric}
              className="rounded px-2.5 py-1 text-xs font-medium text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
              aria-label="关闭"
            >
              知道了
            </button>
          </div>
        </div>
      )}
    </>
  )
}