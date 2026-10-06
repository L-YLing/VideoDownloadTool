/**
 * 媒体服务（main/services/media-service.ts）
 * 依据 08-播放器设计 + 04-技术选型（内置 ffmpeg）：
 * - 用内置 ffmpeg 探测本地媒体的容器 / 视音频编码 / 时长
 * - 判断 Electron 内置播放器（Chromium）能否直接解码
 * - 对不能直接解码的常见编码（HEVC、MPEG-4 Part2、VC1、DTS、AC3、WMA…）
 *   转码为 H.264+AAC / MP4 后播放，实现「播放器支持更多常用编码」
 */
import { ChildProcess, spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import type { MediaCodecInfo, TranscodeTarget } from '../../shared/types'
import { resolveFfmpeg, cacheDir } from '../utils/paths'
import { CHROMIUM_AUDIO_CODECS, CHROMIUM_VIDEO_CODECS, buildTranscodeArgs, isContainerSupported, normalizeCodecName } from './codec-profile'

export interface ProbeResult extends MediaCodecInfo {
  file: string
  hasVideo: boolean
  hasAudio: boolean
  playable: boolean
  reason?: string
  target?: TranscodeTarget
}

export interface TranscodeProgress {
  id: string
  file: string
  percent: number
  done: boolean
  error?: string
  output?: string
}

/** 探测缓存：同一文件（大小+修改时间）不重复探测 */
const probeCache = new Map<string, { key: string; result: ProbeResult }>()
const PROBE_CACHE_MAX = 200

export class MediaService {
  private jobs = new Map<string, ChildProcess>()
  /** 用户手动指定的外部 ffmpeg（空 = 仅用内置） */
  private ffmpegPath: string | null = null
  /** 外部 ffmpeg 解析器（由主进程注入，用于自动探测系统 ffmpeg） */
  private externalFfmpegResolver: (() => Promise<string | null>) | null = null

  constructor(private onProgress?: (p: TranscodeProgress) => void) {}

  /** 设置外部 ffmpeg（设置项「外部 ffmpeg 路径」） */
  setFfmpegPath(p: string | null): void {
    this.ffmpegPath = p && p.trim() ? p.trim() : null
  }

  /** 注入外部 ffmpeg 自动探测（找不到内置编码器时二次尝试） */
  setExternalFfmpegResolver(fn: () => Promise<string | null>): void {
    this.externalFfmpegResolver = fn
  }

  private ffmpeg(): string {
    return this.ffmpegPath ?? resolveFfmpeg()
  }

  /** 探测媒体编码信息（结果按 路径+大小+mtime 缓存） */
  async probe(file: string): Promise<ProbeResult> {
    const key = this.cacheKey(file)
    const hit = probeCache.get(file)
    if (hit && hit.key === key) return hit.result

    const info = await this.runProbe(file)
    const result = this.decorate(file, info)
    if (probeCache.size > PROBE_CACHE_MAX) probeCache.clear()
    probeCache.set(file, { key, result })
    return result
  }

  private cacheKey(file: string): string {
    try {
      const st = fs.statSync(file)
      return `${st.size}:${st.mtimeMs}`
    } catch {
      return 'missing'
    }
  }

  /** 直接探测（不查缓存） */
  private runProbe(file: string): Promise<MediaCodecInfo & { hasVideo: boolean; hasAudio: boolean }> {
    return new Promise((resolvePromise) => {
      if (!fs.existsSync(file)) {
        resolvePromise({ hasVideo: false, hasAudio: false })
        return
      }
      const child = spawn(this.ffmpeg(), ['-hide_banner', '-i', file], {
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe']
      })
      let err = ''
      let timer: NodeJS.Timeout | undefined
      child.stderr.on('data', (d: Buffer) => {
        err += d.toString('utf-8')
        if (err.length > 512 * 1024) child.kill()
      })
      child.on('error', () => resolvePromise({ hasVideo: false, hasAudio: false }))
      child.on('close', () => {
        if (timer) clearTimeout(timer)
        resolvePromise(parseFfmpegInfo(err))
      })
      timer = setTimeout(() => child.kill(), 15000)
    })
  }

  /** 补充可播放性判断与建议转码目标 */
  private decorate(file: string, info: MediaCodecInfo & { hasVideo: boolean; hasAudio: boolean }): ProbeResult {
    const v = info.videoCodec ? normalizeCodecName(info.videoCodec) : undefined
    const a = info.audioCodec ? normalizeCodecName(info.audioCodec) : undefined

    const reasons: string[] = []
    if (!info.container) {
      reasons.push('无法识别媒体容器')
    } else if (!isContainerSupported(info.container)) {
      reasons.push(`容器 ${info.container} 不被内置播放器支持`)
    }
    if (info.hasVideo && v && !CHROMIUM_VIDEO_CODECS.has(v)) {
      reasons.push(`视频编码 ${info.videoCodec}`)
    }
    if (info.hasAudio && a && !CHROMIUM_AUDIO_CODECS.has(a)) {
      reasons.push(`音频编码 ${info.audioCodec}`)
    }
    if (!info.hasVideo && !info.hasAudio) {
      reasons.push('未找到可播放的音频/视频流')
    }

    const playable = reasons.length === 0
    return {
      ...info,
      file,
      hasVideo: info.hasVideo,
      hasAudio: info.hasAudio,
      playable,
      reason: playable ? undefined : `内置播放器无法直接解码（${reasons.join('、')}）`,
      target: playable ? undefined : this.defaultTarget(info.hasVideo)
    }
  }

  private defaultTarget(hasVideo: boolean): TranscodeTarget {
    return hasVideo ? { container: 'mp4', videoCodec: 'h264', audioCodec: 'aac' } : { container: 'm4a', audioCodec: 'aac' }
  }

  /** 兼容转码产物目录（落在缓存目录内，可被「清理缓存」回收） */
  private outDir(): string {
    const dir = path.join(cacheDir(), 'playback')
    fs.mkdirSync(dir, { recursive: true })
    return dir
  }

  /** 已转码产物的缓存路径（同名源文件复用，避免重复转码） */
  private cachedPath(file: string, target: TranscodeTarget): string {
    const base = path.basename(file, path.extname(file)).replace(/[\\/:*?"<>|]/g, '_').slice(0, 80)
    const hash = crypto.createHash('sha1').update(file).digest('hex').slice(0, 8)
    return path.join(this.outDir(), `${base}.${hash}.compat.${target.container}`)
  }

  /**
   * 兼容转码：把 Chromium 放不了的媒体转成 H.264+AAC/MP4（纯音频转 m4a/aac）。
   * 产物缓存复用；重复播放秒开。
   */
  async ensurePlayable(file: string, target?: TranscodeTarget): Promise<{ ok: boolean; path?: string; error?: string; cached?: boolean }> {
    const probe = await this.probe(file)
    if (probe.playable) return { ok: true, path: file }
    const t = target ?? probe.target ?? this.defaultTarget(probe.hasVideo)
    return this.transcode(file, t, probe.duration)
  }

  async transcode(
    file: string,
    target: TranscodeTarget,
    duration?: number
  ): Promise<{ ok: boolean; path?: string; error?: string; cached?: boolean }> {
    if (!fs.existsSync(file)) return { ok: false, error: '文件不存在' }

    const out = this.cachedPath(file, target)
    if (fs.existsSync(out) && fs.statSync(out).size > 0) {
      this.emit({ id: 'cached', file, percent: 100, done: true, output: out })
      return { ok: true, path: out, cached: true }
    }
    return this.transcodeTo(file, target, out, duration)
  }

  /**
   * 转码到指定输出路径（下载产物编码归一用：落在同一目录，不进缓存）。
   *
   * 三档降级（对应「自动调用系统解码/编码库，实在没辙再提示」）：
   *  1. 内置 ffmpeg（或用户在设置里指定的 ffmpeg）
   *  2. 内置缺少该编码器时 → 自动探测到的系统 ffmpeg 再试一次
   *  3. 都失败 → 返回明确错误由 UI 提示用户手动处理
   */
  async transcodeTo(
    file: string,
    target: TranscodeTarget,
    out: string,
    duration?: number
  ): Promise<{ ok: boolean; path?: string; error?: string; cached?: boolean }> {
    if (!fs.existsSync(file)) return { ok: false, error: '文件不存在' }

    const primary = this.ffmpeg()
    const first = await this.runTranscode(primary, file, target, out, duration)
    if (first.ok) return first

    // 内置 ffmpeg 不具备该编码器/滤镜时，尝试系统 ffmpeg
    if (!this.ffmpegPath && this.externalFfmpegResolver && isMissingCapability(first.error ?? '')) {
      try {
        const ext = await this.externalFfmpegResolver()
        if (ext && fs.existsSync(ext) && ext !== primary) {
          const retry = await this.runTranscode(ext, file, target, out, duration)
          if (retry.ok) return retry
        }
      } catch {
        /* 外部 ffmpeg 不可用则沿用首个错误 */
      }
    }
    return first
  }

  /** 实际执行一次 ffmpeg 转码 */
  private runTranscode(
    bin: string,
    file: string,
    target: TranscodeTarget,
    out: string,
    duration?: number
  ): Promise<{ ok: boolean; path?: string; error?: string }> {
    const args = buildTranscodeArgs(file, out, target)
    const id = `tr_${Date.now().toString(36)}`
    this.emit({ id, file, percent: 0, done: false })

    return new Promise((resolvePromise) => {
      const child = spawn(bin, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
      this.jobs.set(id, child)
      let stderr = ''
      let lastPercent = 0

      child.stdout.on('data', (d: Buffer) => {
        const text = d.toString('utf-8')
        const pct = parseFfmpegProgress(text, duration)
        if (pct != null && pct > lastPercent) {
          lastPercent = Math.min(99, pct)
          this.emit({ id, file, percent: lastPercent, done: false })
        }
      })
      child.stderr.on('data', (d: Buffer) => {
        stderr += d.toString('utf-8')
        if (stderr.length > 512 * 1024) stderr = stderr.slice(-64 * 1024)
      })
      child.on('error', (e) => {
        this.jobs.delete(id)
        this.emit({ id, file, percent: 0, done: true, error: `无法启动 ffmpeg: ${e.message}` })
        resolvePromise({ ok: false, error: `无法启动 ffmpeg: ${e.message}` })
      })
      child.on('close', (code) => {
        this.jobs.delete(id)
        if (code === 0 && fs.existsSync(out) && fs.statSync(out).size > 0) {
          this.emit({ id, file, percent: 100, done: true, output: out })
          resolvePromise({ ok: true, path: out })
          return
        }
        try {
          if (fs.existsSync(out)) fs.unlinkSync(out)
        } catch {
          /* ignore */
        }
        const msg = lastErrorLine(stderr) || `ffmpeg 退出码 ${code}`
        this.emit({ id, file, percent: 0, done: true, error: msg })
        resolvePromise({ ok: false, error: msg })
      })
    })
  }

  /** 取消正在进行的转码 */
  cancel(id: string): boolean {
    const child = this.jobs.get(id)
    if (!child) return false
    try {
      child.kill()
    } catch {
      /* ignore */
    }
    this.jobs.delete(id)
    return true
  }

  private emit(p: TranscodeProgress): void {
    if (this.onProgress) {
      try {
        this.onProgress(p)
      } catch (e) {
        console.error('[media] 转码进度回调异常:', e)
      }
    }
  }
}

/** 解析 ffmpeg -i 输出的流信息 */
export function parseFfmpegInfo(text: string): MediaCodecInfo & { hasVideo: boolean; hasAudio: boolean } {
  const out: MediaCodecInfo & { hasVideo: boolean; hasAudio: boolean } = { hasVideo: false, hasAudio: false }

  const container = text.match(/Input #\d+,\s*([^,]+),/)
  if (container) out.container = container[1].trim()

  const dur = text.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/)
  if (dur) out.duration = Number(dur[1]) * 3600 + Number(dur[2]) * 60 + Number(dur[3])

  const video = text.match(/Stream #[\d.:[\]a-z0-9()]*:\s*Video:\s*([a-z0-9_.\-]+)/i)
  if (video) {
    out.videoCodec = video[1]
    out.hasVideo = true
  }

  const audio = text.match(/Stream #[\d.:[\]a-z0-9()]*:\s*Audio:\s*([a-z0-9_.\-]+)/i)
  if (audio) {
    out.audioCodec = audio[1]
    out.hasAudio = true
  }

  const size = text.match(/Video:\s*[a-z0-9_.\-]+[^,]*,[^,]*,?\s*(\d{2,5})x(\d{2,5})/i)
  if (size) {
    out.width = Number(size[1])
    out.height = Number(size[2])
  }
  return out
}

/** 解析 ffmpeg -progress 输出，得到百分比 */
export /** 判断 ffmpeg 报错是否属于「当前二进制不具备该能力」（可换外部 ffmpeg 再试） */
function isMissingCapability(msg: string): boolean {
  return /Unknown encoder|Unknown decoder|No such filter|not found|Invalid argument|Unrecognized option|Cannot load|Decoder \(codec .*\) not found|Encoder \(codec .*\) not found/i.test(
    msg
  )
}

function parseFfmpegProgress(text: string, duration?: number): number | null {
  const ms = text.match(/out_time_ms=(\d+)/)
  if (ms && duration && duration > 0) {
    return Math.min(99, (Number(ms[1]) / 1e6 / duration) * 100)
  }
  const us = text.match(/out_time_us=(\d+)/)
  if (us && duration && duration > 0) {
    return Math.min(99, (Number(us[1]) / 1e6 / duration) * 100)
  }
  const t = text.match(/out_time=(\d+):(\d+):(\d+(?:\.\d+)?)/)
  if (t && duration && duration > 0) {
    const sec = Number(t[1]) * 3600 + Number(t[2]) * 60 + Number(t[3])
    return Math.min(99, (sec / duration) * 100)
  }
  return null
}

function lastErrorLine(stderr: string): string {
  const lines = stderr
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('frame=') && !l.startsWith('[out#') && !l.startsWith('Press '))
  return lines.filter((l) => /error|invalid|unable|failed|not supported|no such/i.test(l)).slice(-1)[0] ?? lines.slice(-1)[0] ?? ''
}
