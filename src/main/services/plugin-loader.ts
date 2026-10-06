/**
 * 插件加载器（main/services/plugin-loader.ts）
 * 依据 09-插件系统：
 * - 插件以目录形式存放在 <userData>/plugins/<id>/（manifest.json + entry js）
 * - 在 node:vm 沙箱中执行，不提供 require，仅暴露受控 API（vd.xxx）
 * - 插件契约：module.exports = { match(url), resolve(url) }
 */
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import type { PluginManifest } from '../../shared/types'
import { safeJoin, userDataDir } from '../utils/paths'

/** 插件对外暴露的受控能力 */
export interface PluginHostApi {
  /** 应用版本 */
  appVersion: string
  /** 打印日志（会带插件 id 前缀） */
  log: (...args: unknown[]) => void
  /** 发起 HTTP 请求（GET，返回文本） */
  fetchText: (url: string, headers?: Record<string, string>) => Promise<string>
  /** 发起 HTTP 请求（GET，返回 JSON） */
  fetchJson: <T = unknown>(url: string, headers?: Record<string, string>) => Promise<T>
  /** 交回内置管线：用 yt-dlp 解析该地址（返回原始 JSON） */
  resolveWithYtDlp: (url: string, extraArgs?: string[]) => Promise<unknown>
  /** 读取设置中的 User-Agent（便于插件模拟浏览器） */
  userAgent: () => string
}

/** 插件可以返回給下载管线的媒体描述 */
export interface PluginResolvedMedia {
  title?: string
  uploader?: string
  cover?: string
  duration?: number
  /** 交给内置下载管线的最终地址（可以是直链，也可以是可被 yt-dlp 解析的页面地址） */
  url: string
  /** 额外传给 yt-dlp 的参数（如 --extractor-args） */
  ytdlpArgs?: string[]
  /** 需要随附下载的扩展数据（弹幕/评论等） */
  extras?: Record<string, unknown>
}

export interface PluginModule {
  match?: (url: string) => boolean
  resolve?: (url: string, api: PluginHostApi) => Promise<PluginResolvedMedia>
  /** 可选：生命周期 */
  activate?: (api: PluginHostApi) => void | Promise<void>
}

export interface LoadedPlugin {
  manifest: PluginManifest
  module: PluginModule
  error?: string
}

export function pluginsRootDir(): string {
  const dir = path.join(userDataDir(), 'plugins')
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

/** 内置 manifest 校验：必填字段 + 类型 */
export function validateManifest(raw: unknown): { ok: boolean; error?: string; manifest?: PluginManifest } {
  if (!raw || typeof raw !== 'object') return { ok: false, error: 'manifest 不是对象' }
  const m = raw as Record<string, unknown>
  const required = ['id', 'name', 'version', 'entry'] as const
  for (const k of required) {
    if (typeof m[k] !== 'string' || !String(m[k]).trim()) {
      return { ok: false, error: `manifest 缺少字段 ${k}` }
    }
  }
  if (!/^[a-z0-9][a-z0-9._-]{1,63}$/i.test(String(m.id))) {
    return { ok: false, error: 'manifest.id 只允许字母、数字、点、下划线、连字符' }
  }
  const manifest: PluginManifest = {
    id: String(m.id),
    name: String(m.name),
    version: String(m.version),
    description: typeof m.description === 'string' ? m.description : undefined,
    author: typeof m.author === 'string' ? m.author : undefined,
    homepage: typeof m.homepage === 'string' ? m.homepage : undefined,
    matchPatterns: Array.isArray(m.matchPatterns) ? m.matchPatterns.map(String) : [],
    capabilities: Array.isArray(m.capabilities) ? m.capabilities.map(String) : [],
    entry: String(m.entry),
    minAppVersion: typeof m.minAppVersion === 'string' ? m.minAppVersion : undefined
  }
  return { ok: true, manifest }
}

/** 读取插件目录中的 manifest.json */
export function readManifest(dir: string): { ok: boolean; error?: string; manifest?: PluginManifest } {
  const file = path.join(dir, 'manifest.json')
  if (!fs.existsSync(file)) return { ok: false, error: `${dir} 下缺少 manifest.json` }
  try {
    return validateManifest(JSON.parse(fs.readFileSync(file, 'utf-8')))
  } catch (e) {
    return { ok: false, error: `manifest.json 解析失败: ${e instanceof Error ? e.message : String(e)}` }
  }
}

/** 在 vm 沙箱中执行插件入口，返回导出的模块对象 */
export function loadPluginModule(dir: string, manifest: PluginManifest, api: PluginHostApi): LoadedPlugin {
  let entryPath: string
  try {
    entryPath = safeJoin(dir, manifest.entry)
  } catch {
    return { manifest, module: {}, error: 'entry 路径非法（不允许穿越到插件目录之外）' }
  }
  if (!fs.existsSync(entryPath)) {
    return { manifest, module: {}, error: `入口文件不存在: ${manifest.entry}` }
  }

  const code = fs.readFileSync(entryPath, 'utf-8')
  const sandboxModule = { exports: {} as PluginModule }
  const sandbox: Record<string, unknown> = {
    module: sandboxModule,
    exports: sandboxModule.exports,
    console: {
      log: (...a: unknown[]) => api.log(...a),
      warn: (...a: unknown[]) => api.log('[warn]', ...a),
      error: (...a: unknown[]) => api.log('[error]', ...a)
    },
    fetch: globalThis.fetch,
    setTimeout,
    clearTimeout,
    URL,
    JSON,
    vd: api
  }
  sandbox.globalThis = sandbox

  try {
    const context = vm.createContext(sandbox)
    vm.runInContext(code, context, { filename: entryPath, timeout: 5000 })
  } catch (e) {
    return { manifest, module: {}, error: `执行插件入口失败: ${e instanceof Error ? e.message : String(e)}` }
  }

  const mod = (sandboxModule.exports ?? {}) as PluginModule
  if (typeof mod !== 'object') {
    return { manifest, module: {}, error: '插件导出不是对象' }
  }
  return { manifest, module: mod }
}

/** 从目录安装插件（拷贝目录 → 校验 → 返回 manifest） */
export function installPluginFromDir(srcDir: string): { ok: boolean; error?: string; manifest?: PluginManifest; dir?: string } {
  if (!fs.existsSync(srcDir)) return { ok: false, error: '源目录不存在' }
  const check = readManifest(srcDir)
  if (!check.ok || !check.manifest) return { ok: false, error: check.error }
  const target = path.join(pluginsRootDir(), check.manifest.id)
  try {
    fs.rmSync(target, { recursive: true, force: true })
    fs.mkdirSync(target, { recursive: true })
    copyDir(srcDir, target)
  } catch (e) {
    return { ok: false, error: `复制插件文件失败: ${e instanceof Error ? e.message : String(e)}` }
  }
  return { ok: true, manifest: check.manifest, dir: target }
}

/** 卸载（删除插件目录） */
export function uninstallPluginDir(id: string): boolean {
  const dir = path.join(pluginsRootDir(), id)
  if (!fs.existsSync(dir)) return false
  try {
    fs.rmSync(dir, { recursive: true, force: true })
    return true
  } catch {
    return false
  }
}

function copyDir(src: string, dst: string): void {
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name)
    const d = path.join(dst, entry.name)
    if (entry.isDirectory()) {
      fs.mkdirSync(d, { recursive: true })
      copyDir(s, d)
    } else if (entry.isFile()) {
      fs.copyFileSync(s, d)
    }
  }
}

/** 把 matchPatterns（glob 简写）转成正则 */
export function patternToRegExp(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.')
  return new RegExp(`^${escaped}$`, 'i')
}
