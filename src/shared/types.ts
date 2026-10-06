/**
 * 共享类型契约（shared/types.ts）
 * 依据设计文档 05/06/07/08/10 的接口契约定义。
 * 两端（Electron 主进程 / 渲染进程）共享，禁止在契约中引入平台实现。
 */

// ---------- 下载 ----------

export type TaskState =
  | 'pending'
  | 'resolving'
  | 'downloading'
  | 'merging'
  | 'distributing'
  | 'completed'
  | 'failed'
  | 'paused'
  | 'cancelled'

export type ContentType = 'audio' | 'video' | 'both'

export type QualityLevel = 360 | 480 | 720 | 1080

export type DistributionMode = 'copyAfter' | 'parallel'

export type InputKind = 'single' | 'batch' | 'favorite' | 'collection' | 'list' | 'custom'

export interface DownloadInput {
  source: string
  kind: InputKind
  /** 登录态 cookie（用于下载私密收藏夹等需要登录的资源） */
  cookie?: string
}

export interface DownloadOptions {
  content: ContentType
  quality?: QualityLevel
  fullDownload?: boolean
  destinations?: string[]
  distribution?: DistributionMode
  renameTemplate?: string
  convertTo?: string
  rateLimit?: string
  proxy?: string
}

export interface TaskSnapshot {
  id: string
  state: TaskState
  progress: number
  input: DownloadInput
  title?: string
  uploader?: string
  outputPaths: string[]
  size?: number
  error?: string
  createdAt: number
  finishedAt?: number
  speed?: string
  eta?: number
  // 供 UI 展示的扩展信息
  detail?: string
}

export interface CollectionInfo {
  id: string
  name: string
  count: number
  owner?: string
}

export interface EnqueueResult {
  taskIds: string[]
  /** 需要用户确认的合集信息（C3） */
  collectionPrompt?: CollectionInfo
}

export interface TaskHistoryItem {
  id: string
  input: DownloadInput
  options: DownloadOptions
  title?: string
  state: TaskState
  outputPaths: string[]
  size?: number
  createdAt: number
  finishedAt?: number
  error?: string
}

// ---------- B站收藏夹 / 登录 ----------

export interface FavoriteVideo {
  bvid: string
  title: string
  uploader: string
  duration: number
  cover?: string
  url: string
}

export interface FavoriteInfo {
  id: string
  name: string
  owner?: string
  isPublic: boolean
  videoCount: number
  /** 可直接解析/下载的收藏夹地址（登录态下由服务端下发，含真实 mid） */
  url?: string
}

export interface AuthStatus {
  loggedIn: boolean
  username?: string
  mid?: number
  method?: 'api' | 'ssid' | 'cookie'
}

export interface AuthLoginResult {
  ok: boolean
  error?: string
  status?: AuthStatus
}

// ---------- 视频列表 / 本地库 ----------

export interface MediaItem {
  id: string
  path: string
  title: string
  duration?: number
  size?: number
}

export interface VideoList {
  id: string
  name: string
  rootPath?: string
  items: MediaItem[]
  createdAt: number
  updatedAt: number
}

// ---------- 播放器 ----------

export type PlayMode = 'audio' | 'video' | 'both'

/** 媒体编码信息（ffmpeg 探测结果） */
export interface MediaCodecInfo {
  container?: string
  videoCodec?: string
  audioCodec?: string
  duration?: number
  width?: number
  height?: number
}

/** 转码目标（播放器兼容播放 / 下载产物归一） */
export interface TranscodeTarget {
  container: string
  videoCodec?: string
  audioCodec?: string
  /** true 时仅换容器不重编码（流拷贝） */
  copy?: boolean
}

export interface MediaRef {
  path?: string
  source?: string
  hasDanmaku: boolean
  hasComments: boolean
  title?: string
  uploader?: string
  duration?: number
  /** 编码探测结果 */
  codec?: MediaCodecInfo
  /** 内置播放器（Chromium）能否直接解码 */
  playable?: boolean
  /** 不可直接播放时的原因说明 */
  playableReason?: string
  /** 建议的兼容转码目标 */
  compatTarget?: TranscodeTarget
}

export interface PlaybackProgress {
  path: string
  position: number
  duration: number
  updatedAt: number
}

export interface DanmakuItem {
  time: number
  mode: number
  color: string
  text: string
}

export interface CommentItem {
  user: string
  content: string
  time: number
  /** 评论 id（用于去重/定位） */
  rpid?: string
  /** 楼中楼回复数（0 表示无回复） */
  replyCount?: number
  /** 点赞数 */
  like?: number
  /**
   * 楼中楼内容（二级 / n 级回复）。
   * 本地伴生文件在读取时就按 parent/root 归位到这里，与一级评论一起展示；
   * 在线评论按需拉取后填入。
   */
  subReplies?: CommentItem[]
  /** 是否还有更多楼中楼未加载（在线分页用） */
  subHasMore?: boolean
}

/** 评论分页结果（在线走游标、本地走下标，统一成同一形状） */
export interface CommentPage {
  ok: boolean
  /** 仅当前页的评论（其余不驻留内存） */
  items: CommentItem[]
  /** 总条数 */
  total: number
  /** 下一页游标（在线接口用；空字符串表示没有下一页） */
  nextOffset: string
  /** 是否还有下一页 */
  hasMore: boolean
  error?: string
}

// ---------- 设置 ----------

export type ThemeMode = 'light' | 'dark' | 'system'

/** 下载目录组织模式：同目录 / 作者隔离 / 自定义目录模板 */
export type FolderMode = 'flat' | 'uploader' | 'custom'

/** 音频编码格式（ffmpeg 自动转换） */
export type AudioCodec = 'none' | 'mp3' | 'flac' | 'wav' | 'aac' | 'm4a' | 'opus'

/**
 * 视频编码封装（容器 + 目标编码）：
 * - mp4  → H.264(avc1) + AAC
 * - mkv  → 保持源编码，仅换 MKV 容器（不重编码）
 * - webm → VP9 + Opus
 * - mov  → H.264 + AAC（MOV 容器）
 * - av1  → AV1 视频（内置播放器可直接解码；内置 ffmpeg 带 libaom-av1 可重编码）
 * - hevc → H.265 / HEVC（内置 ffmpeg 带 libx265；Chromium 不能直接解码，建议配合系统播放器）
 * - none → 完全保持源格式
 */
export type VideoCodec = 'none' | 'mp4' | 'mkv' | 'webm' | 'mov' | 'av1' | 'hevc'

/** 播放器兼容模式：auto=遇到不可解码编码自动转码播放；manual=仅手动触发 */
export type PlayerCompatMode = 'auto' | 'manual'

export interface Settings {
  // 下载
  content: ContentType
  quality: QualityLevel
  fullDownload: boolean
  destinations: string[]
  distribution: DistributionMode
  copyVsMove: 'copy' | 'move'
  concurrent: number
  rateLimit: string
  renameTemplate: string
  // 下载格式/目录组织
  folderMode: FolderMode
  customFolderTemplate: string
  // 编码设置（FFmpeg 自动转换）
  audioCodec: AudioCodec
  videoCodec: VideoCodec
  /** 源编码与目标容器/编码不符时，自动重编码兜底（保证「选了 mp4 就一定是 H.264」） */
  codecFallback: boolean
  // 播放器
  playerCompatMode: PlayerCompatMode
  /** 内置播放器无法解码时，是否允许调用系统解码器/系统播放器兜底 */
  playerSystemFallback: boolean
  /** 探索页每页条数（默认 4×4 = 16） */
  explorePageSize: number
  /** 首页「任务队列」每页条数（默认 10） */
  queuePageSize: number
  /** 首页「下载历史」每页条数（默认 10） */
  downloadHistoryPageSize: number
  /** 个人页「历史记录」每页条数（默认 10） */
  historyPageSize: number
  /** 歌词逐字染色动画（卡拉OK 式，默认开启；低资源模式会强制关闭） */
  lyricKaraoke: boolean

  // ---------- 播放器 · 音乐 ----------

  /**
   * 声音平衡（响度归一化，ReplayGain 式）。
   * 播放前用 FFmpeg 测量该文件的整体响度（EBU R128 积分响度），
   * 再按「目标响度」压低偏响的文件 —— 同一批内容即使来自不同编码 /
   * 不同来源，音量也会接近，避免忽大忽小。
   *
   * 说明：只做「压低」（浏览器音量上限为 1.0，无法放大），
   * 因此以偏响的音乐为基准向下对齐，不会引入削波失真。
   */
  audioBalance: boolean
  /** 目标响度（LUFS，越负越小）。-16 为主流流媒体标准，-18 更接近 ReplayGain 2.0 */
  audioBalanceTarget: number
  /** 最大衰减量（dB），避免把本来就轻的内容压得过小 */
  audioBalanceMaxCut: number

  // ---------- 评论 ----------

  /** 评论列表每页显示条数（1-100，默认 50） */
  commentPageSize: number
  /** 评论排序：热度优先 / 时间最新 */
  commentSort: CommentSort
  /** 楼中楼（二级 / n 级回复）每次加载条数（1-100，默认 5） */
  commentSubPageSize: number
  /** 预览 / 全量下载时预抓取并写入伴生文件的评论条数上限（1-1145，默认 50） */
  commentFetchLimit: number
  /**
   * 是否允许 yt-dlp 使用操作系统代理（默认 false）。
   * 关闭时对 yt-dlp 显式传 `--proxy ""` 强制直连 —— 避免 Steam++/Watt Toolkit
   * 等加速器写入的系统代理劫持请求，导致 SSL 证书校验失败、所有下载失败。
   * 需要走系统代理（如全局 VPN）时打开此项，或直接在「代理」里填地址。
   */
  useSystemProxy: boolean
  /** 自动搜索系统解码资源（环境变量 / 注册表 / 常见安装目录） */
  autoDetectCodec: boolean
  /** 手动指定优先使用的系统播放器（空 = 自动选择） */
  externalPlayerPath: string
  /** 手动指定外部 ffmpeg（空 = 自动探测；用于不支持编码的重编码兜底） */
  externalFfmpegPath: string
  /** 播放循环模式 */
  loopMode: LoopMode
  /** 下载完成后自动开始下一个（列表连播） */
  autoPlayNext: boolean
  /**
   * 后台播放：软件未被关闭时（窗口最小化到托盘 / 切到别的页面 / 失去焦点）继续播放。
   * 关闭后，窗口不在前台即暂停播放。
   */
  backgroundPlayEnabled: boolean
  /**
   * 后台省资源：窗口不在前台时「只留声音、不加载视频」。
   * 探索页的直链是音视频分流，会直接卸载视频流；本地/混流文件则暂停画面、用伴生音频元素续播。
   */
  backgroundAudioOnly: boolean
  // 下载稳定性 / 提速
  /** 无进度超时（秒）：超过判定卡死并重启任务 */
  stallTimeoutSec: number
  /** 单任务重启上限，超出判失败 */
  maxRestarts: number
  /** 分片并发数（yt-dlp --concurrent-fragments），提升下载速度 */
  concurrentFragments: number
  // 合集识别（C3）
  collectionPrompt: boolean
  collectionDefault: 'ask' | 'yes' | 'no'
  // 登录（C6）
  autoLogin: boolean
  // 窗口（D）
  autoStart: boolean
  // 主题（E）
  themeMode: ThemeMode
  themeColor: string
  // 资源（13）
  lowResourceMode: boolean
  hardwareAcceleration: boolean
  cacheLimitMB: number
  /** 定时自动清理（默认开启） */
  autoCleanEnabled: boolean
  /** 自动清理周期（天，默认 120） */
  autoCleanDays: number
  /** 清理范围：播放历史 / 下载日志 / 程序日志 */
  cleanPlayHistory: boolean
  cleanDownloadLogs: boolean
  cleanAppLogs: boolean
  // 通知
  notifyOnComplete: boolean
  // 网络（补充）
  proxy: string
  userAgent: string
  friendlyThrottle: boolean
  // 数据（14）
  privacyMode: boolean
}

export interface AppInfo {
  /** 软件版本（package.json version，语义化版本） */
  version: string
  /** 补丁版本（构建号 / 热修级别，见 main/utils/build-info.ts） */
  patchVersion: string
  buildDate: string
  platform: string
  arch: string
  isWindows: boolean
  electronVersion: string
  nodeVersion: string
  chromeVersion: string
  /** 检测到的系统名称（如 Windows 11） */
  osName: string
  /** 检测到的系统版本（如 10.0.26100） */
  osVersion: string
  userDataPath: string
  cacheSizeMB: number
  diskFreeMB: number
}

// ---------- 下载前解析预览 ----------

export interface PreviewItem {
  id: string
  /** 源地址（单视频 / 展开后的视频链接） */
  source: string
  kind: InputKind
  title?: string
  uploader?: string
  thumbnail?: string
  duration?: number
  /** 按当前画质/内容模式估算的字节数 */
  size?: number
  /** 是否为合集/收藏夹展开出来的条目 */
  parentTitle?: string
  error?: string
}

export interface PreviewResult {
  items: PreviewItem[]
  errors: Array<{ source: string; error: string }>
}

// ---------- 播放列表 ----------

/** 播放循环模式：列表循环 / 单集循环 / 随机播放 */
export type LoopMode = 'list' | 'single' | 'shuffle'

export interface PlaylistItem {
  id: string
  path: string
  title: string
  /** 来源列表名（视频列表 / 下载历史 等） */
  from?: string
  /** 外部媒体：在线地址（探索页预览等） */
  source?: string
  /** 外部媒体的标题/作者/封面 */
  cover?: string
  uploader?: string
  /** 探索页条目：用于加载在线弹幕/评论/点赞 */
  bvid?: string
  aid?: number
  cid?: number
}

/** LRC 歌词行 */
export interface LyricLine {
  time: number
  text: string
}

/** 评论排序方式 */
export type CommentSort = 'hot' | 'time'

/** 在线歌词搜索结果项（供用户挑选） */
export interface LyricSearchItem {
  /** 曲目 id（拉取歌词用） */
  id: number
  title: string
  artist: string
  album: string
  /** 时长（秒） */
  duration: number
}

/** .cop 音频包元信息（meta.json） */
export interface CopMeta {
  format: 'vd-cop'
  version: 1
  title: string
  artist?: string
  album?: string
  /** 音频条目在包内的文件名 */
  audio: string
  /** 歌词条目（可选） */
  lyric?: string
  createdAt: number
}

// ---------- 探索（B站分区浏览） ----------

export interface ExploreCategory {
  /** 分区 id（B站 rid） */
  rid: number
  name: string
  /** 首页/热门等特殊入口 */
  kind: 'recommend' | 'region'
}

export interface ExploreVideo {
  bvid: string
  aid: number
  cid?: number
  title: string
  uploader: string
  /** UP 主 mid */
  mid?: number
  cover?: string
  duration?: number
  /** 播放量 */
  play?: number
  /** 弹幕数 */
  danmaku?: number
  like?: number
  pubdate?: number
  /** 是否为广告（保留） */
  isAd?: boolean
}

export interface ExploreResult {
  videos: ExploreVideo[]
  hasMore: boolean
  /** 当前页码（从 1 开始） */
  page?: number
  /** 每页条数 */
  pageSize?: number
  /** 总页数（接口返回时提供） */
  totalPages?: number
  /** 总条数 */
  total?: number
}

/** 分页的搜索结果（关键字 / BV 号） */
export interface SearchResult extends ExploreResult {
  keyword: string
  /** 'video' = 关键字搜索；'bvid' = BV/AV 号直查 */
  mode: 'video' | 'bvid'
}

// ---------- 用户 ----------

export interface UserProfile {
  mid: number
  name: string
  /** 头像地址（走 vdimg 代理） */
  face?: string
  level?: number
  coins?: number
  following?: number
  follower?: number
  /** 是否已给当前视频点赞 */
  sign?: string
  vipType?: number
}

/** 在线视频的互动状态（点赞/投币/收藏） */
export interface VideoInteraction {
  like: boolean
  coin?: number
  favorite?: boolean
}

// ---------- 播放历史（个人页「历史记录」/ 快捷入口） ----------

export interface WatchHistoryItem {
  id: string
  /** 媒体文件路径（本地）；在线预览则为探索页缓存文件路径 */
  path: string
  title: string
  uploader?: string
  cover?: string
  /** 上次播放位置（秒） */
  position: number
  duration: number
  /** 最近观看时间（ms） */
  watchedAt: number
  /** 来源：本地文件 / 视频列表 / 探索预览 / 下载 */
  from?: string
  /** 累计观看次数 */
  plays?: number
  /** 文件是否仍存在于磁盘（读取列表时由主进程补充） */
  exists?: boolean
}

// ---------- 系统解码资源探测 ----------

export type CodecResourceKind = 'player' | 'ffmpeg' | 'codec-pack'

export interface CodecResource {
  id: string
  name: string
  path: string
  kind: CodecResourceKind
  /** 发现来源：路径搜索 / 环境变量 / 注册表 / 常见目录 / 手动指定 */
  source: string
}

export interface CodecResourceReport {
  players: CodecResource[]
  ffmpegs: CodecResource[]
  codecPacks: CodecResource[]
  /** 探测完成时间 */
  detectedAt: number
  /** 本次探测扫描的位置（供 UI 展示透明度） */
  scanned: string[]
}

// ---------- 日志 ----------

export type LogKind = 'download' | 'app'

export type LogLevel = 'info' | 'warn' | 'error' | 'success'

export interface LogEntry {
  id: string
  /** 时间戳（ms） */
  time: number
  level: LogLevel
  /** 所属模块/来源，如「任务」「编码」「插件」 */
  scope: string
  message: string
}

export interface LogPage {
  entries: LogEntry[]
  /** 文件总行数（用于「显示最近 N 条」提示） */
  total: number
}

export interface PluginManifest {
  id: string
  name: string
  version: string
  description?: string
  author?: string
  homepage?: string
  matchPatterns: string[]
  capabilities: string[]
  entry: string
  minAppVersion?: string
}

export interface PluginInfo {
  manifest: PluginManifest
  installedAt: number
  trust: 'official' | 'trusted' | 'unsigned'
  /** 是否启用（禁用后不参与匹配） */
  enabled: boolean
  /** 内置插件不可卸载 */
  builtin: boolean
  /** 插件所在目录（内置为空） */
  dir?: string
  /** 加载失败原因 */
  error?: string
}
