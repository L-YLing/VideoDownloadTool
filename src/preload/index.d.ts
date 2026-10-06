import type { VdApi } from './index'

declare global {
  interface Window {
    vd: VdApi
  }
}

export {}
