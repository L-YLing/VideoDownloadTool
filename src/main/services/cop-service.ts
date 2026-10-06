/**
 * .cop 音频包服务（main/services/cop-service.ts）
 * 仅音频模式下把「音频 + LRC 歌词」打包为 .cop（本质未压缩 ZIP，改后缀即可解压）。
 * 播放器打开 .cop 时自动解包到缓存目录并播放音频 + 载入歌词。
 */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import type { CopMeta, LyricLine } from '../../shared/types'
import { zipCreate, zipRead } from '../utils/zip-lite'
import { cacheDir } from '../utils/paths'

/** LRC 解析：支持 [mm:ss.xx]、[mm:ss:xx]、多时间标签、offset */
export function parseLrc(text: string): LyricLine[] {
  const lines: LyricLine[] = []
  let offset = 0
  const offsetMatch = text.match(/\[offset:\s*(-?\d+)\s*\]/i)
  if (offsetMatch) offset = Number(offsetMatch[1]) / 1000

  const re = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g
  for (const raw of text.split(/\r?\n/)) {
    const times: number[] = []
    let m: RegExpExecArray | null
    re.lastIndex = 0
    while ((m = re.exec(raw)) !== null) {
      const min = Number(m[1])
      const sec = Number(m[2])
      const fracRaw = m[3] ?? '0'
      // 补齐小数位：[00:01.2] → 200ms，[00:01.23] → 230ms
      const frac = Number(fracRaw) / Math.pow(10, fracRaw.length)
      times.push(min * 60 + sec + frac)
    }
    const content = raw.replace(/\[[^\]]*\]/g, '').trim()
    if (times.length === 0 || !content) continue
    for (const t of times) lines.push({ time: Math.max(0, t + offset), text: content })
  }
  return lines.sort((a, b) => a.time - b.time)
}

export function lrcToText(lines: LyricLine[]): string {
  return lines
    .map((l) => {
      const m = Math.floor(l.time / 60)
      const s = Math.floor(l.time % 60)
      const cs = Math.floor((l.time % 1) * 100)
      return `[${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}]${l.text}`
    })
    .join('\n')
}

export class CopService {
  /** 解包目录（缓存内，可被清理缓存回收） */
  private unpackDir(): string {
    const dir = path.join(cacheDir(), 'cop')
    fs.mkdirSync(dir, { recursive: true })
    return dir
  }

  /**
   * 导出 .cop：音频 + 歌词 + 元信息。
   *
   * 歌词来源优先级：
   *   ① lyricLines（播放器内存中的歌词，直接打包）—— 推荐，不依赖任何磁盘写入；
   *   ② lyricFile（磁盘上的 .lrc 伴生文件）—— 兼容旧调用。
   *
   * 之所以传入内存歌词：以前仅依赖「写侧车 .lrc 成功」才带歌词，
   * 若音频位于只读目录 / 缓存目录写入失败，导出的 .cop 会**静默丢失歌词**，
   * 而歌词正是 .cop 这种打包格式存在的意义。
   *
   * @param audioFile 源音频（mp3/flac/wav/m4a …）
   * @param outFile 输出 .cop 路径
   * @param meta 元信息（标题 / 艺术家 / 专辑）
   * @param lyricFile 可选：磁盘上的 .lrc
   * @param lyricLines 可选：内存中的歌词行（优先于 lyricFile）
   */
  async export(
    audioFile: string,
    outFile: string,
    meta: Partial<CopMeta> = {},
    lyricFile?: string,
    lyricLines?: LyricLine[]
  ): Promise<{ ok: boolean; error?: string; size?: number; hasLyric?: boolean }> {
    try {
      if (!fs.existsSync(audioFile)) return { ok: false, error: '音频文件不存在' }
      const audioName = `audio${path.extname(audioFile).toLowerCase()}`
      const entries = [{ name: audioName, data: fs.readFileSync(audioFile) }]

      // 歌词文本：内存优先，其次磁盘文件
      let lyricText: string | undefined
      if (lyricLines && lyricLines.length > 0) {
        lyricText = lrcToText(lyricLines)
      } else if (lyricFile && fs.existsSync(lyricFile)) {
        lyricText = fs.readFileSync(lyricFile, 'utf-8')
      }
      const lyricName = lyricText ? 'lyric.lrc' : undefined
      if (lyricText) entries.push({ name: lyricName!, data: Buffer.from(lyricText, 'utf-8') })

      const metaData: CopMeta = {
        format: 'vd-cop',
        version: 1,
        title: meta.title || path.basename(audioFile, path.extname(audioFile)),
        artist: meta.artist,
        album: meta.album,
        audio: audioName,
        lyric: lyricName,
        createdAt: Date.now()
      }
      entries.unshift({ name: 'meta.json', data: Buffer.from(JSON.stringify(metaData, null, 2), 'utf-8') })

      fs.writeFileSync(outFile, zipCreate(entries))
      return { ok: true, size: fs.statSync(outFile).size, hasLyric: Boolean(lyricName) }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  }

  /**
   * 导入 .cop：解包到缓存并返回可直接播放的音频路径 + 歌词行
   * 同名文件已解包过则直接复用（无需重复解压）
   */
  async import_(copFile: string): Promise<{
    ok: boolean
    error?: string
    audio?: string
    lyric?: string
    lines?: LyricLine[]
    meta?: CopMeta
  }> {
    try {
      if (!fs.existsSync(copFile)) return { ok: false, error: '文件不存在' }
      const hash = crypto.createHash('sha1').update(`${copFile}:${fs.statSync(copFile).size}:${fs.statSync(copFile).mtimeMs}`).digest('hex').slice(0, 12)
      const dir = path.join(this.unpackDir(), hash)
      if (!fs.existsSync(dir)) {
        const entries = zipRead(fs.readFileSync(copFile))
        fs.mkdirSync(dir, { recursive: true })
        for (const e of entries) {
          const target = path.join(dir, path.basename(e.name))
          fs.writeFileSync(target, e.data)
        }
      }

      let meta: CopMeta | undefined
      const metaFile = path.join(dir, 'meta.json')
      if (fs.existsSync(metaFile)) {
        try {
          meta = JSON.parse(fs.readFileSync(metaFile, 'utf-8')) as CopMeta
        } catch {
          meta = undefined
        }
      }

      // 定位音频：优先 meta.audio，否则取第一个音频扩展名文件
      const audioExts = ['.mp3', '.flac', '.wav', '.m4a', '.aac', '.ogg', '.opus', '.wma', '.ape']
      let audio: string | undefined
      if (meta?.audio && fs.existsSync(path.join(dir, path.basename(meta.audio)))) {
        audio = path.join(dir, path.basename(meta.audio))
      } else {
        const found = fs.readdirSync(dir).find((f) => audioExts.includes(path.extname(f).toLowerCase()))
        if (found) audio = path.join(dir, found)
      }
      if (!audio) return { ok: false, error: '包内未找到音频文件' }

      // 歌词：
      //   ① 优先 .cop 同名的外部 .lrc（用户可自行替换/修正歌词，改完直接生效）
      //   ② 其次用包内嵌入的 lyric.lrc
      let lyric: string | undefined
      let lines: LyricLine[] | undefined
      const sidecar = this.loadSidecarLyric(copFile)
      if (sidecar && sidecar.length > 0) {
        lyric = copFile.replace(/\.[^.]+$/, '.lrc')
        lines = sidecar
      } else {
        const lrcFile = meta?.lyric
          ? path.join(dir, path.basename(meta.lyric))
          : path.join(dir, 'lyric.lrc')
        if (fs.existsSync(lrcFile)) {
          lyric = lrcFile
          lines = parseLrc(fs.readFileSync(lrcFile, 'utf-8'))
        }
      }

      return { ok: true, audio, lyric, lines, meta }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  }

  /** 读取与音频同名的 .lrc（未打包时的常规伴生歌词） */
  loadSidecarLyric(audioFile: string): LyricLine[] | null {
    const lrc = audioFile.replace(/\.[^.]+$/, '.lrc')
    if (!fs.existsSync(lrc)) return null
    try {
      return parseLrc(fs.readFileSync(lrc, 'utf-8'))
    } catch {
      return null
    }
  }

  /** 把导入的歌词保存为音频的伴生 .lrc（下次打开自动加载） */
  saveSidecarLyric(audioFile: string, lines: LyricLine[]): boolean {
    try {
      fs.writeFileSync(audioFile.replace(/\.[^.]+$/, '.lrc'), lrcToText(lines), 'utf-8')
      return true
    } catch {
      return false
    }
  }
}
