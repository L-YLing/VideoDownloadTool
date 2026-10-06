/**
 * 路径与工具（main/utils）
 */
import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'

/** 用户数据目录（Electron userData），不存在则创建 */
export function userDataDir(): string {
  const dir = app.getPath('userData')
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

/** 缓存目录（临时分片/合并中间文件），可清理 */
export function cacheDir(): string {
  const dir = path.join(userDataDir(), 'cache')
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

/** 弹幕/评论数据目录（全量下载伴随数据） */
export function sidecarDir(): string {
  const dir = path.join(userDataDir(), 'sidecar')
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

/** 应用内置二进制目录：打包后为 resources/bin（extraResources）；开发模式为项目 resources/bin */
export function bundledBinDir(): string {
  if (!app.isPackaged) {
    // 开发模式下 app.getAppPath() 可能指向 out/main，需向上查找项目 resources/bin
    const appPath = app.getAppPath()
    const candidates = [
      path.join(appPath, 'resources', 'bin'),
      path.join(appPath, '..', 'resources', 'bin'),
      path.join(appPath, '..', '..', 'resources', 'bin'),
      path.join(process.cwd(), 'resources', 'bin')
    ]
    for (const c of candidates) {
      if (fs.existsSync(c)) return c
    }
  }
  return path.join(process.resourcesPath ?? '', 'bin')
}

/** 获取可用的 yt-dlp 二进制路径：优先内置，其次系统 PATH */
export function resolveYtDlp(): string {
  const bundled = path.join(bundledBinDir(), process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp')
  if (fs.existsSync(bundled)) return bundled
  return 'yt-dlp' // 依赖系统 PATH
}

/**
 * yt-dlp 子进程环境变量：
 * - PYTHONIOENCODING=utf-8：强制 yt-dlp（Python）stdout/stderr 使用 UTF-8
 * - PYTHONUTF8=1：开启 Python UTF-8 模式（PEP 540），无视 locale 设置
 * - PYTHONLEGACYWINDOWSSTDIO=utf-8：Windows 专用，强制 stdio 用 UTF-8 而非系统 ANSI
 * - CHCP=65001：Windows 控制台代码页也设为 UTF-8（兜底）
 * 以上三重保险，彻底杜绝 Windows 下 GBK 输出被误解析导致中文乱码
 */
export function ytDlpEnv(extra?: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const base: NodeJS.ProcessEnv = {
    PYTHONIOENCODING: 'utf-8:strict',
    PYTHONUTF8: '1',
    PYTHONLEGACYWINDOWSSTDIO: 'utf-8'
  }
  if (process.platform === 'win32') {
    base.CHCP = '65001'
    base.PYTHONIOENCODING = 'utf-8:strict'
  }
  return { ...process.env, ...base, ...extra }
}

/** 随包内置的 ffmpeg 路径（无论是否存在都返回路径，供探测/展示用） */
export function bundledFfmpegPath(): string {
  return path.join(bundledBinDir(), process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg')
}

/** 获取可用的 ffmpeg 二进制路径：优先内置，其次系统 PATH */
export function resolveFfmpeg(): string {
  const bundled = bundledFfmpegPath()
  if (fs.existsSync(bundled)) return bundled
  return 'ffmpeg'
}

/** 安全拼接：防路径穿越（14-代码安全） */
export function safeJoin(base: string, ...parts: string[]): string {
  const target = path.join(base, ...parts)
  const rel = path.relative(base, target)
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error('非法路径')
  }
  return target
}

/** 计算目录大小（MB） */
export function dirSizeMB(dir: string): number {
  let total = 0
  try {
    const walk = (d: string): void => {
      for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, entry.name)
        if (entry.isDirectory()) walk(p)
        else total += fs.statSync(p).size
      }
    }
    walk(dir)
  } catch {
    /* 目录不存在或不可读时返回 0 */
  }
  return Math.round(total / 1024 / 1024)
}

/** 清空目录内容（保留目录本身） */
export function clearDir(dir: string): void {
  try {
    if (!fs.existsSync(dir)) return
    for (const entry of fs.readdirSync(dir)) {
      const p = path.join(dir, entry)
      fs.rmSync(p, { recursive: true, force: true })
    }
  } catch (e) {
    console.error('[cache] 清理失败:', e)
  }
}

/** 生成短 id */
export function shortId(prefix = 't'): string {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
}
