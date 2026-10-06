/**
 * 设置服务（main/services/settings-service.ts）
 * 依据 11-UI 主题、10-数据存储、13-资源优化 的默认值约定。
 */
import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { Settings, ThemeMode, FolderMode, AudioCodec, VideoCodec } from '../../shared/types'
import { DEFAULT_NAMING_TEMPLATE } from '../../shared/template'
import { userDataDir } from '../utils/paths'

const DEFAULT_FOLDER_MODE: FolderMode = 'flat' // 同目录为新默认
const DEFAULT_AUDIO_CODEC: AudioCodec = 'mp3'
const DEFAULT_VIDEO_CODEC: VideoCodec = 'mp4'

export const DEFAULT_SETTINGS: Settings = {
  // 下载（06）
  content: 'both',
  quality: 1080,
  fullDownload: false,
  destinations: [],
  distribution: 'copyAfter',
  copyVsMove: 'copy',
  concurrent: 3,
  rateLimit: '',
  // 默认：视频标题_作者_发布时间_分P(如果有).格式后缀
  renameTemplate: DEFAULT_NAMING_TEMPLATE,
  // 下载格式/目录组织
  folderMode: DEFAULT_FOLDER_MODE,
  // 目录模板（不含文件名；文件名由 renameTemplate 决定）
  customFolderTemplate: '{uploader}',
  // 编码设置
  audioCodec: DEFAULT_AUDIO_CODEC,
  videoCodec: DEFAULT_VIDEO_CODEC,
  codecFallback: true,
  playerCompatMode: 'auto',
  playerSystemFallback: true,
  autoDetectCodec: true,
  explorePageSize: 16, // 默认 4×4
  queuePageSize: 10,
  downloadHistoryPageSize: 10,
  historyPageSize: 10,
  lyricKaraoke: true,
  // 播放器 · 音乐：声音平衡（默认关闭，避免影响未开启用户的听感）
  audioBalance: false,
  audioBalanceTarget: -16,
  audioBalanceMaxCut: 12,
  // 评论
  commentPageSize: 50,
  commentSort: 'hot',
  commentSubPageSize: 5,
  commentFetchLimit: 50,
  // 默认不使用系统代理：避免加速器/ VPN 写入的系统代理劫持 yt-dlp 导致 SSL 校验失败
  useSystemProxy: false,

  externalPlayerPath: '',
  externalFfmpegPath: '',
  loopMode: 'list',
  autoPlayNext: true,
  backgroundPlayEnabled: true,
  backgroundAudioOnly: true,
  // 下载稳定性 / 提速
  stallTimeoutSec: 180, // 默认 3 分钟无进度即判定卡死
  maxRestarts: 2, // 默认重启上限 2 次
  concurrentFragments: 4, // 分片并发，显著提升 DASH 下载速度
  // 合集识别（C3）
  collectionPrompt: true,
  collectionDefault: 'ask',
  // 登录（C6）
  autoLogin: true,
  // 窗口（D1）
  autoStart: false,
  // 主题（E1/E2/E3）：默认淡蓝
  themeMode: 'system',
  themeColor: '#64B5F6',
  // 资源（13）
  lowResourceMode: false,
  hardwareAcceleration: true,
  cacheLimitMB: 1024,
  // 定时清理（默认开启，保留 120 天）
  autoCleanEnabled: true,
  autoCleanDays: 120,
  cleanPlayHistory: true,
  cleanDownloadLogs: true,
  cleanAppLogs: true,
  // 通知
  notifyOnComplete: true,
  // 网络（补充）
  proxy: '',
  userAgent: '',
  friendlyThrottle: true,
  // 数据（14）
  privacyMode: false
}

export class SettingsService {
  private settings: Settings
  private readonly filePath: string

  constructor() {
    this.filePath = path.join(userDataDir(), 'settings.json')
    this.settings = this.load()
    // 默认下载目标：用户下载目录
    if (!this.settings.destinations || this.settings.destinations.length === 0) {
      const dl = path.join(os.homedir(), 'Downloads')
      this.settings.destinations = [dl]
      this.persist()
    }
  }

  private load(): Settings {
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = JSON.parse(fs.readFileSync(this.filePath, 'utf-8')) as Partial<Settings>
        return { ...DEFAULT_SETTINGS, ...raw }
      }
    } catch (e) {
      console.error('[settings] 读取失败，使用默认:', e)
    }
    return { ...DEFAULT_SETTINGS }
  }

  get(): Settings {
    return { ...this.settings, destinations: [...this.settings.destinations] }
  }

  getRaw(): Settings {
    return this.settings
  }

  set(patch: Partial<Settings>): Settings {
    this.settings = { ...this.settings, ...patch }
    this.applySideEffects()
    this.persist()
    return this.get()
  }

  /** 与设置联动的系统行为（自启/主题/硬解） */
  private applySideEffects(): void {
    this.applyAutoStart()
  }

  private applyAutoStart(): void {
    try {
      if (this.settings.autoStart) {
        app.setLoginItemSettings({ openAtLogin: true })
      } else {
        app.setLoginItemSettings({ openAtLogin: false })
      }
    } catch (e) {
      console.error('[settings] 设置开机自启失败:', e)
    }
  }

  private persist(): void {
    try {
      const tmp = this.filePath + '.tmp'
      fs.writeFileSync(tmp, JSON.stringify(this.settings, null, 2), 'utf-8')
      fs.renameSync(tmp, this.filePath)
    } catch (e) {
      console.error('[settings] 保存失败:', e)
    }
  }

  /** 导出设置（不含敏感凭据，14） */
  export(): string {
    return JSON.stringify(this.settings, null, 2)
  }

  /** 导入设置（仅合法键） */
  import(raw: string): { ok: boolean; error?: string } {
    try {
      const parsed = JSON.parse(raw) as Partial<Settings>
      const keys = Object.keys(DEFAULT_SETTINGS) as Array<keyof Settings>
      const patch: Partial<Settings> = {}
      for (const k of keys) {
        if (parsed[k] !== undefined) patch[k] = parsed[k] as never
      }
      this.set(patch)
      return { ok: true }
    } catch (e) {
      return { ok: false, error: String(e) }
    }
  }

  /** 主题模式解析（跟随系统） */
  resolveThemeMode(): ThemeMode {
    return this.settings.themeMode
  }

  themeShouldBeDark(): boolean {
    if (this.settings.themeMode === 'dark') return true
    if (this.settings.themeMode === 'light') return false
    return nativeThemeIsDark()
  }
}

function nativeThemeIsDark(): boolean {
  try {
    // 延迟 require 避免循环依赖
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require('electron').nativeTheme.shouldUseDarkColors
  } catch {
    return false
  }
}
