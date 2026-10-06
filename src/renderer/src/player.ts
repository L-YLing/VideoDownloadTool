/**
 * 播放控制器（renderer/player.ts）
 * 视频列表 / 下载历史 / 播放列表 / 探索预览 → 打开播放器 共用入口。
 */
import { store, toast } from './store/app'
import { nextItem, playlist, prevItem, setPlaylist } from './store/playlist'
import type { PlaylistItem } from '@shared/types'

/** 是否为纯音频文件（音频格式默认「仅音频」模式） */
const AUDIO_EXTS = ['.mp3', '.flac', '.wav', '.m4a', '.aac', '.ogg', '.oga', '.opus', '.wma', '.ape', '.aiff', '.aif', '.cop']

export function isAudioOnly(p: string): boolean {
  const lower = p.toLowerCase()
  const ext = lower.slice(lower.lastIndexOf('.'))
  return AUDIO_EXTS.includes(ext)
}

/** 播放来源元信息（写入播放历史用：标题/UP 主/封面/来源） */
export interface PlayMeta {
  title?: string
  uploader?: string
  cover?: string
  from?: string
}

/** 打开单个媒体（不改变播放列表） */
export async function playMedia(p: string, meta?: PlayMeta): Promise<boolean> {
  return openMedia(p, meta)
}

/** 用给定列表替换播放列表并从指定项开始播放 */
export async function playPlaylist(items: PlaylistItem[], startId?: string, from = ''): Promise<boolean> {
  setPlaylist(items, startId, from)
  const start = items.find((i) => i.id === (startId ?? items[0]?.id)) ?? items[0]
  if (!start) return false
  return openMedia(start.path, {
    title: start.title,
    uploader: start.uploader,
    cover: start.cover,
    from: from || start.from
  })
}

/** 播放下一首（无下一首时返回 false） */
export async function playNext(): Promise<boolean> {
  const item = nextItem()
  if (!item) return false
  return openMedia(item.path, { title: item.title, uploader: item.uploader, cover: item.cover, from: item.from })
}

/** 播放上一首 */
export async function playPrev(): Promise<boolean> {
  const item = prevItem()
  if (!item) return false
  return openMedia(item.path, { title: item.title, uploader: item.uploader, cover: item.cover, from: item.from })
}

/**
 * 打开媒体并载入弹幕/评论/歌词/进度；若该路径在播放列表中则同步当前项。
 * .cop 音频包会先解包，取包内音频 + LRC 歌词。
 */
async function openMedia(p: string, meta?: PlayMeta): Promise<boolean> {
  try {
    // .cop 音频包：解包出音频 + LRC 歌词
    let target = p
    let lines: Array<{ time: number; text: string }> = []
    if (p.toLowerCase().endsWith('.cop')) {
      const res = await window.vd.importCop(p)
      if (!res.ok || !res.audio) {
        toast(`打开 .cop 失败: ${res.error ?? '未知错误'}`, 'error')
        return false
      }
      target = res.audio
      lines = res.lines ?? []
    } else {
      lines = (await window.vd.loadLyric(p)) ?? []
    }

    const media = await window.vd.openMedia(target)
    store.player = media
    store.danmakuItems = []
    store.comments = []
    store.lyrics = lines
    // 记住用户实际打开的文件（.cop 时是包本身，而不是缓存里解包出的音频），
    // 这样「保存歌词 / 再次导出 .cop」会落在用户看得见的位置
    store.openedPath = p
    // 记录来源元信息，播放进度上报时会一并写入播放历史
    store.playerMeta = meta ?? {}
    store.view = 'player'

    const hit = playlist.items.find((i) => i.path === p)
    playlist.currentId = hit ? hit.id : ''

    const base = media.path ?? target
    if (media.hasDanmaku) {
      const res = await window.vd.getDanmaku(base)
      store.danmakuItems = res.items
    }
    if (media.hasComments) {
      // 评论改为「切到评论页时按页拉取」：此处不再整份载入，
      // 避免几百上千条评论常驻渲染进程内存（只在内存挂当前页）。
      store.comments = []
    }

    // 恢复播放进度
    const prog = await window.vd.getProgress(base)
    if (prog && prog.position > 5 && prog.position < prog.duration - 10) {
      store.player = { ...store.player, path: base, progress: prog }
    }
    return true
  } catch (e) {
    console.error('[player] 打开媒体失败:', e)
    return false
  }
}
