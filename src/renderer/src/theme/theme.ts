/**
 * Material3 风格主题（11-UI与交互设计）
 * 莫奈取色：默认淡蓝 #64B5F6；明/暗双主题；主色可自定义。
 * 低资源模式（13）：关闭过渡动画与模糊特效。
 */
import { reactive } from 'vue'

export type ThemeMode = 'light' | 'dark' | 'system'

export const theme = reactive({
  mode: 'system' as ThemeMode,
  color: '#64B5F6',
  dark: false,
  lowResource: false
})

const THEME_CACHE_KEY = 'vd.theme'

/** 缓存最近一次生效的主题，供下次启动「首帧」直接使用（避免等待 IPC 期间闪错主题） */
function cacheTheme(s: { themeMode: ThemeMode; themeColor: string; lowResourceMode: boolean }): void {
  try {
    localStorage.setItem(
      THEME_CACHE_KEY,
      JSON.stringify({ themeMode: s.themeMode, themeColor: s.themeColor, lowResourceMode: s.lowResourceMode })
    )
  } catch {
    /* 隐私模式等场景下忽略 */
  }
}

function readCachedTheme(): { themeMode: ThemeMode; themeColor: string; lowResourceMode: boolean } | null {
  try {
    const raw = localStorage.getItem(THEME_CACHE_KEY)
    if (!raw) return null
    const p = JSON.parse(raw) as { themeMode?: ThemeMode; themeColor?: string; lowResourceMode?: boolean }
    if (!p?.themeMode) return null
    return {
      themeMode: p.themeMode,
      themeColor: p.themeColor || '#64B5F6',
      lowResourceMode: Boolean(p.lowResourceMode)
    }
  } catch {
    return null
  }
}

/** 主色 → 浅色容器色（莫奈 tonal 简化：与白/黑混合） */
function tonal(color: string, mix: string, weight: number): string {
  const c = hexToRgb(color)
  const m = hexToRgb(mix)
  const r = Math.round(c.r + (m.r - c.r) * weight)
  const g = Math.round(c.g + (m.g - c.g) * weight)
  const b = Math.round(c.b + (m.b - c.b) * weight)
  return rgbToHex(r, g, b)
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  let h = hex.replace('#', '')
  if (h.length === 3) h = h.split('').map((c) => c + c).join('')
  const n = parseInt(h, 16)
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 }
}

function rgbToHex(r: number, g: number, b: number): string {
  return '#' + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')
}

function luminance(hex: string): number {
  const { r, g, b } = hexToRgb(hex)
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255
}

export function applyTheme(settings: { themeMode: ThemeMode; themeColor: string; lowResourceMode: boolean }): void {
  theme.mode = settings.themeMode
  theme.color = settings.themeColor
  theme.lowResource = settings.lowResourceMode

  const dark =
    settings.themeMode === 'dark' ||
    (settings.themeMode === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
  theme.dark = dark

  const root = document.documentElement
  root.dataset.theme = dark ? 'dark' : 'light'
  root.dataset.lowResource = settings.lowResourceMode ? 'true' : 'false'

  const primary = settings.themeColor || '#64B5F6'
  const onPrimary = luminance(primary) > 0.6 ? '#0D3D6B' : '#ffffff'
  root.style.setProperty('--md-primary', primary)
  root.style.setProperty('--md-on-primary', onPrimary)
  root.style.setProperty('--md-primary-container', dark ? tonal(primary, '#161616', 0.55) : tonal(primary, '#ffffff', 0.72))
  root.style.setProperty('--md-on-primary-container', dark ? tonal(primary, '#ffffff', 0.82) : '#0D3D6B')
  root.style.setProperty('--md-secondary-container', dark ? tonal(primary, '#161616', 0.68) : tonal(primary, '#ffffff', 0.55))

  cacheTheme(settings)
}

/**
 * 启动即应用「上次使用的主题」（读到缓存就用缓存，否则按系统偏好），
 * 不等主进程 IPC 返回 —— 否则首帧会以默认浅色渲染，看起来像「主题被重置」。
 */
export function applyBootTheme(): void {
  const cached = readCachedTheme()
  if (cached) {
    applyTheme(cached)
    return
  }
  applyTheme({
    themeMode: 'system',
    themeColor: '#64B5F6',
    lowResourceMode: false
  })
}

export function resolveSystemDark(): boolean {
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

// 系统主题变化自动跟随
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  if (theme.mode === 'system') {
    applyTheme({ themeMode: 'system', themeColor: theme.color, lowResourceMode: theme.lowResource })
  }
})
