/**
 * 视频列表 / 本地库服务（main/services/library-service.ts）
 * 依据 08-播放器 §4（B7/B8/B9）：创建列表、导入文件夹递归扫描媒体、导入本地文件、作为下载源。
 */
import fs from 'node:fs'
import path from 'node:path'
import type { MediaItem, VideoList } from '../../shared/types'
import { StorageService } from './storage-service'
import { shortId } from '../utils/paths'

/** 常见媒体扩展名（含需要兼容转码的 HEVC/VC1/DTS 等载体，播放器侧会自动处理） */
export const MEDIA_EXTS = new Set([
  // 视频
  '.mp4', '.mkv', '.webm', '.avi', '.mov', '.flv', '.wmv', '.ts', '.m2ts', '.mts', '.m4v',
  '.mpg', '.mpeg', '.3gp', '.ogv', '.f4v', '.vob', '.divx', '.rmvb', '.rm',
  // 音频
  '.mp3', '.m4a', '.flac', '.wav', '.aac', '.ogg', '.oga', '.opus', '.wma', '.ape', '.aiff', '.aif'
])

export class LibraryService {
  constructor(private storage: StorageService) {}

  list(): VideoList[] {
    return this.storage.data.lists.map((l) => ({
      id: l.id,
      name: l.name,
      rootPath: l.rootPath,
      items: l.items,
      createdAt: l.createdAt,
      updatedAt: l.updatedAt
    }))
  }

  create(name: string): VideoList {
    const list: VideoList = {
      id: shortId('l'),
      name: name.trim() || '未命名列表',
      items: [],
      createdAt: Date.now(),
      updatedAt: Date.now()
    }
    this.storage.data.lists.push(list)
    this.storage.save()
    return list
  }

  delete(id: string): void {
    this.storage.data.lists = this.storage.data.lists.filter((l) => l.id !== id)
    this.storage.save()
  }

  /** 重命名列表 */
  rename(id: string, name: string): VideoList | null {
    const list = this.storage.data.lists.find((l) => l.id === id)
    if (!list) return null
    const trimmed = name.trim()
    if (!trimmed) return null
    list.name = trimmed
    list.updatedAt = Date.now()
    this.storage.save()
    return list
  }

  /** 从列表中移除单个条目（不删除磁盘文件） */
  removeItem(id: string, itemId: string): VideoList | null {
    const list = this.storage.data.lists.find((l) => l.id === id)
    if (!list) return null
    list.items = list.items.filter((it) => it.id !== itemId)
    list.updatedAt = Date.now()
    this.storage.save()
    return list
  }

  /** 导入文件夹：递归扫描媒体文件（B7） */
  async importFolder(id: string, folder: string): Promise<VideoList | null> {
    const list = this.storage.data.lists.find((l) => l.id === id)
    if (!list) return null
    const items = this.scanFolder(folder)
    const merged = new Map<string, MediaItem>()
    for (const it of [...list.items, ...items]) merged.set(it.path, it)
    list.items = [...merged.values()]
    list.rootPath = folder
    list.updatedAt = Date.now()
    this.storage.save()
    return list
  }

  /** 导入本地文件（B9） */
  async importFiles(id: string, files: string[]): Promise<VideoList | null> {
    const list = this.storage.data.lists.find((l) => l.id === id)
    if (!list) return null
    const items: MediaItem[] = files.map((f) => {
      const ext = path.extname(f).toLowerCase()
      return {
        id: shortId('m'),
        path: f,
        title: path.basename(f, ext),
        size: safeStat(f)?.size
      }
    })
    const merged = new Map<string, MediaItem>()
    for (const it of [...list.items, ...items]) merged.set(it.path, it)
    list.items = [...merged.values()]
    list.updatedAt = Date.now()
    this.storage.save()
    return list
  }

  /** 重新扫描列表根目录（新增文件自动入列的可选手动触发） */
  scan(id: string): VideoList | null {
    const list = this.storage.data.lists.find((l) => l.id === id)
    if (!list || !list.rootPath) return list ?? null
    return this.importFolderSync(id, list.rootPath)
  }

  private importFolderSync(id: string, folder: string): VideoList | null {
    const list = this.storage.data.lists.find((l) => l.id === id)
    if (!list) return null
    const items = this.scanFolder(folder)
    const merged = new Map<string, MediaItem>()
    for (const it of [...list.items, ...items]) merged.set(it.path, it)
    list.items = [...merged.values()]
    list.updatedAt = Date.now()
    this.storage.save()
    return list
  }

  private scanFolder(folder: string): MediaItem[] {
    const items: MediaItem[] = []
    const walk = (dir: string): void => {
      let entries: fs.Dirent[]
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true })
      } catch {
        return
      }
      for (const e of entries) {
        if (e.name.startsWith('.')) continue
        const full = path.join(dir, e.name)
        if (e.isDirectory()) {
          walk(full)
        } else if (e.isFile() && MEDIA_EXTS.has(path.extname(e.name).toLowerCase())) {
          const st = safeStat(full)
          items.push({
            id: shortId('m'),
            path: full,
            title: path.basename(e.name, path.extname(e.name)),
            size: st?.size
          })
        }
      }
    }
    walk(folder)
    // 排序：目录结构顺序
    items.sort((a, b) => a.path.localeCompare(b.path, 'zh-CN'))
    return items
  }
}

function safeStat(p: string): fs.Stats | null {
  try {
    return fs.statSync(p)
  } catch {
    return null
  }
}
