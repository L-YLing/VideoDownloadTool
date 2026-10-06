/**
 * 下载引擎（main/services/download-service.ts）
 * 依据 06-下载引擎设计：
 * - 任务状态机：pending → resolving → downloading → merging → distributing → completed / failed / paused
 * - yt-dlp 子进程 + ffmpeg 合并（三种内容模式）
 * - 断点续传（-c）、暂停/恢复/重试（指数退避）、并发控制、限速、代理
 * - 多目标分发：copyAfter（默认）/ parallel
 * - 磁盘预览与低磁盘强校验（13）
 * - 自定义源无插件 → 502 占位（09）
 */
import { ChildProcess, spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import type {
  CollectionInfo,
  DownloadInput,
  DownloadOptions,
  EnqueueResult,
  InputKind,
  Settings,
  TaskSnapshot,
  TaskState,
  VideoCodec
} from '../../shared/types'
import { BilibiliAdapter } from './bilibili-adapter'
import { PluginRegistry } from './plugin-registry'
import { SettingsService } from './settings-service'
import { StorageService } from './storage-service'
import { MediaService } from './media-service'
import { VIDEO_PROFILES, buildFormatSelector, normalizeCodecName } from './codec-profile'
import {
  effectiveFolderTemplate,
  resolveOutputTemplate as resolveOutputTemplateShared,
  toYtDlpTemplate
} from '../../shared/template'
import { cacheDir, dirSizeMB, clearDir, resolveFfmpeg, resolveYtDlp, shortId, ytDlpEnv } from '../utils/paths'
import { isBilibili, normalizeBiliInput, parseBatchInput } from '../utils/normalize'
import { ytdlpProxyArgs } from '../utils/ytdlp-args'
import { logDownload } from './logger'

const MAX_AUTO_RETRIES = 3

interface DownloadTask {
  id: string
  input: DownloadInput
  options: DownloadOptions
  state: TaskState
  progress: number
  title?: string
  uploader?: string
  outputPaths: string[]
  size?: number
  error?: string
  createdAt: number
  finishedAt?: number
  speed?: string
  eta?: number
  detail?: string
  child?: ChildProcess
  retries: number
  /** 因「卡死」触发的重启次数（独立于网络错误重试） */
  restarts: number
  /** 最近一次收到进度的时间戳（卡死检测） */
  lastProgressAt: number
  url: string
  startedAt?: number
  /** 标记该任务属于合集（C3：用于 no/ask 分支过滤） */
  collectionPrompt?: boolean
  // 多目标并行分发产生的子任务
  subTasks?: DownloadTask[]
  parentId?: string
}

export { toYtDlpTemplate } from '../../shared/template'

/** 把设计模板转为 yt-dlp 模板并安全拼接到目标目录 */
function buildOutputTemplate(dest: string, template: string): string {
  // 防路径穿越：仅允许模板占位符和一层目录
  const safeDest = dest.replace(/[\\/]+$/, '')
  const converted = toYtDlpTemplate(template)
  if (converted.includes('..')) {
    throw new Error('重命名模板包含非法路径')
  }
  return path.join(safeDest, converted)
}

/**
 * 目录模式 → 目录模板（不含文件名）。
 * 修复：此前 folderMode 只在「调用方未传 renameTemplate」时才生效，
 * 而 makeTask 总会用 settings.renameTemplate 兜底，导致「同目录」等模式形同失效。
 */
export function resolveFolderTemplate(settings: Pick<Settings, 'folderMode' | 'customFolderTemplate'>): string {
  return effectiveFolderTemplate(settings.folderMode, settings.customFolderTemplate)
}

/**
 * 完整输出模板 = 目录模板（可空） + 文件命名模板。
 * 同目录模式下若用户命名模板含 `/`，在此统一回退默认模板（页面另有告警提示）。
 */
export function resolveOutputTemplate(
  settings: Pick<Settings, 'folderMode' | 'customFolderTemplate' | 'renameTemplate'>
): string {
  return resolveOutputTemplateShared(settings)
}

export class DownloadService {
  private tasks = new Map<string, DownloadTask>()
  private queueOrder: string[] = []
  private running = 0
  private listeners = new Set<(snap: TaskSnapshot) => void>()
  private settings: SettingsService
  private storage: StorageService
  private bili: BilibiliAdapter
  private registry: PluginRegistry
  private media: MediaService
  private retryTimers = new Map<string, NodeJS.Timeout>()

  constructor(deps: {
    settings: SettingsService
    storage: StorageService
    bili: BilibiliAdapter
    registry: PluginRegistry
    media?: MediaService
  }) {
    this.settings = deps.settings
    this.storage = deps.storage
    this.bili = deps.bili
    this.registry = deps.registry
    this.media = deps.media ?? new MediaService()
  }

  onUpdate(cb: (snap: TaskSnapshot) => void): void {
    this.listeners.add(cb)
  }

  // ---------- 对外 API ----------

  async enqueue(rawInputs: DownloadInput[], options: DownloadOptions): Promise<EnqueueResult> {
    const resolved = await this.resolveInputs(rawInputs, options)
    // 合集询问（C3）
    if (resolved.collectionPrompt && this.settings.get().collectionPrompt) {
      const def = this.settings.get().collectionDefault
      if (def === 'no') {
        resolved.tasks = resolved.tasks.filter((t) => !t.collectionPrompt)
        return { taskIds: this.enqueueTasks(resolved.tasks) }
      }
      if (def === 'ask') {
        // 挂起，等用户确认
        this.pendingCollection = {
          tasks: resolved.tasks,
          collection: resolved.collectionPrompt,
          taskIds: this.enqueueTasks(resolved.tasks.filter((t) => !t.collectionPrompt), true)
        }
        return {
          taskIds: this.pendingCollection.taskIds,
          collectionPrompt: resolved.collectionPrompt
        }
      }
      // def === 'yes'：全部入队
    }
    return { taskIds: this.enqueueTasks(resolved.tasks) }
  }

  private pendingCollection: { tasks: DownloadTask[]; collection: CollectionInfo; taskIds: string[] } | null = null

  confirmCollection(includeAll: boolean): { taskIds: string[] } {
    const pc = this.pendingCollection
    if (!pc) return { taskIds: [] }
    this.pendingCollection = null
    const extra = pc.tasks.filter((t) => t.collectionPrompt)
    if (includeAll) {
      const ids = this.enqueueTasks(extra)
      return { taskIds: [...pc.taskIds, ...ids] }
    }
    return { taskIds: pc.taskIds }
  }

  async pause(id: string): Promise<void> {
    const task = this.tasks.get(id)
    if (!task || !task.child) return
    if (task.state === 'downloading' || task.state === 'merging') {
      task.child.kill()
      task.state = 'paused'
      task.detail = '已暂停（保留分片，可断点续传）'
      this.emit(task)
    }
  }

  async resume(id: string): Promise<void> {
    const task = this.tasks.get(id)
    if (!task || task.state !== 'paused') return
    task.state = 'pending'
    task.detail = '等待恢复'
    this.emit(task)
    this.schedule()
  }

  async cancel(id: string): Promise<void> {
    const task = this.tasks.get(id)
    if (!task) return
    this.cancelTimer(task.id)
    if (task.child) {
      task.child.kill()
    }
    this.removeFromQueue(task.id)
    task.state = 'cancelled'
    task.finishedAt = Date.now()
    task.detail = '已取消'
    this.emit(task)
    this.pushHistory(task)
    // 清理该任务的 .part 分片（保守：仅删除以任务 URL 命名的 part 文件比较困难，交给缓存清理）
  }

  async retry(id: string): Promise<void> {
    const task = this.tasks.get(id)
    if (!task) return
    if (task.state === 'failed' || task.state === 'cancelled' || task.state === 'completed') {
      task.state = 'pending'
      task.error = undefined
      task.progress = 0
      task.detail = '重新排队'
      task.retries = 0
      this.emit(task)
      this.schedule()
    }
  }

  /** 清空队列中未开始的任务 */
  clearPending(): void {
    for (const id of [...this.queueOrder]) {
      const t = this.tasks.get(id)
      if (t && (t.state === 'pending' || t.state === 'paused')) {
        this.cancelTimer(id)
        this.removeFromQueue(id)
        t.state = 'cancelled'
        this.emit(t)
      }
    }
  }

  /**
   * 清空队列里「已结束」的任务（完成 / 失败 / 取消）。
   * 首页「任务队列」的「清空历史」按钮用它把已结束条目从视图里移走；
   * 进行中 / 排队中 / 暂停中的任务一律保留，避免误删正在跑的任务。
   *
   * 说明：这里直接删除任务记录（不广播 evt:taskUpdate），
   * 由调用方（IPC → 渲染进程）重新 listTasks() 覆盖 store.tasks，
   * 避免广播一个「已不存在」的快照反被渲染进程当成新任务插入。
   */
  clearFinished(): void {
    for (const [id, t] of [...this.tasks.entries()]) {
      if (t.state === 'completed' || t.state === 'failed' || t.state === 'cancelled') {
        this.cancelTimer(id)
        this.removeFromQueue(id)
        this.tasks.delete(id)
      }
    }
  }

  queueMove(id: string, dir: 'up' | 'down'): void {
    const idx = this.queueOrder.indexOf(id)
    if (idx < 0) return
    const target = dir === 'up' ? idx - 1 : idx + 1
    if (target < 0 || target >= this.queueOrder.length) return
    const [item] = this.queueOrder.splice(idx, 1)
    this.queueOrder.splice(target, 0, item)
    this.emit(this.tasks.get(id)!)
  }

  getTask(id: string): TaskSnapshot | null {
    const t = this.tasks.get(id)
    return t ? this.toSnapshot(t) : null
  }

  listTasks(): TaskSnapshot[] {
    // 队列顺序优先展示
    const ordered = [
      ...this.queueOrder.map((id) => this.tasks.get(id)).filter(Boolean),
      ...[...this.tasks.values()].filter((t) => !this.queueOrder.includes(t.id))
    ]
    const seen = new Set<string>()
    const uniq: DownloadTask[] = []
    for (const t of ordered) {
      if (t && !seen.has(t.id)) {
        seen.add(t.id)
        uniq.push(t)
      }
    }
    return uniq.map((t) => this.toSnapshot(t))
  }

  listHistory(): TaskSnapshot[] {
    return this.storage.data.history
      .slice()
      .reverse()
      .map((h) => ({
        id: h.id,
        state: h.state as TaskState,
        progress: h.state === 'completed' ? 100 : 0,
        input: { source: h.input.source, kind: h.input.kind as InputKind },
        title: h.title,
        outputPaths: h.outputPaths,
        size: h.size,
        createdAt: h.createdAt,
        finishedAt: h.finishedAt,
        error: h.error
      }))
  }

  clearHistory(): void {
    this.storage.data.history = []
    this.storage.save()
  }

  requeue(id: string): void {
    const item = this.storage.data.history.find((h) => h.id === id)
    if (!item) return
    void this.enqueue([{ source: item.input.source, kind: item.input.kind as InputKind }], {
      ...(item.options as unknown as DownloadOptions)
    })
  }

  // ---------- 内部实现 ----------

  private async resolveInputs(
    inputs: DownloadInput[],
    options: DownloadOptions
  ): Promise<{ tasks: DownloadTask[]; collectionPrompt?: CollectionInfo }> {
    const tasks: DownloadTask[] = []
    let collectionPrompt: CollectionInfo | undefined

    for (const input of inputs) {
      if (input.kind === 'batch') {
        for (const line of parseBatchInput(input.source)) {
          const t = await this.makeSeed({ source: line, kind: 'single' }, options)
          if (t) tasks.push(t)
        }
        continue
      }

      if (input.kind === 'favorite') {
        try {
          const cookie = input.cookie ?? this.authCookie ?? undefined
          const fav = await this.bili.parseFavorite(input.source, undefined, cookie)
          const favUrls = new Set<string>()
          for (const v of fav.videos) {
            const t = await this.makeSeed({ source: v.url, kind: 'single' }, options)
            if (t) {
              tasks.push(t)
              favUrls.add(t.url)
            }
          }
          // 合集识别：检查第一个视频是否属于合集（C3）
          if (fav.videos.length > 0) {
            const col = await this.bili.checkCollection(fav.videos[0].url)
            if (col) {
              collectionPrompt = col.info
              for (const cv of col.videos) {
                if (favUrls.has(cv.url)) continue
                const t = await this.makeSeed({ source: cv.url, kind: 'single' }, options)
                if (t) {
                  t.collectionPrompt = true
                  tasks.push(t)
                }
              }
            }
          }
          continue
        } catch (e) {
          // 容错：若被误判为收藏夹（如 URL 参数中含 favlist），回退为单个视频下载
          const msg = String(e instanceof Error ? e.message : e)
          if (msg.includes('不是收藏夹链接')) {
            const t = await this.makeSeed(input, options)
            if (t) tasks.push(t)
          } else {
            const t = this.failSeed(input, options, msg)
            tasks.push(t)
          }
          continue
        }
      }

      // single / collection / list / custom
      const t = await this.makeSeed(input, options)
      if (t) tasks.push(t)
    }

    return { tasks, collectionPrompt }
  }

  private async makeSeed(input: DownloadInput, options: DownloadOptions): Promise<DownloadTask | null> {
    const url = input.source.trim()
    if (!url) return null

    // 自定义源 502 占位（09）：非 B站 且无插件 → 明确提示
    if (!isBilibili(url) && !this.registry.canHandle(url)) {
      const t: DownloadTask = {
        id: shortId('t'),
        input,
        options,
        state: 'failed',
        progress: 0,
        outputPaths: [],
        createdAt: Date.now(),
        finishedAt: Date.now(),
        url,
        retries: 0,
        restarts: 0,
        lastProgressAt: Date.now(),
        error: '502 服务错误：该源暂不支持 / 插件开发中（VD 内置仅支持 B站，可通过插件系统扩展）',
        detail: '自定义源占位'
        } as DownloadTask
      this.tasks.set(t.id, t)
      this.emit(t)
      this.pushHistory(t)
      return null
    }

    // 多目标并行分发（方式二）：每个目标独立任务
    if (options.distribution === 'parallel' && options.destinations && options.destinations.length > 1) {
      const created: DownloadTask[] = []
      for (const dest of options.destinations) {
        const sub = this.makeTask({
          ...input
        }, { ...options, destinations: [dest] })
        created.push(sub)
      }
      // 组装成组（第一个为主）
      created[0].subTasks = created
      return created[0]
    }

    return this.makeTask(input, options)
  }

  private makeTask(input: DownloadInput, options: DownloadOptions): DownloadTask {
    const settings = this.settings.get()
    const task: DownloadTask = {
      id: shortId('t'),
      input,
      options: {
        ...options,
        content: options.content ?? settings.content,
        quality: options.quality ?? settings.quality,
        fullDownload: options.fullDownload ?? settings.fullDownload,
        // 未显式指定目标时，只落到「主目标」（destinations[0]），
        // 而不是全部分发到设置里的每个目录 —— 否则探索页 / 收藏夹触发的下载
        // 会「只选了一个文件夹却同步到其它已配置目录」。
        destinations:
          options.destinations && options.destinations.length > 0
            ? options.destinations
            : settings.destinations.slice(0, 1),
        distribution: options.distribution ?? settings.distribution,
        // 调用方未指定命名模板时，按「目录模式 + 文件命名模板」推导（同目录/作者隔离/自定义）
        renameTemplate: options.renameTemplate?.trim() ? options.renameTemplate : resolveOutputTemplate(settings)
      },
      state: 'pending',
      progress: 0,
      outputPaths: [],
      createdAt: Date.now(),
      // 关键：把「裸 BV 号 / av 号」归一化成完整 URL 再交给 yt-dlp，
      // 否则 yt-dlp 会报 `[generic] 'BVxxxx' is not a valid URL`
      url: normalizeBiliInput(input.source).ytdlpUrl ?? input.source.trim(),
      retries: 0,
      restarts: 0,
      lastProgressAt: Date.now(),
      detail: '等待解析'
    }
    this.tasks.set(task.id, task)
    return task
  }

  private failSeed(input: DownloadInput, options: DownloadOptions, error: string): DownloadTask {
    const t: DownloadTask = {
      id: shortId('t'),
      input,
      options,
      state: 'failed',
      progress: 0,
      outputPaths: [],
      createdAt: Date.now(),
      finishedAt: Date.now(),
      url: input.source.trim(),
      retries: 0,
      restarts: 0,
      lastProgressAt: Date.now(),
      error
    }
    this.tasks.set(t.id, t)
    this.emit(t)
    this.pushHistory(t)
    return t
  }

  private enqueueTasks(tasks: DownloadTask[], hold = false): string[] {
    const ids: string[] = []
    for (const t of tasks) {
      if (t.state === 'failed') continue
      // 合并并行分发组：只入队主任务，调度时展开
      if (t.subTasks) {
        ids.push(t.id)
        this.tasks.set(t.id, t)
        this.queueOrder.push(t.id)
        continue
      }
      if (!this.tasks.has(t.id)) this.tasks.set(t.id, t)
      this.queueOrder.push(t.id)
      ids.push(t.id)
      this.emit(t)
    }
    if (!hold) this.schedule()
    return ids
  }

  private schedule(): void {
    const settings = this.settings.get()
    const maxConcurrent = settings.lowResourceMode ? 1 : Math.max(1, settings.concurrent || 2)
    while (this.running < maxConcurrent) {
      const next = this.queueOrder.find((id) => {
        const t = this.tasks.get(id)
        return t && (t.state === 'pending' || t.state === 'paused')
      })
      if (!next) break
      const task = this.tasks.get(next)!
      if (task.subTasks) {
        // 并行分发：同时启动全部子任务（受并发上限约束）
        const subs = task.subTasks
        task.state = 'downloading'
        task.detail = `并行分发到 ${subs.length} 个目标`
        this.emit(task)
        for (const sub of subs) {
          sub.parentId = task.id
          this.running++
          void this.runTask(sub)
        }
      } else {
        this.running++
        void this.runTask(task)
      }
    }
  }

  private async runTask(task: DownloadTask): Promise<void> {
    task.state = 'resolving'
    task.detail = '解析元数据…'
    this.emit(task)

    // 预解析：标题/大小/磁盘检查
    try {
      const meta = await this.resolveMeta(task.url)
      task.title = meta.title
      task.uploader = meta.uploader
      if (meta.filesize) task.size = meta.filesize
      // 磁盘预览（13）：估算大小 + 剩余空间检查
      if (meta.filesize) {
        const dest = this.primaryDest(task)
        const freeMB = this.freeDiskMB(dest)
        const needMB = meta.filesize / 1024 / 1024
        if (freeMB < needMB) {
          task.state = 'failed'
          task.error = `磁盘空间不足：目标盘剩余 ${Math.round(freeMB)}MB，需要约 ${Math.round(needMB)}MB`
          task.finishedAt = Date.now()
          task.detail = '磁盘检查未通过'
          this.emit(task)
          this.pushHistory(task)
          this.running--
          this.schedule()
          return
        }
        if (freeMB < 5120) {
          task.detail = `低磁盘预警：目标盘仅剩 ${Math.round(freeMB)}MB`
        }
      }
    } catch (e) {
      // 解析失败不阻断下载（可能是临时网络问题），继续尝试
      task.detail = '元数据解析失败，直接下载'
    }

    task.state = 'downloading'
    task.startedAt = Date.now()
    task.detail = '连接源站…'
    this.emit(task)

    let args: string[]
    try {
      args = this.buildArgs(task)
    } catch (e) {
      this.fail(task, String(e instanceof Error ? e.message : e))
      return
    }

    const child = spawn(this.ytDlpBin(), args, {
      windowsHide: true,
      env: ytDlpEnv(),
      stdio: ['ignore', 'pipe', 'pipe']
    })
    task.child = child
    task.lastProgressAt = Date.now()

    /**
     * 卡死看门狗：超过「无进度超时」仍无任何 stdout 进展 → 判定卡死
     * → 杀掉进程并整任务重启（默认上限 2 次，可在设置调整）
     */
    const stallSec = Math.max(30, this.settings.get().stallTimeoutSec ?? 180)
    let stalled = false
    const watchdog = setInterval(() => {
      if (stalled) return
      const idle = (Date.now() - task.lastProgressAt) / 1000
      if (idle < stallSec) return
      // 合并阶段（ffmpeg 转码）不产出下载进度，不视为卡死
      if (task.state === 'merging' || task.state === 'distributing') {
        task.lastProgressAt = Date.now()
        return
      }
      stalled = true
      clearInterval(watchdog)
      try {
        child.kill('SIGKILL')
      } catch {
        /* ignore */
      }
      this.handleStall(task)
    }, 5000)

    const clearWatchdog = (): void => {
      clearInterval(watchdog)
    }

    let stdoutBuf = ''
    const printedPaths: string[] = []
    child.stdout.on('data', (d: Buffer) => {
      const text = d.toString('utf-8')
      stdoutBuf += text
      if (stdoutBuf.length > 1 * 1024 * 1024) stdoutBuf = stdoutBuf.slice(-1024 * 1024)
      this.parseProgressLines(text, task)
      task.lastProgressAt = Date.now()
      for (const line of text.split(/\r?\n/)) {
        const p = line.trim()
        if (p && looksLikePath(p)) printedPaths.push(p)
      }
    })
    child.stderr.on('data', (d: Buffer) => {
      const text = d.toString('utf-8')
      task.lastProgressAt = Date.now()
      if (/Merger|ffmpeg/i.test(text)) {
        task.state = 'merging'
        task.detail = 'ffmpeg 合并音视频…'
        this.emit(task)
      }
      if (/ERROR/.test(text)) {
        const m = text.match(/ERROR:\s*(.+)/)
        if (m) task.error = m[1].trim()
      }
    })
    child.on('error', (err) => {
      clearWatchdog()
      task.child = undefined
      this.fail(task, `无法启动下载进程: ${err.message}`)
    })
    child.on('close', (code) => {
      clearWatchdog()
      task.child = undefined
      this.running--
      // 看门狗已接管（卡死重启），这里不再处理
      if (stalled) {
        this.schedule()
        return
      }
      const stateNow = task.state as TaskState
      if (stateNow === 'paused' || stateNow === 'cancelled') {
        this.schedule()
        return
      }
      if (code === 0) {
        void this.onDownloadSuccess(task, printedPaths)
      } else {
        const msg = task.error || `yt-dlp 退出码 ${code}`
        this.fail(task, msg)
      }
      this.schedule()
    })
  }

  /**
   * 卡死处理：杀掉进程后整任务重启（保留断点续传分片）。
   * 默认上限 2 次，超出判为失败（可在设置调整）。
   */
  private handleStall(task: DownloadTask): void {
    const maxRestarts = Math.max(0, this.settings.get().maxRestarts ?? 2)
    const stallSec = Math.max(30, this.settings.get().stallTimeoutSec ?? 180)
    if (task.restarts < maxRestarts) {
      task.restarts++
      task.child = undefined
      task.state = 'pending'
      task.progress = Math.max(0, task.progress)
      task.detail = `下载卡死（${stallSec}s 无进展），重启 ${task.restarts}/${maxRestarts}…`
      task.error = undefined
      logDownload('warn', '任务', `下载卡死（${stallSec}s 无进度），重启 ${task.restarts}/${maxRestarts}：${task.title ?? task.url}`)
      this.emit(task)
      // 稍作停顿，避免刚被限流就立刻再冲（防误限流）
      const delay = Math.min(3000 * task.restarts, 9000)
      const timer = setTimeout(() => {
        this.retryTimers.delete(task.id)
        if (this.tasks.has(task.id)) this.schedule()
      }, delay)
      this.retryTimers.set(task.id, timer)
      return
    }
    task.state = 'failed'
    task.error = `下载卡死：${stallSec}s 无进展且重启 ${maxRestarts} 次仍未完成`
    task.finishedAt = Date.now()
    task.detail = '已放弃（可在设置调大「无进度超时 / 重启上限」）'
    logDownload('error', '任务', `放弃：${task.title ?? task.url} —— ${stallSec}s 无进度，已重启 ${maxRestarts} 次`)
    this.emit(task)
    this.pushHistory(task)
  }

  /**
   * 付费墙 / 无权限内容：直接跳过，不重试、不算失败。
   * 有权限（已登录但校验失败）时按普通错误重试一次后再跳过。
   */
  private isPaywall(msg: string): boolean {
    return /大会员|付费|充电|需要登录|请先登录|会员专享|权限不足|购买|Premium|members.only|This video is (only )?(available )?for members|payment|paywall|已购买/i.test(
      msg
    )
  }

  private async onDownloadSuccess(task: DownloadTask, printedPaths: string[]): Promise<void> {
    // 优先采用 yt-dlp --print 输出的最终路径，其次回退目录扫描猜测
    const outputPath = printedPaths.filter((p) => fs.existsSync(p)).pop() ?? this.guessOutput(task)
    if (outputPath) task.outputPaths = [outputPath]

    // 编码归一：保证「设置里选了 mp4，产物就是 H.264/AAC 的 MP4」
    await this.normalizeOutput(task)

    task.state = 'completed'
    task.progress = 100
    task.finishedAt = Date.now()
    task.detail = '下载完成'
    logDownload('success', '任务', `完成：${task.title ?? task.url} → ${task.outputPaths[0] ?? '(未知路径)'}`)
    this.emit(task)
    this.pushHistory(task)

    this.enforceCacheLimit()

    // 多目标分发：copyAfter 方式一（先下载一份再复制）
    await this.distributeCopyAfter(task)
  }

  /**
   * 产物编码归一（06 §3 格式转换）：
   * - 容器/编码已符合要求 → 不动
   * - 编码符合但容器不符 → ffmpeg 流拷贝（秒级）
   * - 编码不符合 → 按设置「编码不符时自动转码」重编码
   */
  private async normalizeOutput(task: DownloadTask): Promise<void> {
    const settings = this.settings.get()
    const videoCodec: VideoCodec = settings.videoCodec ?? 'none'
    const profile = VIDEO_PROFILES[videoCodec]
    const current = task.outputPaths[0]
    if (!current || !fs.existsSync(current)) return
    if (task.options.content !== 'video' && task.options.content !== 'both') return
    if (!profile) return // 保持源格式

    const desiredExt = profile.container

    let info
    try {
      info = await this.media.probe(current)
    } catch {
      return
    }
    if (!info.hasVideo) return

    const actualV = normalizeCodecName(info.videoCodec)
    const actualA = normalizeCodecName(info.audioCodec)
    const wantV = profile.videoCodec ? normalizeCodecName(profile.videoCodec) : null
    const wantA = profile.audioCodec ? normalizeCodecName(profile.audioCodec) : null
    const extNow = path.extname(current).toLowerCase().replace('.', '')

    const videoOk = !wantV || !actualV || actualV === wantV
    const audioOk = !wantA || !actualA || actualA === wantA
    if (videoOk && audioOk && extNow === desiredExt) return

    if (!videoOk && !settings.codecFallback) {
      // 未开启转码兜底：至少记一笔提示，避免用户以为设置没生效
      task.detail = `源站仅提供 ${info.videoCodec ?? '未知'} 编码，已按源格式保存（可在编码设置开启自动转码）`
      this.emit(task)
      return
    }
    // 本应用无法编码到目标编码（如内置 ffmpeg 无 AV1 编码器）：只换容器，保留源编码
    if (!videoOk && !profile.encodable) {
      task.detail = `源站未提供 ${(wantV ?? '目标').toUpperCase()} 流，本应用无对应编码器，已保留 ${info.videoCodec ?? '源编码'}`
      this.emit(task)
    }

    task.state = 'merging'
    task.detail = videoOk ? `转封装为 ${desiredExt.toUpperCase()}…` : `转码为 ${(wantV ?? '目标').toUpperCase()}…`
    this.emit(task)

    const target = {
      container: desiredExt,
      // 'copy' 表示保留源视频编码（本应用无对应编码器时）
      videoCodec: videoOk ? profile.videoCodec : profile.encodable ? profile.videoCodec : 'copy',
      audioCodec: profile.audioCodec,
      copy: (videoOk || !profile.encodable) && audioOk
    }
    // 产物落在与下载文件同一目录（不进缓存），保持用户的目录组织
    const outPath = uniqueSiblingPath(current, desiredExt)
    const res = await this.media.transcodeTo(current, target, outPath, info.duration)
    if (res.ok && res.path) {
      try {
        fs.unlinkSync(current)
      } catch {
        /* 删除失败保留原文件 */
      }
      task.outputPaths = [res.path]
      task.detail = videoOk ? '转封装完成' : '转码完成'
      logDownload(
        'info',
        '编码',
        `${videoOk ? '转封装' : '转码'}完成：${path.basename(current)} → ${path.basename(res.path)}（目标 ${desiredExt.toUpperCase()}）`
      )
    } else {
      task.detail = `编码归一失败：${res.error ?? '未知错误'}（保留原文件）`
      logDownload('warn', '编码', `编码归一失败：${path.basename(current)} —— ${res.error ?? '未知错误'}（已保留源文件）`)
    }
    this.emit(task)
  }

  /** 缓存上限（13）：超出自动回收临时分片，避免磁盘被 .part 占满 */
  private enforceCacheLimit(): void {
    try {
      const limit = this.settings.get().cacheLimitMB || 1024
      if (dirSizeMB(cacheDir()) > limit) clearDir(cacheDir())
    } catch {
      /* 清理失败不影响主流程 */
    }
  }

  private async distributeCopyAfter(task: DownloadTask): Promise<void> {
    const dests = task.options.destinations ?? this.settings.get().destinations
    if (dests.length <= 1) return
    const primary = this.primaryDest(task)
    const others = dests.filter((d) => path.resolve(d) !== path.resolve(primary))
    if (others.length === 0) return
    if (!task.outputPaths[0] || !fs.existsSync(task.outputPaths[0])) return

    task.state = 'distributing'
    task.detail = `分发到 ${others.length} 个目标…`
    this.emit(task)

    const move = this.settings.get().copyVsMove === 'move'
    for (const dest of others) {
      try {
        fs.mkdirSync(dest, { recursive: true })
        const target = path.join(dest, path.basename(task.outputPaths[0]))
        // 流式复制（低内存）
        await new Promise<void>((resolvePromise, rejectPromise) => {
          const rs = fs.createReadStream(task.outputPaths![0])
          const ws = fs.createWriteStream(target)
          rs.pipe(ws)
          ws.on('finish', () => resolvePromise())
          ws.on('error', rejectPromise)
          rs.on('error', rejectPromise)
        })
        task.outputPaths.push(target)
      } catch (e) {
        task.detail = `分发到 ${dest} 失败: ${e instanceof Error ? e.message : String(e)}`
        task.error = task.detail
        this.emit(task)
        continue
      }
    }
    // move 模式：主目标文件不再保留
    if (move && task.outputPaths[0] && fs.existsSync(task.outputPaths[0])) {
      try {
        fs.unlinkSync(task.outputPaths[0])
        task.outputPaths = task.outputPaths.slice(1)
      } catch {
        /* 删除失败保留原文件 */
      }
    }
    task.state = 'completed'
    task.detail = '分发完成'
    this.emit(task)
    this.pushHistory(task)
  }

  private guessOutput(task: DownloadTask): string | undefined {
    const dest = this.primaryDest(task)
    const tmpl = toYtDlpTemplate(task.options.renameTemplate ?? this.settings.get().renameTemplate)
    // 用模板目录前缀匹配最近修改的文件
    const prefix = tmpl.split('/')[0].split('%')[0].replace(/[\\:*?"<>|]/g, '')
    try {
      if (!fs.existsSync(dest)) return undefined
      const dirs = fs.readdirSync(dest, { withFileTypes: true })
      const candidates: { p: string; t: number }[] = []
      for (const d of dirs) {
        const full = path.join(dest, d.name)
        if (d.isDirectory() && prefix && d.name.startsWith(prefix.slice(0, 4))) {
          const sub = this.newestFile(full)
          if (sub) candidates.push(sub)
        }
        if (d.isFile() && (prefix === '' || d.name.startsWith(prefix.slice(0, 4)))) {
          candidates.push({ p: full, t: fs.statSync(full).mtimeMs })
        }
      }
      if (candidates.length === 0) return undefined
      candidates.sort((a, b) => b.t - a.t)
      return candidates[0].p
    } catch {
      return undefined
    }
  }

  private newestFile(dir: string): { p: string; t: number } | undefined {
    try {
      const files = fs
        .readdirSync(dir)
        .map((f) => path.join(dir, f))
        .filter((f) => fs.statSync(f).isFile())
        .map((p) => ({ p, t: fs.statSync(p).mtimeMs }))
      files.sort((a, b) => b.t - a.t)
      return files[0]
    } catch {
      return undefined
    }
  }

  /** 用 JSON 模式解析元数据（-J + --encoding utf-8 双重保障，彻底避免 GBK 乱码） */
  /** 元数据缓存：同一地址 10 分钟内不重复解析（解决「批量下载解析很慢」） */
  private metaCache = new Map<string, { at: number; meta: { title?: string; uploader?: string; filesize?: number } }>()

  private resolveMeta(url: string): Promise<{ title?: string; uploader?: string; filesize?: number }> {
    const hit = this.metaCache.get(url)
    if (hit && Date.now() - hit.at < 10 * 60 * 1000) return Promise.resolve(hit.meta)

    return new Promise((resolvePromise) => {
      const bin = this.ytDlpBin()
      const child = spawn(
        bin,
        [
          '-J', url,
          '--skip-download',
          '--no-warnings',
          '--no-playlist',
          '--encoding', 'utf-8',
          '--extractor-retries', '2',
          '--socket-timeout', '10',
          // 代理策略同上：默认强制直连
          ...ytdlpProxyArgs(this.settings.get())
        ],
        { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: ytDlpEnv() }
      )
      let out = ''
      // 解析超时缩短到 20s：超时不再阻塞，直接开下载（标题由下载进度行补）
      const timer = setTimeout(() => child.kill(), 20000)
      child.stdout.on('data', (d: Buffer) => {
        out += d.toString('utf-8')
      })
      child.on('close', () => {
        clearTimeout(timer)
        try {
          const json = JSON.parse(out)
          const meta = {
            title: json.title ? String(json.title) : undefined,
            uploader: json.uploader ? String(json.uploader) : undefined,
            filesize: json.filesize_approx ? Number(json.filesize_approx) : undefined
          }
          if (meta.title || meta.filesize) this.metaCache.set(url, { at: Date.now(), meta })
          resolvePromise(meta)
        } catch {
          resolvePromise({})
        }
      })
      child.on('error', () => resolvePromise({}))
    })
  }

  private buildArgs(task: DownloadTask): string[] {
    const settings = this.settings.get()
    const options = task.options
    const args: string[] = []

    // 输出模板（目录模式 + 命名模板，已在 makeTask 推导；此处再兜底一次）
    const dest = this.primaryDest(task)
    const template = options.renameTemplate?.trim() || resolveOutputTemplate(settings)
    const output = buildOutputTemplate(dest, template)
    args.push('-o', output)

    args.push('--newline', '--progress', '--no-warnings', '--encoding', 'utf-8')
    // 精确拿到最终产物路径，替代目录扫描猜测
    args.push('--print', 'after_move:filepath')

    // ---- 提速与稳定性（可调，见设置「下载」页）----
    // 分片并发：DASH 分段下载的主要提速手段
    const frags = Math.max(1, Math.min(8, settings.concurrentFragments ?? 4))
    args.push('--concurrent-fragments', String(frags))
    // 重试 / 超时：网络抖动与源站限速下更稳（避免整任务重来）
    args.push('--retries', '10')
    args.push('--fragment-retries', '10')
    args.push('--file-access-retries', '5')
    args.push('--extractor-retries', '3')
    args.push('--socket-timeout', '20')
    // 限速时不要立刻放弃（返回 429/慢速时按节流速率继续）
    args.push('--throttled-rate', '100K')
    // 断点续传（同一输出名重复下载时复用已下载分片）
    args.push('-c')

    // 单视频不展开播放列表；收藏夹/合集作为列表下载
    if (!['collection', 'favorite'].includes(task.input.kind)) {
      args.push('--no-playlist')
    }

    // 内容模式（06 1.2）+ 编码设置：按目标编码挑流，保证「选 mp4 就是 H.264」
    const quality = options.quality ?? settings.quality
    const audioCodec = settings.audioCodec
    const videoCodec: VideoCodec = settings.videoCodec ?? 'mp4'
    const profile = VIDEO_PROFILES[videoCodec]

    if (options.content === 'audio') {
      args.push('-f', 'ba/b')
      if (audioCodec !== 'none') {
        args.push('--extract-audio', '--audio-format', audioCodec)
        // 有损格式给到较高码率（0 = VBR 最高质量档）
        if (['mp3', 'aac', 'm4a', 'opus'].includes(audioCodec)) args.push('--audio-quality', '0')
      }
    } else if (options.content === 'video') {
      args.push('-f', buildFormatSelector('video', quality, videoCodec), '--no-audio')
      if (profile) args.push('--merge-output-format', mergeContainer(profile.container))
    } else {
      args.push('-f', buildFormatSelector('both', quality, videoCodec))
      if (profile) args.push('--merge-output-format', mergeContainer(profile.container))
    }

    // ffmpeg 位置（合并/转码）
    args.push('--ffmpeg-location', path.dirname(resolveFfmpeg()))

    // 断点续传
    args.push('-c')

    // 限速
    const rate = options.rateLimit || settings.rateLimit
    if (rate) args.push('--limit-rate', rate)

    // 代理：显式配置优先；未配置时默认强制直连，避免被加速器/VPN 的系统代理劫持（详见 utils/ytdlp-args.ts）
    args.push(...ytdlpProxyArgs(settings, options.proxy))

    // UA
    if (settings.userAgent) args.push('--user-agent', settings.userAgent)

    // 全量下载（弹幕/评论/字幕/封面/元数据，07 §4）
    if (options.fullDownload) {
      args.push('--write-info-json', '--write-thumbnail')
      if (isBilibili(task.url)) {
        args.push('--write-subs', '--sub-langs', 'all,-live_chat')
        args.push('--write-comments')
        args.push('--extractor-args', 'bilibili:write_danmaku=1')
      }
    }

    // 友好节流（03 / 14）
    if (settings.friendlyThrottle) {
      args.push('--sleep-requests', '0.5')
    }

    // 临时分片目录（13：缓存可清理）
    args.push('--paths', `temp:${cacheDir()}`)

    // B站 登录 Cookie（07）
    const cookie = this.storage.data.plugins // placeholder; 真实 cookie 由 auth-service 注入
    void cookie
    const authCookie = this.authCookie
    if (authCookie) {
      args.push('--add-header', `Cookie: ${authCookie}`)
    }

    args.push(task.url)
    return args
  }

  private authCookie: string | null = null
  setAuthCookie(cookie: string | null): void {
    this.authCookie = cookie
  }

  private ytDlpBin(): string {
    return resolveYtDlp()
  }

  private parseProgressLines(text: string, task: DownloadTask): void {
    for (const line of text.split(/\r?\n/)) {
      const m = line.match(/\[download\]\s+(\d+(?:\.\d+)?)%/)
      if (m) {
        task.progress = Math.min(99.9, parseFloat(m[1]))
      }
      const speedM = line.match(/at\s+([\d.]+\s*[KMGT]?i?B\/s)/)
      if (speedM) task.speed = speedM[1]
      const etaM = line.match(/ETA\s+(\d{2}:\d{2})/)
      if (etaM) {
        const [mm, ss] = etaM[1].split(':').map(Number)
        task.eta = mm * 60 + ss
      }
      const sizeM = line.match(/of\s+~?\s*([\d.]+\s*[KMGT]?i?B)/)
      if (sizeM) task.size = parseSize(sizeM[1])
      if (/Destination:/.test(line) && task.state === 'downloading') {
        task.detail = '写入文件…'
      }
    }
    if (task.progress > 0) this.emit(task)
  }

  private fail(task: DownloadTask, error: string): void {
    // 付费墙 / 无权限：直接跳过（不重试、不占重试额度）
    if (this.isPaywall(error)) {
      task.state = 'cancelled'
      task.error = undefined
      task.finishedAt = Date.now()
      task.detail = `已跳过：${error.slice(0, 60)}（付费 / 无权限内容）`
      logDownload('warn', '任务', `跳过付费/无权限内容：${task.title ?? task.url}（${error.slice(0, 120)}）`)
      this.emit(task)
      this.pushHistory(task)
      this.removeFromQueue(task.id)
      this.schedule()
      return
    }

    task.state = 'failed'
    task.error = error
    task.finishedAt = Date.now()
    task.detail = '下载失败'
    logDownload('error', '任务', `失败：${task.title ?? task.url} —— ${error}`)
    this.emit(task)
    this.pushHistory(task)
    // 指数退避自动重试（03）
    if (task.retries < MAX_AUTO_RETRIES) {
      task.retries++
      const delay = Math.min(2 ** task.retries * 2, 30) * 1000
      task.detail = `将在 ${delay / 1000}s 后自动重试（${task.retries}/${MAX_AUTO_RETRIES}）`
      this.emit(task)
      const timer = setTimeout(() => {
        if (task.state === 'failed') {
          task.state = 'pending'
          task.error = undefined
          task.detail = '自动重试…'
          this.emit(task)
          this.queueOrder.unshift(task.id)
          this.schedule()
        }
        this.retryTimers.delete(task.id)
      }, delay)
      this.retryTimers.set(task.id, timer)
    } else {
      this.removeFromQueue(task.id)
    }
  }

  private cancelTimer(id: string): void {
    const timer = this.retryTimers.get(id)
    if (timer) {
      clearTimeout(timer)
      this.retryTimers.delete(id)
    }
  }

  private removeFromQueue(id: string): void {
    const idx = this.queueOrder.indexOf(id)
    if (idx >= 0) this.queueOrder.splice(idx, 1)
  }

  private primaryDest(task: DownloadTask): string {
    const dests = task.options.destinations && task.options.destinations.length > 0 ? task.options.destinations : this.settings.get().destinations
    return dests[0] || require('node:os').homedir()
  }

  private freeDiskMB(dir: string): number {
    try {
      const p = path.parse(dir).root
      const stats = fs.statfsSync(p)
      return (stats.bavail * stats.bsize) / 1024 / 1024
    } catch {
      return Number.MAX_SAFE_INTEGER
    }
  }

  private pushHistory(task: DownloadTask): void {
    if (this.settings.get().privacyMode) return
    if (task.state === 'completed' || task.state === 'failed' || task.state === 'cancelled') {
      this.storage.data.history.push({
        id: task.id,
        input: { source: task.input.source, kind: task.input.kind },
        options: { ...task.options } as unknown as Record<string, unknown>,
        title: task.title,
        state: task.state,
        outputPaths: task.outputPaths,
        size: task.size,
        createdAt: task.createdAt,
        finishedAt: task.finishedAt,
        error: task.error
      })
      // 控制历史体量：最多 500 条
      if (this.storage.data.history.length > 500) {
        this.storage.data.history = this.storage.data.history.slice(-500)
      }
      this.storage.save()
    }
  }

  private toSnapshot(t: DownloadTask): TaskSnapshot {
    return {
      id: t.id,
      state: t.state,
      progress: t.progress,
      input: t.input,
      title: t.title,
      uploader: t.uploader,
      outputPaths: [...t.outputPaths],
      size: t.size,
      error: t.error,
      createdAt: t.createdAt,
      finishedAt: t.finishedAt,
      speed: t.speed,
      eta: t.eta,
      detail: t.detail
    }
  }

  private emit(task: DownloadTask): void {
    const snap = this.toSnapshot(task)
    for (const cb of this.listeners) {
      try {
        cb(snap)
      } catch (e) {
        console.error('[download] 事件回调异常:', e)
      }
    }
  }
}

/**
 * --merge-output-format 仅支持 mp4/mkv/webm/ogg/flv，且并非任意编码都能塞进目标容器。
 * 这里统一先用「宽容容器」合并，再由本应用的 ffmpeg 归一步骤转成最终容器/编码：
 * - mov  → 先 mp4（MOV 不在白名单）
 * - webm → 先 mkv（WebM 装不下 H.264，直接合并会失败）
 */
function mergeContainer(container: string): string {
  if (container === 'mov') return 'mp4'
  if (container === 'webm') return 'mkv'
  return container
}

/** 判断 stdout 的一行是否为路径（--print after_move:filepath 的输出） */
function looksLikePath(line: string): boolean {
  if (line.length < 4 || line.length > 4096) return false
  if (/[\r\n\t]/.test(line)) return false
  return /^[a-zA-Z]:[\\/]/.test(line) || line.startsWith('/') || line.startsWith('\\\\')
}

/** 同目录下生成一个不重名的目标扩展名路径 */
function uniqueSiblingPath(file: string, ext: string): string {
  const dir = path.dirname(file)
  const base = path.basename(file, path.extname(file))
  let candidate = path.join(dir, `${base}.${ext}`)
  let n = 1
  while (fs.existsSync(candidate) && n < 100) {
    candidate = path.join(dir, `${base}(${n}).${ext}`)
    n++
  }
  return candidate
}

function parseSize(s: string): number | undefined {
  const m = s.trim().match(/^([\d.]+)\s*([KMGT]?)(i?B|B)$/i)
  if (!m) return undefined
  const val = parseFloat(m[1])
  const unit = m[2].toUpperCase()
  const mult: Record<string, number> = { '': 1, K: 1024, M: 1024 ** 2, G: 1024 ** 3, T: 1024 ** 4 }
  return Math.round(val * (mult[unit] ?? 1))
}
