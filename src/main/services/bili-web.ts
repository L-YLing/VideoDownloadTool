/**
 * B站 Web API 客户端（main/services/bili-web.ts）
 * 供「探索」与「用户」页使用：分区浏览、视频元数据、弹幕、评论、点赞。
 *
 * 统一在此处处理：
 * - 浏览器请求头（UA / Referer）：缺少 Referer 会被风控直接拒
 * - 登录态 Cookie：来自 AuthService，未登录时该字段为空
 * - 友好节流：串行 + 最小间隔，避免高频请求触发风控（07 合规）
 */

import { createHash } from 'node:crypto'

export const WEB_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'

const API = 'https://api.bilibili.com'

export interface BiliResult<T> {
  code: number
  message: string
  data: T
}

let lastRequestAt = 0
let chain: Promise<unknown> = Promise.resolve()

/** 串行 + 最小间隔，防止并发请求把账号送进风控 */
function throttle<T>(fn: () => Promise<T>): Promise<T> {
  const run = async (): Promise<T> => {
    const wait = 120 - (Date.now() - lastRequestAt)
    if (wait > 0) await new Promise((r) => setTimeout(r, wait))
    lastRequestAt = Date.now()
    return fn()
  }
  const p = chain.then(run, run)
  chain = p.catch(() => undefined)
  return p
}

function headers(cookie?: string, referer?: string): Record<string, string> {
  const h: Record<string, string> = {
    'User-Agent': WEB_UA,
    Accept: 'application/json, text/plain, */*',
    'Accept-Language': 'zh-CN,zh;q=0.9'
  }
  if (referer) h.Referer = referer
  h.Origin = 'https://www.bilibili.com'
  return cookie ? { ...h, Cookie: cookie } : h
}

/** GET JSON（带节流） */
export async function biliGet<T>(
  path: string,
  cookie?: string,
  referer = 'https://www.bilibili.com/',
  timeoutMs = 15000
): Promise<BiliResult<T>> {
  return throttle(async () => {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), timeoutMs)
    try {
      const res = await fetch(`${API}${path}`, { headers: headers(cookie, referer), signal: ctrl.signal })
      return (await res.json()) as BiliResult<T>
    } finally {
      clearTimeout(timer)
    }
  })
}

/** GET 原始文本（弹幕 XML） */
export async function biliGetText(
  path: string,
  cookie?: string,
  referer = 'https://www.bilibili.com/'
): Promise<string> {
  return throttle(async () => {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 15000)
    try {
      const res = await fetch(`${API}${path}`, { headers: headers(cookie, referer), signal: ctrl.signal })
      return await res.text()
    } finally {
      clearTimeout(timer)
    }
  })
}

/** POST form（点赞等需要 csrf 的操作） */
export async function biliPost<T>(
  path: string,
  form: Record<string, string>,
  cookie?: string,
  csrf?: string
): Promise<BiliResult<T>> {
  return throttle(async () => {
    const body = new URLSearchParams({ ...form })
    if (csrf) body.set('csrf', csrf)
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 15000)
    try {
      const res = await fetch(`${API}${path}`, {
        method: 'POST',
        headers: { ...headers(cookie, 'https://www.bilibili.com/'), 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
        signal: ctrl.signal
      })
      return (await res.json()) as BiliResult<T>
    } finally {
      clearTimeout(timer)
    }
  })
}

// ---------- WBI 签名 ----------
/**
 * B站 的搜索等接口要求 WBI 签名（缺签名会返回 -403）。
 * 算法：从 nav 接口取 img_key / sub_key → 按固定表重排后截取前 32 位得到 mixinKey
 * → 参数按 key 排序拼接 → md5(拼接串 + mixinKey) 作为 w_rid。
 * 已实测可用（搜索返回 code 0、正常分页）。
 */
const MIXIN_KEY_ENC_TAB = [
  46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49, 33, 9, 42, 19, 29, 28, 14, 39,
  12, 38, 41, 13, 37, 48, 7, 16, 24, 55, 40, 61, 26, 17, 0, 1, 60, 51, 30, 4, 22, 25, 54, 21, 56, 59, 6, 63, 57,
  62, 11, 36, 20, 34, 44, 52
]

let wbiKeys: { imgKey: string; subKey: string; at: number } | null = null

async function getWbiKeys(cookie?: string): Promise<{ imgKey: string; subKey: string }> {
  if (wbiKeys && Date.now() - wbiKeys.at < 12 * 3600 * 1000) {
    return { imgKey: wbiKeys.imgKey, subKey: wbiKeys.subKey }
  }
  const res = await biliGet<{ wbi_img?: { img_url?: string; sub_url?: string } }>(
    '/x/web-interface/nav',
    cookie
  )
  const pick = (u?: string): string => (u ? u.slice(u.lastIndexOf('/') + 1).split('.')[0] : '')
  const imgKey = pick(res.data?.wbi_img?.img_url)
  const subKey = pick(res.data?.wbi_img?.sub_url)
  if (!imgKey || !subKey) throw new Error('无法获取 WBI 签名密钥（nav 接口未返回 wbi_img）')
  wbiKeys = { imgKey, subKey, at: Date.now() }
  return { imgKey, subKey }
}

function mixinKeyOf(imgKey: string, subKey: string): string {
  const orig = imgKey + subKey
  return MIXIN_KEY_ENC_TAB.map((i) => orig[i] ?? '').join('').slice(0, 32)
}

/** 带 WBI 签名的 GET（搜索 / 部分新版接口必需） */
export async function biliWbiGet<T>(
  path: string,
  params: Record<string, string | number>,
  cookie?: string,
  referer = 'https://www.bilibili.com/'
): Promise<BiliResult<T>> {
  const { imgKey, subKey } = await getWbiKeys(cookie)
  const mixinKey = mixinKeyOf(imgKey, subKey)
  const signed: Record<string, string | number> = { ...params, wts: Math.floor(Date.now() / 1000) }
  const query = Object.keys(signed)
    .sort()
    .map(
      (k) =>
        `${encodeURIComponent(k)}=${encodeURIComponent(String(signed[k]).replace(/[!'()*]/g, ''))}`
    )
    .join('&')
  const wRid = createHash('md5').update(query + mixinKey).digest('hex')
  return biliGet<T>(`${path}?${query}&w_rid=${wRid}`, cookie, referer)
}
