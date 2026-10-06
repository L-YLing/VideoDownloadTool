/**
 * 构建 / 系统信息（main/utils/build-info.ts）
 * 用于「关于」页展示：软件版本 + 补丁版本 + 检测到的系统平台与版本。
 */
import os from 'node:os'
import { app } from 'electron'

/**
 * 补丁版本：每发布一次热修 +1。
 * 格式：<major>.<minor> 之后的热修序号，例如 0.1.0 的第 1 个补丁 → "1"
 */
export const PATCH_LEVEL = '0'

/** 构建日期（ISO 日期，随构建时间更新） */
export const BUILD_DATE = '2026-10-04'

export function patchVersion(): string {
  return `${app.getVersion()}-p${PATCH_LEVEL}`
}

/** 检测到的系统名称（Windows 按 build 号区分 10/11，其它平台用 os.type） */
export function detectOsName(): string {
  const release = os.release()
  switch (process.platform) {
    case 'win32': {
      const [major, minor, build] = release.split('.').map((n) => Number(n) || 0)
      if (major > 10) return 'Windows'
      if (major < 10) return `Windows ${major}.${minor}`
      return build >= 22000 ? 'Windows 11' : 'Windows 10'
    }
    case 'darwin': {
      const major = Number(release.split('.')[0]) || 0
      // Darwin 内核版本 → macOS 版本（19=10.15 起每 +1 为大版本）
      if (major >= 20) return `macOS ${major - 9}.x`
      if (major === 19) return 'macOS 10.15'
      return `macOS (Darwin ${release})`
    }
    case 'linux':
      return 'Linux'
    default:
      return os.type()
  }
}

/** 检测到的系统版本（内核版本串） */
export function detectOsVersion(): string {
  return os.release()
}

/** 「关于」页展示的系统平台描述，如 Windows 11 (10.0.26100) */
export function describeSystem(): { osName: string; osVersion: string; arch: string } {
  return { osName: detectOsName(), osVersion: detectOsVersion(), arch: process.arch }
}
