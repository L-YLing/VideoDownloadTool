/**
 * 命名 / 目录模板（shared/template.ts）
 * 主进程与渲染进程共用：占位符文档、合法性校验、默认值兜底。
 *
 * 设计要点：
 * - 「同目录」模式下文件命名模板不允许出现 `/`（会被 yt-dlp 解析成子目录，与模式语义冲突）
 * - 「作者隔离 / 自定义」模式允许 `/`，用于构造目录层级
 * - 校验不通过且用户未修改 → 直接落到默认模板，避免静默产生不符合预期的目录
 */

import type { FolderMode } from './types'

/** 默认文件命名模板：视频标题_作者_发布时间_分P(如果有).格式后缀 */
export const DEFAULT_NAMING_TEMPLATE = '{title}_{uploader}_{date}{p}.{ext}'

/** 文件命名模板可用占位符（顺序即文档展示顺序） */
export const NAMING_PLACEHOLDERS: Array<{
  token: string
  yt: string
  desc: string
  example: string
}> = [
  { token: '{title}', yt: '%(title)s', desc: '视频标题', example: '【4K】风景合集' },
  { token: '{uploader}', yt: '%(uploader)s', desc: 'UP 主 / 作者名', example: '碧诗' },
  { token: '{date}', yt: '%(upload_date)s', desc: '发布时间（YYYYMMDD）', example: '20240115' },
  { token: '{p}', yt: '%(playlist_index&_{}|)s', desc: '分P（有则输出「_序号」，无则整段留空）', example: '_3' },
  { token: '{index}', yt: '%(playlist_index|)s', desc: '分P / 合集序号（无分P时为空）', example: '3' },
  { token: '{quality}', yt: '%(height)s', desc: '实际画质高度', example: '1080' },
  { token: '{favName}', yt: '%(playlist_title)s', desc: '收藏夹 / 合集名称', example: '我的收藏' },
  { token: '{ext}', yt: '%(ext)s', desc: '文件扩展名（建议放末尾）', example: 'mp4' }
]

/** 目录模板可用占位符（「自定义」模式） */
export const FOLDER_PLACEHOLDERS: Array<{ token: string; yt: string; desc: string; example: string }> = [
  { token: '{uploader}', yt: '%(uploader)s', desc: 'UP 主 / 作者名', example: '碧诗' },
  { token: '{favName}', yt: '%(playlist_title)s', desc: '收藏夹 / 合集名称', example: '我的收藏' },
  { token: '{date}', yt: '%(upload_date)s', desc: '发布时间（YYYYMMDD）', example: '20240115' },
  { token: '{quality}', yt: '%(height)s', desc: '实际画质高度', example: '1080' },
  { token: '{ext}', yt: '%(ext)s', desc: '扩展名（出现时表示模板已包含文件名）', example: 'mp4' }
]

/** 目录模板中是否允许出现路径分隔符 */
export function folderModeAllowsSeparator(mode: FolderMode): boolean {
  return mode === 'uploader' || mode === 'custom'
}

export interface TemplateIssue {
  level: 'error' | 'warn'
  /** 归属字段：naming=文件命名模板，folder=目录模板 */
  field: 'naming' | 'folder'
  message: string
}

/** 模板中是否含有路径分隔符（/ 或 \） */
export function hasSeparator(template: string): boolean {
  return /[\\/]/.test(template)
}

/** 去掉模板中的路径部分，只保留最后一段（用于「同目录」兜底前的提示展示） */
export function stripTemplatePath(template: string): string {
  const parts = template.split(/[\\/]/).filter(Boolean)
  return parts.length > 0 ? parts[parts.length - 1] : template
}

/** 校验文件命名模板 */
export function validateNamingTemplate(mode: FolderMode, template: string): TemplateIssue[] {
  const issues: TemplateIssue[] = []
  const tpl = (template ?? '').trim()
  if (!tpl) {
    issues.push({ level: 'error', field: 'naming', message: '命名模板不能为空，将回退到默认模板' })
    return issues
  }
  if (hasSeparator(tpl) && !folderModeAllowsSeparator(mode)) {
    issues.push({
      level: 'error',
      field: 'naming',
      message: '「同目录」模式下命名模板不支持 / 分隔符（会被解析为子文件夹），请删除后重试；未修改将使用默认模板'
    })
  }
  if (tpl.includes('..')) {
    issues.push({ level: 'error', field: 'naming', message: '命名模板不能包含 ..（防目录穿越）' })
  }
  if (/^[\\/]/.test(tpl)) {
    issues.push({ level: 'error', field: 'naming', message: '命名模板不能以 / 开头' })
  }
  if (!tpl.includes('{ext}')) {
    issues.push({ level: 'warn', field: 'naming', message: '模板未包含 {ext}，yt-dlp 会自动补扩展名，建议显式写在末尾' })
  }
  const unknown = findUnknownPlaceholders(tpl, NAMING_PLACEHOLDERS.map((p) => p.token))
  if (unknown.length > 0) {
    issues.push({ level: 'warn', field: 'naming', message: `存在无法识别的占位符：${unknown.join('、')}` })
  }
  return issues
}

/** 校验目录模板（仅「自定义」模式使用） */
export function validateFolderTemplate(mode: FolderMode, template: string): TemplateIssue[] {
  const issues: TemplateIssue[] = []
  if (mode !== 'custom') return issues
  const tpl = (template ?? '').trim()
  if (!tpl) {
    issues.push({ level: 'warn', field: 'folder', message: '目录模板为空，将直接保存到目标目录' })
    return issues
  }
  if (tpl.includes('..')) {
    issues.push({ level: 'error', field: 'folder', message: '目录模板不能包含 ..（防目录穿越）' })
  }
  if (/^[\\/]/.test(tpl) || /^[A-Za-z]:/.test(tpl)) {
    issues.push({ level: 'error', field: 'folder', message: '目录模板请使用相对路径（不要以 / 或盘符开头）' })
  }
  const allowed = [...FOLDER_PLACEHOLDERS.map((p) => p.token), ...NAMING_PLACEHOLDERS.map((p) => p.token)]
  const unknown = findUnknownPlaceholders(tpl, allowed)
  if (unknown.length > 0) {
    issues.push({ level: 'warn', field: 'folder', message: `存在无法识别的占位符：${unknown.join('、')}` })
  }
  return issues
}

function findUnknownPlaceholders(template: string, allowed: string[]): string[] {
  const found = template.match(/\{[^{}]+\}/g) ?? []
  return [...new Set(found)].filter((t) => !allowed.includes(t))
}

/** 是否有阻断性错误 */
export function hasBlockingIssue(issues: TemplateIssue[]): boolean {
  return issues.some((i) => i.level === 'error')
}

/**
 * 取最终生效的文件命名模板：
 * 同目录模式下若模板非法（含路径分隔符 / 空 / 含 ..）→ 直接使用默认模板。
 */
export function effectiveNamingTemplate(mode: FolderMode, template: string): string {
  const tpl = (template ?? '').trim()
  const issues = validateNamingTemplate(mode, tpl)
  if (hasBlockingIssue(issues)) return DEFAULT_NAMING_TEMPLATE
  return tpl || DEFAULT_NAMING_TEMPLATE
}

/** 取最终生效的目录模板（不含文件名） */
export function effectiveFolderTemplate(mode: FolderMode, customTemplate: string): string {
  switch (mode) {
    case 'flat':
      return ''
    case 'uploader':
      return '{uploader}'
    case 'custom': {
      const tpl = (customTemplate ?? '').trim().replace(/^[\\/]+|[\\/]+$/g, '')
      if (!tpl || tpl.includes('..')) return ''
      return tpl
    }
    default:
      return ''
  }
}

/** 完整输出模板 = 目录模板（可空） + 文件命名模板 */
export function resolveOutputTemplate(settings: {
  folderMode: FolderMode
  customFolderTemplate: string
  renameTemplate: string
}): string {
  const fileTpl = effectiveNamingTemplate(settings.folderMode, settings.renameTemplate)
  const dirTpl = effectiveFolderTemplate(settings.folderMode, settings.customFolderTemplate)
  if (!dirTpl) return fileTpl
  // 目录模板里若已含 {ext}，视为完整路径模板，不再追加文件名
  if (dirTpl.includes('{ext}')) return dirTpl
  return `${dirTpl}/${fileTpl}`
}

/**
 * 把用户可见模板转换为 yt-dlp 输出模板。
 * {p} 必须在 {index} 之前替换，否则 {index} 的替换串会被二次匹配。
 */
export function toYtDlpTemplate(template: string): string {
  return template
    .replace(/\{p\}/g, '%(playlist_index&_{}|)s')
    .replace(/\{title\}/g, '%(title)s')
    .replace(/\{uploader\}/g, '%(uploader)s')
    .replace(/\{quality\}/g, '%(height)s')
    .replace(/\{index\}/g, '%(playlist_index|)s')
    .replace(/\{date\}/g, '%(upload_date)s')
    .replace(/\{ext\}/g, '%(ext)s')
    .replace(/\{favName\}/g, '%(playlist_title)s')
}
