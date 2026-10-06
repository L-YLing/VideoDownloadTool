/**
 * 探索服务（main/services/explore-service.ts）
 * B站分区浏览：首页/知识/游戏/音乐… → 列表 → 预览（缓存播放）→ 决定下载。
 *
 * 过滤规则（用户要求）：
 * - 大会员 / 付费内容：直接跳过（不展示，避免点了才发现下不了）
 * - 漫画 / 动态 / 专栏：直接过滤（本应用只处理视频）
 * - 广告：保留（带「广告」标记）
 * - 互动（弹幕 / 评论 / 点赞）：走官方接口
 */
import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import type {
  CommentItem,
  CommentSort,
  DanmakuItem,
  ExploreCategory,
  ExploreResult,
  ExploreVideo,
  SearchResult,
  UserProfile,
  VideoInteraction
} from '../../shared/types'
import { AuthService } from './auth-service'
import type { SettingsService } from './settings-service'
import { biliGet, biliGetText, biliPost, biliWbiGet } from './bili-web'
import { cacheDir, resolveYtDlp, ytDlpEnv } from '../utils/paths'
import { ytdlpProxyArgs } from '../utils/ytdlp-args'

/**
 * 单次评论抓取的目标条数上限（用户可配，设置里上限 1145）。
 * 接口单次只能给 30 条，超过部分由 commentsPageFull 用游标连续取。
 */
const COMMENT_TARGET_MAX = 1145

/** B站分区（rid 沿用官方分区 id；首页=热门推荐） */
export const EXPLORE_CATEGORIES: ExploreCategory[] = [
  { rid: 0, name: '首页', kind: 'recommend' },
  { rid: 36, name: '知识', kind: 'region' },
  { rid: 4, name: '游戏', kind: 'region' },
  { rid: 3, name: '音乐', kind: 'region' },
  { rid: 1, name: '动画', kind: 'region' },
  { rid: 129, name: '舞蹈', kind: 'region' },
  { rid: 188, name: '科技', kind: 'region' },
  { rid: 234, name: '运动', kind: 'region' },
  { rid: 160, name: '生活', kind: 'region' },
  { rid: 211, name: '美食', kind: 'region' },
  { rid: 217, name: '动物圈', kind: 'region' },
  { rid: 119, name: '鬼畜', kind: 'region' },
  { rid: 155, name: '时尚', kind: 'region' },
  { rid: 5, name: '娱乐', kind: 'region' },
  { rid: 181, name: '影视', kind: 'region' },
  { rid: 177, name: '纪录片', kind: 'region' },
  { rid: 23, name: '电影', kind: 'region' },
  { rid: 11, name: '电视剧', kind: 'region' }
]

interface PopularItem {
  aid: number
  bvid: string
  title: string
  pic: string
  duration: number
  pubdate: number
  owner: { mid: number; name: string }
  stat: { view: number; danmaku: number; like: number }
  /** 广告标记 */
  is_ad?: boolean
  rcmd_reason?: { content?: string }
}

interface ArchiveItem {
  aid: number
  bvid: string
  title: string
  pic: string
  duration: number
  pubdate: number
  owner: { mid: number; name: string }
  stat: { view: number; danmaku: number; like: number }
  is_ad?: boolean
  /** 有些接口会带付费标记 */
  vip?: number
}

/** 预览缓存目录 */
function previewDir(): string {
  const dir = path.join(cacheDir(), 'preview')
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

export class ExploreService {
  constructor(
    private auth: AuthService,
    private settings: SettingsService
  ) {}

  categories(): ExploreCategory[] {
    return EXPLORE_CATEGORIES
  }

  private cookie(): string | undefined {
    return this.auth.getCookie() ?? undefined
  }

  private csrf(): string | undefined {
    return this.auth.getBiliJct() ?? undefined
  }

  /** 拉取分区列表 */
  async feed(rid: number, pn = 1, ps = 24): Promise<ExploreResult> {
    const cookie = this.cookie()
    if (rid === 0) {
      const res = await biliGet<{ list: PopularItem[] }>(
        `/x/web-interface/popular?pn=${pn}&ps=${ps}`,
        cookie
      )
      if (res.code !== 0) throw new Error(`获取热门失败（${res.code} ${res.message}）`)
      const videos = (res.data?.list ?? []).map(mapPopular).filter(vipOrInvalid)
      return { videos, hasMore: videos.length >= ps, page: pn, pageSize: ps }
    }

    // 分区列表优先用现行「分区动态」接口；失败或为空时回退到旧的 newlist
    let archives: ArchiveItem[] = []
    const dyn = await biliGet<{ archives: ArchiveItem[] }>(
      `/x/web-interface/dynamic/region?rid=${rid}&pn=${pn}&ps=${ps}`,
      cookie
    ).catch(() => null)
    if (dyn?.code === 0) archives = dyn.data?.archives ?? []

    if (archives.length === 0) {
      const res = await biliGet<{ archives: ArchiveItem[] }>(
        `/x/web-interface/newlist?rid=${rid}&type=0&pn=${pn}&ps=${ps}`,
        cookie
      ).catch(() => null)
      if (res?.code === 0) archives = res.data?.archives ?? []
      else if (!dyn || dyn.code !== 0) {
        throw new Error(`获取分区失败（${res?.code ?? dyn?.code ?? '-'} ${res?.message ?? dyn?.message ?? ''}）`)
      }
    }

    const videos = archives
      // vip=1：会员专享（大会员）内容，直接过滤，避免点了才发现下不了
      .filter((it) => !it.vip)
      .map(mapArchive)
      .filter(vipOrInvalid)
    return { videos, hasMore: archives.length >= ps, page: pn, pageSize: ps }
  }

  /**
   * 搜索：关键字 或 BV/AV 号。
   *
   * - BV 号：直接走视频详情接口，精确返回 1 条（无需签名，最可靠）
   * - 关键字：走 wbi/search/type（**需要 WBI 签名**，否则返回 -403），
   *   结果里的 title 带 <em> 高亮标签、pic 为 // 开头，这里统一清洗。
   */
  async search(keyword: string, pn = 1, ps = 16): Promise<SearchResult> {
    const kw = keyword.trim()
    if (!kw) return { keyword: kw, videos: [], hasMore: false, mode: 'video', page: pn, pageSize: ps }

    // ① BV / AV 号 / 视频链接 → 精确解析单条
    const bvid = extractBvid(kw)
    if (bvid) {
      const res = await biliGet<SearchViewData>(`/x/web-interface/view?bvid=${encodeURIComponent(bvid)}`, this.cookie())
      if (res.code !== 0 || !res.data?.bvid) {
        return {
          keyword: kw,
          videos: [],
          hasMore: false,
          mode: 'bvid',
          page: 1,
          pageSize: ps,
          total: 0,
          totalPages: 0
        }
      }
      const one = mapView(res.data)
      return {
        keyword: kw,
        videos: one ? [one] : [],
        hasMore: false,
        mode: 'bvid',
        page: 1,
        pageSize: ps,
        total: one ? 1 : 0,
        totalPages: 1
      }
    }

    // ② 关键字搜索（WBI 签名）
    const res = await biliWbiGet<{
      result?: SearchItem[]
      numPages?: number
      numResults?: number
      page?: number
      pagesize?: number
    }>(
      '/x/web-interface/wbi/search/type',
      { search_type: 'video', keyword: kw, page: pn, page_size: ps, order: 'totalrank' },
      this.cookie()
    )
    if (res.code !== 0) {
      throw new Error(`搜索失败（${res.code} ${res.message}）`)
    }
    const list = res.data?.result ?? []
    const videos = list
      // 付费 / 会员专享内容过滤掉（与分区列表保持一致）
      .filter((it) => !it.is_pay && !it.badgepay)
      .map(mapSearch)
      .filter(vipOrInvalid)
    const totalPages = Number(res.data?.numPages ?? 0)
    return {
      keyword: kw,
      videos,
      hasMore: totalPages ? pn < totalPages : videos.length >= ps,
      mode: 'video',
      page: pn,
      pageSize: ps,
      total: Number(res.data?.numResults ?? 0),
      totalPages
    }
  }

  /** 取 cid（用于弹幕 / 评论 / 点赞） */
  async cidOf(bvid: string): Promise<number> {
    const res = await biliGet<Array<{ cid: number; page: number }>>(
      `/x/player/pagelist?bvid=${encodeURIComponent(bvid)}`,
      this.cookie()
    )
    if (res.code !== 0) throw new Error(`获取 cid 失败（${res.message}）`)
    const first = res.data?.[0]?.cid
    if (!first) throw new Error('未找到 cid')
    return first
  }

  /** 在线弹幕（XML → DanmakuItem） */
  async danmaku(cid: number): Promise<DanmakuItem[]> {
    const xml = await biliGetText(`/x/v1/dm/list.so?oid=${cid}`, this.cookie())
    return parseDanmakuXml(xml)
  }

  /**
   * 在线评论（一页）。
   *
   * 为什么不用老接口 `/x/v2/reply`：
   *   ① 该接口已废弃，未登录/风控下会返回「只有 member.uname、content 被抽空」的占位评论，
   *      表现为「只看得到名字、看不到评论内容」；
   *   ② 只返回极少条数（实测某 349 条的稿件只给 3 条）；
   *   ③ 不支持正确的翻页（pn 无效）。
   * 因此改用新版 `/x/v2/reply/wbi/main`（需 WBI 签名），并用游标 pagination_str 翻页。
   *
   * 实测：页间零重复、内容完整、cursor.all_count 给出总数、ps 上限 30。
   */
  async commentsPage(
    aid: number,
    offset = '',
    ps = 30,
    sort: CommentSort = 'hot'
  ): Promise<{ ok: boolean; items: CommentItem[]; nextOffset: string; total: number; hasMore: boolean; error?: string }> {
    const empty = { ok: false, items: [] as CommentItem[], nextOffset: '', total: 0, hasMore: false }
    if (!aid) return { ...empty, error: '缺少视频 id' }
    try {
      const res = await biliWbiGet<{
        replies?: Array<{
          rpid?: number
          content?: { message?: string }
          member?: { uname?: string }
          ctime?: number
          like?: number
          rcount?: number
        }>
        cursor?: {
          all_count?: number
          is_end?: boolean
          pagination_reply?: { next_offset?: string }
        }
      }>(
        '/x/v2/reply/wbi/main',
        {
          oid: aid,
          type: 1,
          // mode：3 = 按热度，2 = 按时间（用户可在设置里选）
          mode: sort === 'time' ? 2 : 3,
          plat: 1,
          web_location: 1315875,
          ps: Math.max(1, Math.min(30, ps)),
          pagination_str: JSON.stringify({ offset })
        },
        this.cookie(),
        `https://www.bilibili.com/video/av${aid}`
      )
      if (res.code !== 0) {
        return { ...empty, error: `评论接口返回 ${res.code} ${res.message ?? ''}` }
      }
      const cursor = res.data?.cursor ?? {}
      const items: CommentItem[] = (res.data?.replies ?? [])
        .map((r) => ({
          user: String(r.member?.uname ?? '匿名'),
          content: String(r.content?.message ?? ''),
          time: Number(r.ctime ?? 0) * 1000,
          rpid: r.rpid != null ? String(r.rpid) : undefined,
          replyCount: Number(r.rcount ?? 0),
          like: Number(r.like ?? 0)
        }))
        // 风控占位评论（无内容）直接丢弃，避免「只有名字」
        .filter((c) => c.content.trim().length > 0)
      const nextOffset = String(cursor.pagination_reply?.next_offset ?? '')
      const isEnd = Boolean(cursor.is_end) || !nextOffset
      return {
        ok: true,
        items,
        nextOffset,
        total: Number(cursor.all_count ?? 0),
        hasMore: !isEnd
      }
    } catch (e) {
      return { ...empty, error: `评论获取失败：${e instanceof Error ? e.message : String(e)}` }
    }
  }

  /**
   * 取满一整页评论：接口单次上限 30 条，这里按游标连续取，凑够 ps 条为止。
   * 「默认 50 条一页」即通过 30 + 20 两次请求实现；返回后前面分块的内容不再保留。
   */
  async commentsPageFull(
    aid: number,
    offset = '',
    ps = 50,
    sort: CommentSort = 'hot'
  ): Promise<{ ok: boolean; items: CommentItem[]; nextOffset: string; total: number; hasMore: boolean; error?: string }> {
    const target = Math.max(1, Math.min(COMMENT_TARGET_MAX, ps))
    const out: CommentItem[] = []
    let cur = offset
    let total = 0
    let hasMore = false
    let calls = 0
    // 接口单次上限 30 条，按游标连续取直到凑够 target。
    // maxCalls 由目标条数推导（+2 容错），并设总时长预算，避免超大目标拖太久。
    const maxCalls = Math.min(64, Math.ceil(target / 30) + 2)
    const deadline = Date.now() + 25000
    while (out.length < target && calls < maxCalls && Date.now() < deadline) {
      const chunk = await this.commentsPage(aid, cur, Math.min(30, target - out.length), sort)
      if (!chunk.ok) {
        if (out.length > 0) break
        return chunk
      }
      total = chunk.total
      out.push(...chunk.items)
      cur = chunk.nextOffset
      hasMore = chunk.hasMore
      calls++
      if (!hasMore) break
    }
    return {
      ok: true,
      items: out.slice(0, target),
      nextOffset: cur,
      total,
      hasMore
    }
  }

  /**
   * 楼中楼（二级 / n 级回复）。
   * 接口：`/x/v2/reply/reply`（实测可用，无需 WBI 签名）。
   * 这些内容会挂在对应一级评论下一起展示，而不是当作独立评论。
   */
  async subReplies(
    aid: number,
    rootRpid: string | number,
    pn = 1,
    ps = 10
  ): Promise<{ ok: boolean; items: CommentItem[]; hasMore: boolean; total: number; error?: string }> {
    const empty = { ok: false, items: [] as CommentItem[], hasMore: false, total: 0 }
    if (!aid || !rootRpid) return { ...empty, error: '缺少参数' }
    try {
      const res = await biliGet<{
        replies?: Array<{
          rpid?: number
          content?: { message?: string }
          member?: { uname?: string }
          ctime?: number
          like?: number
          rcount?: number
        }>
        page?: { count?: number }
        total?: number
      }>(
        `/x/v2/reply/reply?oid=${aid}&type=1&root=${rootRpid}&pn=${pn}&ps=${Math.max(1, Math.min(20, ps))}`,
        this.cookie(),
        `https://www.bilibili.com/video/av${aid}`
      )
      if (res.code !== 0) return { ...empty, error: `楼中楼接口返回 ${res.code}` }
      const items: CommentItem[] = (res.data?.replies ?? [])
        .map((r) => ({
          user: String(r.member?.uname ?? '匿名'),
          content: String(r.content?.message ?? ''),
          time: Number(r.ctime ?? 0) * 1000,
          rpid: r.rpid != null ? String(r.rpid) : undefined,
          replyCount: Number(r.rcount ?? 0),
          like: Number(r.like ?? 0)
        }))
        .filter((c) => c.content.trim().length > 0)
      const total = Number(res.data?.page?.count ?? res.data?.total ?? 0)
      return { ok: true, items, hasMore: total > 0 ? pn * ps < total : items.length >= ps, total }
    } catch (e) {
      return { ...empty, error: `楼中楼获取失败：${e instanceof Error ? e.message : String(e)}` }
    }
  }

  /**
   * 写伴生 info.json 用：按设置「评论预抓取上限」取评论。
   * 这样预览 / 全量下载保存下来的评论条数由用户决定
   * （此前硬编码 20，导致播放器里评论「只有几条」）。
   */
  async commentsForSidecar(aid: number): Promise<CommentItem[]> {
    const limit = this.clampCommentFetchLimit(this.settings?.get?.().commentFetchLimit ?? 50)
    const sort = (this.settings?.get?.().commentSort ?? 'hot') as CommentSort
    if (limit <= 30) {
      const page = await this.commentsPage(aid, '', limit, sort)
      return page.items
    }
    const full = await this.commentsPageFull(aid, '', limit, sort)
    return full.items
  }

  /** 评论预抓取上限收敛到 [1, 1145] */
  private clampCommentFetchLimit(v: unknown): number {
    const n = Number(v)
    if (!Number.isFinite(n)) return 50
    return Math.max(1, Math.min(COMMENT_TARGET_MAX, Math.floor(n)))
  }

  /** 点赞状态查询（未登录返回 false，不报错） */
  async interaction(bvid: string): Promise<VideoInteraction> {
    const cookie = this.cookie()
    if (!cookie) return { like: false }
    const res = await biliGet<number>(`/x/web-interface/archive/has/like?bvid=${encodeURIComponent(bvid)}`, cookie)
    // data: 1=已点赞 0=未点赞
    return { like: res.code === 0 && Number(res.data) === 1 }
  }

  /** 点赞 / 取消点赞 */
  async like(bvid: string, like: boolean): Promise<{ ok: boolean; error?: string }> {
    const cookie = this.cookie()
    const csrf = this.csrf()
    if (!cookie || !csrf) return { ok: false, error: '未登录，无法点赞' }
    const res = await biliPost<unknown>(
      '/x/web-interface/archive/like',
      { bvid, like: like ? '1' : '2' },
      cookie,
      csrf
    )
    if (res.code !== 0) return { ok: false, error: res.message || '点赞失败' }
    return { ok: true }
  }

  /**
   * 预览准备：把在线视频下载到预览缓存，并把弹幕/评论写成伴生文件。
   * 之后交给内置播放器按本地文件播放（可拖动、可兼容转码）。
   */
  async preparePreview(
    video: ExploreVideo,
    onProgress?: (p: { percent: number; done: boolean; error?: string; path?: string }) => void
  ): Promise<{ ok: boolean; path?: string; error?: string }> {
    // cid 仅用于弹幕；取不到也必须能继续播放（此前 cidOf 抛错会导致整个预览失败）
    let cid = video.cid ?? 0
    if (!cid) {
      try {
        cid = await this.cidOf(video.bvid)
      } catch {
        cid = 0
      }
    }
    const url = `https://www.bilibili.com/video/${video.bvid}`
    const outDir = previewDir()
    const outTpl = path.join(outDir, `${video.bvid}.%(ext)s`)
    const cookie = this.cookie()

    // 弹幕 / 评论 并行抓取，失败不影响播放
    const side = (async () => {
      try {
        const [dm, cm] = await Promise.all([
          (cid ? this.danmaku(cid) : Promise.resolve([] as DanmakuItem[])).catch(() => [] as DanmakuItem[]),
          this.commentsForSidecar(video.aid).catch(() => [] as CommentItem[])
        ])
        const dmFile = path.join(outDir, `${video.bvid}.xml`)
        if (dm.length > 0) fs.writeFileSync(dmFile, danmakuToXml(dm), 'utf-8')
        if (cm.length > 0) {
          fs.writeFileSync(
            path.join(outDir, `${video.bvid}.info.json`),
            JSON.stringify(
              { comments: cm.map((c) => ({ author: c.user, content: c.content, timestamp: Math.floor((c.time ?? 0) / 1000) })) },
              null,
              2
            ),
            'utf-8'
          )
        }
      } catch {
        /* 伴生数据失败不影响播放 */
      }
    })()

    const download = new Promise<{ ok: boolean; path?: string; error?: string }>((resolvePromise) => {
      const args = [
        '--no-warnings',
        '--no-playlist',
        '--encoding', 'utf-8',
        /**
         * 预览格式：优先「内置播放器一定能解」的编码，再挑体积最小的。
         * 注意不能只按体积排序 —— 实测最小的是 HEVC（hev1），Chromium 解不了，
         * 会导致预览播不出来。所以先锁 H.264/AAC，其次 AV1，最后才逐级放宽。
         */
        '-f',
        'bv*[height<=?480][vcodec^=avc1]+ba[acodec^=mp4a]/bv*[height<=?480][vcodec^=avc1]+ba/bv*[height<=?480][vcodec^=av01]+ba/bv*[height<=?480]+ba/b[height<=?480]/bv*+ba/b',
        '-S', '+size,+br,+res',
        '--merge-output-format', 'mp4',
        '--concurrent-fragments', '2',
        '--retries', '3',
        '--fragment-retries', '3',
        '--socket-timeout', '15',
        '-o', outTpl,
        '--print', 'after_move:filepath'
      ]
      if (cookie) args.push('--add-header', `Cookie: ${cookie}`)
      // 代理：默认强制直连，避免被加速器/VPN 的系统代理劫持（详见 utils/ytdlp-args.ts）
      args.push(...ytdlpProxyArgs(this.settings.get()))
      args.push(url)

      const child = spawn(resolveYtDlp(), args, { windowsHide: true, env: ytDlpEnv(), stdio: ['ignore', 'pipe', 'pipe'] })
      let stdout = ''
      let stderr = ''
      let settled = false
      let lastPct = 0

      const finish = (r: { ok: boolean; path?: string; error?: string }): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        onProgress?.({ percent: r.ok ? 100 : 0, done: true, error: r.error, path: r.path })
        resolvePromise(r)
      }

      const timer = setTimeout(() => {
        try {
          child.kill()
        } catch {
          /* ignore */
        }
        finish({ ok: false, error: '预览下载超时（2 分钟），可改用「下载」到本地观看' })
      }, 120000)

      child.stdout.on('data', (d: Buffer) => {
        stdout += d.toString('utf-8')
        const m = stdout.match(/\[download\]\s+(\d+(?:\.\d+)?)%/)
        if (m) {
          const pct = Number(m[1])
          if (pct > lastPct) {
            lastPct = pct
            onProgress?.({ percent: Math.min(99, pct), done: false })
          }
        }
      })
      child.stderr.on('data', (d: Buffer) => {
        stderr += d.toString('utf-8')
      })
      child.on('error', (e) => finish({ ok: false, error: `无法启动 yt-dlp: ${e.message}` }))
      child.on('close', (code) => {
        if (code !== 0) {
          const line = stderr.trim().split(/\r?\n/).filter(Boolean).pop() ?? `退出码 ${code}`
          finish({ ok: false, error: line })
          return
        }
        const printed = stdout
          .split(/\r?\n/)
          .map((l) => l.trim())
          .filter((l) => /^[a-zA-Z]:[\\/]/.test(l) || l.startsWith('/'))
          .filter((l) => fs.existsSync(l))
          .pop()
        if (printed) {
          finish({ ok: true, path: printed })
          return
        }
        // 兜底：按 bvid 找产物
        const found = fs.readdirSync(outDir).find((f) => f.startsWith(video.bvid) && !f.endsWith('.part'))
        finish(found ? { ok: true, path: path.join(outDir, found) } : { ok: false, error: '未能定位预览文件' })
      })
    })

    const [result] = await Promise.all([download, side])
    return result
  }

  /**
   * 解析「可直接播放的网页视频直链」（不下载，秒开）。
   *
   * 实测结论：B站 绝大多数视频**没有**已混流（progressive/durl）格式，
   * 只提供 DASH —— 视频流与音频流是两条独立 URL（`-f b` 会直接报
   * "Requested format is not available"）。
   * 因此这里取两条 URL：播放页用 <video> 放视频流 + <audio> 放音频流并做同步，
   * 从而做到「直接引用网页视频播放」，无需等待下载与合并。
   *
   * 通过 vdstream:// 代理播放（补 Referer，绕开 CDN 防盗链与 CORS）。
   * 取不到任何流时返回失败，由调用方回退到「缓存下载」路径。
   */
  async resolveStream(
    video: ExploreVideo,
    maxHeight = 720
  ): Promise<{
    ok: boolean
    /** 视频流直链 */
    videoUrl?: string
    /** 音频流直链（DASH 才有；与画面同源需要同步播放） */
    audioUrl?: string
    /** true 表示单条 URL 已含音视频，可直接喂给 <video> */
    muxed?: boolean
    height?: number
    cid?: number
    error?: string
  }> {
    const bvid = video?.bvid
    if (!bvid) return { ok: false, error: '缺少 bvid' }

    // cid 用于弹幕（拿不到不影响播放）
    let cid = video.cid ?? 0
    if (!cid) {
      try {
        cid = await this.cidOf(bvid)
      } catch {
        cid = 0
      }
    }

    const h = Math.max(144, Math.min(1080, maxHeight))
    // 先试「已混流」（少数视频仍有 durl），再退到 DASH：优先 H.264+AAC（Chromium 必解）
    const selector = [
      `b[height<=?${h}]`,
      `bv*[height<=?${h}][vcodec^=avc1]+ba[acodec^=mp4a]`,
      `bv*[height<=?${h}][vcodec^=av01]+ba`,
      `bv*[height<=?${h}]+ba`,
      'bv*+ba'
    ].join('/')

    const args = ['-g', '--no-warnings', '--no-playlist', '--encoding', 'utf-8', '-f', selector]
    // 代理：默认强制直连（同上）
    args.push(...ytdlpProxyArgs(this.settings.get()))
    const cookie = this.cookie()
    if (cookie) args.push('--add-header', `Cookie: ${cookie}`)
    args.push(`https://www.bilibili.com/video/${bvid}`)

    const urls = await new Promise<string[]>((resolvePromise) => {
      const child = spawn(resolveYtDlp(), args, {
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: ytDlpEnv()
      })
      let out = ''
      const timer = setTimeout(() => child.kill(), 25000)
      child.stdout.on('data', (d: Buffer) => {
        out += d.toString('utf-8')
      })
      child.on('close', () => {
        clearTimeout(timer)
        resolvePromise(
          out
            .split(/\r?\n/)
            .map((l) => l.trim())
            .filter((l) => /^https?:\/\//i.test(l))
        )
      })
      child.on('error', () => {
        clearTimeout(timer)
        resolvePromise([])
      })
    })

    if (urls.length === 0) return { ok: false, error: '未能解析出可播放的直链', cid }
    if (urls.length === 1) return { ok: true, videoUrl: urls[0], muxed: true, height: h, cid }
    return { ok: true, videoUrl: urls[0], audioUrl: urls[1], muxed: false, height: h, cid }
  }

  /** 弹幕 + 评论（在线直链播放时没有伴生文件，直接走接口） */
  async sideData(video: ExploreVideo): Promise<{ danmaku: DanmakuItem[]; comments: CommentItem[] }> {
    const cid = video?.cid ?? 0
    const [danmaku, comments] = await Promise.all([
      (cid ? this.danmaku(cid) : Promise.resolve([] as DanmakuItem[])).catch(() => [] as DanmakuItem[]),
      this.commentsForSidecar(video?.aid ?? 0).catch(() => [] as CommentItem[])
    ])
    return { danmaku, comments }
  }
}

/** 过滤：大会员/付费内容直接跳过；其余（含广告）保留 */
function vipOrInvalid(v: ExploreVideo): boolean {
  if (!v || !v.bvid || !v.title) return false
  const t = `${v.title}`
  if (/大会员|付费|充电专属|会员专享|抢先/i.test(t)) return false
  return true
}

function mapPopular(it: PopularItem): ExploreVideo {
  return {
    bvid: it.bvid,
    aid: it.aid,
    title: it.title,
    uploader: it.owner?.name ?? '',
    mid: it.owner?.mid,
    cover: fixCover(it.pic),
    duration: Number(it.duration ?? 0),
    play: Number(it.stat?.view ?? 0),
    danmaku: Number(it.stat?.danmaku ?? 0),
    like: Number(it.stat?.like ?? 0),
    pubdate: Number(it.pubdate ?? 0),
    isAd: Boolean(it.is_ad)
  }
}

function mapArchive(it: ArchiveItem): ExploreVideo {
  return {
    bvid: it.bvid,
    aid: it.aid,
    title: it.title,
    uploader: it.owner?.name ?? '',
    mid: it.owner?.mid,
    cover: fixCover(it.pic),
    duration: Number(it.duration ?? 0),
    play: Number(it.stat?.view ?? 0),
    danmaku: Number(it.stat?.danmaku ?? 0),
    like: Number(it.stat?.like ?? 0),
    pubdate: Number(it.pubdate ?? 0),
    isAd: Boolean(it.is_ad)
  }
}

function fixCover(p?: string): string | undefined {
  if (!p) return undefined
  if (p.startsWith('//')) return `https:${p}`
  if (p.startsWith('http://')) return `https://${p.slice(7)}`
  return p
}

// ---------- 搜索相关 ----------

interface SearchItem {
  bvid: string
  aid: number
  title: string
  pic: string
  duration?: string | number
  author?: string
  mid?: number
  play?: number
  video_review?: number
  pubdate?: number
  /** 付费标记 */
  is_pay?: number
  badgepay?: boolean
}

interface SearchViewData {
  bvid?: string
  aid?: number
  cid?: number
  title?: string
  pic?: string
  duration?: number
  pubdate?: number
  owner?: { mid?: number; name?: string }
  stat?: { view?: number; danmaku?: number; like?: number }
}

/** 搜索结果的 title 带 <em class="keyword"> 高亮标签，需去掉标签与实体 */
function stripHtml(s?: string): string {
  if (!s) return ''
  return String(s)
    .replace(/<[^>]+>/g, '')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;/g, "'")
    .trim()
}

/** 搜索结果的 duration 形如 "12:34" 或 "1:02:03"，统一转成秒 */
function parseDuration(v?: string | number): number {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0
  if (!v) return 0
  const parts = String(v)
    .split(':')
    .map((x) => Number(x) || 0)
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2]
  if (parts.length === 2) return parts[0] * 60 + parts[1]
  return Number(v) || 0
}

function mapSearch(it: SearchItem): ExploreVideo {
  return {
    bvid: it.bvid,
    aid: it.aid,
    title: stripHtml(it.title),
    uploader: it.author ?? '',
    mid: it.mid,
    cover: fixCover(it.pic),
    duration: parseDuration(it.duration),
    play: Number(it.play ?? 0),
    danmaku: Number(it.video_review ?? 0),
    pubdate: Number(it.pubdate ?? 0)
  }
}

function mapView(it: SearchViewData): ExploreVideo | null {
  if (!it.bvid) return null
  return {
    bvid: it.bvid,
    aid: Number(it.aid ?? 0),
    cid: it.cid,
    title: String(it.title ?? it.bvid),
    uploader: it.owner?.name ?? '',
    mid: it.owner?.mid,
    cover: fixCover(it.pic),
    duration: Number(it.duration ?? 0),
    play: Number(it.stat?.view ?? 0),
    danmaku: Number(it.stat?.danmaku ?? 0),
    like: Number(it.stat?.like ?? 0),
    pubdate: Number(it.pubdate ?? 0)
  }
}

/** 从关键字里识别 BV 号 / AV 号 / 视频链接 */
export function extractBvid(input: string): string | null {
  const s = input.trim()
  const bv = /(BV[0-9A-Za-z]{10})/.exec(s)
  if (bv) return bv[1]
  const av = /^(?:av)?(\d{4,})$/i.exec(s)
  if (av) return `av${av[1]}`
  return null
}

/** 解析 B站 弹幕 XML */
export function parseDanmakuXml(xml: string): DanmakuItem[] {
  const items: DanmakuItem[] = []
  const re = /<d p="([^"]+)">([^<]*)<\/d>/g
  let m: RegExpExecArray | null
  while ((m = re.exec(xml)) !== null) {
    const p = m[1].split(',')
    items.push({
      time: Number(p[0]) || 0,
      mode: Number(p[1]) || 1,
      color: '#' + Number(p[3] || 16777215).toString(16).padStart(6, '0'),
      text: m[2]
    })
  }
  return items
}

/** DanmakuItem → 伴生 XML（供播放器 loadDanmaku 读取） */
function danmakuToXml(items: DanmakuItem[]): string {
  const body = items
    .map((d) => {
      const color = parseInt((d.color || '#ffffff').replace('#', ''), 16) || 16777215
      const time = d.time.toFixed(3)
      const p = [time, d.mode ?? 1, 25, color, Math.floor(Date.now() / 1000), 0, '0', '0']
      const text = String(d.text ?? '').replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' })[c] ?? c)
      return `<d p="${p.join(',')}">${text}</d>`
    })
    .join('\n')
  return `<?xml version="1.0" encoding="UTF-8"?>\n<i>\n${body}\n</i>\n`
}

/** 用户资料（nav + 关系数） */
export async function fetchUserProfile(cookie: string | undefined): Promise<UserProfile | null> {
  if (!cookie) return null
  const res = await biliGet<{
    mid?: number
    uname?: string
    face?: string
    level_info?: { current_level?: number }
    money?: number
    vipType?: number
    isLogin?: boolean
  }>('/x/web-interface/nav', cookie)
  if (res.code !== 0 || !res.data?.mid) return null

  const stat = await biliGet<{ following?: number; follower?: number }>(
    `/x/relation/stat?vmid=${res.data.mid}`,
    cookie
  ).catch(() => null)

  return {
    mid: Number(res.data.mid),
    name: String(res.data.uname ?? ''),
    face: res.data.face ? fixCover(res.data.face) : undefined,
    level: Number(res.data.level_info?.current_level ?? 0),
    coins: Number(res.data.money ?? 0),
    following: Number(stat?.data?.following ?? 0),
    follower: Number(stat?.data?.follower ?? 0),
    vipType: Number(res.data.vipType ?? 0)
  }
}
