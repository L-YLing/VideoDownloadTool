/**
 * 在线歌词服务（main/services/lyric-service.ts）
 *
 * 仅音频模式下，用户可「在线搜索歌词」：
 *   ① 按关键词搜索歌曲（标题 / 歌手 / 专辑 / 时长）
 *   ② 用户选中后拉取该曲目的 LRC 文本并解析为时间轴歌词
 *
 * 数据来源：网易云音乐公开接口（无需登录、返回标准 LRC）
 *   - 搜索：POST https://music.163.com/api/search/get/web
 *   - 歌词：GET  https://music.163.com/api/song/lyric
 *
 * 说明：这里用主进程 Node 的 fetch 发起请求。Node（undici）不会读取 Windows
 * 注册表里的系统代理，因此**不受** Steam++ / 加速器写入的系统代理影响，
 * 也就不会出现 yt-dlp 那种 SSL 证书校验失败的问题。
 */
import type { LyricLine, LyricSearchItem } from '../../shared/types'
import { parseLrc } from './cop-service'

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'

/** 网易云对未带 Cookie 的请求可能返回空结果，这里带上最简 PC 客户端标识 */
const COMMON_HEADERS: Record<string, string> = {
  'User-Agent': UA,
  Referer: 'https://music.163.com/',
  Cookie: 'os=pc; appver=2.9.7',
  'Accept-Language': 'zh-CN,zh;q=0.9'
}

interface NeSong {
  id: number
  name: string
  artists?: Array<{ name?: string }>
  album?: { name?: string }
  duration?: number
}

export class LyricService {
  /** 搜索歌曲；返回精简后的候选列表供用户挑选 */
  async search(
    keyword: string,
    limit = 20
  ): Promise<{ ok: boolean; items?: LyricSearchItem[]; error?: string }> {
    const kw = String(keyword ?? '').trim()
    if (!kw) return { ok: false, error: '请输入歌曲名 / 歌手' }
    try {
      const body = new URLSearchParams({
        s: kw,
        type: '1', // 单曲
        offset: '0',
        limit: String(Math.max(1, Math.min(50, limit)))
      })
      const res = await fetch('https://music.163.com/api/search/get/web', {
        method: 'POST',
        headers: { ...COMMON_HEADERS, 'Content-Type': 'application/x-www-form-urlencoded' },
        body
      })
      if (!res.ok) return { ok: false, error: `搜索失败（HTTP ${res.status}）` }
      const json = (await res.json()) as { result?: { songs?: NeSong[] }; code?: number }
      const songs = json.result?.songs ?? []
      const items: LyricSearchItem[] = songs.map((s) => ({
        id: Number(s.id),
        title: String(s.name ?? ''),
        artist: (s.artists ?? []).map((a) => a.name).filter(Boolean).join(' / '),
        album: String(s.album?.name ?? ''),
        duration: Math.round((Number(s.duration ?? 0) || 0) / 1000)
      }))
      if (items.length === 0) return { ok: false, error: '没有搜到匹配的歌曲，换个关键词试试' }
      return { ok: true, items }
    } catch (e) {
      return { ok: false, error: `搜索失败：${e instanceof Error ? e.message : String(e)}` }
    }
  }

  /** 拉取指定歌曲的 LRC 并解析为行数组 */
  async fetchLyric(songId: number): Promise<{ ok: boolean; lines?: LyricLine[]; lrc?: string; error?: string }> {
    if (!songId) return { ok: false, error: '缺少歌曲 id' }
    try {
      const url = `https://music.163.com/api/song/lyric?id=${songId}&lv=-1&kv=-1&tv=-1`
      const res = await fetch(url, { headers: COMMON_HEADERS })
      if (!res.ok) return { ok: false, error: `获取歌词失败（HTTP ${res.status}）` }
      const json = (await res.json()) as { lrc?: { lyric?: string } }
      const lrc = String(json.lrc?.lyric ?? '')
      if (!lrc.trim()) return { ok: false, error: '该曲目暂无歌词（可能为纯音乐）' }
      const lines = parseLrc(lrc)
      if (lines.length === 0) return { ok: false, error: '歌词解析为空（可能只有翻译或纯音乐）' }
      return { ok: true, lines, lrc }
    } catch (e) {
      return { ok: false, error: `获取歌词失败：${e instanceof Error ? e.message : String(e)}` }
    }
  }
}
