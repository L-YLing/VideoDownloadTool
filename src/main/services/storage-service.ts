/**
 * 存储服务（main/services/storage-service.ts）
 * 依据 10-数据与存储设计：结构化数据 SQLite 契约 → v1 采用轻量 JSON 实现
 * （避免原生模块编译，低资源友好；接口契约与设计文档一致）。
 */
import fs from 'node:fs'
import path from 'node:path'
import { userDataDir } from '../utils/paths'

function dataDir(): string {
  const dir = path.join(userDataDir(), 'data')
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

function filePath(name: string): string {
  return path.join(dataDir(), name)
}

export class JsonStore<T extends object> {
  private readonly filePath: string
  private readonly defaults: T
  private data: T
  private writeTimer: NodeJS.Timeout | null = null

  constructor(name: string, defaults: T) {
    this.filePath = filePath(name)
    this.defaults = defaults
    this.data = this.load()
  }

  private load(): T {
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, 'utf-8')
        const parsed = JSON.parse(raw) as Partial<T>
        return this.merge(this.defaults, parsed)
      }
    } catch (e) {
      console.error(`[storage] 读取 ${this.filePath} 失败，回退默认值:`, e)
    }
    return structuredClone(this.defaults)
  }

  private merge<T>(defaults: T, data: unknown): T {
    if (defaults === null || typeof defaults !== 'object' || Array.isArray(defaults)) {
      return (data as T) ?? defaults
    }
    if (typeof data !== 'object' || data === null) return structuredClone(defaults)
    const out: Record<string, unknown> = structuredClone(defaults as Record<string, unknown>)
    for (const key of Object.keys(defaults as Record<string, unknown>)) {
      const d = (data as Record<string, unknown>)[key]
      if (d !== undefined) {
        out[key] = this.merge((defaults as Record<string, unknown>)[key], d)
      }
    }
    return out as T
  }

  get(): T {
    return this.data
  }

  /** 修改数据并延迟落盘（防抖，低资源友好） */
  set(updater: (draft: T) => void): void {
    updater(this.data)
    this.scheduleWrite()
  }

  private scheduleWrite(): void {
    if (this.writeTimer) clearTimeout(this.writeTimer)
    this.writeTimer = setTimeout(() => this.flush(), 500)
  }

  /** 立即落盘（应用退出前调用） */
  flush(): void {
    if (this.writeTimer) {
      clearTimeout(this.writeTimer)
      this.writeTimer = null
    }
    try {
      const tmp = this.filePath + '.tmp'
      fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2), 'utf-8')
      fs.renameSync(tmp, this.filePath)
    } catch (e) {
      console.error('[storage] 写入失败:', e)
    }
  }
}

// ---------- 具体 Store ----------

export interface StoredTask {
  id: string
  input: { source: string; kind: string }
  options: Record<string, unknown>
  title?: string
  uploader?: string
  state: string
  progress: number
  outputPaths: string[]
  size?: number
  error?: string
  createdAt: number
  finishedAt?: number
  speed?: string
  eta?: number
  detail?: string
  // 运行期字段（不持久化到历史）
  _running?: boolean
}

export interface StoredHistoryItem {
  id: string
  input: { source: string; kind: string }
  options: Record<string, unknown>
  title?: string
  state: string
  outputPaths: string[]
  size?: number
  createdAt: number
  finishedAt?: number
  error?: string
}

export interface StoredVideoList {
  id: string
  name: string
  rootPath?: string
  items: Array<{ id: string; path: string; title: string; duration?: number; size?: number }>
  createdAt: number
  updatedAt: number
}

export interface StoredPlaybackProgress {
  path: string
  position: number
  duration: number
  updatedAt: number
}

/** 播放历史（「历史记录」视图的数据源） */
export interface StoredWatchHistory {
  id: string
  path: string
  title: string
  uploader?: string
  cover?: string
  position: number
  duration: number
  watchedAt: number
  from?: string
  plays?: number
}

/** 维护任务运行状态（定时清理） */
export interface StoredMaintenance {
  /** 上次自动清理时间（ms） */
  lastCleanAt: number
  /** 上次清理移除的条目数（展示用） */
  lastRemoved?: number
}

export interface StoredPlugin {
  manifest: { id: string; name: string; version: string; matchPatterns: string[]; capabilities: string[]; entry: string }
  installedAt: number
  trust: 'official' | 'trusted' | 'unsigned'
}

export interface StorageData {
  tasks: StoredTask[]
  history: StoredHistoryItem[]
  lists: StoredVideoList[]
  progress: StoredPlaybackProgress[]
  plugins: StoredPlugin[]
  watchHistory: StoredWatchHistory[]
  maintenance: StoredMaintenance
}

export class StorageService {
  data: StorageData

  constructor() {
    this.data = this.load()
  }

  private load(): StorageData {
    const defaults: StorageData = {
      tasks: [],
      history: [],
      lists: [],
      progress: [],
      plugins: [],
      watchHistory: [],
      maintenance: { lastCleanAt: 0 }
    }
    const loaded: StorageData = { ...defaults }
    try {
      const file = filePath('app-data.json')
      if (fs.existsSync(file)) {
        const parsed = JSON.parse(fs.readFileSync(file, 'utf-8')) as Partial<StorageData>
        loaded.tasks = parsed.tasks ?? []
        loaded.history = parsed.history ?? []
        loaded.lists = parsed.lists ?? []
        loaded.progress = parsed.progress ?? []
        loaded.plugins = parsed.plugins ?? []
        loaded.watchHistory = parsed.watchHistory ?? []
        loaded.maintenance = parsed.maintenance ?? { lastCleanAt: 0 }
      }
    } catch (e) {
      console.error('[storage] 加载失败:', e)
    }
    return loaded
  }

  save(): void {
    try {
      const file = filePath('app-data.json')
      const tmp = file + '.tmp'
      fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2), 'utf-8')
      fs.renameSync(tmp, file)
    } catch (e) {
      console.error('[storage] 保存失败:', e)
    }
  }

  flush(): void {
    this.save()
  }
}
