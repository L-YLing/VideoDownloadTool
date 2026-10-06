/**
 * 收藏夹服务（main/services/favorite-service.ts）
 * 依据 07-B站接入 §3：免登录公开收藏夹下载、合集识别、登录后查看自身收藏。
 */
import type { DownloadOptions, FavoriteInfo, FavoriteVideo } from '../../shared/types'
import { BilibiliAdapter } from './bilibili-adapter'
import { DownloadService } from './download-service'
import { AuthService } from './auth-service'

export interface FavoriteResolveResult {
  info: FavoriteInfo
  videos: FavoriteVideo[]
  token?: number
}

const WEB_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'

export class FavoriteService {
  constructor(
    private bili: BilibiliAdapter,
    private downloadService: DownloadService,
    private auth: AuthService
  ) {}

  /** 解析收藏夹（公开/登录态均可）—— 渐进式 + token 防串扰 */
  async resolve(
    input: string,
    onProgress?: (index: number, total: number, video: FavoriteVideo, token: number) => void
  ): Promise<FavoriteResolveResult> {
    const cookie = this.auth.getCookie() ?? undefined
    const parsed = await this.bili.parseFavorite(input, onProgress, cookie)
    return { info: parsed.info, videos: parsed.videos, token: parsed.token }
  }

  /** 下载收藏夹内全部视频（带 cookie 支持登录态） */
  async download(input: string, opts: DownloadOptions): Promise<{ taskIds: string[] }> {
    const result = await this.downloadService.enqueue(
      [{ source: input, kind: 'favorite', cookie: this.auth.getCookie() ?? undefined } as any],
      opts
    )
    return { taskIds: result.taskIds }
  }

  /** 查看自己的收藏（C8，需登录） */
  async getMine(): Promise<{ ok: boolean; error?: string; favorites?: FavoriteInfo[] }> {
    if (!this.auth.isLoggedIn()) {
      return { ok: false, error: '未登录，无法查看自己的收藏夹' }
    }
    const mid = this.auth.getMid()
    if (!mid) {
      return { ok: false, error: '登录会话异常，请重新登录' }
    }
    try {
      const cookie = this.auth.getCookie() ?? ''
      const biliJct = this.auth.getBiliJct() ?? ''
      const params = new URLSearchParams({ up_mid: String(mid), csrf: biliJct })
      const res = await fetch(`https://api.bilibili.com/x/v3/fav/folder/created/list-all?${params}`, {
        headers: {
          Cookie: cookie,
          'User-Agent': WEB_UA,
          Referer: `https://space.bilibili.com/${mid}`,
          Origin: 'https://space.bilibili.com',
          Accept: 'application/json, text/plain, */*',
          'Accept-Language': 'zh-CN,zh;q=0.9'
        }
      })
      const data = (await res.json()) as {
        code?: number
        message?: string
        data?: {
          list?: Array<{ id: number; title: string; media_count: number; attr?: number }>
        }
      }
      if (data.code !== 0) {
        return { ok: false, error: `获取收藏夹失败（code ${data.code} ${data.message ?? ''}）` }
      }
      const username = this.auth.getStatus().username
      // 带真实 mid 拼地址：私密/个人收藏夹也能被正确解析（此前用 mid=0 导致列表拿不到）
      const list = (data.data?.list ?? []).map((f) => ({
        id: String(f.id),
        name: f.title,
        owner: username,
        isPublic: true,
        videoCount: f.media_count,
        url: `https://space.bilibili.com/${mid}/favlist?fid=${f.id}`
      }))
      return { ok: true, favorites: list }
    } catch (e) {
      return { ok: false, error: `网络错误: ${e instanceof Error ? e.message : String(e)}` }
    }
  }

  /** 解析指定收藏夹的视频列表（登录态下走官方接口，兼容私密收藏夹） */
  async resolveById(favoriteUrl: string): Promise<FavoriteResolveResult> {
    return this.resolve(favoriteUrl)
  }

  /**
   * 新建收藏夹（与阿 B 网页一致：/x/v3/fav/folder/add）。
   * 探索页收藏弹窗里「新建收藏夹并收藏」用。
   * @returns 新建收藏夹的 id
   */
  async createFolder(
    name: string,
    intro = '',
    privacy = false
  ): Promise<{ ok: boolean; id?: number; error?: string }> {
    if (!this.auth.isLoggedIn()) return { ok: false, error: '未登录，无法新建收藏夹' }
    const title = name.trim()
    if (!title) return { ok: false, error: '收藏夹名称不能为空' }
    try {
      const cookie = this.auth.getCookie() ?? ''
      const csrf = this.auth.getBiliJct() ?? ''
      const mid = this.auth.getMid() ?? 0
      const body = new URLSearchParams({
        title,
        intro,
        privacy: privacy ? '1' : '0',
        csrf
      })
      const res = await fetch('https://api.bilibili.com/x/v3/fav/folder/add', {
        method: 'POST',
        headers: {
          Cookie: cookie,
          'User-Agent': WEB_UA,
          Referer: `https://space.bilibili.com/${mid}/favlist`,
          Origin: 'https://space.bilibili.com',
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json, text/plain, */*'
        },
        body: body.toString()
      })
      const data = (await res.json()) as {
        code?: number
        message?: string
        data?: { id?: number }
      }
      if (data.code !== 0 || !data.data?.id) {
        const hint = data.code === -111 ? '（登录凭据缺少 bili_jct，请重新登录）' : ''
        return { ok: false, error: `新建失败（${data.code ?? '-'} ${data.message ?? ''}）${hint}` }
      }
      return { ok: true, id: Number(data.data.id) }
    } catch (e) {
      return { ok: false, error: `网络错误: ${e instanceof Error ? e.message : String(e)}` }
    }
  }

  /**
   * 查询某视频已被收藏在「我的」哪些收藏夹（探索页收藏按钮的初始状态）。
   * 与阿 B 逻辑一致：收藏是「多收藏夹」的，所以需要列出已选中的收藏夹。
   */
  async collectedFolders(
    aid: number
  ): Promise<{ ok: boolean; folderIds?: number[]; error?: string }> {
    if (!this.auth.isLoggedIn()) return { ok: false, error: '未登录' }
    const mid = this.auth.getMid()
    if (!mid || !aid) return { ok: false, error: '参数缺失' }
    try {
      const cookie = this.auth.getCookie() ?? ''
      const res = await fetch(
        `https://api.bilibili.com/x/v3/fav/folder/collected/list?up_mid=${mid}&rid=${aid}&type=2&pn=1&ps=50`,
        {
          headers: {
            Cookie: cookie,
            'User-Agent': WEB_UA,
            Referer: `https://www.bilibili.com/video/av${aid}`,
            Origin: 'https://www.bilibili.com',
            Accept: 'application/json, text/plain, */*'
          }
        }
      )
      const data = (await res.json()) as {
        code?: number
        message?: string
        data?: { list?: Array<{ id: number }> }
      }
      if (data.code !== 0) return { ok: false, error: `查询失败（${data.code} ${data.message ?? ''}）` }
      return { ok: true, folderIds: (data.data?.list ?? []).map((f) => Number(f.id)) }
    } catch (e) {
      return { ok: false, error: `网络错误: ${e instanceof Error ? e.message : String(e)}` }
    }
  }

  /**
   * 收藏 / 取消收藏（与阿 B 网页一致的 /x/v3/fav/resource/deal）。
   * @param addIds 要加入的收藏夹 id
   * @param delIds 要移除的收藏夹 id
   */
  async deal(
    aid: number,
    addIds: number[] = [],
    delIds: number[] = []
  ): Promise<{ ok: boolean; error?: string }> {
    if (!this.auth.isLoggedIn()) return { ok: false, error: '未登录，无法收藏' }
    if (!aid) return { ok: false, error: '缺少视频 id' }
    if (addIds.length === 0 && delIds.length === 0) return { ok: true }
    try {
      const cookie = this.auth.getCookie() ?? ''
      const csrf = this.auth.getBiliJct() ?? ''
      const body = new URLSearchParams({
        rid: String(aid),
        type: '2',
        add_media_ids: addIds.join(','),
        del_media_ids: delIds.join(','),
        csrf
      })
      const res = await fetch('https://api.bilibili.com/x/v3/fav/resource/deal', {
        method: 'POST',
        headers: {
          Cookie: cookie,
          'User-Agent': WEB_UA,
          Referer: `https://www.bilibili.com/video/av${aid}`,
          Origin: 'https://www.bilibili.com',
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json, text/plain, */*'
        },
        body: body.toString()
      })
      const data = (await res.json()) as { code?: number; message?: string }
      if (data.code !== 0) {
        // -111：csrf 校验失败（通常是 bili_jct 缺失/过期）
        const hint = data.code === -111 ? '（登录凭据缺少 bili_jct，请重新登录）' : ''
        return { ok: false, error: `操作失败（${data.code} ${data.message ?? ''}）${hint}` }
      }
      return { ok: true }
    } catch (e) {
      return { ok: false, error: `网络错误: ${e instanceof Error ? e.message : String(e)}` }
    }
  }
}
