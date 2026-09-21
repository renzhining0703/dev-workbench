import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'

/**
 * 主题状态单一来源。
 *
 * 之前 useTheme 写在 App.tsx 内部，主题只能从顶栏按钮切换；
 * 现在提到 Provider，设置中心与顶栏按钮共享同一份状态，不会互相覆盖。
 *
 * 持久化格式沿用 `dev-workbench:theme`，历史值 'light' | 'dark' 仍然有效；
 * 新增 'system'（跟随系统）。index.html 的首屏内联脚本已同步支持 'system'。
 */

export type ThemePref = 'system' | 'light' | 'dark'
/** 实际生效的主题（'system' 会被解析成其一） */
export type ResolvedTheme = 'light' | 'dark'

const STORAGE_KEY = 'dev-workbench:theme'

export const THEME_OPTIONS: { value: ThemePref; label: string; desc: string }[] = [
  { value: 'system', label: '跟随系统', desc: '随系统深色模式自动切换' },
  { value: 'light', label: '浅色', desc: '始终使用浅色主题' },
  { value: 'dark', label: '深色', desc: '始终使用深色主题' },
]

interface ThemeContextValue {
  /** 用户偏好，可能是「跟随系统」 */
  pref: ThemePref
  /** 当前实际生效的主题 */
  theme: ResolvedTheme
  setPref: (pref: ThemePref) => void
  /** 在明 / 暗之间切换（切到显式偏好，等于脱离「跟随系统」） */
  toggle: () => void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

function systemTheme(): ResolvedTheme {
  if (typeof window === 'undefined' || !window.matchMedia) return 'light'
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function loadPref(): ThemePref {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved === 'light' || saved === 'dark' || saved === 'system') return saved
  } catch {
    /* 存储不可用：忽略，走跟随系统 */
  }
  return 'system'
}

function persist(pref: ThemePref): void {
  try {
    localStorage.setItem(STORAGE_KEY, pref)
  } catch {
    /* 存储不可用：忽略，仅影响持久化 */
  }
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [pref, setPrefState] = useState<ThemePref>(loadPref)
  const [system, setSystem] = useState<ResolvedTheme>(systemTheme)

  // 跟随系统：监听 prefers-color-scheme 变化（pref 为 system 时才影响实际主题）
  useEffect(() => {
    if (!window.matchMedia) return
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => setSystem(mq.matches ? 'dark' : 'light')
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  const theme: ResolvedTheme = pref === 'system' ? system : pref

  // 应用主题（html.dark）；写回偏好交给 setPref / toggle
  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark')
  }, [theme])

  // 跨标签页同步偏好
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) setPrefState(loadPref())
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  const setPref = useCallback((next: ThemePref) => {
    setPrefState(next)
    persist(next)
  }, [])

  const toggle = useCallback(() => {
    setPref(theme === 'dark' ? 'light' : 'dark')
  }, [theme, setPref])

  const value = useMemo(
    () => ({ pref, theme, setPref, toggle }),
    [pref, theme, setPref, toggle],
  )

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider')
  return ctx
}
