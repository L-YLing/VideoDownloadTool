/**
 * 插件注册表（main/services/plugin-registry.ts）
 * 依据 09-插件系统：
 * - 内置 B站 插件（official，不可卸载）
 * - 第三方插件：目录安装 → 沙箱加载 → 参与匹配与解析
 * - 未匹配任何插件时返回 502 占位（下载管线据此给出明确提示）
 */
import fs from 'node:fs'
import path from 'node:path'
import type { PluginInfo, PluginManifest } from '../../shared/types'
import { StorageService } from './storage-service'
import {
  PluginHostApi,
  PluginResolvedMedia,
  installPluginFromDir,
  loadPluginModule,
  patternToRegExp,
  pluginsRootDir,
  readManifest,
  uninstallPluginDir
} from './plugin-loader'
import { spawnYtDlpJson } from './yt-dlp-runner'

export interface SourceInput {
  url: string
}

export interface ResolvedMedia {
  title: string
  uploader?: string
  cover?: string
  tracks: { audioUrl?: string; videoUrls: Record<number, string> }
  danmaku?: unknown
  comments?: unknown
}

export interface SitePlugin {
  manifest: PluginManifest
  match(input: SourceInput): boolean
  resolve(input: SourceInput): Promise<ResolvedMedia>
}

/** 持久化记录：已安装插件的状态（启用/禁用） */
interface PluginRecord {
  id: string
  enabled: boolean
  installedAt: number
}

export class PluginRegistry {
  private plugins = new Map<string, SitePlugin>()
  private loaded = new Map<string, { manifest: PluginManifest; error?: string }>()
  private records = new Map<string, PluginRecord>()
  private patterns = new Map<string, RegExp[]>()

  constructor(
    private storage: StorageService,
    private host?: { appVersion: string; userAgent: () => string; authCookie: () => string | undefined }
  ) {
    this.registerBuiltinBilibili()
    this.loadRecords()
    this.loadInstalled()
  }

  // ---------- 内置 ----------

  private registerBuiltinBilibili(): void {
    const manifest: PluginManifest = {
      id: 'builtin.bilibili',
      name: 'B站适配（内置）',
      version: '1.0.0',
      description: '内置 B站 支持：视频 / 收藏夹 / 合集，基于 yt-dlp 管线',
      author: '207研究所',
      homepage: 'https://apart207.top',
      matchPatterns: ['https://www.bilibili.com/*', 'https://b23.tv/*', 'BV*', 'av*'],
      capabilities: ['audio', 'video', 'fullDownload'],
      entry: 'builtin'
    }
    this.plugins.set(manifest.id, {
      manifest,
      match: (input) => /bilibili\.com|b23\.tv|^BV[0-9A-Za-z]{10}$|^av\d+$/i.test(input.url),
      resolve: async () => {
        // B站 由内置下载管线直接处理（yt-dlp），此处为契约占位
        throw new Error('B站由内置管线处理')
      }
    })
    this.patterns.set(manifest.id, manifest.matchPatterns.map(patternToRegExp))
    this.loaded.set(manifest.id, { manifest })
  }

  // ---------- 持久化状态 ----------

  private loadRecords(): void {
    const raw = this.storage.data.plugins as unknown as Array<PluginRecord | { manifest?: { id: string } }>
    for (const p of raw ?? []) {
      const id = (p as PluginRecord).id ?? (p as { manifest?: { id: string } }).manifest?.id
      if (!id) continue
      this.records.set(id, {
        id,
        enabled: (p as PluginRecord).enabled !== false,
        installedAt: (p as PluginRecord).installedAt ?? Date.now()
      })
    }
  }

  private persistRecords(): void {
    this.storage.data.plugins = [...this.records.values()].map((r) => ({
      manifest: this.loaded.get(r.id)?.manifest ?? { id: r.id, name: r.id, version: '0.0.0', matchPatterns: [], capabilities: [], entry: '' },
      installedAt: r.installedAt,
      trust: r.id === 'builtin.bilibili' ? ('official' as const) : ('unsigned' as const)
    })) as never
    this.storage.save()
  }

  // ---------- 加载第三方插件 ----------

  private loadInstalled(): void {
    const root = pluginsRootDir()
    let dirs: string[] = []
    try {
      dirs = fs.readdirSync(root, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => path.join(root, d.name))
    } catch {
      return
    }
    for (const dir of dirs) {
      const check = readManifest(dir)
      if (!check.ok || !check.manifest) {
        const id = path.basename(dir)
        this.loaded.set(id, {
          manifest: {
            id,
            name: id,
            version: '0.0.0',
            matchPatterns: [],
            capabilities: [],
            entry: ''
          },
          error: check.error
        })
        continue
      }
      this.loadOne(dir, check.manifest)
    }
  }

  private loadOne(dir: string, manifest: PluginManifest): void {
    const api = this.buildHostApi(manifest)
    const result = loadPluginModule(dir, manifest, api)
    this.loaded.set(manifest.id, { manifest, error: result.error })
    if (result.error) return

    this.patterns.set(manifest.id, (manifest.matchPatterns ?? []).map(patternToRegExp))
    this.plugins.set(manifest.id, {
      manifest,
      match: (input) => {
        const res = result.module.match
        if (typeof res === 'function') {
          try {
            return Boolean(res(input.url))
          } catch {
            return false
          }
        }
        return (this.patterns.get(manifest.id) ?? []).some((re) => re.test(input.url))
      },
      resolve: async (input) => {
        if (typeof result.module.resolve !== 'function') {
          throw new Error('插件未实现 resolve()')
        }
        const media = await result.module.resolve!(input.url, api)
        return this.toResolvedMedia(media)
      }
    })
    if (!this.records.has(manifest.id)) {
      this.records.set(manifest.id, { id: manifest.id, enabled: true, installedAt: Date.now() })
    }
  }

  private toResolvedMedia(media: PluginResolvedMedia): ResolvedMedia {
    return {
      title: media.title ?? '未知标题',
      uploader: media.uploader,
      cover: media.cover,
      tracks: { videoUrls: {}, audioUrl: media.url },
      danmaku: media.extras?.danmaku,
      comments: media.extras?.comments
    }
  }

  private buildHostApi(manifest: PluginManifest): PluginHostApi {
    const prefix = `[plugin:${manifest.id}]`
    return {
      appVersion: this.host?.appVersion ?? '0.0.0',
      log: (...args: unknown[]) => console.log(prefix, ...args),
      fetchText: async (url: string, headers?: Record<string, string>) => {
        const res = await fetch(url, { headers })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return res.text()
      },
      fetchJson: async <T>(url: string, headers?: Record<string, string>): Promise<T> => {
        const res = await fetch(url, { headers })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return (await res.json()) as T
      },
      resolveWithYtDlp: async (url: string, extraArgs: string[] = []) => {
        const args = [...extraArgs, '--skip-download', '--no-warnings']
        if (this.host?.authCookie?.()) args.push('--add-header', `Cookie: ${this.host.authCookie()}`)
        args.push(url)
        return spawnYtDlpJson(args, { timeoutMs: 45000 })
      },
      userAgent: () => this.host?.userAgent() ?? ''
    }
  }

  // ---------- 对外 API ----------

  /** 安装：从本地目录（含 manifest.json）拷贝并加载 */
  installFromDir(srcDir: string): { ok: boolean; error?: string; manifest?: PluginManifest } {
    const res = installPluginFromDir(srcDir)
    if (!res.ok || !res.manifest || !res.dir) return { ok: false, error: res.error }
    this.loadOne(res.dir, res.manifest)
    this.records.set(res.manifest.id, { id: res.manifest.id, enabled: true, installedAt: Date.now() })
    this.persistRecords()
    return { ok: true, manifest: res.manifest }
  }

  /** 安装：直接选择 manifest.json 所在目录 */
  installFromManifest(manifestFile: string): { ok: boolean; error?: string; manifest?: PluginManifest } {
    return this.installFromDir(path.dirname(manifestFile))
  }

  uninstall(id: string): { ok: boolean; error?: string } {
    if (id === 'builtin.bilibili') return { ok: false, error: '内置插件不可卸载' }
    this.plugins.delete(id)
    this.loaded.delete(id)
    this.records.delete(id)
    this.patterns.delete(id)
    uninstallPluginDir(id)
    this.persistRecords()
    return { ok: true }
  }

  setEnabled(id: string, enabled: boolean): { ok: boolean } {
    const rec = this.records.get(id)
    if (!rec) return { ok: false }
    rec.enabled = enabled
    this.persistRecords()
    return { ok: true }
  }

  /** 重新加载全部第三方插件（开发调试 / 文件更新后） */
  reload(): void {
    for (const id of [...this.plugins.keys()]) {
      if (id !== 'builtin.bilibili') this.plugins.delete(id)
    }
    for (const id of [...this.loaded.keys()]) {
      if (id !== 'builtin.bilibili') this.loaded.delete(id)
    }
    this.patterns.clear()
    this.patterns.set(
      'builtin.bilibili',
      (this.loaded.get('builtin.bilibili')?.manifest.matchPatterns ?? []).map(patternToRegExp)
    )
    this.loadInstalled()
  }

  register(plugin: SitePlugin): void {
    this.plugins.set(plugin.manifest.id, plugin)
    this.records.set(plugin.manifest.id, {
      id: plugin.manifest.id,
      enabled: true,
      installedAt: Date.now()
    })
    this.persistRecords()
  }

  unregister(id: string): void {
    this.plugins.delete(id)
  }

  /** 解析源：命中插件返回 handle，否则 null → 502 占位 */
  resolve(input: SourceInput): { plugin: SitePlugin | null; manifest?: PluginManifest } {
    for (const [id, plugin] of this.plugins) {
      if (this.records.get(id)?.enabled === false) continue
      try {
        if (plugin.match(input)) {
          return { plugin, manifest: plugin.manifest }
        }
      } catch {
        continue
      }
    }
    return { plugin: null }
  }

  /** 是否有可用插件处理该源 */
  canHandle(url: string): boolean {
    return this.resolve({ url }).plugin !== null
  }

  /** 走插件解析（内置 B站 会抛出，由调用方回退内置管线） */
  async resolveViaPlugin(url: string): Promise<ResolvedMedia | null> {
    const { plugin } = this.resolve({ url })
    if (!plugin) return null
    return plugin.resolve({ url })
  }

  /** 插件目录（供 UI “打开目录”） */
  pluginsDir(): string {
    return pluginsRootDir()
  }

  list(): PluginInfo[] {
    const out: PluginInfo[] = []
    const seen = new Set<string>()
    for (const [id, entry] of this.loaded) {
      seen.add(id)
      out.push({
        manifest: entry.manifest,
        installedAt: this.records.get(id)?.installedAt ?? Date.now(),
        trust: id === 'builtin.bilibili' ? 'official' : 'unsigned',
        enabled: this.records.get(id)?.enabled !== false,
        builtin: id === 'builtin.bilibili',
        dir: id === 'builtin.bilibili' ? undefined : path.join(pluginsRootDir(), id),
        error: entry.error
      })
    }
    // 目录里没有、但记录中存在的（脏数据）也列出来，便于用户清理
    for (const rec of this.records.values()) {
      if (seen.has(rec.id)) continue
      out.push({
        manifest: {
          id: rec.id,
          name: rec.id,
          version: '0.0.0',
          matchPatterns: [],
          capabilities: [],
          entry: ''
        },
        installedAt: rec.installedAt,
        trust: 'unsigned',
        enabled: rec.enabled,
        builtin: false,
        error: '插件目录缺失'
      })
    }
    return out.sort((a, b) => Number(b.builtin) - Number(a.builtin) || a.manifest.name.localeCompare(b.manifest.name))
  }
}
