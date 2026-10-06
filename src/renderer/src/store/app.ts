/**
 * 渲染进程全局状态（store/app.ts）
 * 轻量 reactive store（不引入 pinia，低资源友好）。
 */
import { reactive } from 'vue'
import type { AppInfo, LoopMode, MediaCodecInfo, Settings, TaskSnapshot, TranscodeTarget } from '@shared/types'
import { applyBootTheme, applyTheme } from '../theme/theme'

export type ViewId =
  | 'download'
  | 'player'
  | 'favorites'
  | 'library'
  | 'libraryDetail'
  | 'settings'
  | 'explore'
  | 'explorePlayer'
  | 'profile'
  | 'history'
  | 'logs'
  | 'systemLog'

export const store = reactive({
  view: 'download' as ViewId,
  /** 视频列表详情页当前打开的列表 id（进入 libraryDetail 视图时使用） */
  libraryDetailId: '',
  settings: null as Settings | null,
  tasks: [] as TaskSnapshot[],
  history: [] as TaskSnapshot[],
  auth: { loggedIn: false } as { loggedIn: boolean; username?: string; mid?: number; method?: string },
  sysInfo: null as null | AppInfo,
  /** 播放循环模式（与设置同步，方便播放器实时读写） */
  loopMode: 'list' as LoopMode,
  /** 登录请求计数：顶栏头像在未登录时点击 → 递增，个人页监听后自动拉起登录弹窗 */
  loginRequest: 0,
  /**
   * 应用是否处于前台（窗口可见且窗口拥有焦点）。
   * 后台播放策略依赖它：最小化到托盘 / 切到其他程序都算后台。
   */
  foreground: true,
  toasts: [] as Array<{ id: number; text: string; type: 'info' | 'error' | 'success' }>,
  // 播放器状态（MediaRef）
  player: null as null | {
    path?: string
    source?: string
    title?: string
    hasDanmaku?: boolean
    hasComments?: boolean
    duration?: number
    progress?: { position: number; duration: number }
    codec?: MediaCodecInfo
    playable?: boolean
    playableReason?: string
    compatTarget?: TranscodeTarget
  },
  danmakuItems: [] as Array<{ time: number; mode: number; color: string; text: string }>,
  comments: [] as Array<{ user: string; content: string; time: number }>,
  /** 当前媒体的 LRC 歌词（.cop 解包 或 同名 .lrc 伴生） */
  lyrics: [] as Array<{ time: number; text: string }>,
  /** 当前媒体的来源元信息（写入播放历史用） */
  playerMeta: {} as { title?: string; uploader?: string; cover?: string; from?: string },
  /**
   * 用户实际打开的文件路径（可能是 .cop 音频包）。
   * .cop 会解包到缓存目录播放，但「保存歌词 / 再次导出」应落回用户看得见的位置，
   * 而不是缓存目录，因此单独记住这里。
   */
  openedPath: '',
  /** 探索页在线播放上下文（点卡片后进入 ExplorePlayerView） */
  exploreCurrent: null as null | {
    video: {
      bvid: string
      aid: number
      title: string
      uploader: string
      cover?: string
      duration?: number
      play?: number
      danmaku?: number
      isAd?: boolean
    }
    /** 已缓存的本地可播放文件路径（缓存下载模式） */
    path?: string
    /**
     * 在线直链（免下载秒开模式）。
     * B站 为 DASH：videoUrl 为纯视频流、audioUrl 为纯音频流，播放时需双元素同步。
     * muxed=true 表示单条 URL 已含音视频，直接喂给 <video> 即可。
     */
    stream?: { videoUrl: string; audioUrl?: string; muxed?: boolean }
  }
})

let toastId = 0

export function toast(text: string, type: 'info' | 'error' | 'success' = 'info', duration = 3200): void {
  const id = ++toastId
  store.toasts.push({ id, text, type })
  setTimeout(() => {
    const idx = store.toasts.findIndex((t) => t.id === id)
    if (idx >= 0) store.toasts.splice(idx, 1)
  }, duration)
}

let historyTimer: ReturnType<typeof setTimeout> | null = null
function refreshHistory(): void {
  if (historyTimer) clearTimeout(historyTimer)
  historyTimer = setTimeout(async () => {
    store.history = await window.vd.listHistory()
  }, 800)
}

/**
 * 单步容错：某个 IPC 失败不应让整个应用初始化中断
 * （曾经的教训：一处 invoke 抛错 → settings/auth 全为 null → 主题、登录、各页面连带失效）
 */
async function settle<T>(task: () => Promise<T>, fallback: T, label: string): Promise<T> {
  try {
    return await task()
  } catch (e) {
    console.error(`[initApp] ${label} 失败:`, e)
    toast(`${label}加载失败，部分功能可能不可用`, 'error')
    return fallback
  }
}

export async function initApp(): Promise<void> {
  // 首帧主题：先用本地缓存/系统偏好渲染，避免等待 IPC 时闪成默认浅色
  applyBootTheme()

  const settings = await settle(() => window.vd.getSettings(), null, '设置')
  if (settings) {
    store.settings = settings
    applyTheme(settings)
    store.loopMode = settings.loopMode ?? 'list'
  }

  store.tasks = await settle(() => window.vd.listTasks(), [], '下载任务')
  store.history = await settle(() => window.vd.listHistory(), [], '下载历史')
  store.auth = await settle(() => window.vd.getAuthStatus(), { loggedIn: false }, '登录状态')
  store.sysInfo = await settle(() => window.vd.getSysInfo(), null, '系统信息')

  try {
    window.vd.onTaskUpdate((snap) => {
      const idx = store.tasks.findIndex((t) => t.id === snap.id)
      if (idx >= 0) store.tasks[idx] = { ...snap }
      else store.tasks.unshift({ ...snap })
      if (['completed', 'failed', 'cancelled'].includes(snap.state)) refreshHistory()
    })
    window.vd.onAuthChange((s) => {
      store.auth = s
    })
  } catch (e) {
    console.error('[initApp] 事件订阅失败:', e)
  }
}

/**
 * 写入设置。
 *
 * 注意：Vue 的 reactive 对象是 Proxy，Electron 的 IPC 走结构化克隆（structured clone），
 * 无法克隆 Proxy → 会抛 "An object could not be cloned."，表现为「点保存没反应/保存失效」。
 * 这里统一先深拷贝成纯对象再发往主进程。
 */
export async function updateSettings(patch: Partial<Settings>): Promise<void> {
  const plain = JSON.parse(JSON.stringify(patch)) as Partial<Settings>
  store.settings = await window.vd.setSettings(plain)
  applyTheme(store.settings)
  store.loopMode = store.settings.loopMode ?? store.loopMode
}

/** 重新从主进程拉取设置（用于外部修改后同步，例如打开 settings.json 手改） */
export async function reloadSettings(): Promise<void> {
  store.settings = await window.vd.getSettings()
  applyTheme(store.settings)
}
