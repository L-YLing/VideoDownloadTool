/**
 * 下载前解析预览（main/services/preview-service.ts）
 * 依据 06 §1：用户粘贴链接后先解析出「标题 / 作者 / 封面 / 时长 / 大小」，
 * 确认无误再入队下载，避免“下了才知道是什么”。
 */
import type {
  DownloadInput,
  DownloadOptions,
  InputKind,
  PreviewItem,
  PreviewResult,
  VideoCodec
} from '../../shared/types'
import { BilibiliAdapter } from './bilibili-adapter'
import { SettingsService } from './settings-service'
import { buildFormatSelector } from './codec-profile'
import { spawnYtDlpJson } from './yt-dlp-runner'
import { isBilibili, normalizeBiliInput, parseBatchInput } from '../utils/normalize'
import { shortId } from '../utils/paths'

/** 单条解析的并发上限（低资源友好） */
const CONCURRENCY = 4
/** 单条解析超时 */
const TIMEOUT_MS = 45000

export class PreviewService {
  constructor(
    private settings: SettingsService,
    private bili: BilibiliAdapter,
    private authCookie: () => string | undefined
  ) {}

  /**
   * 解析输入列表 → 预览条目。
   * - 单视频：yt-dlp -J 取标题/作者/封面/时长/按当前画质估算大小
   * - 收藏夹 / 合集：先展开为视频列表（取服务端元数据，大小留空）
   * - 批量文本：拆行后逐条解析
   */
  async preview(inputs: DownloadInput[], options: DownloadOptions): Promise<PreviewResult> {
    const settings = this.settings.get()
    const content = options.content ?? settings.content
    const quality = options.quality ?? settings.quality
    const videoCodec = settings.videoCodec

    const flat: DownloadInput[] = []
    for (const input of inputs) {
      if (input.kind === 'batch') {
        for (const line of parseBatchInput(input.source)) {
          flat.push({ source: line, kind: 'single', cookie: input.cookie })
        }
        continue
      }
      flat.push(input)
    }

    const items: PreviewItem[] = []
    const errors: Array<{ source: string; error: string }> = []
    let cursor = 0

    const worker = async (): Promise<void> => {
      while (cursor < flat.length) {
        const input = flat[cursor++]
        try {
          const expanded = await this.expand(input, content, quality, videoCodec)
          items.push(...expanded)
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e)
          errors.push({ source: input.source, error: msg })
          items.push({ id: shortId('pv'), source: input.source, kind: input.kind, error: msg })
        }
      }
    }

    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, Math.max(1, flat.length)) }, worker))

    // 保持输入顺序
    const order = new Map(flat.map((f, i) => [f.source, i]))
    items.sort((a, b) => (order.get(a.source) ?? 0) - (order.get(b.source) ?? 0))
    return { items, errors }
  }

  private async expand(
    input: DownloadInput,
    content: DownloadOptions['content'],
    quality: number,
    videoCodec: VideoCodec
  ): Promise<PreviewItem[]> {
    const source = input.source.trim()
    if (!source) return []

    const kind = input.kind
    if (kind === 'favorite' || kind === 'collection') {
      return this.expandPlaylist(input, source)
    }

    // 即使 kind 标成 single，链接本身也可能是收藏夹（用户直接粘贴）
    if (kind === 'single' && /bilibili\.com|b23\.tv/i.test(source) && /\/favlist|\/medialist|list\?fid=/.test(source)) {
      return this.expandPlaylist(input, source)
    }

    if (!isBilibili(source)) {
      throw new Error('该源暂不支持（内置仅支持 B站，可通过插件扩展）')
    }

    // 关键：裸 BV / av 号必须归一化成完整 URL 再交给 yt-dlp，
    // 否则「解析预览」会报 `[generic] 'BVxxxx' is not a valid URL`（下载路径已单独归一化）
    const target = normalizeBiliInput(source).ytdlpUrl ?? source
    const item = await this.resolveOne(target, kind, content, quality, videoCodec)
    return [item]
  }

  /** 展开收藏夹 / 合集：优先服务端接口（含封面与作者），大小留空 */
  private async expandPlaylist(input: DownloadInput, source: string): Promise<PreviewItem[]> {
    const cookie = input.cookie ?? this.authCookie()
    const parsed = await this.bili.parseFavorite(source, undefined, cookie)
    return parsed.videos.map((v) => ({
      id: shortId('pv'),
      source: v.url,
      kind: 'single' as InputKind,
      title: v.title,
      uploader: v.uploader,
      thumbnail: v.cover,
      duration: v.duration,
      parentTitle: parsed.info.name
    }))
  }

  /** 解析单个视频（含按当前画质估算的大小） */
  private async resolveOne(
    source: string,
    kind: InputKind,
    content: DownloadOptions['content'],
    quality: number,
    videoCodec: VideoCodec
  ): Promise<PreviewItem> {
    const args: string[] = ['--skip-download', '--no-warnings', '--no-playlist']
    const cookie = this.authCookie()
    if (cookie) args.push('--add-header', `Cookie: ${cookie}`)
    if (content !== 'audio') {
      args.push('-f', buildFormatSelector(content, quality, videoCodec))
    } else {
      args.push('-f', 'ba/b')
    }
    args.push(source)

    const json = await spawnYtDlpJson(args, { timeoutMs: TIMEOUT_MS })
    const thumb = json.thumbnail ? String(json.thumbnail) : undefined
    return {
      id: shortId('pv'),
      source: String(json.webpage_url ?? json.original_url ?? source),
      kind,
      title: json.title ? String(json.title) : undefined,
      uploader: json.uploader ? String(json.uploader) : undefined,
      thumbnail: thumb ? (thumb.startsWith('http://') ? 'https://' + thumb.slice(7) : thumb) : undefined,
      duration: json.duration ? Number(json.duration) : undefined,
      size: estimateSize(json)
    }
  }
}

/**
 * 估算最终产物大小：
 * - 优先使用 requested_formats（按当前 -f 选择器实际选中的音视频流求和）
 * - 其次顶层 filesize / filesize_approx
 */
function estimateSize(json: any): number | undefined {
  const sum = (list: any[]): number => {
    let total = 0
    let any = false
    for (const f of list) {
      const n = Number(f?.filesize ?? f?.filesize_approx ?? 0)
      if (Number.isFinite(n) && n > 0) {
        total += n
        any = true
      }
    }
    return any ? total : 0
  }
  if (Array.isArray(json?.requested_formats) && json.requested_formats.length > 0) {
    const s = sum(json.requested_formats)
    if (s > 0) return s
  }
  const direct = Number(json?.filesize ?? json?.filesize_approx ?? 0)
  return Number.isFinite(direct) && direct > 0 ? direct : undefined
}
