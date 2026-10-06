/**
 * 系统解码资源探测（main/services/system-codec.ts）
 *
 * 目标：内置播放器解不了某个编码时，**优先借用系统上已经装好的解码能力**，
 * 实在找不到才提示用户手动处理。查找手段（按可靠性排序）：
 *
 *  1. 环境变量：PATH / PATHEXT 中的可执行文件；以及 VLC_HOME、MPV_HOME、
 *     PLAYER_PATH、FFMPEG_PATH 等常见自定义变量
 *  2. 注册表（Windows）：App Paths 与 Uninstall 列表
 *     → 能发现「装在非默认目录」的播放器与解码包（K-Lite / LAV / 完美解码…）
 *  3. 常见安装目录：Program Files / Program Files (x86) / LOCALAPPDATA\Programs
 *     以及各播放器默认子目录
 *
 * 结果同时给「播放器兜底」与「外挂 ffmpeg 转码」两条链路使用。
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { execFile, spawn } from 'node:child_process'
import type { CodecResource, CodecResourceKind, CodecResourceReport } from '../../shared/types'
import { bundledFfmpegPath } from '../utils/paths'

const IS_WIN = process.platform === 'win32'

/** 已知播放器可执行名（用于 PATH / App Paths 探测） */
const PLAYER_EXES: Array<{ exe: string; name: string; seek?: 'mpv' | 'vlc' | 'pot' | 'mpc' }> = [
  { exe: 'mpv.exe', name: 'mpv', seek: 'mpv' },
  { exe: 'vlc.exe', name: 'VLC media player', seek: 'vlc' },
  { exe: 'PotPlayerMini64.exe', name: 'PotPlayer', seek: 'pot' },
  { exe: 'PotPlayerMini.exe', name: 'PotPlayer (32位)', seek: 'pot' },
  { exe: 'mpc-hc64.exe', name: 'MPC-HC', seek: 'mpc' },
  { exe: 'mpc-hc.exe', name: 'MPC-HC (32位)', seek: 'mpc' },
  { exe: 'mpc-be64.exe', name: 'MPC-BE', seek: 'mpc' },
  { exe: 'mpc-be.exe', name: 'MPC-BE (32位)', seek: 'mpc' },
  { exe: 'KMPlayer64.exe', name: 'KMPlayer', seek: 'pot' },
  { exe: 'QQPlayer.exe', name: 'QQ影音' },
  { exe: 'iQiyiPlayer.exe', name: '爱奇艺万能联播' }
]

/** 常见安装目录模板（%VAR% 会被展开） */
const COMMON_DIRS = [
  '%ProgramFiles%\\VideoLAN\\VLC',
  '%ProgramFiles%\\mpv',
  '%ProgramFiles%\\MPV Player',
  '%ProgramFiles%\\PotPlayer',
  '%ProgramFiles%\\DAUM\\PotPlayer',
  '%ProgramFiles%\\DAUM\\PotPlayer\\PotPlayerMini64',
  '%ProgramFiles%\\K-Lite Codec Pack\\MPC-HC64',
  '%ProgramFiles%\\K-Lite Codec Pack\\MPC-BE64',
  '%ProgramFiles%\\MPC-HC',
  '%ProgramFiles%\\MPC-BE',
  '%ProgramFiles%\\KMPlayer64',
  '%ProgramFiles%\\KMPlayer',
  '%ProgramFiles%\\ffmpeg\\bin',
  '%ProgramFiles%\\ffmpeg',
  '%ProgramFiles(x86)%\\VideoLAN\\VLC',
  '%ProgramFiles(x86)%\\K-Lite Codec Pack\\MPC-HC',
  '%ProgramFiles(x86)%\\K-Lite Codec Pack\\MPC-BE',
  '%ProgramFiles(x86)%\\PotPlayer',
  '%ProgramFiles(x86)%\\DAUM\\PotPlayer',
  '%ProgramFiles(x86)%\\KMPlayer',
  '%ProgramFiles(x86)%\\Tencent\\QQPlayer',
  '%ProgramFiles(x86)%\\ffmpeg\\bin',
  '%LOCALAPPDATA%\\Programs\\mpv',
  '%LOCALAPPDATA%\\Programs\\PotPlayer',
  '%LOCALAPPDATA%\\Programs\\VLC',
  '%LOCALAPPDATA%\\Programs\\ffmpeg\\bin',
  '%APPDATA%\\mpv',
  '%USERPROFILE%\\scoop\\shims',
  '%USERPROFILE%\\scoop\\apps\\ffmpeg\\current\\bin',
  '%USERPROFILE%\\scoop\\apps\\mpv\\current',
  '%ChocolateyInstall%\\bin'
]

/** 解码包/滤镜识别名（注册表 Uninstall 显示名匹配） */
const CODEC_PACK_NAMES = [
  { key: 'k-lite', name: 'K-Lite Codec Pack' },
  { key: 'lav filters', name: 'LAV Filters' },
  { key: '完美解码', name: '完美解码' },
  { key: '终极解码', name: '终极解码' },
  { key: 'madVR', name: 'madVR' },
  { key: 'ffdshow', name: 'ffdshow' },
  { key: 'avisynth', name: 'AviSynth' },
  { key: 'hevc video extensions', name: 'HEVC 视频扩展（系统）' },
  { key: 'vp9 video extensions', name: 'VP9 视频扩展（系统）' },
  { key: 'av1 video extension', name: 'AV1 视频扩展（系统）' },
  { key: 'web media extensions', name: 'Web 媒体扩展（系统）' },
  { key: 'dolby', name: 'Dolby 解码扩展（系统）' }
]

let cached: CodecResourceReport | null = null

/** 展开 %VAR% 形式的环境变量 */
function expand(p: string): string {
  return p.replace(/%([^%]+)%/g, (_, name: string) => process.env[name] ?? '')
}

function pushIfFile(list: CodecResource[], file: string, name: string, kind: CodecResourceKind, source: string): void {
  try {
    if (!file || file.includes('%')) return
    if (!fs.existsSync(file)) return
    if (!fs.statSync(file).isFile()) return
    const key = `${kind}:${file.toLowerCase()}`
    if (list.some((r) => `${r.kind}:${r.path.toLowerCase()}` === key)) return
    list.push({ id: key, name, path: file, kind, source })
  } catch {
    /* ignore */
  }
}

/** ① 环境变量：PATH 中直接找；以及常见 *HOME / *_PATH 变量 */
function scanEnv(players: CodecResource[], ffmpegs: CodecResource[], scanned: string[]): void {
  const pathEntries = (process.env.PATH ?? '').split(path.delimiter).filter(Boolean)
  scanned.push('环境变量 PATH')
  for (const dir of pathEntries) {
    if (!dir || dir.includes('%')) continue
    for (const p of PLAYER_EXES) {
      pushIfFile(players, path.join(dir, p.exe), p.name, 'player', '环境变量 PATH')
    }
    pushIfFile(ffmpegs, path.join(dir, 'ffmpeg.exe'), 'ffmpeg（系统 PATH）', 'ffmpeg', '环境变量 PATH')
  }

  const varDirs: Array<{ key: string; label: string }> = [
    { key: 'VLC_HOME', label: '环境变量 VLC_HOME' },
    { key: 'MPV_HOME', label: '环境变量 MPV_HOME' },
    { key: 'PLAYER_PATH', label: '环境变量 PLAYER_PATH' },
    { key: 'MPC_HOME', label: '环境变量 MPC_HOME' }
  ]
  for (const v of varDirs) {
    const dir = process.env[v.key]
    if (!dir) continue
    scanned.push(v.label)
    for (const p of PLAYER_EXES) pushIfFile(players, path.join(dir, p.exe), p.name, 'player', v.label)
  }
  for (const dir of [process.env.FFMPEG_PATH, process.env.FFMPEG_HOME]) {
    if (!dir) continue
    scanned.push('环境变量 FFMPEG_PATH')
    pushIfFile(ffmpegs, path.join(dir, 'ffmpeg.exe'), 'ffmpeg（环境变量）', 'ffmpeg', '环境变量 FFMPEG_PATH')
    pushIfFile(ffmpegs, dir, 'ffmpeg（环境变量）', 'ffmpeg', '环境变量 FFMPEG_PATH')
  }
}

/** ② 常见安装目录 */
function scanCommonDirs(players: CodecResource[], ffmpegs: CodecResource[], scanned: string[]): void {
  scanned.push('常见安装目录')
  for (const tpl of COMMON_DIRS) {
    const dir = expand(tpl)
    if (!dir || dir.includes('%') || !fs.existsSync(dir)) continue
    for (const p of PLAYER_EXES) pushIfFile(players, path.join(dir, p.exe), p.name, 'player', '常见安装目录')
    pushIfFile(ffmpegs, path.join(dir, 'ffmpeg.exe'), 'ffmpeg（常见目录）', 'ffmpeg', '常见安装目录')
  }
}

/** ③ 注册表：App Paths（播放器）+ Uninstall（解码包） */
function regQuery(key: string): Promise<string> {
  return new Promise((resolvePromise) => {
    if (!IS_WIN) return resolvePromise('')
    execFile(
      'reg.exe',
      ['query', key, '/ve'],
      { windowsHide: true, timeout: 6000, maxBuffer: 4 * 1024 * 1024 },
      (err, stdout) => resolvePromise(err ? '' : String(stdout ?? ''))
    )
  })
}

function regQueryAll(key: string): Promise<string> {
  return new Promise((resolvePromise) => {
    if (!IS_WIN) return resolvePromise('')
    execFile(
      'reg.exe',
      ['query', key, '/s', '/v', 'DisplayName'],
      { windowsHide: true, timeout: 12000, maxBuffer: 8 * 1024 * 1024 },
      (err, stdout) => resolvePromise(err ? '' : String(stdout ?? ''))
    )
  })
}

/** 从 reg query 输出里提取 REG_SZ / REG_EXPAND_SZ 的值 */
function extractRegValues(out: string): string[] {
  const values: string[] = []
  for (const line of out.split(/\r?\n/)) {
    const m = line.match(/REG_(?:SZ|EXPAND_SZ)\s+(.+)$/)
    if (m) values.push(m[1].trim().replace(/^"|"$/g, ''))
  }
  return values
}

async function scanRegistry(players: CodecResource[], codecPacks: CodecResource[], scanned: string[]): Promise<void> {
  if (!IS_WIN) return
  scanned.push('注册表 App Paths / Uninstall')

  // ---- App Paths：并发查询（此前是 44 次串行 spawn，会把主进程拖住好几秒）----
  const jobs: Array<Promise<void>> = []
  for (const root of ['HKLM', 'HKCU']) {
    for (const p of PLAYER_EXES) {
      const key = `${root}\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\${p.exe}`
      jobs.push(
        regQuery(key).then((out) => {
          const hit = extractRegValues(out).find((v) => /\.exe$/i.test(v))
          if (hit) pushIfFile(players, hit, p.name, 'player', '注册表 App Paths')
        })
      )
    }
  }
  await Promise.all(jobs)

  // ---- 解码包 / 系统扩展：并发查 Uninstall（/s 查询较慢，控制并发数与超时）----
  const uninstallKeys = [
    'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
    'HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
    'HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall'
  ]
  const outs = await Promise.all(uninstallKeys.map((key) => regQueryAll(key)))
  const joined = outs.join('\n').toLowerCase()
  for (const pack of CODEC_PACK_NAMES) {
    if (joined.includes(pack.key.toLowerCase())) {
      codecPacks.push({
        id: `codec-pack:${pack.key}`,
        name: pack.name,
        path: '',
        kind: 'codec-pack',
        source: '注册表 Uninstall'
      })
    }
  }
}

/** 应用资源目录里随包内置的 ffmpeg（永远可用） */
function detectBundled(ffmpegs: CodecResource[]): void {
  const bundled = bundledFfmpegPath()
  pushIfFile(ffmpegs, bundled, 'ffmpeg（内置随包）', 'ffmpeg', '应用 resources/bin')
}

/** 探测总耗时预算：超时即返回已扫到的结果，绝不长时间卡住调用方 */
const SCAN_BUDGET_MS = 6000

/** 完整探测（结果缓存；refresh=true 强制重新扫描） */
export async function detectCodecResources(refresh = false): Promise<CodecResourceReport> {
  if (cached && !refresh) return cached
  if (pending) return pending

  pending = (async () => {
    const players: CodecResource[] = []
    const ffmpegs: CodecResource[] = []
    const codecPacks: CodecResource[] = []
    const scanned: string[] = []

    // 轻量部分：内置 + 环境变量 + 常见目录（同步、几乎无耗时）
    detectBundled(ffmpegs)
    scanEnv(players, ffmpegs, scanned)
    scanCommonDirs(players, ffmpegs, scanned)
    scanned.push('注册表')

    // 注册表查询较慢，加总预算兜底；超时则先用已有结果
    const scan = scanRegistry(players, codecPacks, scanned)
    const timeout = new Promise<void>((r) => setTimeout(r, SCAN_BUDGET_MS))
    await Promise.race([scan, timeout])

    const report: CodecResourceReport = {
      players,
      ffmpegs,
      codecPacks,
      detectedAt: Date.now(),
      scanned
    }
    cached = report
    return report
  })()

  try {
    return await pending
  } finally {
    pending = null
  }
}

let pending: Promise<CodecResourceReport> | null = null

/**
 * 只读取缓存（不触发扫描）。
 * 设置页首屏用这个，避免「进页面就开始扫注册表」造成卡顿。
 */
export function peekCodecResources(): CodecResourceReport | null {
  return cached
}

/**
 * 后台预热：启动后空闲时调用一次，把结果放进缓存。
 * 这样设置页 / 播放器兜底查询都是瞬时返回，不会造成界面卡顿。
 */
export function warmDetect(delayMs = 8000): void {
  const t = setTimeout(() => {
    detectCodecResources(true).catch(() => {
      /* 预热失败无所谓，真正需要时再扫 */
    })
  }, delayMs)
  t.unref?.()
}

/** 播放器优先级：mpv / VLC / MPC / PotPlayer（可被设置覆盖） */
const PLAYER_PRIORITY = ['mpv', 'vlc', 'mpc', 'pot']

/** 选择一个可用的系统播放器（preferredPath 存在则优先） */
export async function resolveExternalPlayer(preferredPath?: string): Promise<CodecResource | null> {
  if (preferredPath && fs.existsSync(preferredPath)) {
    return {
      id: `player:${preferredPath.toLowerCase()}`,
      name: path.basename(preferredPath),
      path: preferredPath,
      kind: 'player',
      source: '手动指定'
    }
  }
  const report = await detectCodecResources()
  if (report.players.length === 0) return null
  for (const key of PLAYER_PRIORITY) {
    const hit = report.players.find((p) => p.name.toLowerCase().includes(key))
    if (hit) return hit
  }
  return report.players[0]
}

/** 选择可用的外部 ffmpeg（preferredPath 存在则优先；否则挑非内置的第一个） */
export async function resolveExternalFfmpeg(preferredPath?: string): Promise<string | null> {
  if (preferredPath && fs.existsSync(preferredPath)) return preferredPath
  const report = await detectCodecResources()
  const external = report.ffmpegs.find((f) => !f.source.includes('内置'))
  return external?.path ?? null
}

/** 按播放器类型生成「从指定位置开始播放」的开播参数 */
function seekArgs(player: CodecResource, position: number, mediaPath: string): string[] {
  const sec = Math.max(0, Math.floor(position))
  const lower = player.path.toLowerCase()
  if (lower.includes('mpv')) {
    return sec > 3 ? [`--start=+${sec}`, mediaPath] : [mediaPath]
  }
  if (lower.includes('vlc')) {
    return sec > 3 ? [`--start-time=${sec}`, mediaPath] : [mediaPath]
  }
  if (lower.includes('potplayer') || lower.includes('kmplayer')) {
    return sec > 3 ? [mediaPath, `/seek=${sec}`] : [mediaPath]
  }
  if (lower.includes('mpc')) {
    return sec > 3 ? [mediaPath, '/start', String(sec)] : [mediaPath]
  }
  return [mediaPath]
}

export interface OpenWithExternalResult {
  ok: boolean
  /** 实际使用的播放器名 */
  player?: string
  /** 播放器路径 */
  path?: string
  error?: string
}

/**
 * 用系统播放器打开媒体（使用系统已安装的解码库）。
 * 失败时返回明确的错误，交由上层提示用户手动处理。
 */
export async function openWithExternalPlayer(
  mediaPath: string,
  preferredPath?: string,
  position = 0
): Promise<OpenWithExternalResult> {
  if (!mediaPath || !fs.existsSync(mediaPath)) {
    return { ok: false, error: '媒体文件不存在' }
  }
  const player = await resolveExternalPlayer(preferredPath)
  if (!player) {
    return { ok: false, error: '未在系统中找到可用播放器（可手动指定，或安装 mpv / VLC / MPC-HC / PotPlayer）' }
  }
  const args = seekArgs(player, position, mediaPath)
  return new Promise((resolvePromise) => {
    try {
      // detached + stdio ignore + unref：播放器作为独立进程启动，不等它退出
      const child = spawn(player.path, args, {
        detached: true,
        windowsHide: false,
        stdio: 'ignore'
      })
      child.once('error', (err) => {
        const code = (err as NodeJS.ErrnoException).code
        if (code === 'ENOENT' || code === 'EACCES') {
          resolvePromise({ ok: false, error: `无法启动播放器：${player.path}（${code}）` })
        }
      })
      child.unref()
      resolvePromise({ ok: true, player: player.name, path: player.path })
    } catch (e) {
      resolvePromise({ ok: false, error: e instanceof Error ? e.message : String(e) })
    }
  })
}

/** 供「关于/设置」页展示的系统信息摘要 */
export function platformHint(): string {
  return `${os.type()} ${os.release()} (${process.arch})`
}
