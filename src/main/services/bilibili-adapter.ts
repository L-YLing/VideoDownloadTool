/**
 * B站适配器（main/services/bilibili-adapter.ts）
 * v2：parseFavorite 带 token + 旧任务可取消，防止重复解析时事件串扰
 */
import { normalizeBiliInput, extractBiliId, isBilibili } from '../utils/normalize'
import type { FavoriteInfo, FavoriteVideo, CollectionInfo } from '../../shared/types'
import { spawnYtDlpJson } from './yt-dlp-runner'

const WEB_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'

export interface ParsedFavorite {
  info: FavoriteInfo
  videos: FavoriteVideo[]
  token: number
}

export class BilibiliAdapter {
  private static nextToken = 1
  /** 当前活跃的渐进式 token，每次 parseFavorite 递增，旧任务发出的事件被自动丢弃 */
  private activeToken = 0

  /** 判断输入是否属于 B站 并归一化 */
  resolve(raw: string): { handled: boolean; normalized?: ReturnType<typeof normalizeBiliInput> } {
    if (!isBilibili(raw)) return { handled: false }
    return { handled: true, normalized: normalizeBiliInput(raw) }
  }

  /**
   * 解析收藏夹（渐进式）—— 先快速返回 flat-playlist 基础列表，
   * 然后后台并发解析全部元数据，解析完一个就通过 onProgress 推事件给 UI。
   * 每次调用都会使上一次调用的 token 失效，旧事件被自动丢弃。
   * 调用方传入 cookie 可支持登录态收藏夹（私密等）。
   */
  async parseFavorite(
    input: string,
    onProgress?: (index: number, total: number, video: FavoriteVideo, token: number) => void,
    cookie?: string
  ): Promise<ParsedFavorite> {
    const token = BilibiliAdapter.nextToken++
    this.activeToken = token // 使上一次的渐进式回调自动失效

    const norm = normalizeBiliInput(input)
    if (norm.kind !== 'favlist') {
      throw new Error('输入不是收藏夹链接')
    }

    // ① 优先走 B站官方收藏夹接口：登录态可解析私密收藏夹，且一次性拿到完整元数据
    if (norm.id) {
      const viaApi = await this.parseFavoriteByApi(norm.id, cookie)
      if (viaApi && viaApi.videos.length > 0) {
        if (onProgress) onProgress(viaApi.videos.length, viaApi.videos.length, viaApi.videos[0], token)
        return { info: viaApi.info, videos: viaApi.videos, token }
      }
    }

    // ② 回退 yt-dlp flat-playlist（免登录公开收藏夹）
    const args = [norm.ytdlpUrl!, '--flat-playlist', '--no-warnings']
    if (cookie) args.push('--add-header', `Cookie: ${cookie}`)
    const json = await spawnYtDlpJson(args, { timeoutMs: 60000 })
    const entries = (json.entries ?? []) as Array<Record<string, unknown>>

    const videos: FavoriteVideo[] = entries
      .filter((e) => e && (e.id || e.url || e.webpage_url))
      .map((e) => {
        const bvid = extractBiliId(String(e.id ?? '')) ?? extractBiliId(String(e.url ?? e.webpage_url ?? '')) ?? String(e.id ?? '')
        const url = String(e.url ?? e.webpage_url ?? '')
        return { bvid, title: bvid, uploader: '', duration: 0, cover: undefined, url } as FavoriteVideo
      })

    const info: FavoriteInfo = {
      id: norm.value,
      name: String(json.title ?? '收藏夹'),
      owner: json.uploader ? String(json.uploader) : undefined,
      isPublic: true,
      videoCount: videos.length
    }

    // 渐进式后台解析（并发 6）—— 带 token 检查
    if (onProgress && videos.length > 0) {
      void this.batchResolveMeta(videos, 6, (i, v) => {
        if (this.activeToken !== token) return // 旧 token → 丢弃
        onProgress(i, videos.length, v, token)
      }, cookie)
    }

    return { info, videos, token }
  }

  /**
   * 用 B站 官方接口解析收藏夹（支持登录态私密收藏夹，一次拿到标题/UP主/时长/封面）。
   * 失败时返回 null，由调用方回退到 yt-dlp。
   */
  private async parseFavoriteByApi(
    fid: string,
    cookie?: string
  ): Promise<{ info: FavoriteInfo; videos: FavoriteVideo[] } | null> {
    try {
      const headers: Record<string, string> = {
        'User-Agent': WEB_UA,
        Referer: `https://www.bilibili.com/medialist/detail/${fid}`,
        Origin: 'https://www.bilibili.com',
        Accept: 'application/json, text/plain, */*',
        'Accept-Language': 'zh-CN,zh;q=0.9'
      }
      if (cookie) headers.Cookie = cookie

      const videos: FavoriteVideo[] = []
      let name = '收藏夹'
      let owner: string | undefined
      let page = 1
      let hasMore = true

      while (hasMore && page <= 20) {
        const url =
          `https://api.bilibili.com/x/v3/fav/resource/list?media_id=${encodeURIComponent(fid)}` +
          `&pn=${page}&ps=20&order=mtime&type=0&tid=0&platform=web`
        const res = await fetch(url, { headers })
        const data = (await res.json()) as {
          code?: number
          message?: string
          data?: {
            info?: { id?: number; title?: string; media_count?: number; upper?: { mid?: number; name?: string } }
            medias?: Array<{
              id?: number
              type?: number
              bvid?: string
              title?: string
              cover?: string
              duration?: number
              upper?: { name?: string }
            }> | null
            has_more?: boolean
          }
        }
        if (data.code !== 0) return videos.length > 0 ? { info: { id: fid, name, owner, isPublic: true, videoCount: videos.length }, videos } : null
        const info = data.data?.info
        if (info?.title) name = String(info.title)
        if (info?.upper?.name) owner = String(info.upper.name)

        const medias = data.data?.medias ?? []
        for (const m of medias) {
          // type=2 为普通视频，其余（直播/专栏等）跳过
          if (m.type !== undefined && m.type !== 2) continue
          const bvid = m.bvid ?? ''
          if (!bvid) continue
          videos.push({
            bvid,
            title: String(m.title ?? bvid),
            uploader: String(m.upper?.name ?? ''),
            duration: Number(m.duration ?? 0),
            cover: m.cover ? String(m.cover).replace(/^http:\/\//, 'https://') : undefined,
            url: `https://www.bilibili.com/video/${bvid}`
          })
        }
        hasMore = Boolean(data.data?.has_more) && medias.length > 0
        page++
        if (!hasMore) break
      }

      if (videos.length === 0) return null
      return {
        info: { id: fid, name, owner, isPublic: true, videoCount: videos.length },
        videos
      }
    } catch {
      return null
    }
  }

  /** 并发批量解析视频元数据（带 token 检查防串扰） */
  private async batchResolveMeta(
    videos: FavoriteVideo[],
    concurrency = 4,
    onOneDone?: (index: number, video: FavoriteVideo) => void,
    cookie?: string
  ): Promise<void> {
    let idx = 0
    const total = videos.length
    const next = (): Promise<void> => {
      if (idx >= total) return Promise.resolve()
      const i = idx++
      const v = videos[i]
      return this.resolveVideoMeta(v.url, cookie).then((meta) => {
        if (meta.title) v.title = meta.title
        if (meta.uploader) v.uploader = meta.uploader
        if (meta.duration) v.duration = meta.duration
        if (meta.cover) v.cover = meta.cover
        if (onOneDone) onOneDone(i, v)
      }).catch(() => {
        // 单个解析失败不影响整体
      }).then(next)
    }
    await Promise.all(Array.from({ length: Math.min(concurrency, total) }, next))
  }

  /** 判断收藏夹内某视频是否属于合集（C3），并返回合集内全部视频 */
  async checkCollection(videoUrl: string): Promise<{ info: CollectionInfo; videos: FavoriteVideo[] } | null> {
    try {
      const json = await spawnYtDlpJson([videoUrl, '--skip-download', '--no-warnings'], { timeoutMs: 45000 })
      const playlist = json.playlist
      if (playlist && Array.isArray(playlist.entries) && playlist.entries.length > 1) {
        const videos: FavoriteVideo[] = playlist.entries
          .filter((e: Record<string, unknown>) => e && (e.url || e.webpage_url))
          .map((e: Record<string, unknown>) => {
            const bvid = extractBiliId(String(e.id ?? e.url ?? '')) ?? String(e.id ?? '')
            return {
              bvid,
              title: String(e.title ?? ''),
              uploader: String(e.uploader ?? e.channel ?? ''),
              duration: Number(e.duration ?? 0),
              cover: e.thumbnail ? String(e.thumbnail) : undefined,
              url: String(e.url ?? e.webpage_url ?? '')
            } as FavoriteVideo
          })
        return {
          info: {
            id: String(playlist.id ?? ''),
            name: String(playlist.title ?? '合集'),
            count: videos.length,
            owner: json.uploader ? String(json.uploader) : undefined
          },
          videos
        }
      }
    } catch {
      // 解析失败视为无合集信息
    }
    return null
  }

  /** 解析单个视频元数据 */
  async resolveVideoMeta(input: string, cookie?: string): Promise<{ title?: string; uploader?: string; duration?: number; cover?: string; url: string }> {
    const norm = normalizeBiliInput(input)
    try {
      const args = [norm.ytdlpUrl ?? input, '--skip-download', '--no-warnings']
      if (cookie) args.push('--add-header', `Cookie: ${cookie}`)
      const json = await spawnYtDlpJson(args, { timeoutMs: 45000 })
      let cover = json.thumbnail ? String(json.thumbnail) : undefined
      if (cover && cover.startsWith('http://')) cover = 'https://' + cover.slice(7)
      return {
        title: json.title ? String(json.title) : undefined,
        uploader: json.uploader ? String(json.uploader) : undefined,
        duration: json.duration ? Number(json.duration) : undefined,
        cover,
        url: norm.ytdlpUrl ?? input
      }
    } catch {
      return { url: norm.ytdlpUrl ?? input }
    }
  }
}
