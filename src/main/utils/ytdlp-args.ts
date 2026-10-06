/**
 * yt-dlp 公共参数（main/utils/ytdlp-args.ts）
 *
 * 背景（重要）：
 * yt-dlp 是 Python 程序，当**没有**显式指定 `--proxy` 时，它会自动读取
 * Windows 注册表（WinINET）里的系统代理。而国内常见的网络加速器
 * （Steam++ / Watt Toolkit、部分游戏加速器、VPN 客户端）会把系统代理
 * 设为 `127.0.0.1:xxxx`，此时：
 *   - 请求被劫持到加速器
 *   - 加速器的 HTTPS 证书不在 Python 的 certifi 证书库里
 *   - 于是报 `[SSL: CERTIFICATE_VERIFY_FAILED] unable to get local issuer certificate`
 *   - 表现为「以前能下，开了加速器之后所有视频都下载失败」
 *
 * 因此默认策略为「强制直连」（显式传 `--proxy ""`，yt-dlp 语义为“不使用代理”），
 * 只在用户**明确**设置了代理、或主动开启「使用系统代理」时才走代理。
 */

/** 与代理相关的设置片段（避免直接依赖 Settings 全量类型） */
export interface ProxySettings {
  /** 用户在设置里填写的代理地址（空 = 未配置） */
  proxy?: string
  /** 是否允许使用操作系统代理（默认 false = 强制直连） */
  useSystemProxy?: boolean
}

/**
 * 生成 yt-dlp 的代理参数。
 *
 * @param settings 当前设置
 * @param override 单次任务级代理（优先级最高）
 * @returns 需要追加到 yt-dlp 参数列表中的片段
 */
export function ytdlpProxyArgs(settings: ProxySettings, override?: string): string[] {
  const explicit = String(override ?? settings.proxy ?? '').trim()
  // ① 显式配置的代理优先
  if (explicit) return ['--proxy', explicit]
  // ② 用户主动要求跟随系统代理 → 不传参，交给 yt-dlp 自行读取系统代理
  if (settings.useSystemProxy) return []
  // ③ 默认：强制直连，避免被加速器 / VPN 的系统代理劫持
  return ['--proxy', '']
}
