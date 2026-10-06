/**
 * 主窗口（main/window.ts）
 * 依据 11-UI/交互、13-性能：单窗口、contextIsolation、硬件加速开关。
 */
import { BrowserWindow, shell } from 'electron'
import path from 'node:path'
import type { SettingsService } from './services/settings-service'

let mainWindow: BrowserWindow | null = null

export function getMainWindow(): BrowserWindow | null {
  return mainWindow
}

/**
 * 后台节流开关（资源优化）：
 * - 开启「后台播放」时必须关闭节流，否则窗口失去焦点后 Chromium 会把定时器降到 1Hz，
 *   导致后台播放卡顿；
 * - 未开启后台播放时保留 Chromium 默认节流（后台定时器降频、合成器降帧），
 *   可显著降低后台 CPU / 功耗。
 */
export function applyBackgroundThrottling(backgroundPlayEnabled: boolean): void {
  const win = mainWindow
  if (!win || win.isDestroyed()) return
  try {
    win.webContents.setBackgroundThrottling(!backgroundPlayEnabled)
  } catch {
    /* 某些平台/版本可能不支持，忽略 */
  }
}

export function createMainWindow(settings: SettingsService): BrowserWindow {
  const s = settings.get()
  const isDark = s.themeMode === 'dark' || (s.themeMode === 'system' && nativeThemeDark())

  mainWindow = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 900,
    minHeight: 600,
    show: false,
    backgroundColor: isDark ? '#161616' : '#F4F7FB',
    autoHideMenuBar: true,
    title: 'VD视频下载器',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false,
      /**
       * 后台节流：仅在开启「后台播放」时关闭。
       * 关闭后窗口最小化 / 失去焦点时 Chromium 仍全速运行 —— 这是后台播放的前提；
       * 未开启后台播放时保留默认节流，让后台渲染/合成器主动降频，省 CPU 与功耗。
       */
      backgroundThrottling: s.backgroundPlayEnabled === false
    }
  })

  // 外链用系统浏览器打开（安全）
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      void shell.openExternal(url)
    }
    return { action: 'deny' }
  })

  // 硬件加速：低资源模式关闭（13）
  if (s.lowResourceMode) {
    mainWindow.webContents.setFrameRate(30)
  }

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
  })

  // D2：关闭即退出
  mainWindow.on('closed', () => {
    mainWindow = null
  })

  // 开发/生产加载
  if (process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  }

  return mainWindow
}

function nativeThemeDark(): boolean {
  try {
    return require('electron').nativeTheme.shouldUseDarkColors
  } catch {
    return false
  }
}
