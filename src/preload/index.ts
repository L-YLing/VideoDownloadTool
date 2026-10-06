/**
 * 预加载脚本（preload/index.ts）
 * contextBridge 白名单暴露（14：仅暴露必需 API）。
 */
import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '../shared/ipc'
import type { DownloadInput, DownloadOptions, Settings, TaskSnapshot } from '../shared/types'

/**
 * 把参数转成「可结构化克隆」的纯数据。
 *
 * 为什么必须做：渲染进程里从 `ref`/`reactive` 取出对象时拿到的是 Vue 的 Proxy，
 * 而 Electron IPC 使用结构化克隆 —— Proxy 无法克隆，会抛出
 * 「An object could not be cloned.」。表现为：只传字符串的调用（如点赞）正常，
 * 一旦传对象（如点击卡片预览、批量下载、保存带元信息的进度）就「点击后毫无反应」。
 * 这里统一做一次 JSON 深拷贝，彻底消除该类问题。
 */
function plain<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value
  try {
    return JSON.parse(JSON.stringify(value)) as T
  } catch {
    return value
  }
}

/** 统一的 IPC 调用入口：自动净土参数后再走底层 ipcRenderer.invoke */
function invoke<T = unknown>(channel: string, ...args: unknown[]): Promise<T> {
  return ipcRenderer.invoke(channel, ...args.map((a) => plain(a))) as Promise<T>
}

const api = {
  // 设置
  getSettings: (): Promise<Settings> => invoke(IPC.settingsGet),
  setSettings: (patch: Partial<Settings>): Promise<Settings> => invoke(IPC.settingsSet, patch),
  exportSettings: (): Promise<string> => invoke(IPC.settingsExport),
  importSettings: (raw: string): Promise<{ ok: boolean; error?: string }> =>
    invoke(IPC.settingsImport, raw),

  // 下载
  enqueue: (inputs: DownloadInput[], options: DownloadOptions): Promise<any> =>
    invoke(IPC.downloadEnqueue, inputs, options),
  pause: (id: string): Promise<void> => invoke(IPC.downloadPause, id),
  resume: (id: string): Promise<void> => invoke(IPC.downloadResume, id),
  cancel: (id: string): Promise<void> => invoke(IPC.downloadCancel, id),
  retry: (id: string): Promise<void> => invoke(IPC.downloadRetry, id),
  getTask: (id: string): Promise<TaskSnapshot | null> => invoke(IPC.downloadGet, id),
  listTasks: (): Promise<TaskSnapshot[]> => invoke(IPC.downloadList),
  listHistory: (): Promise<TaskSnapshot[]> => invoke(IPC.downloadHistory),
  clearHistory: (): Promise<void> => invoke(IPC.downloadClearHistory),
  queueMove: (id: string, dir: 'up' | 'down'): Promise<void> => invoke(IPC.downloadQueueMove, id, dir),
  queueClear: (): Promise<void> => invoke(IPC.downloadQueueClear),
  /** 清空队列中已结束的任务；返回清空后的队列 */
  queueClearFinished: (): Promise<TaskSnapshot[]> => invoke(IPC.downloadQueueClearFinished),
  requeue: (id: string): Promise<void> => invoke(IPC.downloadRequeue, id),
  confirmCollection: (includeAll: boolean): Promise<{ taskIds: string[] }> =>
    invoke(IPC.downloadConfirmCollection, includeAll),
  previewSources: (inputs: DownloadInput[], options: DownloadOptions): Promise<any> =>
    invoke(IPC.downloadPreview, inputs, options),
  readTextFile: (file: string): Promise<string | { error: string }> => invoke(IPC.fileReadText, file),

  // 对话框
  openFile: (opts?: { filters?: Electron.FileFilter[] }): Promise<string[]> =>
    invoke(IPC.dialogOpenFile, opts),
  openDirectory: (): Promise<string | null> => invoke(IPC.dialogOpenDirectory),
  openExternal: (url: string): Promise<void> => invoke(IPC.shellOpenExternal, url),
  pickDownloadDir: (): Promise<string | null> => invoke(IPC.dialogPickDownloadDir),
  saveFile: (opts?: { defaultPath?: string; filters?: Electron.FileFilter[] }): Promise<string | null> =>
    invoke(IPC.dialogSaveFile, opts),

  // 视频列表
  listLists: (): Promise<any[]> => invoke(IPC.libraryList),
  createList: (name: string): Promise<any> => invoke(IPC.libraryCreate, name),
  deleteList: (id: string): Promise<void> => invoke(IPC.libraryDelete, id),
  importFolderToList: (id: string, folder: string): Promise<any | null> =>
    invoke(IPC.libraryImportFolder, id, folder),
  importFilesToList: (id: string, files: string[]): Promise<any | null> =>
    invoke(IPC.libraryImportFiles, id, files),
  scanList: (id: string): Promise<any | null> => invoke(IPC.libraryScan, id),
  renameList: (id: string, name: string): Promise<any | null> => invoke(IPC.libraryRename, id, name),
  removeListItem: (id: string, itemId: string): Promise<any | null> =>
    invoke(IPC.libraryRemoveItem, id, itemId),

  // 播放器
  openMedia: (pathOrUrl: string): Promise<any> => invoke(IPC.playerOpen, pathOrUrl),
  saveProgress: (
    p: string,
    pos: number,
    dur: number,
    meta?: { title?: string; uploader?: string; cover?: string; from?: string }
  ): Promise<void> => invoke(IPC.playerSaveProgress, p, pos, dur, meta),
  getProgress: (p: string): Promise<any | null> => invoke(IPC.playerGetProgress, p),
  getComments: (mediaPath: string): Promise<any[]> => invoke(IPC.playerGetComments, mediaPath),
  /** 本地伴生评论分页（只返回当前页） */
  getCommentsPage: (
    mediaPath: string,
    pn = 1,
    ps = 50
  ): Promise<{ items: any[]; total: number; page: number; pageSize: number; hasMore: boolean }> =>
    invoke(IPC.playerGetCommentsPage, mediaPath, pn, ps),
  getDanmaku: (mediaPath: string): Promise<{ items: any[]; ok: boolean }> =>
    invoke(IPC.playerGetDanmaku, mediaPath),
  probeMedia: (mediaPath: string): Promise<any> => invoke(IPC.playerProbe, mediaPath),
  transcodeForPlayback: (
    mediaPath: string,
    target?: { container: string; videoCodec?: string; audioCodec?: string; copy?: boolean }
  ): Promise<{ ok: boolean; path?: string; error?: string; cached?: boolean }> =>
    invoke(IPC.playerTranscode, mediaPath, target),
  cancelTranscode: (id: string): Promise<boolean> => invoke(IPC.playerCancelTranscode, id),
  // 系统解码资源
  detectCodecResources: (refresh?: boolean, peek?: boolean): Promise<any> =>
    invoke(IPC.playerDetectCodec, refresh, peek),
  openWithExternalPlayer: (
    mediaPath: string,
    preferred?: string,
    position?: number
  ): Promise<{ ok: boolean; player?: string; path?: string; error?: string }> =>
    invoke(IPC.playerOpenExternal, mediaPath, preferred, position),
  openAuto: (
    mediaPath: string,
    preferred?: string,
    position?: number
  ): Promise<{ ok: boolean; player?: string; path?: string; error?: string; fallback: boolean }> =>
    invoke(IPC.playerOpenAuto, mediaPath, preferred, position),
  pickExternalPlayer: (): Promise<string | null> => invoke(IPC.playerPickExternal),
  // 播放历史
  listPlayHistory: (): Promise<any[]> => invoke(IPC.playerHistory),
  clearPlayHistory: (): Promise<any[]> => invoke(IPC.playerHistoryClear),
  removePlayHistory: (id: string): Promise<any[]> => invoke(IPC.playerHistoryRemove, id),

  // 收藏夹 / 登录
  resolveFavorite: (input: string): Promise<any> => invoke(IPC.favoriteResolve, input),
  downloadFavorite: (input: string, opts: DownloadOptions): Promise<{ taskIds: string[] }> =>
    invoke(IPC.favoriteDownload, input, opts),
  getMyFavorites: (): Promise<any> => invoke(IPC.favoriteGetMine),
  getAuthStatus: (): Promise<any> => invoke(IPC.authStatus),
  loginCookie: (cookie: string): Promise<any> => invoke(IPC.authLoginCookie, cookie),
  quickLogin: (): Promise<{ ok: boolean; error?: string }> => invoke(IPC.authQuickLogin),
  openBrowserLogin: (): Promise<boolean> => invoke(IPC.authOpenBrowserLogin),
  logout: (): Promise<void> => invoke(IPC.authLogout),
  refreshAuth: (): Promise<any> => invoke(IPC.authRefresh),

  // 日志
  getLogs: (kind: 'download' | 'app', limit?: number): Promise<any> => invoke(IPC.logsPage, kind, limit),
  clearLogs: (kind: 'download' | 'app'): Promise<boolean> => invoke(IPC.logsClear, kind),
  openLogsDir: (): Promise<string> => invoke(IPC.logsOpenDir),

  // 插件
  listPlugins: (): Promise<any[]> => invoke(IPC.pluginList),
  installPlugin: (dir: string): Promise<{ ok: boolean; error?: string; manifest?: any }> =>
    invoke(IPC.pluginInstallDir, dir),
  uninstallPlugin: (id: string): Promise<{ ok: boolean; error?: string }> =>
    invoke(IPC.pluginUninstall, id),
  setPluginEnabled: (id: string, enabled: boolean): Promise<{ ok: boolean }> =>
    invoke(IPC.pluginSetEnabled, id, enabled),
  reloadPlugins: (): Promise<any[]> => invoke(IPC.pluginReload),
  openPluginsDir: (): Promise<string> => invoke(IPC.pluginOpenDir),

  // 远端封面走主进程代理协议（带 Referer），解决 CDN 拒绝直连
  imgUrl: (url: string): string => `vdimg://img/?u=${encodeURIComponent(url)}`,
  /**
   * 本地媒体 → 可被 <video>/<audio> 加载的受信任协议地址。
   * 直接给 file:// 或 `D:\xx.mp4` 会被同源策略拒绝（表现为播不出来）。
   */
  mediaUrl: (filePath: string): string => `vdmedia://file/?p=${encodeURIComponent(filePath)}`,
  /** 在线视频流 → 经主进程代理（补 Referer，绕开 CDN 防盗链/CORS） */
  streamUrl: (url: string, type: 'v' | 'a' = 'v'): string =>
    `vdstream://s/?u=${encodeURIComponent(url)}&t=${type}`,

  // 探索（B站分区浏览）
  exploreCategories: (): Promise<any[]> => invoke(IPC.exploreCategories),
  exploreFeed: (rid: number, pn?: number, ps?: number): Promise<any> =>
    invoke(IPC.exploreFeed, rid, pn, ps),
  explorePreview: (video: any): Promise<{ ok: boolean; path?: string; error?: string }> =>
    invoke(IPC.explorePreview, video),
  exploreStream: (
    video: any,
    maxHeight?: number
  ): Promise<{ ok: boolean; videoUrl?: string; audioUrl?: string; muxed?: boolean; cid?: number; error?: string }> =>
    invoke(IPC.exploreStream, video, maxHeight),
  exploreSide: (video: any): Promise<{ danmaku: any[]; comments: any[] }> => invoke(IPC.exploreSide, video),
  exploreSearch: (
    keyword: string,
    pn?: number,
    ps?: number
  ): Promise<{
    videos: any[]
    hasMore: boolean
    mode: 'video' | 'bvid'
    page: number
    pageSize: number
    total?: number
    totalPages?: number
    error?: string
  }> => invoke(IPC.exploreSearch, keyword, pn, ps),
  /** 评论分页（游标）：offset 为空表示第一页；返回当前页 items + nextOffset + total */
  exploreComments: (
    aid: number,
    offset = '',
    ps = 50
  ): Promise<{
    ok: boolean
    items: any[]
    nextOffset: string
    total: number
    hasMore: boolean
    error?: string
  }> => invoke(IPC.exploreComments, aid, offset, ps),
  /** 楼中楼（二级/n级回复）：挂在对应一级评论下一起渲染 */
  exploreSubReplies: (
    aid: number,
    root: string,
    pn = 1,
    ps = 10
  ): Promise<{ ok: boolean; items: any[]; hasMore: boolean; total: number; error?: string }> =>
    invoke(IPC.exploreSubReplies, aid, root, pn, ps),
  exploreInteraction: (bvid: string): Promise<any> => invoke(IPC.exploreInteraction, bvid),

  // 收藏（与阿 B 一致：先查已收藏的收藏夹，再增量增删）
  favCollectedFolders: (aid: number): Promise<{ ok: boolean; folderIds?: number[]; error?: string }> =>
    invoke(IPC.favCollected, aid),
  favDeal: (aid: number, addIds: number[], delIds: number[]): Promise<{ ok: boolean; error?: string }> =>
    invoke(IPC.favDeal, aid, addIds, delIds),
  favCreate: (name: string, intro?: string, privacy?: boolean): Promise<{ ok: boolean; id?: number; error?: string }> =>
    invoke(IPC.favCreate, name, intro, privacy),
  exploreLike: (bvid: string, like: boolean): Promise<{ ok: boolean; error?: string }> =>
    invoke(IPC.exploreLike, bvid, like),
  onExploreProgress: (cb: (p: { percent: number; done: boolean; error?: string; path?: string }) => void): (() => void) => {
    const listener = (_e: any, payload: any): void => cb(payload)
    ipcRenderer.on(IPC.evtExploreProgress, listener)
    return () => ipcRenderer.removeListener(IPC.evtExploreProgress, listener)
  },

  // 用户
  getUserProfile: (): Promise<any | null> => invoke(IPC.userProfile),

  // 歌词 / .cop 音频包
  parseLyric: (file: string): Promise<any[]> => invoke(IPC.lyricParse, file),
  saveLyric: (audio: string, lines: any[]): Promise<boolean> => invoke(IPC.lyricSave, audio, lines),
  loadLyric: (audio: string): Promise<any[] | null> => invoke(IPC.lyricLoad, audio),
  /** 在线搜索歌词：关键词 → 候选曲目列表（由用户挑选） */
  searchLyrics: (
    keyword: string,
    limit?: number
  ): Promise<{ ok: boolean; items?: Array<{ id: number; title: string; artist: string; album: string; duration: number }>; error?: string }> =>
    invoke(IPC.lyricSearch, keyword, limit),
  /** 拉取指定曲目的 LRC 并解析为歌词行 */
  fetchLyric: (songId: number): Promise<{ ok: boolean; lines?: any[]; lrc?: string; error?: string }> =>
    invoke(IPC.lyricFetch, songId),
  /** 导出 .cop：lyricLines 为内存歌词（优先于 lyric 磁盘路径），保证歌词一定被打包 */
  exportCop: (audio: string, out: string, meta?: any, lyric?: string, lyricLines?: any[]): Promise<any> =>
    invoke(IPC.copExport, audio, out, meta, lyric, lyricLines),
  importCop: (file: string): Promise<any> => invoke(IPC.copImport, file),
  openWithSystemPlayer: (p: string): Promise<void> => invoke(IPC.mediaOpenSystem, p),

  // 系统
  getSysInfo: (): Promise<any> => invoke(IPC.sysInfo),
  openPath: (p: string): Promise<void> => invoke(IPC.sysOpenPath, p),
  showInFolder: (p: string): Promise<void> => invoke(IPC.sysShowInFolder, p),
  cleanCache: (): Promise<number> => invoke(IPC.sysCleanCache),
  getCacheSize: (): Promise<number> => invoke(IPC.sysGetCacheSize),
  minimizeToTray: (): Promise<boolean> => invoke(IPC.sysMinimizeToTray),
  openSettingsFile: (): Promise<string> => invoke(IPC.sysOpenSettingsFile),
  cleanNow: (): Promise<{ report: any; cacheSizeMB: number }> => invoke(IPC.sysCleanNow),
  /** 当前内存占用（MB） */
  getMemory: (): Promise<{ totalMB: number; processes: number }> => invoke(IPC.sysMemory),
  /** 内存优化：回收工作集 + 清理代码缓存 */
  optimizeMemory: (): Promise<{
    ok: boolean
    beforeMB: number
    afterMB: number
    freedMB: number
    processes: number
    trimmed: boolean
    note?: string
    error?: string
  }> => invoke(IPC.sysOptimizeMemory),
  /** 系统日志分类（程序/下载日志 + Windows 事件日志） */
  systemLogChannels: (): Promise<Array<{ id: string; label: string; source: 'app' | 'system'; needsAdmin?: boolean }>> =>
    invoke(IPC.sysSystemLogChannels),
  /** 读取系统日志某一页（只返回当前页） */
  systemLog: (
    channel: string,
    pn = 1,
    ps = 50
  ): Promise<{
    ok: boolean
    entries: Array<{ id: string; time: number; level: 'success' | 'info' | 'warn' | 'error'; scope: string; message: string }>
    total: number
    page: number
    pageSize: number
    hasMore: boolean
    error?: string
  }> => invoke(IPC.sysSystemLog, channel, pn, ps),

  // 事件订阅
  onTaskUpdate: (cb: (snap: TaskSnapshot) => void): (() => void) => {
    const listener = (_e: Electron.IpcRendererEvent, snap: TaskSnapshot): void => cb(snap)
    ipcRenderer.on(IPC.evtTaskUpdate, listener)
    return () => ipcRenderer.removeListener(IPC.evtTaskUpdate, listener)
  },
  onAuthChange: (cb: (status: any) => void): (() => void) => {
    const listener = (_e: Electron.IpcRendererEvent, status: any): void => cb(status)
    ipcRenderer.on(IPC.evtAuthChange, listener)
    return () => ipcRenderer.removeListener(IPC.evtAuthChange, listener)
  },
  onFavVideoUpdate: (
    cb: (payload: { index: number; total: number; video: any }) => void
  ): (() => void) => {
    const listener = (_e: Electron.IpcRendererEvent, payload: any): void => cb(payload)
    ipcRenderer.on(IPC.evtFavVideoUpdate, listener)
    return () => ipcRenderer.removeListener(IPC.evtFavVideoUpdate, listener)
  },
  onTranscodeProgress: (
    cb: (payload: { id: string; file: string; percent: number; done: boolean; error?: string; output?: string }) => void
  ): (() => void) => {
    const listener = (_e: Electron.IpcRendererEvent, payload: any): void => cb(payload)
    ipcRenderer.on(IPC.evtTranscodeProgress, listener)
    return () => ipcRenderer.removeListener(IPC.evtTranscodeProgress, listener)
  }
}

export type VdApi = typeof api

contextBridge.exposeInMainWorld('vd', api)
