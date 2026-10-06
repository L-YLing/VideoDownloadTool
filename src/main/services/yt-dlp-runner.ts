/**
 * yt-dlp 子进程运行器（main/services/yt-dlp-runner.ts）
 * 负责以子进程方式调用 yt-dlp，输出 JSON 供解析（低资源：流式、超时控制）。
 */
import { spawn } from 'node:child_process'
import { resolveYtDlp, ytDlpEnv } from '../utils/paths'
import { ytdlpProxyArgs, type ProxySettings } from '../utils/ytdlp-args'

export interface YtDlpOptions {
  timeoutMs?: number
  env?: NodeJS.ProcessEnv
}

/**
 * 全局代理设置提供者：由主进程启动时注册（见 main/index.ts）。
 * 这样本文件所有调用方（解析预览 / 插件解析 / 收藏夹解析）都能自动获得
 * 统一的代理策略，无需各自传参 —— 默认强制直连，避免系统代理劫持导致 SSL 失败。
 */
let proxySettingsProvider: (() => ProxySettings) | null = null

/** 注册代理设置来源（应用启动时调用一次） */
export function setYtDlpProxySettingsProvider(fn: () => ProxySettings): void {
  proxySettingsProvider = fn
}

/** 运行 yt-dlp 并收集 stdout 解析为 JSON */
export function spawnYtDlpJson(args: string[], opts: YtDlpOptions = {}): Promise<any> {
  // 确保以 JSON 模式输出（--dump-json 简写 -J），避免调用方遗漏
  // 同时强制 --encoding utf-8，避免 Windows 下 GBK 输出导致中文乱码
  const needsJ = !args.includes('-J') && !args.includes('--dump-json')
  const needsEnc = !args.includes('--encoding')
  const fullArgs = [...args]
  if (needsJ) fullArgs.unshift('-J')
  if (needsEnc) fullArgs.push('--encoding', 'utf-8')
  // 统一代理策略：调用方未显式指定 --proxy 时按全局设置注入
  if (!fullArgs.includes('--proxy') && proxySettingsProvider) {
    fullArgs.push(...ytdlpProxyArgs(proxySettingsProvider()))
  }
  return new Promise((resolvePromise, rejectPromise) => {
    const bin = resolveYtDlp()
    const child = spawn(bin, fullArgs, {
      windowsHide: true,
      env: ytDlpEnv(opts.env),
      stdio: ['ignore', 'pipe', 'pipe']
    })
    let stdout = ''
    let stderr = ''
    let settled = false
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true
        child.kill()
        rejectPromise(new Error(`yt-dlp 解析超时（${opts.timeoutMs ?? 30000}ms）`))
      }
    }, opts.timeoutMs ?? 30000)

    child.stdout.on('data', (d: Buffer) => {
      stdout += d.toString('utf-8')
      if (stdout.length > 50 * 1024 * 1024) {
        // 防止内存膨胀
        child.kill()
      }
    })
    child.stderr.on('data', (d: Buffer) => {
      stderr += d.toString('utf-8')
    })
    child.on('error', (err) => {
      if (!settled) {
        settled = true
        clearTimeout(timer)
        rejectPromise(new Error(`无法启动 yt-dlp: ${err.message}`))
      }
    })
    child.on('close', (code) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (code === 0 && stdout.trim()) {
        try {
          resolvePromise(JSON.parse(stdout))
        } catch {
          rejectPromise(new Error('yt-dlp 输出不是有效 JSON'))
        }
      } else {
        const msg = stderr.trim().split(/\r?\n/).pop() ?? `yt-dlp 退出码 ${code}`
        rejectPromise(new Error(msg))
      }
    })
  })
}
