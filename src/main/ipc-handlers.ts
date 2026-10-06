/**
 * IPC 处理器（main/ipc-handlers.ts）
 * 白名单通道注册（14-代码安全：contextIsolation + 预加载白名单）。
 */
import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { IPC } from '../shared/ipc'
import type { DownloadInput, DownloadOptions, Settings } from '../shared/types'
import type { DownloadService } from './services/download-service'
import type { SettingsService } from './services/settings-service'
import type { AuthService } from './services/auth-service'
import type { FavoriteService } from './services/favorite-service'
import type { LibraryService } from './services/library-service'
import type { PlayerService } from './services/player-service'
import type { PluginRegistry } from './services/plugin-registry'
import type { PreviewService } from './services/preview-service'
import type { ExploreService } from './services/explore-service'
import { fetchUserProfile } from './services/explore-service'
import type { CopService } from './services/cop-service'
import type { LyricService } from './services/lyric-service'
import type { StorageService } from './services/storage-service'
import type { ExploreVideo, LogKind, LyricLine, TranscodeTarget } from '../shared/types'
import { clearDir, dirSizeMB } from './utils/paths'
import { BUILD_DATE, describeSystem, patchVersion } from './utils/build-info'
import { parseLrc } from './services/cop-service'
import { clearLogs, logApp, logsDir, readLogs } from './services/logger'
import { runMaintenance } from './services/maintenance-service'
import { peekCodecResources } from './services/system-codec'
import { applyBackgroundThrottling } from './window'
import { currentMemoryReport, optimizeMemory } from './services/memory-service'
import { readSystemLog, systemLogChannels } from './services/system-log-service'

export interface IpcDeps {
  download: DownloadService
  settings: SettingsService
  auth: AuthService
  favorite: FavoriteService
  library: LibraryService
  player: PlayerService
  registry: PluginRegistry
  preview: PreviewService
  explore: ExploreService
  cop: CopService
  lyric: LyricService
  storage: StorageService
  getWindow: () => BrowserWindow | null
  cacheDir: () => string
}

export function registerIpcHandlers(deps: IpcDeps): void {
  const { download, settings, auth, favorite, library, player, registry, preview, explore, cop, lyric, storage, getWindow, cacheDir } =
    deps

  // ---------- 设置 ----------
  ipcMain.handle(IPC.settingsGet, () => settings.get())
  ipcMain.handle(IPC.settingsSet, (_e, patch: Partial<Settings>) => {
    const next = settings.set(patch)
    // 外部 ffmpeg 路径变更后立即生效（播放器兼容转码 / 下载编码归一）
    player.getMediaService().setFfmpegPath(next.externalFfmpegPath || null)
    // 缓存上限调低时顺手回收一次
    if (patch.cacheLimitMB !== undefined) {
      try {
        if (dirSizeMB(cacheDir()) > (next.cacheLimitMB || 1024)) clearDir(cacheDir())
      } catch {
        /* ignore */
      }
    }
    // 后台播放开关变化 → 实时调整渲染进程节流（未开启后台播放时保留默认节流省 CPU）
    if (patch.backgroundPlayEnabled !== undefined) {
      applyBackgroundThrottling(next.backgroundPlayEnabled !== false)
    }
    // 低资源模式变化 → 实时限制渲染帧率
    if (patch.lowResourceMode !== undefined) {
      const win = getWindow()
      try {
        win?.webContents.setFrameRate(next.lowResourceMode ? 30 : 60)
      } catch {
        /* ignore */
      }
    }
    logApp('info', '设置', `已更新设置：${Object.keys(patch).join('、') || '(空)'}`)
    return next
  })
  ipcMain.handle(IPC.settingsExport, () => settings.export())
  ipcMain.handle(IPC.settingsImport, (_e, raw: string) => settings.import(raw))

  // ---------- 下载 ----------
  ipcMain.handle(IPC.downloadEnqueue, (_e, inputs: DownloadInput[], options: DownloadOptions) =>
    download.enqueue(inputs, options)
  )
  ipcMain.handle(IPC.downloadPause, (_e, id: string) => download.pause(id))
  ipcMain.handle(IPC.downloadResume, (_e, id: string) => download.resume(id))
  ipcMain.handle(IPC.downloadCancel, (_e, id: string) => download.cancel(id))
  ipcMain.handle(IPC.downloadRetry, (_e, id: string) => download.retry(id))
  ipcMain.handle(IPC.downloadGet, (_e, id: string) => download.getTask(id))
  ipcMain.handle(IPC.downloadList, () => download.listTasks())
  ipcMain.handle(IPC.downloadHistory, () => download.listHistory())
  ipcMain.handle(IPC.downloadClearHistory, () => download.clearHistory())
  ipcMain.handle(IPC.downloadQueueMove, (_e, id: string, dir: 'up' | 'down') => download.queueMove(id, dir))
  ipcMain.handle(IPC.downloadQueueClear, () => download.clearPending())
  /** 清空队列中「已结束」的任务（首页「清空历史」）；返回清空后的队列快照 */
  ipcMain.handle(IPC.downloadQueueClearFinished, () => {
    download.clearFinished()
    return download.listTasks()
  })
  ipcMain.handle(IPC.downloadRequeue, (_e, id: string) => download.requeue(id))
  ipcMain.handle(IPC.downloadConfirmCollection, (_e, includeAll: boolean) => download.confirmCollection(includeAll))
  ipcMain.handle(IPC.downloadPreview, (_e, inputs: DownloadInput[], options: DownloadOptions) =>
    preview.preview(inputs, options ?? {})
  )
  ipcMain.handle(IPC.fileReadText, (_e, file: string) => {
    try {
      return fs.readFileSync(file, 'utf-8')
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) }
    }
  })

  // ---------- 文件对话框 ----------
  ipcMain.handle(IPC.dialogOpenFile, async (e, opts?: { filters?: Electron.FileFilter[] }) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    const res = await dialog.showOpenDialog(win ?? getWindow()!, {
      properties: ['openFile', 'multiSelections'],
      filters:
        opts?.filters ?? [
          {
            // 默认「媒体文件」：视频 + 音频 + .cop 音频包（.cop 必须在这里，否则文件选择器选不到它）
            name: '媒体文件',
            extensions: [
              'mp4', 'mkv', 'webm', 'mov', 'm4v', 'avi', 'flv', 'ts', 'm2ts', 'wmv', 'mpg', 'mpeg', '3gp', 'ogv', 'f4v',
              'mp3', 'm4a', 'flac', 'wav', 'aac', 'ogg', 'oga', 'opus', 'wma', 'ape', 'aiff', 'aif', 'cop'
            ]
          },
          { name: 'VD 音频包 (.cop)', extensions: ['cop'] },
          { name: '所有文件', extensions: ['*'] }
        ]
    })
    return res.canceled ? [] : res.filePaths
  })
  ipcMain.handle(IPC.dialogOpenDirectory, async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    const res = await dialog.showOpenDialog(win ?? getWindow()!, { properties: ['openDirectory'] })
    return res.canceled ? null : res.filePaths[0]
  })
  ipcMain.handle(IPC.dialogPickDownloadDir, async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    const res = await dialog.showOpenDialog(win ?? getWindow()!, {
      properties: ['openDirectory', 'createDirectory']
    })
    return res.canceled ? null : res.filePaths[0]
  })
  ipcMain.handle(
    IPC.dialogSaveFile,
    async (e, opts?: { defaultPath?: string; filters?: Electron.FileFilter[] }) => {
      const win = BrowserWindow.fromWebContents(e.sender)
      const res = await dialog.showSaveDialog(win ?? getWindow()!, {
        defaultPath: opts?.defaultPath,
        filters: opts?.filters ?? [{ name: '所有文件', extensions: ['*'] }]
      })
      return res.canceled ? null : res.filePath
    }
  )

  // ---------- 视频列表 ----------
  ipcMain.handle(IPC.libraryList, () => library.list())
  ipcMain.handle(IPC.libraryCreate, (_e, name: string) => library.create(name))
  ipcMain.handle(IPC.libraryDelete, (_e, id: string) => library.delete(id))
  ipcMain.handle(IPC.libraryImportFolder, (_e, id: string, folder: string) => library.importFolder(id, folder))
  ipcMain.handle(IPC.libraryImportFiles, (_e, id: string, files: string[]) => library.importFiles(id, files))
  ipcMain.handle(IPC.libraryScan, (_e, id: string) => library.scan(id))
  ipcMain.handle(IPC.libraryRename, (_e, id: string, name: string) => library.rename(id, name))
  ipcMain.handle(IPC.libraryRemoveItem, (_e, id: string, itemId: string) => library.removeItem(id, itemId))

  // ---------- 播放器 ----------
  ipcMain.handle(IPC.playerOpen, (_e, pathOrUrl: string) => player.toMediaRef(pathOrUrl))
  ipcMain.handle(IPC.playerProbe, (_e, mediaPath: string) => player.probe(mediaPath))
  ipcMain.handle(IPC.playerTranscode, async (_e, mediaPath: string, target?: TranscodeTarget) =>
    player.ensurePlayable(mediaPath, target)
  )
  ipcMain.handle(IPC.playerCancelTranscode, (_e, id: string) => player.getMediaService().cancel(id))
  ipcMain.handle(IPC.playerDetectCodec, (_e, refresh?: boolean, peek?: boolean) => {
    // peek=true：只读缓存（设置页首屏用），绝不触发扫描，避免界面卡顿
    if (peek) {
      const hit = peekCodecResources()
      return (
        hit ?? { players: [], ffmpegs: [], codecPacks: [], scanned: [], detectedAt: 0, cached: false }
      )
    }
    return player.detectCodecResources(Boolean(refresh))
  })
  ipcMain.handle(
    IPC.playerOpenExternal,
    (_e, mediaPath: string, preferred?: string, position?: number) =>
      player.openExternal(mediaPath, preferred, position ?? 0)
  )
  ipcMain.handle(
    IPC.playerOpenAuto,
    (_e, mediaPath: string, preferred?: string, position?: number) =>
      player.openAuto(mediaPath, preferred, position ?? 0)
  )
  ipcMain.handle(IPC.playerPickExternal, async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    const res = await dialog.showOpenDialog(win ?? getWindow()!, {
      title: '选择播放器可执行文件（mpv / VLC / MPC-HC / PotPlayer…）',
      properties: ['openFile'],
      filters:
        process.platform === 'win32'
          ? [{ name: '可执行文件', extensions: ['exe'] }]
          : [{ name: '所有文件', extensions: ['*'] }]
    })
    return res.canceled ? null : res.filePaths[0]
  })
  ipcMain.handle(IPC.playerHistory, () =>
    player.listHistory().map((h) => ({ ...h, exists: player.historyExists(h.path) }))
  )
  ipcMain.handle(IPC.playerHistoryClear, () => player.clearHistory())
  ipcMain.handle(IPC.playerHistoryRemove, (_e, id: string) => player.removeHistory(id))
  ipcMain.handle(
    IPC.playerSaveProgress,
    (
      _e,
      p: string,
      pos: number,
      dur: number,
      meta?: { title?: string; uploader?: string; cover?: string; from?: string }
    ) => {
      player.saveProgress(p, pos, dur)
      // 同步写入播放历史（个人页「历史记录」）
      player.recordHistory(p, pos, dur, meta)
    }
  )
  ipcMain.handle(IPC.playerGetProgress, (_e, p: string) => player.getProgress(p))
  ipcMain.handle(IPC.playerGetComments, (_e, mediaPath: string) => player.loadComments(mediaPath))
  /** 评论区翻页：只返回当前页，避免整份评论常驻渲染进程内存 */
  ipcMain.handle(IPC.playerGetCommentsPage, (_e, mediaPath: string, pn?: number, ps?: number) =>
    player.loadCommentsPage(mediaPath, pn ?? 1, ps ?? 50)
  )
  ipcMain.handle(IPC.playerGetDanmaku, (_e, mediaPath: string) => player.loadDanmaku(mediaPath))

  // ---------- B站收藏夹 / 登录 ----------
  ipcMain.handle(IPC.favoriteResolve, async (e, input: string) => {
    const win = BrowserWindow.fromWebContents(e.sender) ?? getWindow()
    return favorite.resolve(input, (index, total, video, token) => {
      win?.webContents.send(IPC.evtFavVideoUpdate, { index, total, video, token })
    })
  })
  ipcMain.handle(IPC.favoriteDownload, (_e, input: string, opts: DownloadOptions) =>
    favorite.download(input, opts)
  )
  ipcMain.handle(IPC.favoriteGetMine, () => favorite.getMine())
  ipcMain.handle(IPC.authStatus, () => auth.getStatus())
  ipcMain.handle(IPC.authLoginCookie, (_e, cookie: string) => auth.loginCookie(cookie))
  ipcMain.handle(IPC.authQuickLogin, () => auth.quickLogin())
  ipcMain.handle(IPC.authOpenBrowserLogin, () => {
    auth.openLoginInBrowser()
    return true
  })
  ipcMain.handle(IPC.authLogout, () => auth.logout())
  ipcMain.handle(IPC.authRefresh, () => auth.refresh())

  // ---------- 日志 ----------
  ipcMain.handle(IPC.logsPage, (_e, kind: LogKind, limit?: number) => readLogs(kind ?? 'app', limit ?? 500))
  ipcMain.handle(IPC.logsClear, (_e, kind: LogKind) => {
    const ok = clearLogs(kind ?? 'app')
    logApp('info', '日志', `已清空${kind === 'download' ? '下载' : '程序'}日志`)
    return ok
  })
  ipcMain.handle(IPC.logsOpenDir, async () => {
    const dir = logsDir()
    await shell.openPath(dir)
    return dir
  })

  // ---------- 插件 ----------
  ipcMain.handle(IPC.pluginList, () => registry.list())
  ipcMain.handle(IPC.pluginInstallDir, (_e, dir: string) => {
    if (!dir) return { ok: false, error: '未选择目录' }
    // 也允许用户直接选中 manifest.json
    if (dir.toLowerCase().endsWith('.json')) return registry.installFromManifest(dir)
    return registry.installFromDir(dir)
  })
  ipcMain.handle(IPC.pluginUninstall, (_e, id: string) => registry.uninstall(id))
  ipcMain.handle(IPC.pluginSetEnabled, (_e, id: string, enabled: boolean) => registry.setEnabled(id, enabled))
  ipcMain.handle(IPC.pluginReload, () => {
    registry.reload()
    return registry.list()
  })
  ipcMain.handle(IPC.pluginOpenDir, () => {
    const dir = registry.pluginsDir()
    if (fs.existsSync(dir)) shell.openPath(dir)
    return dir
  })

  // ---------- 探索（B站分区浏览） ----------
  ipcMain.handle(IPC.exploreCategories, () => explore.categories())
  ipcMain.handle(IPC.exploreFeed, (_e, rid: number, pn: number, ps?: number) => explore.feed(rid, pn ?? 1, ps ?? 24))
  ipcMain.handle(IPC.explorePreview, async (_e, video: ExploreVideo) => {
    const send = (p: { percent: number; done: boolean; error?: string; path?: string }): void => {
      for (const w of BrowserWindow.getAllWindows()) w.webContents.send(IPC.evtExploreProgress, p)
    }
    try {
      return await explore.preparePreview(video, send)
    } catch (e) {
      // 任何异常都转成可读失败结果，避免渲染进程收到 rejected Promise 后「点了没反应」
      const msg = e instanceof Error ? e.message : String(e)
      logApp('error', '探索', `预览准备失败：${video?.bvid ?? '-'} —— ${msg}`)
      return { ok: false, error: msg }
    }
  })
  // 解析网页视频直链（不下载，秒开）
  ipcMain.handle(IPC.exploreStream, async (_e, video: ExploreVideo, maxHeight?: number) => {
    try {
      return await explore.resolveStream(video, maxHeight ?? 720)
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  })
  // 在线直链播放时没有伴生文件，弹幕/评论直接走接口
  ipcMain.handle(IPC.exploreSide, async (_e, video: ExploreVideo) => {
    try {
      return await explore.sideData(video)
    } catch {
      return { danmaku: [], comments: [] }
    }
  })
  // 搜索：关键字 / BV 号（分页由 pageSize 决定，默认 16）
  ipcMain.handle(IPC.exploreSearch, async (_e, keyword: string, pn?: number, ps?: number) => {
    try {
      return await explore.search(keyword ?? '', pn ?? 1, ps ?? settings.get().explorePageSize ?? 16)
    } catch (e) {
      return {
        keyword: keyword ?? '',
        videos: [],
        hasMore: false,
        mode: 'video',
        page: pn ?? 1,
        pageSize: ps ?? 16,
        error: e instanceof Error ? e.message : String(e)
      }
    }
  })
  // 评论分页：游标式，只返回当前页（凑够 ps 条，接口单次上限 30）
  ipcMain.handle(IPC.exploreComments, async (_e, aid: number, offset?: string, ps?: number) => {
    try {
      return await explore.commentsPageFull(Number(aid), offset ?? '', ps ?? 50)
    } catch (e) {
      return {
        ok: false,
        items: [],
        nextOffset: '',
        total: 0,
        hasMore: false,
        error: e instanceof Error ? e.message : String(e)
      }
    }
  })
  // 楼中楼：挂在对应一级评论下一起展示
  ipcMain.handle(IPC.exploreSubReplies, async (_e, aid: number, root: string, pn?: number, ps?: number) => {
    try {
      return await explore.subReplies(Number(aid), root, pn ?? 1, ps ?? 10)
    } catch (e) {
      return { ok: false, items: [], hasMore: false, total: 0, error: e instanceof Error ? e.message : String(e) }
    }
  })
  ipcMain.handle(IPC.exploreInteraction, (_e, bvid: string) => explore.interaction(bvid))

  // 收藏（与阿 B 一致：查询已收藏的收藏夹 + 增删）
  ipcMain.handle(IPC.favCollected, (_e, aid: number) => favorite.collectedFolders(aid))
  ipcMain.handle(IPC.favDeal, (_e, aid: number, addIds: number[], delIds: number[]) =>
    favorite.deal(aid, addIds ?? [], delIds ?? [])
  )
  ipcMain.handle(IPC.favCreate, (_e, name: string, intro?: string, privacy?: boolean) =>
    favorite.createFolder(name, intro ?? '', Boolean(privacy))
  )
  ipcMain.handle(IPC.exploreLike, (_e, bvid: string, like: boolean) => explore.like(bvid, like))

  // ---------- 用户 ----------
  ipcMain.handle(IPC.userProfile, async () => {
    // 会话状态可能是上次启动缓存的，这里先校验一次再决定是否取资料
    const status = auth.getStatus().loggedIn ? auth.getStatus() : await auth.refresh()
    if (!status.loggedIn) return null
    return fetchUserProfile(auth.getCookie() ?? undefined)
  })

  // ---------- 歌词 / .cop 音频包 ----------
  ipcMain.handle(IPC.lyricParse, (_e, file: string) => {
    if (!file || !fs.existsSync(file)) return []
    return parseLrc(fs.readFileSync(file, 'utf-8'))
  })
  ipcMain.handle(IPC.lyricSave, (_e, audio: string, lines: LyricLine[]) => cop.saveSidecarLyric(audio, lines ?? []))
  ipcMain.handle(IPC.lyricLoad, (_e, audio: string) => cop.loadSidecarLyric(audio))
  // 在线搜索歌词（网易云公开接口）：搜索候选 → 用户选择 → 拉取 LRC
  ipcMain.handle(IPC.lyricSearch, (_e, keyword: string, limit?: number) => lyric.search(keyword, limit))
  ipcMain.handle(IPC.lyricFetch, (_e, songId: number) => lyric.fetchLyric(Number(songId)))
  ipcMain.handle(
    IPC.copExport,
    async (_e, audio: string, out: string, meta: Record<string, unknown>, lyric?: string, lyricLines?: LyricLine[]) =>
      cop.export(audio, out, meta ?? {}, lyric, lyricLines ?? [])
  )
  ipcMain.handle(IPC.copImport, (_e, file: string) => cop.import_(file))
  ipcMain.handle(IPC.mediaOpenSystem, async (_e, p: string) => {
    if (p && fs.existsSync(p)) await shell.openPath(p)
  })

  // ---------- 系统 ----------
  ipcMain.handle(IPC.sysInfo, () => {
    const sys = describeSystem()
    return {
      version: app.getVersion(),
      patchVersion: patchVersion(),
      buildDate: BUILD_DATE,
      platform: process.platform,
      arch: process.arch,
      isWindows: process.platform === 'win32',
      electronVersion: process.versions.electron,
      nodeVersion: process.versions.node,
      chromeVersion: process.versions.chrome,
      osName: sys.osName,
      osVersion: sys.osVersion,
      userDataPath: app.getPath('userData'),
      cacheSizeMB: dirSizeMB(cacheDir()),
      diskFreeMB: freeDiskMB(deps.settings.get().destinations[0] ?? app.getPath('home'))
    }
  })
  ipcMain.handle(IPC.sysOpenPath, async (_e, p: string) => {
    if (p && fs.existsSync(p)) await shell.openPath(p)
  })
  ipcMain.handle(IPC.sysShowInFolder, async (_e, p: string) => {
    if (p && fs.existsSync(p)) shell.showItemInFolder(p)
  })
  ipcMain.handle(IPC.shellOpenExternal, async (_e, url: string) => {
    if (typeof url === 'string' && /^https?:\/\//i.test(url)) await shell.openExternal(url)
  })
  ipcMain.handle(IPC.sysCleanCache, () => {
    clearDir(cacheDir())
    return dirSizeMB(cacheDir())
  })
  ipcMain.handle(IPC.sysGetCacheSize, () => dirSizeMB(cacheDir()))
  ipcMain.handle(IPC.sysMinimizeToTray, () => {
    const win = getWindow()
    if (win) {
      win.hide()
      return true
    }
    return false
  })
  /** 定位 settings.json（用户可自行查看/备份持久化文件） */
  ipcMain.handle(IPC.sysOpenSettingsFile, async () => {
    const file = path.join(app.getPath('userData'), 'settings.json')
    if (fs.existsSync(file)) {
      shell.showItemInFolder(file)
      return file
    }
    const dir = app.getPath('userData')
    await shell.openPath(dir)
    return file
  })
  /** 立即执行一次资源清理（忽略周期限制） */
  ipcMain.handle(IPC.sysCleanNow, () => {
    const report = runMaintenance({ settings, storage }, true)
    return { report, cacheSizeMB: dirSizeMB(cacheDir()) }
  })

  // ---------- 内存优化 / 系统日志 ----------
  ipcMain.handle(IPC.sysMemory, () => currentMemoryReport())
  ipcMain.handle(IPC.sysOptimizeMemory, async () => {
    const report = await optimizeMemory(true)
    logApp(
      'info',
      '内存',
      `内存优化：${report.beforeMB} MB → ${report.afterMB} MB（回收 ${report.freedMB} MB，共 ${report.processes} 个进程）${report.error ? `；${report.error}` : ''}`
    )
    return report
  })
  ipcMain.handle(IPC.sysSystemLogChannels, () => systemLogChannels())
  ipcMain.handle(IPC.sysSystemLog, async (_e, channel: string, pn?: number, ps?: number) =>
    readSystemLog(channel, pn ?? 1, ps ?? 50)
  )
}

function freeDiskMB(dir: string): number {
  try {
    const root = path.parse(dir).root
    const stats = fs.statfsSync(root)
    return (stats.bavail * stats.bsize) / 1024 / 1024
  } catch {
    return -1
  }
}
