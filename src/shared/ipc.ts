/**
 * IPC 通道白名单（shared/ipc.ts）
 * 渲染进程只能通过 preload 暴露的白名单通道与主进程通信（见 14-安全隐私与合规.md）。
 */

export const IPC = {
  // ---------- 设置 ----------
  settingsGet: 'settings:get',
  settingsSet: 'settings:set',
  settingsExport: 'settings:export',
  settingsImport: 'settings:import',

  // ---------- 下载 ----------
  downloadEnqueue: 'download:enqueue',
  downloadPause: 'download:pause',
  downloadResume: 'download:resume',
  downloadCancel: 'download:cancel',
  downloadRetry: 'download:retry',
  downloadGet: 'download:get',
  downloadList: 'download:list',
  downloadHistory: 'download:history',
  downloadClearHistory: 'download:clearHistory',
  downloadQueueMove: 'download:queueMove',
  downloadQueueClear: 'download:queueClear',
  /** 清空队列中已结束（完成/失败/取消）的任务 —— 首页「清空历史」 */
  downloadQueueClearFinished: 'download:queueClearFinished',
  downloadRequeue: 'download:requeue',
  downloadConfirmCollection: 'download:confirmCollection',
  downloadPreview: 'download:preview',
  fileReadText: 'file:readText',

  // ---------- 文件对话框 ----------
  dialogOpenFile: 'dialog:openFile',
  dialogOpenDirectory: 'dialog:openDirectory',
  dialogPickDownloadDir: 'dialog:pickDownloadDir',
  dialogSaveFile: 'dialog:saveFile',
  shellOpenExternal: 'shell:openExternal',
  shellOpenPath: 'shell:openPath',

  // ---------- 视频列表 / 本地库 ----------
  libraryList: 'library:list',
  libraryCreate: 'library:create',
  libraryImportFolder: 'library:importFolder',
  libraryImportFiles: 'library:importFiles',
  libraryDelete: 'library:delete',
  libraryScan: 'library:scan',
  libraryRename: 'library:rename',
  libraryRemoveItem: 'library:removeItem',

  // ---------- 播放器 ----------
  playerOpen: 'player:open',
  playerSaveProgress: 'player:saveProgress',
  playerGetProgress: 'player:getProgress',
  playerGetComments: 'player:getComments',
  /** 本地伴生评论分页（只返回当前页） */
  playerGetCommentsPage: 'player:getCommentsPage',
  playerGetDanmaku: 'player:getDanmaku',
  playerProbe: 'player:probe',
  playerTranscode: 'player:transcode',
  playerCancelTranscode: 'player:cancelTranscode',
  playerDetectCodec: 'player:detectCodec',
  playerOpenExternal: 'player:openExternal',
  playerOpenAuto: 'player:openAuto',
  playerPickExternal: 'player:pickExternal',
  playerHistory: 'player:history',
  playerHistoryClear: 'player:historyClear',
  playerHistoryRemove: 'player:historyRemove',

  // ---------- B站收藏夹 / 登录 ----------
  favoriteResolve: 'favorite:resolve',
  favoriteDownload: 'favorite:download',
  favoriteGetMine: 'favorite:getMine',
  authStatus: 'auth:status',
  authLoginCookie: 'auth:loginCookie',
  authQuickLogin: 'auth:quickLogin',
  authOpenBrowserLogin: 'auth:openBrowserLogin',
  authLogout: 'auth:logout',
  authRefresh: 'auth:refresh',

  // ---------- 日志 ----------
  logsPage: 'logs:page',
  logsClear: 'logs:clear',
  logsOpenDir: 'logs:openDir',

  // ---------- 插件 ----------
  pluginList: 'plugin:list',
  pluginInstallDir: 'plugin:installDir',
  pluginUninstall: 'plugin:uninstall',
  pluginSetEnabled: 'plugin:setEnabled',
  pluginReload: 'plugin:reload',
  pluginOpenDir: 'plugin:openDir',

  // ---------- 探索（B站分区浏览） ----------
  exploreCategories: 'explore:categories',
  exploreFeed: 'explore:feed',
  explorePreview: 'explore:preview',
  exploreStream: 'explore:stream',
  exploreSide: 'explore:side',
  exploreSearch: 'explore:search',
  favCollected: 'fav:collected',
  favDeal: 'fav:deal',
  favCreate: 'fav:create',
  /** 评论分页（游标） */
  exploreComments: 'explore:comments',
  /** 楼中楼（二级/n级回复） */
  exploreSubReplies: 'explore:subReplies',
  exploreInteraction: 'explore:interaction',
  exploreLike: 'explore:like',

  // ---------- 用户 ----------
  userProfile: 'user:profile',

  // ---------- 歌词 / .cop 音频包 ----------
  lyricParse: 'lyric:parse',
  copExport: 'cop:export',
  copImport: 'cop:import',
  mediaOpenSystem: 'media:openSystem',
  lyricSave: 'lyric:save',
  lyricLoad: 'lyric:load',
  /** 在线搜索歌词（关键词 → 候选列表） */
  lyricSearch: 'lyric:search',
  /** 拉取指定曲目的 LRC */
  lyricFetch: 'lyric:fetch',

  // ---------- 系统 ----------
  sysInfo: 'sys:info',
  sysOpenPath: 'sys:openPath',
  sysShowInFolder: 'sys:showInFolder',
  sysCleanCache: 'sys:cleanCache',
  sysGetCacheSize: 'sys:getCacheSize',
  sysMinimizeToTray: 'sys:minimizeToTray',
  sysOpenSettingsFile: 'sys:openSettingsFile',
  sysCleanNow: 'sys:cleanNow',
  /** 内存优化（回收工作集 + 清理代码缓存） */
  sysOptimizeMemory: 'sys:optimizeMemory',
  /** 当前内存占用 */
  sysMemory: 'sys:memory',
  /** 系统日志（Windows 事件日志 / 分类分页读取） */
  sysSystemLog: 'sys:systemLog',
  /** 可用的系统日志分类 */
  sysSystemLogChannels: 'sys:systemLogChannels',

  // ---------- 主进程 → 渲染进程事件 ----------
  evtTaskUpdate: 'evt:taskUpdate',
  evtAuthChange: 'evt:authChange',
  evtNotify: 'evt:notify',
  evtFavVideoUpdate: 'evt:favVideoUpdate',
  evtTranscodeProgress: 'evt:transcodeProgress',
  evtExploreProgress: 'evt:exploreProgress'
} as const

export type IpcChannel = (typeof IPC)[keyof typeof IPC]
