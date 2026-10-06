/**
 * 编码策略（main/services/codec-profile.ts）
 * 统一「设置 → yt-dlp 格式选择 / 容器 / 目标编码」的映射，
 * 修复「选了 mp4 却下载到 AV1」这类容器与编码不一致的问题（06 §1.2 / §3 格式转换）。
 */
import type { AudioCodec, TranscodeTarget, VideoCodec } from '../../shared/types'

/** 某容器下的目标编码（用于下载归一与播放器兼容转码） */
export interface VideoProfile {
  /** yt-dlp --merge-output-format / 最终容器 */
  container: string
  /** 期望的视频编码（ffmpeg 名称），为空表示不限制 */
  videoCodec?: string
  /** 期望的音频编码（ffmpeg 名称），为空表示不限制 */
  audioCodec?: string
  /** 重编码时使用的视频编码器 */
  videoEncoder: string
  /** 重编码时使用的音频编码器 */
  audioEncoder: string
  /**
   * 本应用能否重编码到该视频编码。
   * 内置 ffmpeg 已编入 libx264 / libx265 / libvpx-vp9 / libaom-av1，故全部为 true。
   * 若外部环境缺少某个编码器，转码失败后会自动回退到第错误处理（保留源文件）。
   */
  encodable: boolean
}

/**
 * 各容器的编码策略。
 * 注意：yt-dlp 的 --merge-output-format 仅支持 mp4/mkv/webm/ogg/flv，
 * 因此 mov 先合并为 mp4，再由本应用 ffmpeg 流拷贝为 mov。
 *
 * 「内置解码能力」实测（resources/bin/ffmpeg）：
 *   解码 av1/h264/hevc/vp9/mpeg4/vc1/aac/ac3/eac3/dca(dts)/truehd/flac/mp3/opus/vorbis/wmav2/ape/pcm
 *   编码 libx264 / libx265 / libvpx-vp9 / libaom-av1 / aac / libopus / libmp3lame / flac
 * 所以「内置解码库」这件事本身是齐备的，缺的只是 Chromium 侧的容器/编码白名单，
 * 由播放器兼容转码兜底。
 */
export const VIDEO_PROFILES: Record<VideoCodec, VideoProfile | null> = {
  none: null, // 保持源格式
  mp4: { container: 'mp4', videoCodec: 'h264', audioCodec: 'aac', videoEncoder: 'libx264', audioEncoder: 'aac', encodable: true },
  mkv: { container: 'mkv', videoEncoder: 'libx264', audioEncoder: 'aac', encodable: true },
  webm: { container: 'webm', videoCodec: 'vp9', audioCodec: 'opus', videoEncoder: 'libvpx-vp9', audioEncoder: 'libopus', encodable: true },
  mov: { container: 'mov', videoCodec: 'h264', audioCodec: 'aac', videoEncoder: 'libx264', audioEncoder: 'aac', encodable: true },
  // AV1：Chromium 可直接解码；内置 ffmpeg 带 libaom-av1 编码器（较慢，故用高 cpu-used）
  av1: { container: 'mp4', videoCodec: 'av1', audioCodec: 'aac', videoEncoder: 'libaom-av1', audioEncoder: 'aac', encodable: true },
  // H.265 / HEVC：内置 ffmpeg 带 libx265；注意 Chromium 不能直接解码 HEVC，选它请配合系统播放器
  hevc: { container: 'mkv', videoCodec: 'hevc', audioCodec: 'aac', videoEncoder: 'libx265', audioEncoder: 'aac', encodable: true }
}

/** 播放器原生能力说明（设置页展示用，与 CHROMIUM_* 保持一致） */
export const NATIVE_PLAYBACK_INFO = {
  video: ['H.264 (AVC)', 'VP8', 'VP9', 'AV1', 'Theora'],
  audio: ['AAC', 'MP3', 'Vorbis', 'Opus', 'FLAC', 'ALAC', 'PCM'],
  /** 需要走兼容转码/系统播放器的常见编码 */
  needsFallback: ['H.265 / HEVC', 'MPEG-4 Part 2', 'VC-1', 'DTS', 'AC-3 / E-AC-3', 'TrueHD', 'WMA', 'APE']
} as const

/** 音频格式的编码器映射（content=audio 时使用） */
export const AUDIO_ENCODERS: Record<Exclude<AudioCodec, 'none'>, string> = {
  mp3: 'libmp3lame',
  flac: 'flac',
  wav: 'pcm_s16le',
  aac: 'aac',
  m4a: 'aac',
  opus: 'libopus'
}

/** 需要重编码（非流拷贝）的音频格式 */
export const LOSSY_AUDIO: ReadonlySet<string> = new Set(['mp3', 'aac', 'm4a', 'opus'])

/** 归一化 ffmpeg 报出的编码名，便于比较 */
export function normalizeCodecName(name: string | undefined): string {
  if (!name) return ''
  const n = name.toLowerCase().trim()
  if (n.startsWith('avc1') || n === 'h264') return 'h264'
  if (n.startsWith('hev1') || n.startsWith('hvc1') || n === 'hevc' || n === 'h265') return 'hevc'
  if (n.startsWith('av01') || n === 'av1') return 'av1'
  if (n.startsWith('vp09') || n === 'vp9') return 'vp9'
  if (n === 'vp8') return 'vp8'
  return n
}

/**
 * 构造 yt-dlp 的 -f 格式选择器：按目标编码优先挑流，拿不到再放宽。
 * 这是「选 mp4 就是 H.264」的第一道保障。
 */
export function buildFormatSelector(
  content: 'audio' | 'video' | 'both',
  quality: number,
  videoCodec: VideoCodec
): string {
  const q = Number(quality) || 1080
  if (content === 'audio') return 'ba/b'

  const profile = VIDEO_PROFILES[videoCodec]
  const vPref = profile?.videoCodec ? `[vcodec^=${codecMatchToken(profile.videoCodec)}]` : ''
  const aPref = profile?.audioCodec ? `[acodec^=${codecMatchToken(profile.audioCodec)}]` : ''
  const sizeCap = `[height<=?${q}]`

  // 精确匹配：目标编码 + 画质上限
  const exactV = `bv*${vPref}${sizeCap}`
  const exactA = `ba${aPref}`
  // 放宽：只要画质符合
  const looseV = `bv*${sizeCap}`
  const looseA = 'ba'
  // 单文件兜底
  const single = `b${sizeCap}`

  if (content === 'video') {
    return dedupe([exactV, looseV, 'bv*', single]).join('/')
  }

  return dedupe([
    `${exactV}+${exactA}`,
    `${exactV}+${looseA}`,
    `${looseV}+${exactA}`,
    `${looseV}+${looseA}`,
    looseV,
    single
  ]).join('/')
}

function dedupe(list: string[]): string[] {
  return [...new Set(list.filter(Boolean))]
}

/** ffmpeg 编码名 → yt-dlp 格式过滤里 stream 的 codec 前缀 */
function codecMatchToken(codec: string): string {
  switch (codec) {
    case 'h264':
      return 'avc1'
    case 'hevc':
      return 'hev1'
    case 'av1':
      return 'av01'
    case 'vp9':
      return 'vp9'
    case 'opus':
      return 'opus'
    case 'aac':
      return 'mp4a'
    default:
      return codec
  }
}

/**
 * Chromium（Electron 内置播放器）能直接解码的编码集合。
 * 超出此范围的（HEVC / MPEG-4 Part2 / VC1 / DTS / AC3 / WMA …）需要 ffmpeg 兼容转码。
 */
export const CHROMIUM_VIDEO_CODECS: ReadonlySet<string> = new Set([
  'h264', 'vp8', 'vp9', 'av1', 'theora', 'vp9.2'
])

export const CHROMIUM_AUDIO_CODECS: ReadonlySet<string> = new Set([
  'aac', 'mp3', 'vorbis', 'opus', 'flac', 'alac', 'pcm_s16le', 'pcm_s24le', 'pcm_s32le', 'pcm_u8', 'pcm_f32le'
])

/** Chromium 能解封装的容器 */
export const CHROMIUM_CONTAINERS: ReadonlySet<string> = new Set([
  'mp4', 'mov', 'm4a', 'm4v', '3gp', '3g2', 'webm', 'mkv', 'ogg', 'oga', 'opus', 'wav', 'flac', 'mp3', 'aac',
  'mov,mp4,m4a,3gp,3g2,mj2', 'matroska,webm', 'mpegts'
])

export function isContainerSupported(container: string | undefined): boolean {
  if (!container) return false
  const c = container.toLowerCase()
  if (CHROMIUM_CONTAINERS.has(c)) return true
  // ffmpeg 报的是复合名（如 mov,mp4,m4a,3gp,3g2,mj2 / matroska,webm），逐段判断
  return c.split(',').some((seg) => CHROMIUM_CONTAINERS.has(seg.trim()))
}

/** 播放器兼容转码的默认目标：H.264 + AAC / MP4（音频-only 时为 m4a） */
export function compatTarget(hasVideo: boolean): TranscodeTarget {
  return hasVideo
    ? { container: 'mp4', videoCodec: 'h264', audioCodec: 'aac' }
    : { container: 'm4a', audioCodec: 'aac' }
}

/**
 * 构造 ffmpeg 转码/转封装参数（带 -progress pipe:1，便于进度回传）。
 * copy=true 时只换容器不重编码（毫秒级完成）。
 */
export function buildTranscodeArgs(input: string, output: string, target: TranscodeTarget): string[] {
  const base = ['-hide_banner', '-nostdin', '-y', '-i', input, '-sn', '-dn', '-map_metadata', '0']
  const progress = ['-progress', 'pipe:1', '-nostats']
  const container = (target.container || 'mp4').toLowerCase()
  const hasVideo = Boolean(target.videoCodec)

  if (hasVideo) {
    const args = [...base, '-map', '0:v:0', '-map', '0:a:0?']
    if (target.copy) {
      args.push('-c', 'copy')
    } else if (target.videoCodec === 'copy') {
      // 保留源视频编码，仅处理音频（本应用无对应视频编码器时的降级路径）
      const profile = pickVideoProfile(target)
      args.push('-c:v', 'copy', '-c:a', profile.audioEncoder)
      if (profile.audioEncoder === 'aac') args.push('-b:a', '192k', '-ac', '2')
      if (profile.audioEncoder === 'libopus') args.push('-b:a', '128k')
    } else {
      const profile = pickVideoProfile(target)
      args.push('-c:v', profile.videoEncoder)
      if (profile.videoEncoder === 'libx264') {
        args.push('-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p', '-profile:v', 'high', '-level', '4.1', '-max_muxing_queue_size', '9999')
      } else if (profile.videoEncoder === 'libvpx-vp9') {
        args.push('-crf', '34', '-b:v', '0', '-row-mt', '1', '-deadline', 'good', '-cpu-used', '4')
      } else if (profile.videoEncoder === 'libaom-av1') {
        // libaom 很慢：用高 cpu-used + 固定 CRF，兼顾速度与体积
        args.push('-crf', '32', '-b:v', '0', '-cpu-used', '6', '-row-mt', '1', '-threads', '0')
      } else if (profile.videoEncoder === 'libx265') {
        args.push('-preset', 'fast', '-crf', '26', '-pix_fmt', 'yuv420p', '-x265-params', 'log-level=error')
      }
      args.push('-c:a', profile.audioEncoder)
      if (profile.audioEncoder === 'aac') args.push('-b:a', '192k', '-ac', '2')
      if (profile.audioEncoder === 'libopus') args.push('-b:a', '128k')
    }
    if (container === 'mp4' || container === 'mov') args.push('-movflags', '+faststart')
    args.push(...progress, output)
    return args
  }

  // 纯音频
  const args = [...base, '-map', '0:a:0', '-vn']
  if (target.copy) {
    args.push('-c:a', 'copy')
  } else {
    args.push('-c:a', target.audioCodec ? audioEncoderFor(target.audioCodec) : 'aac')
    if (!['flac', 'pcm_s16le'].includes(target.audioCodec ?? '')) args.push('-b:a', '192k')
  }
  args.push(...progress, output)
  return args
}

function pickVideoProfile(target: TranscodeTarget): VideoProfile {
  const wanted = normalizeCodecName(target.videoCodec)
  const matched = (Object.keys(VIDEO_PROFILES) as VideoCodec[])
    .map((k) => VIDEO_PROFILES[k])
    .find((p) => p && p.videoCodec && normalizeCodecName(p.videoCodec) === wanted)
  return matched ?? VIDEO_PROFILES.mp4!
}

function audioEncoderFor(codec: string): string {
  const c = normalizeCodecName(codec)
  if (c === 'mp3') return AUDIO_ENCODERS.mp3
  if (c === 'opus') return AUDIO_ENCODERS.opus
  if (c === 'flac') return AUDIO_ENCODERS.flac
  if (c === 'pcm_s16le') return AUDIO_ENCODERS.wav
  return AUDIO_ENCODERS.aac
}
