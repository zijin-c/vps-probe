import { createContext, createElement, useContext, useEffect, useState, type ReactNode } from 'react'
import { DEFAULT_THEME, findTheme } from '../themes/registry'
import { api } from './api'

export type Theme = 'dark' | 'light'
export type ThemeMode = 'auto' | 'dark' | 'light'

const MODE_KEY = 'probe-theme'          // 访客自己选的明暗（只有点过切换按钮才会写入）
const SITE_MODE_KEY = 'probe-site-mode' // 站点默认明暗的缓存，避免首屏闪烁
const SKIN_KEY = 'probe-skin'           // 站点主题的缓存
const PREVIEW_KEY = 'probe-skin-preview' // ?theme=xxx 预览（仅当前标签页）

function safeGet(store: Storage | undefined, k: string): string | null {
  try { return store?.getItem(k) ?? null } catch { return null }
}
function safeSet(store: Storage | undefined, k: string, v: string) {
  try { store?.setItem(k, v) } catch { /* 隐私模式下忽略 */ }
}

const systemTheme = (): Theme => (window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark')

function resolveMode(siteMode: ThemeMode): Theme {
  const own = safeGet(window.localStorage, MODE_KEY)
  if (own === 'dark' || own === 'light') return own
  return siteMode === 'auto' ? systemTheme() : siteMode
}

function initialSkin(): string {
  const url = new URLSearchParams(location.search).get('theme')
  if (url) {
    safeSet(window.sessionStorage, PREVIEW_KEY, url)
    return findTheme(url).id
  }
  const preview = safeGet(window.sessionStorage, PREVIEW_KEY)
  if (preview) return findTheme(preview).id
  return findTheme(safeGet(window.localStorage, SKIN_KEY) || DEFAULT_THEME).id
}

interface SkinState {
  skin: string
  previewing: boolean
  theme: Theme
  toggle: () => void
  exitPreview: () => void
}

const SkinCtx = createContext<SkinState>({ skin: DEFAULT_THEME, previewing: false, theme: 'dark', toggle: () => {}, exitPreview: () => {} })

/** 在根组件挂一次：读取站点主题 / 默认明暗，并同步到 <html data-skin data-theme> */
export function SkinProvider({ children }: { children: ReactNode }) {
  const [skin, setSkin] = useState(initialSkin)
  const [previewing, setPreviewing] = useState(() => !!safeGet(window.sessionStorage, PREVIEW_KEY))
  const [siteMode, setSiteMode] = useState<ThemeMode>(() => (safeGet(window.localStorage, SITE_MODE_KEY) as ThemeMode) || 'auto')
  const [theme, setTheme] = useState<Theme>(() => resolveMode(siteMode))

  useEffect(() => {
    api<{ theme?: string; theme_mode?: ThemeMode }>('/probe/meta').then((m) => {
      if (!m) return
      const site = findTheme(m.theme).id
      safeSet(window.localStorage, SKIN_KEY, site)
      if (!safeGet(window.sessionStorage, PREVIEW_KEY)) setSkin(site)
      const mode = m.theme_mode || 'auto'
      safeSet(window.localStorage, SITE_MODE_KEY, mode)
      setSiteMode(mode)
      setTheme(resolveMode(mode))
    }).catch(() => {})
  }, [])

  // 站点默认"跟随系统"且访客没手动选过时，系统切换明暗也跟着变
  useEffect(() => {
    if (siteMode !== 'auto') return
    const mq = window.matchMedia?.('(prefers-color-scheme: light)')
    if (!mq) return
    const h = () => setTheme(resolveMode('auto'))
    mq.addEventListener?.('change', h)
    return () => mq.removeEventListener?.('change', h)
  }, [siteMode])

  useEffect(() => {
    document.documentElement.dataset.skin = skin
    document.documentElement.dataset.theme = theme
  }, [skin, theme])

  const toggle = () => setTheme((t) => {
    const n: Theme = t === 'dark' ? 'light' : 'dark'
    safeSet(window.localStorage, MODE_KEY, n)
    return n
  })
  const exitPreview = () => {
    try { window.sessionStorage.removeItem(PREVIEW_KEY) } catch { /* ignore */ }
    setPreviewing(false)
    setSkin(findTheme(safeGet(window.localStorage, SKIN_KEY)).id)
    const u = new URL(location.href)
    u.searchParams.delete('theme')
    history.replaceState(null, '', u.toString())
  }
  return createElement(SkinCtx.Provider, { value: { skin, previewing, theme, toggle, exitPreview } }, children)
}

export const useSkin = () => useContext(SkinCtx)

/** 兼容旧调用：[当前明暗, 切换] */
export function useTheme(): [Theme, () => void] {
  const s = useSkin()
  return [s.theme, s.toggle]
}
