/**
 * 内存优化（main/services/memory-service.ts）
 *
 * 思路参考 PCL（Plain Craft Launcher）的「内存优化」：
 * 调用 Windows `psapi.dll!EmptyWorkingSet` 把进程的工作集（物理内存页）交还给系统。
 * 这些页并未丢失（仍在分页文件/待命中），再次访问时按需换入，
 * 因此表现为「任务管理器里的内存立刻降下来」，属于安全操作。
 *
 * 同时附带：
 *  - 清理 Chromium 代码缓存（编译后的 JS/WASM 机器码），释放一部分内存
 *  - 采集优化前后的内存占用用于展示
 *
 * 说明：EmptyWorkingSet 需要 PROCESS_QUERY_INFORMATION | PROCESS_SET_QUOTA 权限，
 * 对本应用自身进程（主进程 / 渲染进程 / GPU 进程）均可打开；无需管理员权限。
 */
import { app, session } from 'electron'
import { spawn } from 'node:child_process'

export interface MemoryReport {
  ok: boolean
  /** 优化前占用（MB） */
  beforeMB: number
  /** 优化后占用（MB） */
  afterMB: number
  /** 回收量（MB，可能为负 —— 说明期间又分配了内存） */
  freedMB: number
  /** 处理的进程数 */
  processes: number
  /** 是否真正执行了系统级回收 */
  trimmed: boolean
  note?: string
  error?: string
}

/** 汇总本应用所有进程的工作集占用（MB） */
function currentMemoryMB(): { total: number; pids: number[] } {
  try {
    const metrics = app.getAppMetrics()
    let total = 0
    const pids: number[] = []
    for (const m of metrics) {
      // workingSetSize 单位为 KB
      const kb = Number((m.memory as { workingSetSize?: number })?.workingSetSize ?? 0)
      if (Number.isFinite(kb)) total += kb
      if (m.pid) pids.push(m.pid)
    }
    return { total: total / 1024, pids }
  } catch {
    return { total: process.memoryUsage().rss / 1024 / 1024, pids: [process.pid] }
  }
}

/**
 * 调用 PowerShell 对指定 PID 逐个 EmptyWorkingSet。
 * 之所以用 PowerShell + Add-Type：Node 侧没有 PSAPI 绑定，
 * 而 Add-Type 可直接 P/Invoke，无需随包编译原生模块。
 * （Add-Type 首次编译约 1s，之后同进程内可复用，故这里只启动一次。）
 */
function trimWorkingSet(pids: number[]): Promise<{ ok: boolean; error?: string }> {
  return new Promise((resolvePromise) => {
    if (process.platform !== 'win32') {
      resolvePromise({ ok: false, error: '仅 Windows 支持工作集回收' })
      return
    }
    if (pids.length === 0) {
      resolvePromise({ ok: false, error: '没有可优化的进程' })
      return
    }
    // C# 源码：P/Invoke 三个 API
    const cs = [
      'using System;',
      'using System.Runtime.InteropServices;',
      'public static class VdMem {',
      '  [DllImport("kernel32.dll", SetLastError=true)] public static extern IntPtr OpenProcess(int access, bool inherit, int pid);',
      '  [DllImport("psapi.dll", SetLastError=true)] public static extern bool EmptyWorkingSet(IntPtr h);',
      '  [DllImport("kernel32.dll", SetLastError=true)] public static extern bool CloseHandle(IntPtr h);',
      '}'
    ].join('\n')

    // 用单引号 here-string 承载 C#，避免其中双引号与 PowerShell 引号冲突
    // 0x0100 = PROCESS_SET_QUOTA，0x0400 = PROCESS_QUERY_INFORMATION
    const body = [
      "$src = @'",
      cs,
      "'@",
      'Add-Type -TypeDefinition $src -ErrorAction SilentlyContinue',
      `$targets = @(${pids.join(',')})`,
      '$n = 0',
      'foreach ($p in $targets) {',
      '  $h = [VdMem]::OpenProcess(0x0100 -bor 0x0400, $false, $p)',
      '  if ($h -ne [IntPtr]::Zero) { if ([VdMem]::EmptyWorkingSet($h)) { $n++ }; [void][VdMem]::CloseHandle($h) }',
      '}',
      'Write-Output $n'
    ].join('\n')

    const child = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', body],
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
    }, 20000)
    child.stdout.on('data', (d: Buffer) => (out += d.toString('utf-8')))
    child.stderr.on('data', (d: Buffer) => (err += d.toString('utf-8')))
    child.on('error', (e) => {
      clearTimeout(timer)
      resolvePromise({ ok: false, error: `无法启动 PowerShell：${e.message}` })
    })
    child.on('close', () => {
      clearTimeout(timer)
      const n = Number(out.trim().split(/\r?\n/).pop() ?? 0)
      if (n > 0) resolvePromise({ ok: true })
      else resolvePromise({ ok: false, error: err.trim().split(/\r?\n/).pop() || '未能回收工作集' })
    })
  })
}

/**
 * 执行一次内存优化。
 * @param clearCodeCache 是否同时清理 Chromium 代码缓存（默认是）
 */
export async function optimizeMemory(clearCodeCache = true): Promise<MemoryReport> {
  const before = currentMemoryMB()
  let trimmed = false
  let error: string | undefined

  // ① 系统级：回收工作集
  const res = await trimWorkingSet(before.pids)
  trimmed = res.ok
  if (!res.ok) error = res.error

  // ② 应用级：清理代码缓存（编译后的机器码），减少 JS 堆外的常驻内存
  if (clearCodeCache) {
    try {
      await session.defaultSession.clearCodeCaches({})
    } catch {
      /* 清理失败不影响整体 */
    }
  }

  // 给系统一点时间完成回收统计
  await new Promise((r) => setTimeout(r, 250))
  const after = currentMemoryMB()
  return {
    ok: trimmed,
    beforeMB: Number(before.total.toFixed(1)),
    afterMB: Number(after.total.toFixed(1)),
    freedMB: Number((before.total - after.total).toFixed(1)),
    processes: before.pids.length,
    trimmed,
    note: process.platform === 'win32' ? undefined : '当前系统不支持工作集回收，仅清理了代码缓存',
    error
  }
}

/** 当前内存占用（MB），供设置页显示 */
export function currentMemoryReport(): { totalMB: number; processes: number } {
  const { total, pids } = currentMemoryMB()
  return { totalMB: Number(total.toFixed(1)), processes: pids.length }
}
