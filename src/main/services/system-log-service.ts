/**
 * 系统日志服务（main/services/system-log-service.ts）
 *
 * 统一「软件日志」与「操作系统日志」，供「系统日志」页做专业排查：
 *  - 软件侧：程序日志 / 下载日志（JSONL，走 logger）
 *  - 系统侧：Windows 事件日志（System / Application / Setup / PowerShell / Security…）
 *
 * 统一输出形状（LogViewEntry），前端一套 UI 即可展示所有来源。
 * 分页：只返回当前页，避免整份日志进入渲染进程内存。
 */
import { spawn } from 'node:child_process'
import { readLogsPage } from './logger'

export type LogViewLevel = 'success' | 'info' | 'warn' | 'error'

export interface LogViewEntry {
  id: string
  /** 毫秒时间戳 */
  time: number
  level: LogViewLevel
  /** 来源（模块 / 事件提供程序） */
  scope: string
  message: string
}

export interface LogViewPage {
  ok: boolean
  entries: LogViewEntry[]
  total: number
  page: number
  pageSize: number
  hasMore: boolean
  error?: string
}

export interface SystemLogChannel {
  id: string
  label: string
  /** 来源类型：自有日志 / 系统事件日志 */
  source: 'app' | 'system'
  /** 是否需要管理员权限 */
  needsAdmin?: boolean
}

/** 固定分类（Windows 事件日志名 + 自有日志） */
const CHANNELS: SystemLogChannel[] = [
  { id: 'app', label: '程序日志', source: 'app' },
  { id: 'download', label: '下载日志', source: 'app' },
  { id: 'System', label: '系统', source: 'system' },
  { id: 'Application', label: '应用程序', source: 'system' },
  { id: 'Setup', label: '安装程序', source: 'system' },
  { id: 'Windows PowerShell', label: 'PowerShell', source: 'system' },
  { id: 'Microsoft-Windows-WindowsUpdateClient/Operational', label: 'Windows 更新', source: 'system' },
  { id: 'Security', label: '安全（需管理员）', source: 'system', needsAdmin: true }
]

const MAX_TAKE = 2000

/** 可用的日志分类列表 */
export function systemLogChannels(): SystemLogChannel[] {
  return CHANNELS
}

/** 把 Windows 事件级别（本地化或英文）归一化 */
function mapLevel(raw: string): LogViewLevel {
  const s = String(raw ?? '').trim()
  if (/错误|严重|Error|Critical|Fail/i.test(s)) return 'error'
  if (/警告|Warning/i.test(s)) return 'warn'
  if (/信息|详细|Information|Verbose|Info/i.test(s)) return 'info'
  return 'info'
}

/** 读取自有日志（JSONL）的一页 */
function readAppLog(channel: string, pn: number, ps: number): LogViewPage {
  const kind = channel === 'download' ? 'download' : 'app'
  const res = readLogsPage(kind, pn, ps)
  return {
    ok: true,
    entries: res.entries.map((e) => ({
      id: e.id,
      time: e.time,
      level: e.level as LogViewLevel,
      scope: e.scope,
      message: e.message
    })),
    total: res.total,
    page: pn,
    pageSize: ps,
    hasMore: pn * ps < res.total
  }
}

/** 读取 Windows 事件日志的一页（PowerShell + Get-WinEvent） */
function readWinLog(channel: string, pn: number, ps: number): Promise<LogViewPage> {
  return new Promise((resolvePromise) => {
    if (process.platform !== 'win32') {
      resolvePromise({
        ok: false,
        entries: [],
        total: 0,
        page: pn,
        pageSize: ps,
        hasMore: false,
        error: '当前系统不支持 Windows 事件日志'
      })
      return
    }
    const ch = channel.replace(/'/g, "''")
    const take = Math.min(pn * ps, MAX_TAKE)
    // 关键点：
    //  - [Console]::OutputEncoding 设为 UTF8，否则中文会按 GBK 输出导致乱码
    //  - Get-WinEvent -MaxEvents N 取最新 N 条（降序），再 Select-Object -Last ps 得到第 pn 页
    //  - 时间输出为 ISO('o')，便于前端按本地时区显示
    const script = [
      '[Console]::OutputEncoding=[Text.Encoding]::UTF8',
      `$ch='${ch}'`,
      '$log=Get-WinEvent -ListLog $ch -ErrorAction Stop',
      `$ev=@(Get-WinEvent -LogName $ch -MaxEvents ${take} -ErrorAction Stop)`,
      `$slice=@($ev | Select-Object -Last ${ps})`,
      '$items=@($slice | ForEach-Object { [pscustomobject]@{ t=$_.TimeCreated.ToString("o"); l=[string]$_.LevelDisplayName; p=[string]$_.ProviderName; i=$_.Id; m=[string]$_.Message } })',
      '[pscustomobject]@{ total=[int64]$log.RecordCount; items=$items } | ConvertTo-Json -Depth 4 -Compress'
    ].join('; ')

    const child = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
      { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }
    )
    let out = ''
    let err = ''
    const timer = setTimeout(() => {
      try {
        child.kill()
      } catch {
        /* ignore */
      }
    }, 30000)
    child.stdout.on('data', (d: Buffer) => (out += d.toString('utf-8')))
    child.stderr.on('data', (d: Buffer) => (err += d.toString('utf-8')))
    child.on('error', (e) => {
      clearTimeout(timer)
      resolvePromise({
        ok: false,
        entries: [],
        total: 0,
        page: pn,
        pageSize: ps,
        hasMore: false,
        error: `无法启动 PowerShell：${e.message}`
      })
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (code !== 0 || !out.trim()) {
        const raw = err.trim()
        const msg = raw.split(/\r?\n/).filter(Boolean).pop() ?? `退出码 ${code}`
        const whole = raw || msg
        let friendly = msg
        if (/拒绝访问|Access is denied|requires elevation|Authorization|Unauthorized/i.test(whole)) {
          friendly = '读取该日志需要管理员权限：请以管理员身份运行本软件后重试'
        } else if (/LogInfoUnavailable|No events were found|日志.*不可用|no events/i.test(whole)) {
          friendly = '该日志当前不可用（可能未启用或被系统策略禁用），请换一个分类查看'
        } else if (/does not exist|找不到|not found/i.test(whole)) {
          friendly = '系统中不存在该日志分类'
        }
        resolvePromise({
          ok: false,
          entries: [],
          total: 0,
          page: pn,
          pageSize: ps,
          hasMore: false,
          error: friendly
        })
        return
      }
      try {
        const json = JSON.parse(out) as { total?: number; items?: unknown }
        const rawItems: Array<Record<string, unknown>> = Array.isArray(json.items)
          ? (json.items as Array<Record<string, unknown>>)
          : json.items
            ? [json.items as Record<string, unknown>]
            : []
        const entries: LogViewEntry[] = rawItems.map((o, idx) => {
          const ts = o.t ? Date.parse(String(o.t)) : NaN
          const msg = String(o.m ?? '').replace(/\r?\n/g, ' ⏎ ').trim()
          return {
            id: `${pn}-${idx}-${o.i ?? ''}`,
            time: Number.isFinite(ts) ? ts : Date.now(),
            level: mapLevel(String(o.l ?? '')),
            scope: `${String(o.p ?? '')}${o.i != null ? ` #${o.i}` : ''}`.trim() || '系统',
            message: msg.length > 2000 ? msg.slice(0, 2000) + '…' : msg
          }
        })
        const total = Number(json.total ?? 0) || entries.length
        resolvePromise({
          ok: true,
          entries,
          total,
          page: pn,
          pageSize: ps,
          hasMore: pn * ps < total
        })
      } catch (e) {
        resolvePromise({
          ok: false,
          entries: [],
          total: 0,
          page: pn,
          pageSize: ps,
          hasMore: false,
          error: `解析系统日志失败：${e instanceof Error ? e.message : String(e)}`
        })
      }
    })
  })
}

/** 读取任意分类的一页日志 */
export async function readSystemLog(channel: string, pn = 1, ps = 50): Promise<LogViewPage> {
  const meta = CHANNELS.find((c) => c.id === channel)
  const page = Math.max(1, pn)
  const size = Math.max(1, Math.min(200, ps))
  if (!meta) {
    return { ok: false, entries: [], total: 0, page, pageSize: size, hasMore: false, error: '未知的日志分类' }
  }
  if (meta.source === 'app') return readAppLog(meta.id, page, size)
  return readWinLog(meta.id, page, size)
}
