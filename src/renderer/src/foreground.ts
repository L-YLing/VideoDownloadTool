import { store } from './store/app'

/**
 * 前后台状态跟踪（后台播放策略的输入）。
 *
 * 判定「后台」的两种典型场景：
 * - 窗口最小化 / 隐藏到托盘 → document.visibilityState 变为 'hidden'
 * - 窗口仍可见但焦点被其他程序抢走 → document.hasFocus() 为 false
 *
 * 二者任一不满足即视为后台，播放器据此决定「暂停」还是「只留声音」。
 */
export function setupForegroundTracking(): void {
  const update = (): void => {
    store.foreground = document.visibilityState === 'visible' && document.hasFocus()
  }
  document.addEventListener('visibilitychange', update)
  window.addEventListener('focus', update)
  window.addEventListener('blur', () => {
    // blur 稍作延迟：避免拖拽/弹窗导致的焦点抖动被误判为后台
    setTimeout(update, 120)
  })
  update()
}
