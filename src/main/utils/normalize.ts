/**
 * 输入归一化（main/utils/normalize.ts）
 * 依据 07-B站接入：URL / BV / AV 识别与转换。
 */

export type BiliInputKind = 'bvid' | 'avid' | 'url' | 'favlist' | 'collection' | 'unknown'

export interface NormalizedInput {
  kind: BiliInputKind
  value: string
  /** 可直接交给 yt-dlp 的地址 */
  ytdlpUrl?: string
  /** 收藏夹 / 合集 ID（favlist 的 fid、medialist 的 biz_id） */
  id?: string
  raw: string
}

const BV_RE = /BV[0-9A-Za-z]{10}/
const AV_RE = /av(\d+)/i
const EP_RE = /ep(\d+)/i
const SS_RE = /ss(\d+)/i

/** 判断输入是否为 B站 相关内容 */
export function isBilibili(raw: string): boolean {
  return (
    BV_RE.test(raw) ||
    AV_RE.test(raw) ||
    /bilibili\.com|b23\.tv/i.test(raw) ||
    /^BV[0-9A-Za-z]{10}$/.test(raw.trim())
  )
}

/** 从任意文本中提取 B站 标识 */
export function extractBiliId(raw: string): string | null {
  const bv = raw.match(BV_RE)
  if (bv) return bv[0]
  const av = raw.match(AV_RE)
  if (av) return `av${av[1]}`
  return null
}

/**
 * 归一化输入，产出可交付 yt-dlp 的地址。
 * 收藏夹 URL：https://space.bilibili.com/{uid}/favlist?fid={fid}
 * 合集 URL：https://www.bilibili.com/medialist/play/{id} 或 space 合集
 */
export function normalizeBiliInput(raw: string): NormalizedInput {
  const input = raw.trim()
  const bv = input.match(BV_RE)
  if (bv) return { kind: 'bvid', value: bv[0], ytdlpUrl: `https://www.bilibili.com/video/${bv[0]}`, raw: input }
  const av = input.match(AV_RE)
  if (av) return { kind: 'avid', value: av[0], ytdlpUrl: `https://www.bilibili.com/video/${av[0]}`, raw: input }
  const ep = input.match(EP_RE)
  if (ep) return { kind: 'url', value: ep[0], ytdlpUrl: input, raw: input }
  const ss = input.match(SS_RE)
  if (ss) return { kind: 'url', value: ss[0], ytdlpUrl: input, raw: input }
  if (/bilibili\.com|b23\.tv/i.test(input)) {
    // 收藏夹：路径中含 /favlist、/medialist，或 list?fid= 形式
    if (/\/favlist|\/medialist|list\?fid=/.test(input)) {
      const fid = matchFavId(input)
      return { kind: 'favlist', value: fid ?? input, id: fid, ytdlpUrl: input, raw: input }
    }
    if (/\/medialist\/play|\/collection|\/channel/i.test(input) && !/\/video\//.test(input)) {
      const mlid = input.match(/\/medialist\/play\/(\d+)/)?.[1] ?? input.match(/[?&]business_id=(\d+)/)?.[1]
      return { kind: 'collection', value: mlid ?? input, id: mlid, ytdlpUrl: input, raw: input }
    }
    return { kind: 'url', value: input, ytdlpUrl: input, raw: input }
  }
  // 纯数字视为收藏夹 ID（服务端下发时使用）
  if (/^\d{3,}$/.test(input)) {
    return { kind: 'favlist', value: input, id: input, ytdlpUrl: `https://www.bilibili.com/medialist/detail/${input}`, raw: input }
  }
  return { kind: 'unknown', value: input, raw: input }
}

/** 从收藏夹链接中提取 fid（支持 ?fid=、/favlist/{id}、/medialist/detail/{id}） */
export function matchFavId(input: string): string | undefined {
  return (
    input.match(/[?&]fid=(\d+)/)?.[1] ??
    input.match(/\/favlist\/(\d+)/)?.[1] ??
    input.match(/\/medialist\/detail\/(\d+)/)?.[1] ??
    input.match(/\/medialist\/play\/ml(\d+)/)?.[1] ??
    undefined
  )
}

/** 解析批量输入：每行一个，忽略空行与 # 注释 */
export function parseBatchInput(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith('#'))
}

/** 目录模板占位符展开（10-文件组织模板） */
export function applyRenameTemplate(
  template: string,
  vars: {
    title?: string
    uploader?: string
    quality?: string
    index?: number
    favName?: string
    date?: string
    ext?: string
  }
): string {
  const date = vars.date ?? new Date().toISOString().slice(0, 10)
  const safe = (s: string | undefined, fallback = '未知'): string => {
    if (!s || !s.trim()) return fallback
    // 去掉 Windows 非法文件名字符
    return s.replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, ' ').trim()
  }
  return template
    .replace(/\{title\}/g, safe(vars.title))
    .replace(/\{uploader\}/g, safe(vars.uploader, '未知UP主'))
    .replace(/\{quality\}/g, safe(vars.quality, 'auto'))
    .replace(/\{index\}/g, vars.index != null ? String(vars.index).padStart(2, '0') : '')
    .replace(/\{favName\}/g, safe(vars.favName))
    .replace(/\{date\}/g, date)
    .replace(/\{ext\}/g, vars.ext ?? 'mp4')
}
