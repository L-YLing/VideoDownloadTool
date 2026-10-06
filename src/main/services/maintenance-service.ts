/**
 * 系统资源维护（main/services/maintenance-service.ts）
 *
 * 按设置「定时清理」周期回收以下内容（默认开启，保留 120 天）：
 *  - 播放历史（watchHistory）与播放进度（progress）
 *  - 下载日志 / 程序日志
 *  - 缓存目录中的转码产物与封面缩略图
 *
 * 调度策略：启动时检查一次 + 每 6 小时检查；距上次实际清理不足 20 小时则跳过，
 * 避免频繁 IO。也可由用户在设置页点「立即清理」强制运行。
 */
import fs from 'node:fs'
import path from 'node:path'
import type { SettingsService } from './settings-service'
import type { StorageService } from './storage-service'
import { cacheDir, dirSizeMB, clearDir } from '../utils/paths'
import { pruneLogs } from './logger'
import { logApp } from './logger'

export interface MaintenanceReport {
  ranAt: number
  removedHistory: number
  removedProgress: number
  removedLogs: number
  freedCacheMB: number
  /** 本次使用的保留天数 */
  retentionDays: number
  /** 跳过的原因（未到周期） */
  skipped?: string
}

export interface MaintenanceDeps {
  settings: SettingsService
  storage: StorageService
}

const CHECK_INTERVAL_MS = 6 * 3600 * 1000
const MIN_GAP_MS = 20 * 3600 * 1000

function cutoffOf(days: number): number {
  return Date.now() - Math.max(1, days) * 24 * 3600 * 1000
}

/** 删除目录中修改时间早于 cutoff 的文件（含子目录），返回释放的 MB */
function purgeDir(dir: string, cutoff: number): number {
  let freed = 0
  try {
    if (!fs.existsSync(dir)) return 0
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      try {
        if (entry.isDirectory()) {
          freed += purgeDir(full, cutoff)
          // 目录空了就顺手删掉
          if (fs.readdirSync(full).length === 0) fs.rmdirSync(full)
          continue
        }
        const st = fs.statSync(full)
        if (st.mtimeMs < cutoff) {
          freed += st.size
          fs.unlinkSync(full)
        }
      } catch {
        /* 单个文件失败不影响整体 */
      }
    }
  } catch {
    /* ignore */
  }
  return freed / (1024 * 1024)
}

/**
 * 执行清理。
 * @param force 忽略「距上次清理不足 20 小时」的限制（设置页「立即清理」）
 */
export function runMaintenance(deps: MaintenanceDeps, force = false): MaintenanceReport {
  const settings = deps.settings.get()
  const days = settings.autoCleanDays ?? 120
  const report: MaintenanceReport = {
    ranAt: Date.now(),
    removedHistory: 0,
    removedProgress: 0,
    removedLogs: 0,
    freedCacheMB: 0,
    retentionDays: days
  }

  const last = deps.storage.data.maintenance?.lastCleanAt ?? 0
  const enabled = settings.autoCleanEnabled ?? true

  if (!force && (!enabled || Date.now() - last < MIN_GAP_MS)) {
    report.skipped = !enabled ? '定时清理已关闭' : '未到清理周期'
    return report
  }

  const cutoff = cutoffOf(days)

  // ① 播放历史
  if (force || (settings.cleanPlayHistory ?? true)) {
    const before = deps.storage.data.watchHistory.length
    deps.storage.data.watchHistory = deps.storage.data.watchHistory.filter((h) => h.watchedAt >= cutoff)
    report.removedHistory = before - deps.storage.data.watchHistory.length

    const pBefore = deps.storage.data.progress.length
    deps.storage.data.progress = deps.storage.data.progress.filter((p) => p.updatedAt >= cutoff)
    report.removedProgress = pBefore - deps.storage.data.progress.length
  }

  // ② 日志
  if (settings.cleanDownloadLogs ?? true) pruneLogs(days)
  if (settings.cleanAppLogs ?? true) report.removedLogs = pruneLogs(days)

  // ③ 缓存：先按保留期清理过期文件，再按容量上限兜底
  report.freedCacheMB = Number(purgeDir(cacheDir(), cutoff).toFixed(1))
  const limit = settings.cacheLimitMB || 1024
  if (dirSizeMB(cacheDir()) > limit) clearDir(cacheDir())

  deps.storage.data.maintenance = { lastCleanAt: Date.now(), lastRemoved: report.removedHistory }
  deps.storage.save()

  logApp(
    'info',
    '维护',
    `已清理：历史 ${report.removedHistory} 条 / 进度 ${report.removedProgress} 条 / 日志 ${report.removedLogs} 行 / 缓存 ${report.freedCacheMB} MB（保留 ${days} 天）`
  )
  return report
}

/** 启动调度：启动检查一次，之后每 6 小时检查 */
export function startMaintenanceScheduler(deps: MaintenanceDeps): NodeJS.Timeout {
  // 启动后延迟 30 秒执行，避免与启动流程抢 IO
  const kickoff = setTimeout(() => {
    try {
      runMaintenance(deps)
    } catch (e) {
      logApp('warn', '维护', `启动清理失败：${e instanceof Error ? e.message : String(e)}`)
    }
  }, 30_000)

  const timer = setInterval(() => {
    try {
      runMaintenance(deps)
    } catch (e) {
      logApp('warn', '维护', `定时清理失败：${e instanceof Error ? e.message : String(e)}`)
    }
  }, CHECK_INTERVAL_MS)
  timer.unref?.()
  void kickoff

  return timer
}
