/**
 * 播放器辅助服务（main/services/player-service.ts）
 * 依据 08-播放器设计：播放进度记忆、评论/弹幕数据读取（全量下载伴随文件）。
 */
import fs from 'node:fs'
import path from 'node:path'
import type {
  CommentItem,
  DanmakuItem,
  MediaCodecInfo,
  MediaRef,
  PlaybackProgress,
  TranscodeTarget,
  WatchHistoryItem
} from '../../shared/types'
import { detectCodecResources, openWithExternalPlayer, type OpenWithExternalResult } from './system-codec'
import { StorageService } from './storage-service'
import { sidecarDir } from '../utils/paths'
import { MediaService } from './media-service'
import { compatTarget } from './codec-profile'

interface ParsedDanmaku {
  items: DanmakuItem[]
  ok: boolean
}

export class PlayerService {
  private media: MediaService

  constructor(private storage: StorageService, media?: MediaService) {
    this.media = media ?? new MediaService()
  }

  /** 供主进程注入 MediaService（共享转码进度广播） */
  setMediaService(media: MediaService): void {
    this.media = media
  }

  /** 探测媒体编码（供 UI 展示编码信息与兼容提示） */
  probe(mediaPath: string): Promise<MediaCodecInfo & { playable: boolean; reason?: string; target?: TranscodeTarget }> {
    return this.media.probe(mediaPath)
  }

  /** 兼容转码：把内置播放器放不了的媒体转为 H.264+AAC/MP4 */
  ensurePlayable(mediaPath: string, target?: TranscodeTarget): Promise<{ ok: boolean; path?: string; error?: string; cached?: boolean }> {
    return this.media.ensurePlayable(mediaPath, target)
  }

  getMediaService(): MediaService {
    return this.media
  }

  /** 探测系统上可用的解码资源（播放器 / ffmpeg / 解码包） */
  detectCodecResources(refresh = false): ReturnType<typeof detectCodecResources> {
    return detectCodecResources(refresh)
  }

  /** 用系统播放器打开（借用系统已装解码库） */
  openExternal(mediaPath: string, preferred?: string, position = 0): Promise<OpenWithExternalResult> {
    return openWithExternalPlayer(mediaPath, preferred, position)
  }

  /**
   * 自动兜底播放：
   * 先看内置播放器能不能解 → 能解就交给内置（返回 fallback=false）；
   * 不能解则尝试系统播放器（返回 fallback=true + 播放器信息）。
   * 系统也找不到时才返回失败，由 UI 提示用户手动处理。
   */
  async openAuto(
    mediaPath: string,
    preferred?: string,
    position = 0
  ): Promise<OpenWithExternalResult & { fallback: boolean }> {
    const info = await this.media.probe(mediaPath)
    if (info.playable) return { ok: true, fallback: false }
    const res = await openWithExternalPlayer(mediaPath, preferred, position)
    return { ...res, fallback: true }
  }

  /** 记录播放进度（10/08：断点续播） */
  saveProgress(pathOrUrl: string, position: number, duration: number): void {
    const existing = this.storage.data.progress.find((p) => p.path === pathOrUrl)
    if (existing) {
      existing.position = position
      existing.duration = duration
      existing.updatedAt = Date.now()
    } else {
      this.storage.data.progress.push({ path: pathOrUrl, position, duration, updatedAt: Date.now() })
    }
    if (this.storage.data.progress.length > 500) {
      this.storage.data.progress = this.storage.data.progress.slice(-500)
    }
    this.storage.save()
  }

  getProgress(pathOrUrl: string): PlaybackProgress | null {
    return this.storage.data.progress.find((p) => p.path === pathOrUrl) ?? null
  }

  /** 解析全量下载的弹幕文件（.xml / .json） */
  loadDanmaku(mediaPath: string): ParsedDanmaku {
    const base = path.basename(mediaPath, path.extname(mediaPath))
    const dir = path.dirname(mediaPath)
    const candidates = [
      path.join(dir, `${base}.xml`),
      path.join(dir, `${base}.danmaku.xml`),
      path.join(sidecarDir(), `${base}.xml`),
      path.join(dir, `${base}.json`)
    ]
    for (const file of candidates) {
      if (!fs.existsSync(file)) continue
      try {
        if (file.endsWith('.xml')) {
          return { items: this.parseXmlDanmaku(fs.readFileSync(file, 'utf-8')), ok: true }
        }
        const json = JSON.parse(fs.readFileSync(file, 'utf-8')) as { data?: Array<Array<string | number>> }
        if (Array.isArray(json.data)) {
          const items = json.data.map((d) => ({
            time: Number(d[0] ?? 0),
            mode: Number(d[1] ?? 1),
            color: '#' + Number(d[3] ?? 16777215).toString(16).padStart(6, '0'),
            text: String(d[4] ?? '')
          }))
          return { items, ok: true }
        }
      } catch {
        continue
      }
    }
    return { items: [], ok: false }
  }

  private parseXmlDanmaku(xml: string): DanmakuItem[] {
    const items: DanmakuItem[] = []
    const re = /<d p="([^"]+)">([^<]*)<\/d>/g
    let m: RegExpExecArray | null
    while ((m = re.exec(xml)) !== null) {
      const [time, mode, , color] = m[1].split(',')
      items.push({
        time: Number(time) || 0,
        mode: Number(mode) || 1,
        color: '#' + Number(color || 16777215).toString(16).padStart(6, '0'),
        text: m[2]
      })
    }
    return items
  }

  /**
   * 解析伴生评论（`<同名>.info.json`）。
   *
   * 需要同时兼容两种写法，否则会出现「只显示名字、没有评论内容」：
   *   ① 本应用预览时写的：{ author, content, timestamp }
   *   ② yt-dlp --write-comments 写的：{ author, text, timestamp, replies[], parent, like_count }
   * 之前只读 `content`，遇到 yt-dlp 的文件就是 undefined → 内容全空。
   */
  private readComments(mediaPath: string): CommentItem[] {
    const base = path.basename(mediaPath, path.extname(mediaPath))
    const dir = path.dirname(mediaPath)
    const infoJson = path.join(dir, `${base}.info.json`)
    if (!fs.existsSync(infoJson)) return []
    try {
      const info = JSON.parse(fs.readFileSync(infoJson, 'utf-8')) as {
        comments?: Array<{
          author?: string
          name?: string
          content?: string
          text?: string
          timestamp?: number
          like_count?: number
          replies?: unknown[]
        }>
      }
      if (!Array.isArray(info.comments)) return []
      const raw = info.comments as Array<Record<string, unknown>>
      const toItem = (c: Record<string, unknown>): CommentItem => ({
        user: String(c.author ?? c.name ?? '匿名'),
        // content（自有格式）优先，其次 text（yt-dlp 格式）
        content: String(c.content ?? c.text ?? ''),
        time: Number(c.timestamp ?? 0) * 1000,
        rpid: c.id != null ? String(c.id) : undefined,
        like: Number(c.like_count ?? 0)
      })
      // 是否为「回复某条评论」的二级/n级评论：yt-dlp 用 parent='root' 表示一级
      const isReply = (c: Record<string, unknown>): boolean => {
        const p = c.parent ?? c.root
        return p != null && p !== 'root' && p !== 0 && p !== '0' && p !== ''
      }
      const roots = raw.filter((c) => !isReply(c))
      const replies = raw.filter(isReply)
      return roots
        .map((c) => {
          const item = toItem(c)
          const id = String(c.id ?? c.rpid ?? '')
          // 已嵌套在 replies 字段里的（yt-dlp 常见）先收进来
          const nested = Array.isArray(c.replies)
            ? (c.replies as Array<Record<string, unknown>>).map(toItem).filter((r) => r.content.trim())
            : []
          // 再按 parent/root 指针，把平铺在 comments 里的回复归位到该一级评论下
          const linked = replies
            .filter((r) => id && String(r.parent ?? r.root) === id)
            .map(toItem)
            .filter((r) => r.content.trim())
          const subs = [...nested, ...linked]
          subs.forEach((s, i) => {
            if (!s.rpid) s.rpid = `${item.rpid ?? id}#${i}`
          })
          return { ...item, subReplies: subs, replyCount: subs.length }
        })
        // 无内容的（被删除/风控占位）直接丢弃
        .filter((c) => c.content.trim().length > 0)
    } catch {
      return []
    }
  }

  /** 全部评论（内部用于判断是否存在评论） */
  loadComments(mediaPath: string): CommentItem[] {
    return this.readComments(mediaPath)
  }

  /**
   * 分页读取评论：只把当前页返回给渲染进程。
   * 满足「只在内存挂当前页的评论内容」——其余页不进入渲染进程内存。
   */
  loadCommentsPage(
    mediaPath: string,
    pn = 1,
    ps = 50
  ): { items: CommentItem[]; total: number; page: number; pageSize: number; hasMore: boolean } {
    const all = this.readComments(mediaPath)
    const size = Math.max(1, ps)
    const page = Math.max(1, pn)
    const start = (page - 1) * size
    return {
      items: all.slice(start, start + size),
      total: all.length,
      page,
      pageSize: size,
      hasMore: start + size < all.length
    }
  }

  /** 构建播放引用：本地文件 → MediaRef（含编码信息 + 可播放性判断） */
  async toMediaRef(pathOrUrl: string): Promise<MediaRef> {
    const isFile = fs.existsSync(pathOrUrl)
    const base = isFile ? path.basename(pathOrUrl, path.extname(pathOrUrl)) : pathOrUrl
    const danmaku = isFile ? this.loadDanmaku(pathOrUrl) : { items: [], ok: false }
    const comments = isFile ? this.loadComments(pathOrUrl) : []
    const codec = isFile ? await this.media.probe(pathOrUrl) : undefined

    return {
      path: isFile ? pathOrUrl : undefined,
      source: isFile ? undefined : pathOrUrl,
      hasDanmaku: danmaku.items.length > 0,
      hasComments: comments.length > 0,
      title: isFile ? base : pathOrUrl,
      duration: codec?.duration,
      codec: codec
        ? {
            container: codec.container,
            videoCodec: codec.videoCodec,
            audioCodec: codec.audioCodec,
            duration: codec.duration,
            width: codec.width,
            height: codec.height
          }
        : undefined,
      playable: codec ? codec.playable : true,
      playableReason: codec?.reason,
      compatTarget: codec?.playable ? undefined : codec?.target ?? compatTarget(Boolean(codec?.hasVideo))
    }
  }

  // ---------- 播放历史（个人页「历史记录」） ----------

  /**
   * 记录 / 更新播放历史。
   * 同一个文件只保留一条（按 path 去重），并累计播放次数。
   */
  recordHistory(
    mediaPath: string,
    position: number,
    duration: number,
    meta?: { title?: string; uploader?: string; cover?: string; from?: string }
  ): WatchHistoryItem | null {
    if (!mediaPath) return null
    const list = this.storage.data.watchHistory
    const existing = list.find((h) => h.path === mediaPath)
    const now = Date.now()

    if (existing) {
      existing.position = position
      existing.duration = duration || existing.duration
      existing.watchedAt = now
      if (meta?.title) existing.title = meta.title
      if (meta?.uploader) existing.uploader = meta.uploader
      if (meta?.cover) existing.cover = meta.cover
      if (meta?.from) existing.from = meta.from
      this.storage.save()
      return { ...existing }
    }

    const item: WatchHistoryItem = {
      id: `wh_${now.toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
      path: mediaPath,
      title: meta?.title || path.basename(mediaPath, path.extname(mediaPath)),
      uploader: meta?.uploader,
      cover: meta?.cover,
      position,
      duration,
      watchedAt: now,
      from: meta?.from,
      plays: 1
    }
    list.unshift(item)
    // 上限 1000 条，避免无限增长
    if (list.length > 1000) list.length = 1000
    this.storage.save()
    return { ...item }
  }

  /** 播放历史列表（最近在前） */
  listHistory(): WatchHistoryItem[] {
    return [...this.storage.data.watchHistory].sort((a, b) => b.watchedAt - a.watchedAt)
  }

  /** 删除单条历史 */
  removeHistory(id: string): WatchHistoryItem[] {
    this.storage.data.watchHistory = this.storage.data.watchHistory.filter((h) => h.id !== id)
    this.storage.save()
    return this.listHistory()
  }

  /** 清空历史 */
  clearHistory(): WatchHistoryItem[] {
    this.storage.data.watchHistory = []
    this.storage.save()
    return []
  }

  /** 把历史条目提及的文件已不存在的情况标注出来（UI 灰显用） */
  historyExists(mediaPath: string): boolean {
    try {
      return fs.existsSync(mediaPath)
    } catch {
      return false
    }
  }
}
