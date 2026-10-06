/**
 * 系统托盘（main/tray.ts）
 * 依据 11-UI §4、D3：仅 Windows 显示托盘；托盘菜单：显示/隐藏、开始/暂停全部、打开下载目录、退出。
 */
import { Tray, Menu, app, nativeImage, shell } from 'electron'
import fs from 'node:fs'
import path from 'node:path'

let tray: Tray | null = null

export function isTraySupported(): boolean {
  return process.platform === 'win32'
}

export function createTray(
  callbacks: {
    onShow: () => void
    onPauseAll: () => void
    onResumeAll: () => void
    getDownloadDir: () => string
  }
): Tray | null {
  if (!isTraySupported()) return null

  // 托盘图标：优先使用打包资源，其次内嵌 base64 图标
  const iconPath = path.join(process.resourcesPath ?? '', 'tray.png')
  let image: Electron.NativeImage
  if (fs.existsSync(iconPath)) {
    image = nativeImage.createFromPath(iconPath)
  } else {
    image = nativeImage.createFromDataURL(TRAY_ICON_BASE64)
  }
  if (image.isEmpty()) image = nativeImage.createFromDataURL(TRAY_ICON_BASE64)
  if (process.platform === 'win32') image = image.resize({ width: 16, height: 16 })

  tray = new Tray(image)
  tray.setToolTip('VD视频下载器')

  const menu = Menu.buildFromTemplate([
    { label: '显示主窗口', click: () => callbacks.onShow() },
    { label: '暂停全部下载', click: () => callbacks.onPauseAll() },
    { label: '继续全部下载', click: () => callbacks.onResumeAll() },
    { label: '打开下载目录', click: () => void shell.openPath(callbacks.getDownloadDir()) },
    { type: 'separator' },
    { label: '退出', click: () => app.quit() }
  ])
  tray.setContextMenu(menu)
  tray.on('click', () => callbacks.onShow())
  return tray
}

export function destroyTray(): void {
  tray?.destroy()
  tray = null
}

/** 16x16 蓝色下载箭头（无外部文件依赖） */
const TRAY_ICON_BASE64 =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAUElEQVR4nGP8z8DA8B8JMMxEw4wMDGhqkMVI+mA0YcQAFKaTAVT8f9QAFIPQdJ8B1ZB/AxQj0FyA5gK0GMDwmTRLCJmMEhgoy0VAZ4KRAJbMCRluYZ3sAAAAAElFTkSuQmCC'
