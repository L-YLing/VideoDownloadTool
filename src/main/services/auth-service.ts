/**
 * 登录服务（main/services/auth-service.ts）
 * 依据 07-B站接入 §2、14-安全隐私：Cookie 会话加密存储（Electron safeStorage）。
 * v1 支持 Cookie 粘贴登录 + 应用内浏览器快速登录（自动捕获 Cookie）。
 */
import { BrowserWindow, shell, safeStorage } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import type { AuthStatus } from '../../shared/types'
import { userDataDir } from '../utils/paths'
import { biliGet } from './bili-web'
import type { DownloadService } from './download-service'

interface StoredSession {
  cookie: string
  username?: string
  mid?: number
  savedAt: number
}

export class AuthService {
  private session: StoredSession | null = null
  private readonly filePath = path.join(userDataDir(), 'session.bin')
  private listeners = new Set<(status: AuthStatus) => void>()
  private loginWindow: BrowserWindow | null = null
  private onQuickLoginDone: ((result: { ok: boolean; error?: string }) => void) | null = null

  constructor(private download: DownloadService) {
    this.load()
  }

  onAuthChange(cb: (status: AuthStatus) => void): void {
    this.listeners.add(cb)
  }

  private load(): void {
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath)
        let json: string
        if (safeStorage.isEncryptionAvailable()) {
          json = safeStorage.decryptString(raw)
        } else {
          json = raw.toString('utf-8')
        }
        const parsed = JSON.parse(json) as StoredSession
        if (parsed.cookie) {
          this.session = parsed
          this.download.setAuthCookie(parsed.cookie)
        }
      }
    } catch (e) {
      console.error('[auth] 会话读取失败，视为未登录:', e)
      this.session = null
    }
  }

  private persist(): void {
    try {
      if (!this.session) {
        if (fs.existsSync(this.filePath)) fs.unlinkSync(this.filePath)
        return
      }
      const json = JSON.stringify(this.session)
      if (safeStorage.isEncryptionAvailable()) {
        fs.writeFileSync(this.filePath, safeStorage.encryptString(json))
      } else {
        fs.writeFileSync(this.filePath, Buffer.from(json, 'utf-8'))
      }
    } catch (e) {
      console.error('[auth] 会话保存失败:', e)
    }
  }

  getStatus(): AuthStatus {
    if (!this.session?.cookie) return { loggedIn: false }
    return { loggedIn: true, username: this.session.username, mid: this.session.mid, method: 'cookie' }
  }

  /**
   * 校验已保存的会话并刷新昵称 / mid。
   *
   * 关键修复：B站 nav 接口**必须带 Referer/Origin**，否则即便 SESSDATA 完全有效
   * 也会返回 -101（未登录）。此前用裸 fetch 调用 → 被误判为未登录并清空会话，
   * 表现为「已经登录了、SESSDATA 也给了，却被识别成未登录」。
   *
   * 另外：只有拿到明确的未登录错误码才登出；网络异常/其它错误码一律保留会话。
   */
  async validateSession(): Promise<AuthStatus> {
    const cookie = this.session?.cookie
    if (!cookie) return this.getStatus()
    try {
      const res = await biliGet<{ uname?: string; mid?: number; isLogin?: boolean }>(
        '/x/web-interface/nav',
        cookie
      )
      // 明确的未登录 / 账号异常才清除会话
      if (res.code === -101 || res.code === -111) {
        this.logout()
        return this.getStatus()
      }
      if (res.code !== 0 || res.data?.isLogin === false) {
        // 其它错误码（风控、限流、临时异常）保留会话，避免误登出
        return this.getStatus()
      }
      if (this.session) {
        if (res.data?.uname) this.session.username = res.data.uname
        if (res.data?.mid) this.session.mid = res.data.mid
      }
      this.persist()
      this.emit()
    } catch {
      // 网络异常不清除会话
    }
    return this.getStatus()
  }

  /** 供 UI 手动刷新登录态（个人页/探索页进入时调用） */
  async refresh(): Promise<AuthStatus> {
    return this.validateSession()
  }

  isLoggedIn(): boolean {
    return Boolean(this.session?.cookie)
  }

  getCookie(): string | null {
    return this.session?.cookie ?? null
  }

  getMid(): number | null {
    return this.session?.mid ?? null
  }

  /** 从 Cookie 中提取 bili_jct（CSRF token），B站大多数 API POST/GET 都需要 */
  getBiliJct(): string | null {
    const cookie = this.session?.cookie
    if (!cookie) return null
    const m = cookie.match(/bili_jct=([^;\s]+)/)
    return m ? m[1] : null
  }

  /** Cookie 登录：解析常见键值对（SESSDATA 等） */
  async loginCookie(cookieText: string): Promise<{ ok: boolean; error?: string }> {
    const cookie = cookieText.trim()
    if (!cookie) return { ok: false, error: 'Cookie 为空' }
    // 提取 SESSDATA 判断有效性（宽松校验）
    const hasSession = /SESSDATA=([^;\s]+)/.test(cookie)
    if (!hasSession && !/bili_jct=/.test(cookie)) {
      return { ok: false, error: '未识别到有效的 B站 登录凭据（需包含 SESSDATA）' }
    }
    this.session = { cookie, savedAt: Date.now() }
    // 立即取回用户名与 mid：mid 用于拼「我的收藏夹」地址，缺失会导致列表打不开
    const profile = await this.fetchProfile()
    if (this.session) {
      if (profile.username) this.session.username = profile.username
      if (profile.mid) this.session.mid = profile.mid
    }
    this.download.setAuthCookie(cookie)
    this.persist()
    this.emit()
    return { ok: true }
  }

  /** 取昵称 / mid（同样需要 Referer，否则接口会返回未登录） */
  private async fetchProfile(): Promise<{ username?: string; mid?: number }> {
    const cookie = this.session?.cookie
    if (!cookie) return {}
    try {
      const res = await biliGet<{ uname?: string; mid?: number }>('/x/web-interface/nav', cookie)
      if (res.code !== 0) return {}
      return { username: res.data?.uname, mid: res.data?.mid }
    } catch {
      return {}
    }
  }

  logout(): void {
    this.session = null
    this.download.setAuthCookie(null)
    this.closeLoginWindow()
    try {
      if (fs.existsSync(this.filePath)) fs.unlinkSync(this.filePath)
    } catch (e) {
      console.error('[auth] 清除会话失败:', e)
    }
    this.emit()
  }

  /**
   * 拉起默认浏览器到 B 站登录页（外部模式）。
   * 注意：Electron 无法读取外部浏览器的 Cookie，用户登录完成后需手动粘贴 Cookie 回来。
   */
  openLoginInBrowser(): void {
    void shell.openExternal('https://passport.bilibili.com/login')
  }

  /**
   * 快速登录：打开一个内嵌浏览器窗口让用户在其中登录 B 站，
   * 登录成功后自动从 session 捕获 SESSDATA 等 Cookie 完成登录。
   */
  async quickLogin(): Promise<{ ok: boolean; error?: string }> {
    if (this.loginWindow) {
      this.loginWindow.focus()
      return { ok: false, error: '登录窗口已打开，请在其中完成登录' }
    }

    return new Promise((resolvePromise) => {
      this.onQuickLoginDone = resolvePromise
      this.loginWindow = new BrowserWindow({
        width: 1024,
        height: 720,
        minWidth: 800,
        minHeight: 600,
        title: 'B站登录（VD视频下载器）',
        backgroundColor: '#ffffff',
        autoHideMenuBar: true,
        webPreferences: {
          contextIsolation: false,
          nodeIntegration: false,
          sandbox: false,
          partition: 'persist:bili-login' // 独立 session，cookie 持久化在该 partition
        }
      })

      // 允许新窗口（如扫码跳转）在同窗口打开
      this.loginWindow.webContents.setWindowOpenHandler(({ url }) => {
        if (url.startsWith('http://') || url.startsWith('https://')) {
          void this.loginWindow?.loadURL(url)
        }
        return { action: 'deny' }
      })

      // 监听 cookie 变化——检测到 SESSDATA 即视为登录成功
      const session = this.loginWindow.webContents.session
      session.cookies.on('changed', (_event, cookie, _cause, removed) => {
        if (removed) return
        // SESSDATA 是关键凭据，出现即说明登录成功
        if (cookie.name === 'SESSDATA' && cookie.value) {
          void this.captureAndLogin(session)
        }
      })

      // 只在内嵌窗口中打开登录页。
      // 此前这里还会 shell.openExternal 拉起默认浏览器，导致「一次点击打开两个页面」；
      // 外部浏览器登录是独立入口（openLoginInBrowser），不应在快速登录里重复触发。
      void this.loginWindow.loadURL('https://passport.bilibili.com/login').catch(() => {
        // 加载失败不影响，用户可手动刷新
      })

      this.loginWindow.on('closed', () => {
        this.loginWindow = null
        if (this.onQuickLoginDone) {
          // 检查关闭前是否已登录（可能 cookie 事件漏触发）
          void session.cookies
            .get({ domain: '.bilibili.com' })
            .then((cookies) => {
              const hasSess = cookies.some((c) => c.name === 'SESSDATA' && c.value)
              if (hasSess) {
                void this.captureAndLogin(session)
              } else {
                this.onQuickLoginDone = null
                resolvePromise({ ok: false, error: '登录窗口已关闭' })
              }
            })
            .catch(() => {
              this.onQuickLoginDone = null
              resolvePromise({ ok: false, error: '登录窗口已关闭' })
            })
        }
      })
    })
  }

  /** 从登录窗口的 session 捕获 cookie 并完成登录 */
  private async captureAndLogin(session: Electron.Session): Promise<void> {
    try {
      const cookies = await session.cookies.get({ domain: '.bilibili.com' })
      if (!cookies.some((c) => c.name === 'SESSDATA' && c.value)) return

      const cookieStr = cookies
        .filter((c) => c.value)
        .map((c) => `${c.name}=${c.value}`)
        .join('; ')

      // 用已有的 loginCookie 逻辑完成登录
      const result = await this.loginCookie(cookieStr)

      // 清理独立 session 的 cookie 文件（可选：保留下次快速登录）
      // await session.clearStorageData()

      this.closeLoginWindow()
      if (this.onQuickLoginDone) {
        this.onQuickLoginDone(result)
        this.onQuickLoginDone = null
      }
    } catch (e) {
      console.error('[auth] 自动捕获 cookie 失败:', e)
      if (this.onQuickLoginDone) {
        this.onQuickLoginDone({ ok: false, error: '自动捕获失败，请手动粘贴 Cookie' })
        this.onQuickLoginDone = null
      }
    }
  }

  private closeLoginWindow(): void {
    if (this.loginWindow) {
      try {
        this.loginWindow.removeAllListeners('closed')
        this.loginWindow.close()
      } catch {
        /* ignore */
      }
      this.loginWindow = null
    }
  }

  private emit(): void {
    const status = this.getStatus()
    for (const cb of this.listeners) cb(status)
  }
}
