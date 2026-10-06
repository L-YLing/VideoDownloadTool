/**
 * 主进程入口（main/index.ts）
 * 依据 05-系统架构：单实例、窗口、托盘、服务装配、IPC、事件广播。
 */
import { app, BrowserWindow, Notification, protocol } from 'electron'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { Readable } from 'node:stream'
import { IPC } from '../shared/ipc'
import { SettingsService } from './services/settings-service'
import { StorageService } from './services/storage-service'
import { BilibiliAdapter } from './services/bilibili-adapter'
import { DownloadService, toYtDlpTemplate } from './services/download-service'
import { AuthService } from './services/auth-service'
import { FavoriteService } from './services/favorite-service'
import { LibraryService } from './services/library-service'
import { PlayerService } from './services/player-service'
import { MediaService } from './services/media-service'
import { PluginRegistry } from './services/plugin-registry'
import { PreviewService } from './services/preview-service'
import { ExploreService } from './services/explore-service'
import { CopService } from './services/cop-service'
import { LyricService } from './services/lyric-service'
import { resolveExternalFfmpeg, warmDetect } from './services/system-codec'
import { setYtDlpProxySettingsProvider } from './services/yt-dlp-runner'
import { startMaintenanceScheduler } from './services/maintenance-service'
import { logApp } from './services/logger'
import { registerIpcHandlers } from './ipc-handlers'
import { createMainWindow, getMainWindow } from './window'
import { createTray, destroyTray, isTraySupported } from './tray'
import { cacheDir, resolveYtDlp } from './utils/paths'
import { normalizeBiliInput, isBilibili, extractBiliId } from './utils/normalize'

/**
 * 自定义协议注册：
 * - vdimg://  图片代理。B站 等 CDN 校验 Referer，渲染进程直连会被拒（403/空白），
 *             由主进程带浏览器头抓取并回传，另做磁盘缓存。
 * - vdmedia:// 本地媒体。渲染进程不能直接用 `D:\xx.mp4` 作为 <video src>（既不是合法 URL，
 *             也会被同源策略拦截），必须通过受信任协议把本地文件流式交给媒体元素，
 *             并支持 Range 请求（拖动进度条依赖它）。
 */
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'vdimg',
    privileges: { standard: true, secure: true, corsEnabled: true, supportFetchAPI: true, bypassCSP: true }
  },
  {
    scheme: 'vdmedia',
    privileges: {
      standard: true,
      secure: true,
      corsEnabled: true,
      supportFetchAPI: true,
      stream: true,
      bypassCSP: true
    }
  },
  {
    // 在线视频流代理：B站 CDN 校验 Referer，且存在 CORS 限制，
    // 渲染进程无法把直链直接交给 <video>，必须经主进程转发。
    scheme: 'vdstream',
    privileges: {
      standard: true,
      secure: true,
      corsEnabled: true,
      supportFetchAPI: true,
      stream: true,
      bypassCSP: true
    }
  }
])

// 单实例锁（13：避免多实例放大内存）
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  bootstrap()
}

function bootstrap(): void {
  app.on('second-instance', () => {
    const win = getMainWindow()
    if (win) {
      if (win.isMinimized()) win.restore()
      win.show()
      win.focus()
    }
  })

  // 硬件加速开关（13：核显按需，低资源模式关闭）
  const settingsService = new SettingsService()
  if (!settingsService.get().hardwareAcceleration) {
    app.disableHardwareAcceleration()
  }

  void app.whenReady().then(() => {
    registerImageProtocol()
    registerMediaProtocol()
    registerStreamProtocol()

    // yt-dlp 代理策略来源（默认强制直连，避免加速器/VPN 的系统代理劫持导致 SSL 校验失败）
    setYtDlpProxySettingsProvider(() => settingsService.get())

    const storage = new StorageService()
    const bili = new BilibiliAdapter()
    // auth 在下面创建，这里用闭包延迟取用（避免构造顺序造成的循环依赖）
    let authRef: AuthService | null = null
    const registry = new PluginRegistry(storage, {
      appVersion: app.getVersion(),
      userAgent: () => settingsService.get().userAgent || '',
      authCookie: () => authRef?.getCookie() ?? undefined
    })

    // 转码进度广播（播放器兼容转码 / 下载产物编码归一共用）
    const media = new MediaService((p) => {
      for (const win of BrowserWindow.getAllWindows()) {
        win.webContents.send(IPC.evtTranscodeProgress, p)
      }
    })

    const download = new DownloadService({ settings: settingsService, storage, bili, registry, media })
    const auth = new AuthService(download)
    authRef = auth
    const favorite = new FavoriteService(bili, download, auth)
    const library = new LibraryService(storage)
    const player = new PlayerService(storage, media)
    const preview = new PreviewService(settingsService, bili, () => auth.getCookie() ?? undefined)
    const explore = new ExploreService(auth, settingsService)
    const cop = new CopService()
    const lyric = new LyricService()

    // 外挂 ffmpeg：内置缺编码器时自动改走系统 ffmpeg（播放器兼容 + 下载编码归一都会用到）
    media.setFfmpegPath(settingsService.get().externalFfmpegPath || null)
    media.setExternalFfmpegResolver(async () => resolveExternalFfmpeg(settingsService.get().externalFfmpegPath || undefined))

    // 定时清理（播放历史 / 日志 / 缓存），启动后延迟执行 + 每 6 小时检查
    startMaintenanceScheduler({ settings: settingsService, storage })

    // 系统解码资源后台预热（延迟执行，避免影响启动；结果缓存供设置页/播放器即时读取）
    if (settingsService.get().autoDetectCodec !== false) warmDetect(8000)

    logApp('info', '启动', `VD视频下载器 v${app.getVersion()} 启动（${process.platform} ${process.arch}）`)

    // 设置「自动登录」：启动校验已保存会话，失效则自动退出
    if (settingsService.get().autoLogin) {
      void auth.validateSession()
    }

    // 冒烟自检模式（VD_SMOKE=1）：无窗口验证核心管线后退出
    if (process.env.VD_SMOKE === '1') {
      runSmoke({ settings: settingsService, registry, download, bili })
        .then((result) => {
          console.log('[smoke] ' + JSON.stringify(result, null, 2))
          app.exit(result.ok ? 0 : 1)
        })
        .catch((e) => {
          console.error('[smoke] 异常:', e)
          app.exit(1)
        })
      return
    }

    registerIpcHandlers({
      download,
      settings: settingsService,
      auth,
      favorite,
      library,
      player,
      registry,
      preview,
      explore,
      cop,
      lyric,
      storage,
      getWindow: getMainWindow,
      cacheDir
    })

    // 下载任务更新 → 广播给渲染进程
    download.onUpdate((snap) => {
      for (const win of BrowserWindow.getAllWindows()) {
        win.webContents.send(IPC.evtTaskUpdate, snap)
      }
      // 完成通知（03：可关闭）
      const s = settingsService.get()
      if (snap.state === 'completed' && s.notifyOnComplete && !s.privacyMode) {
        notifyComplete(snap.title ?? '下载任务')
      }
    })

    // 登录态变更广播
    auth.onAuthChange((status) => {
      logApp('info', '登录', status.loggedIn ? `已登录：${status.username ?? '未知用户'}（mid ${status.mid ?? '-'}）` : '已退出登录')
      for (const win of BrowserWindow.getAllWindows()) {
        win.webContents.send(IPC.evtAuthChange, status)
      }
    })

    createMainWindow(settingsService)

    // 托盘（仅 Windows，D3）
    if (isTraySupported()) {
      createTray({
        onShow: () => {
          const win = getMainWindow()
          if (win) {
            win.show()
            win.focus()
          }
        },
        onPauseAll: () => {
          for (const t of download.listTasks()) {
            if (t.state === 'downloading' || t.state === 'pending') void download.pause(t.id)
          }
        },
        onResumeAll: () => {
          for (const t of download.listTasks()) {
            if (t.state === 'paused') void download.resume(t.id)
          }
        },
        getDownloadDir: () => settingsService.get().destinations[0] ?? app.getPath('downloads')
      })
    }

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createMainWindow(settingsService)
    })
  })

  // D2：关闭即退出（所有窗口关闭 → 退出，非常驻托盘）
  app.on('window-all-closed', () => {
    app.quit()
  })

  app.on('quit', () => {
    destroyTray()
  })
}

/**
 * 图片代理：vdimg://img/?u=<encoded url>
 * 主进程带 Referer / UA 抓取远端图片并回传，解决渲染进程直连 CDN 被拒的问题。
 * 抓取结果按 URL 哈希做一层磁盘缓存，重复打开不再走网络。
 */
function registerImageProtocol(): void {
  const thumbDir = path.join(cacheDir(), 'thumbs')
  try {
    fs.mkdirSync(thumbDir, { recursive: true })
  } catch {
    /* ignore */
  }

  protocol.handle('vdimg', async (request) => {
    try {
      const url = new URL(request.url)
      const raw = url.searchParams.get('u') ?? ''
      const target = decodeURIComponent(raw)
      if (!/^https?:\/\//i.test(target)) {
        return new Response('', { status: 400 })
      }

      const cacheFile = path.join(thumbDir, crypto.createHash('sha1').update(target).digest('hex'))
      if (fs.existsSync(cacheFile)) {
        const buf = fs.readFileSync(cacheFile)
        return new Response(buf, { headers: { 'Content-Type': guessMime(cacheFile), 'Cache-Control': 'max-age=86400' } })
      }

      const res = await fetch(target, {
        headers: {
          Referer: 'https://www.bilibili.com/',
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
          Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8'
        }
      })
      if (!res.ok) return new Response('', { status: res.status })
      const buf = Buffer.from(await res.arrayBuffer())
      const type = res.headers.get('content-type') || guessMime(target)
      try {
        fs.writeFileSync(cacheFile, buf)
      } catch {
        /* 缓存写入失败不影响显示 */
      }
      return new Response(buf, { headers: { 'Content-Type': type, 'Cache-Control': 'max-age=86400' } })
    } catch {
      return new Response('', { status: 500 })
    }
  })
}

/**
 * 本地媒体协议：vdmedia://file/?p=<encoded absolute path>
 *
 * 为什么必须这样做：渲染进程里 <video src="D:\a\b.mp4"> 既不是合法 URL、
 * 也会被同源策略拒绝加载（表现为「选好视频却一直播不出来」）。
 * 这里以受信任协议 + 流式响应输出本地文件，并实现 HTTP Range，
 * 保证拖动进度条 / 续播定位可用。
 */
function registerMediaProtocol(): void {
  protocol.handle('vdmedia', async (request) => {
    try {
      const url = new URL(request.url)
      const raw = url.searchParams.get('p') ?? ''
      const filePath = decodeURIComponent(raw)
      if (!filePath) return new Response('', { status: 400 })
      if (!fs.existsSync(filePath)) return new Response('', { status: 404 })
      const stat = fs.statSync(filePath)
      if (!stat.isFile()) return new Response('', { status: 400 })

      const mime = mediaMime(filePath)
      const range = request.headers.get('Range')
      if (range) {
        const m = /bytes=(\d*)-(\d*)/.exec(range)
        let start = m && m[1] ? Number(m[1]) : 0
        let end = m && m[2] ? Number(m[2]) : stat.size - 1
        if (Number.isNaN(start) || start < 0) start = 0
        if (Number.isNaN(end) || end >= stat.size) end = stat.size - 1
        if (start > end) return new Response('', { status: 416 })
        const stream = Readable.toWeb(fs.createReadStream(filePath, { start, end })) as ReadableStream
        return new Response(stream, {
          status: 206,
          headers: {
            'Content-Type': mime,
            'Content-Length': String(end - start + 1),
            'Content-Range': `bytes ${start}-${end}/${stat.size}`,
            'Accept-Ranges': 'bytes',
            'Cache-Control': 'no-store'
          }
        })
      }

      const stream = Readable.toWeb(fs.createReadStream(filePath)) as ReadableStream
      return new Response(stream, {
        status: 200,
        headers: {
          'Content-Type': mime,
          'Content-Length': String(stat.size),
          'Accept-Ranges': 'bytes',
          'Cache-Control': 'no-store'
        }
      })
    } catch {
      return new Response('', { status: 500 })
    }
  })
}

/**
 * 在线视频流代理：vdstream://s/?u=<encoded url>&t=v|a
 *
 * 作用：把 B站 CDN 的直链（DASH 的 m4s）转发给渲染进程的 <video>/<audio>。
 * 必要性：CDN 校验 Referer 且有 CORS 限制，渲染进程直接引用会被拒。
 * 完整转发 Range 请求与 206/Content-Range，保证拖动进度条可用。
 * Content-Type 明确按流类型给出（CDN 常返回 octet-stream，浏览器会拒绝播放）。
 */
function registerStreamProtocol(): void {
  protocol.handle('vdstream', async (request) => {
    try {
      const url = new URL(request.url)
      const raw = url.searchParams.get('u') ?? ''
      const target = decodeURIComponent(raw)
      if (!/^https?:\/\//i.test(target)) return new Response('', { status: 400 })

      const type = url.searchParams.get('t') ?? ''
      const range = request.headers.get('Range')
      const headers: Record<string, string> = {
        Referer: 'https://www.bilibili.com/',
        Origin: 'https://www.bilibili.com',
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
        Accept: '*/*',
        'Accept-Language': 'zh-CN,zh;q=0.9'
      }
      if (range) headers.Range = range

      const upstream = await fetch(target, { headers, redirect: 'follow' })
      if (!upstream.ok && upstream.status !== 206) {
        return new Response('', { status: upstream.status })
      }

      const out = new Headers()
      const upstreamType = upstream.headers.get('content-type') ?? ''
      // 明确指定类型：m4s（fMP4）用 video/mp4、音频用 audio/mp4
      if (type === 'v') out.set('Content-Type', 'video/mp4')
      else if (type === 'a') out.set('Content-Type', 'audio/mp4')
      else if (upstreamType && upstreamType !== 'application/octet-stream') out.set('Content-Type', upstreamType)
      else out.set('Content-Type', 'video/mp4')

      const len = upstream.headers.get('content-length')
      if (len) out.set('Content-Length', len)
      const cr = upstream.headers.get('content-range')
      if (cr) out.set('Content-Range', cr)
      out.set('Accept-Ranges', 'bytes')
      out.set('Cache-Control', 'no-store')

      return new Response(upstream.body, { status: upstream.status, headers: out })
    } catch {
      return new Response('', { status: 502 })
    }
  })
}

/** 媒体文件 MIME（覆盖常见容器与音频格式） */
function mediaMime(ref: string): string {
  const ext = path.extname(ref).toLowerCase()
  const map: Record<string, string> = {
    '.mp4': 'video/mp4',
    '.m4v': 'video/mp4',
    '.mov': 'video/quicktime',
    '.mkv': 'video/x-matroska',
    '.webm': 'video/webm',
    '.avi': 'video/x-msvideo',
    '.flv': 'video/x-flv',
    '.wmv': 'video/x-ms-wmv',
    '.ts': 'video/mp2t',
    '.m2ts': 'video/mp2t',
    '.mpg': 'video/mpeg',
    '.mpeg': 'video/mpeg',
    '.3gp': 'video/3gpp',
    '.ogv': 'video/ogg',
    '.mp3': 'audio/mpeg',
    '.m4a': 'audio/mp4',
    '.flac': 'audio/flac',
    '.wav': 'audio/wav',
    '.aac': 'audio/aac',
    '.ogg': 'audio/ogg',
    '.oga': 'audio/ogg',
    '.opus': 'audio/ogg',
    '.wma': 'audio/x-ms-wma',
    '.ape': 'audio/x-ape',
    '.aiff': 'audio/aiff',
    '.aif': 'audio/aiff'
  }
  return map[ext] ?? 'application/octet-stream'
}

function guessMime(ref: string): string {
  const lower = ref.toLowerCase()
  if (lower.endsWith('.png')) return 'image/png'
  if (lower.endsWith('.gif')) return 'image/gif'
  if (lower.endsWith('.webp')) return 'image/webp'
  if (lower.endsWith('.avif')) return 'image/avif'
  return 'image/jpeg'
}

function notifyComplete(title: string): void {
  try {
    if (!Notification.isSupported()) return
    new Notification({ title: 'VD视频下载器', body: `「${title}」下载完成` }).show()
  } catch {
    /* 通知失败不影响主流程 */
  }
}

/** 冒烟自检（15-测试与质量保障：验收门核心项） */
async function runSmoke(deps: {
  settings: SettingsService
  registry: PluginRegistry
  download: DownloadService
  bili: BilibiliAdapter
}): Promise<{ ok: boolean; checks: Record<string, unknown> }> {
  const checks: Record<string, unknown> = {}
  const ok = (name: string, value: unknown): void => {
    checks[name] = value
  }

  // 1. 设置默认值（E1 淡蓝 / D1 自启关 / 默认 both）
  const s = deps.settings.get()
  ok('settings.defaults', {
    themeColor: s.themeColor,
    autoStart: s.autoStart,
    content: s.content,
    destinations: s.destinations.length
  })

  // 2. 插件注册表：B站 内置可匹配（09）
  ok('plugin.bilibili', deps.registry.canHandle('https://www.bilibili.com/video/BV1xx411c7mD'))
  ok('plugin.custom.502', !deps.registry.canHandle('https://example.com/video/123'))

  // 3. yt-dlp 可执行（resolveYtDlp）
  const bin = resolveYtDlp()
  ok('yt-dlp.bin', bin)
  const version = await new Promise<string>((resolvePromise) => {
    const child = spawn(bin, ['--version'], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    child.stdout.on('data', (d: Buffer) => (out += d.toString()))
    child.on('close', () => resolvePromise(out.trim()))
    child.on('error', () => resolvePromise(''))
  })
  ok('yt-dlp.version', version || '缺失')

  // 4. 输入归一化（07：BV/AV/URL/收藏夹）
  ok('normalize.bv', normalizeBiliInput('BV1xx411c7mD').kind)
  ok('normalize.av', extractBiliId('av170001'))
  ok('normalize.url', isBilibili('https://www.bilibili.com/video/BV1xx411c7mD'))
  ok('normalize.fav', normalizeBiliInput('https://space.bilibili.com/123/favlist?fid=456').kind)

  // 5. 模板转换（10：{title} → %(title)s）
  ok('template.convert', toYtDlpTemplate('{uploader}/{title}.{ext}'))

  const allOk =
    Boolean(version) &&
    checks['plugin.bilibili'] === true &&
    checks['plugin.custom.502'] === true &&
    checks['normalize.bv'] === 'bvid' &&
    checks['normalize.av'] === 'av170001'
  return { ok: allOk, checks }
}
