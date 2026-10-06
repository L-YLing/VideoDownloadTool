/**
 * 播放列表状态（renderer/store/playlist.ts）
 * 轻量 reactive，独立于 app store，避免播放器与下载状态互相污染。
 */
import { reactive } from 'vue'
import type { LoopMode, PlaylistItem } from '@shared/types'

export const playlist = reactive({
  items: [] as PlaylistItem[],
  /** 当前播放条目的 id */
  currentId: '' as string,
  /** 列表来源（视频列表名 / 临时） */
  from: '' as string,
  /** 循环模式 */
  loopMode: 'list' as LoopMode,
  /** 随机播放已播放过的下标（用于「不重复」随机） */
  shuffled: [] as number[]
})

export function setPlaylist(items: PlaylistItem[], startId?: string, from = ''): void {
  playlist.items = [...items]
  playlist.from = from
  playlist.currentId = startId ?? items[0]?.id ?? ''
  playlist.shuffled = []
}

export function appendToPlaylist(items: PlaylistItem[], from?: string): void {
  const known = new Set(playlist.items.map((i) => i.path))
  const added = items.filter((i) => !known.has(i.path))
  playlist.items.push(...added)
  if (from && !playlist.from) playlist.from = from
  if (!playlist.currentId && playlist.items.length > 0) playlist.currentId = playlist.items[0].id
  playlist.shuffled = []
}

export function removeFromPlaylist(id: string): void {
  playlist.items = playlist.items.filter((i) => i.id !== id)
  if (playlist.currentId === id) playlist.currentId = ''
  playlist.shuffled = []
}

export function clearPlaylist(): void {
  playlist.items = []
  playlist.currentId = ''
  playlist.from = ''
  playlist.shuffled = []
}

export function setLoopMode(mode: LoopMode): void {
  playlist.loopMode = mode
  playlist.shuffled = []
}

export function currentIndex(): number {
  return playlist.items.findIndex((i) => i.id === playlist.currentId)
}

/**
 * 下一首：
 * - list   → 顺序播放，末尾回到开头
 * - single → 返回 undefined（由播放器自行 loop）
 * - shuffle→ 随机未播过的下标，全部播完后重新洗牌
 * 返回 undefined 表示「没有下一个」
 */
export function nextItem(): PlaylistItem | undefined {
  const n = playlist.items.length
  if (n === 0) return undefined
  const idx = currentIndex()

  if (playlist.loopMode === 'single') return undefined
  if (playlist.loopMode === 'shuffle') {
    if (n === 1) return playlist.items[0]
    const remaining = playlist.shuffled.length >= n ? [] : playlist.shuffled
    let pickIdx = -1
    for (let guard = 0; guard < 64; guard++) {
      const c = Math.floor(Math.random() * n)
      if (c !== idx && !remaining.includes(c)) {
        pickIdx = c
        break
      }
    }
    if (pickIdx < 0) {
      playlist.shuffled = []
      return nextItem()
    }
    playlist.shuffled = [...remaining, pickIdx]
    return playlist.items[pickIdx]
  }

  return idx < 0 ? playlist.items[0] : playlist.items[(idx + 1) % n]
}

/** 上一首（随机模式回退到上一首已播条目） */
export function prevItem(): PlaylistItem | undefined {
  const n = playlist.items.length
  if (n === 0) return undefined
  const idx = currentIndex()
  if (playlist.loopMode === 'shuffle' && playlist.shuffled.length > 1) {
    const back = playlist.shuffled[playlist.shuffled.length - 2]
    playlist.shuffled = playlist.shuffled.slice(0, -1)
    return playlist.items[back]
  }
  if (idx <= 0) return playlist.items[n - 1]
  return playlist.items[idx - 1]
}

export function hasPlaylist(): boolean {
  return playlist.items.length > 0
}

/** 是否还有下一首（用于按钮禁用态） */
export function hasNext(): boolean {
  const n = playlist.items.length
  if (n === 0) return false
  if (playlist.loopMode === 'single') return false
  return true
}
