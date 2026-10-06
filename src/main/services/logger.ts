/**
 * 日志服务（main/services/logger.ts）
 *
 * 两类日志分离，便于「日志」页分区查看与单独清理：
 * - download：下载任务全流程（解析 / 下载 / 合并 / 编码归一 / 分发 / 重试 / 跳过）
 * - app     ：软件自身运行日志（启动、设置、插件、登录、播放、异常）
 *
 * 存储格式：JSON Lines（每行一条 JSON），便于流式追加与大文件只读尾部读取。
 * 单文件超过 MAX_SIZE 自动轮转为 xxx.1.log，避免无限增长（13-资源优化）。
 */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import type { LogEntry, LogKind, LogLevel, LogPage } from '../../shared/types'
import { userDataDir } from '../utils/paths'

const MAX_SIZE = 2 * 1024 * 1024 // 2 MB 轮转阈值
const MAX_READ = 3000 // 单次最多读取行数

/** 日志目录 */
export function logsDir(): string {
  const dir = path.join(userDataDir(), 'logs')
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

function fileOf(kind: LogKind): string {
  return path.join(logsDir(), `${kind}.log`)
}

/** 追加一条日志（同步写入，进程崩溃前的最后一条不会丢） */
export function log(kind: LogKind, level: LogLevel, scope: string, message: string): void {
  const entry: LogEntry = {
    id: crypto.randomUUID(),
    time: Date.now(),
    level,
    scope,
    message: sanitize(message)
  }
  try {
    const file = fileOf(kind)
    if (fs.existsSync(file) && fs.statSync(file).size > MAX_SIZE) {
      const rotated = file.replace(/\.log$/, '.1.log')
      try {
        if (fs.existsSync(rotated)) fs.unlinkSync(rotated)
      } catch {
        /* ignore */
      }
      fs.renameSync(file, rotated)
    }
    fs.appendFileSync(file, JSON.stringify(entry) + '\n', 'utf-8')
  } catch (e) {
    // 日志失败绝不能影响主流程
    console.error('[logger] 写入失败:', e)
  }
}

/** 去掉换行/超长内容，保证「一行一条」 */
function sanitize(text: string): string {
  const one = String(text ?? '').replace(/\r?\n/g, ' ⏎ ')
  return one.length > 2000 ? one.slice(0, 2000) + '…' : one
}

/** 读取日志尾部（最新在后），readonly 列表展示用 */
export function readLogs(kind: LogKind, limit = 500): LogPage {
  const all = readAll(kind)
  return { entries: all.entries.slice(0, Math.min(limit, MAX_READ)), total: all.total }
}

/**
 * 分页读取日志（最新在最前）。
 * 只返回当前页，避免把整份日志塞进渲染进程内存。
 */
export function readLogsPage(kind: LogKind, pn = 1, ps = 50): LogPage {
  const all = readAll(kind)
  const size = Math.max(1, ps)
  const page = Math.max(1, pn)
  const start = (page - 1) * size
  return { entries: all.entries.slice(start, start + size), total: all.total }
}

/** 读取全部日志（最新在前，最多 MAX_READ 条） */
function readAll(kind: LogKind): LogPage {
  const file = fileOf(kind)
  if (!fs.existsSync(file)) return { entries: [], total: 0 }
  try {
    const raw = fs.readFileSync(file, 'utf-8')
    const lines = raw.split('\n').filter((l) => l.trim().length > 0)
    const total = lines.length
    const slice = lines.slice(Math.max(0, total - MAX_READ))
    const entries: LogEntry[] = []
    for (const line of slice) {
      try {
        const e = JSON.parse(line) as LogEntry
        if (e && e.message !== undefined) entries.push(e)
      } catch {
        /* 跳过损坏行 */
      }
    }
    // 展示按时间倒序（最新在最上面）
    entries.reverse()
    return { entries, total }
  } catch {
    return { entries: [], total: 0 }
  }
}

/** 清空某类日志 */
export function clearLogs(kind: LogKind): boolean {
  try {
    const file = fileOf(kind)
    if (fs.existsSync(file)) fs.unlinkSync(file)
    const rotated = file.replace(/\.log$/, '.1.log')
    if (fs.existsSync(rotated)) fs.unlinkSync(rotated)
    return true
  } catch {
    return false
  }
}

/** 按保留天数清理日志（定时维护用） */
export function pruneLogs(days: number): number {
  let removed = 0
  try {
    const cutoff = Date.now() - Math.max(1, days) * 24 * 3600 * 1000
    for (const kind of ['download', 'app'] as LogKind[]) {
      const file = fileOf(kind)
      if (!fs.existsSync(file)) continue
      // 单文件模式下按「行内时间戳」过滤保留期内的条目
      const raw = fs.readFileSync(file, 'utf-8')
      const keep = raw
        .split('\n')
        .filter((l) => {
          if (!l.trim()) return false
          try {
            const e = JSON.parse(l) as LogEntry
            return Number(e.time ?? 0) >= cutoff
          } catch {
            return false
          }
        })
      const removedHere = raw.split('\n').filter((l) => l.trim()).length - keep.length
      if (removedHere > 0) {
        fs.writeFileSync(file, keep.length ? keep.join('\n') + '\n' : '', 'utf-8')
        removed += removedHere
      }
    }
  } catch (e) {
    console.error('[logger] 清理失败:', e)
  }
  return removed
}

/** 便捷方法 */
export const logApp = (level: LogLevel, scope: string, message: string): void => log('app', level, scope, message)
export const logDownload = (level: LogLevel, scope: string, message: string): void =>
  log('download', level, scope, message)
