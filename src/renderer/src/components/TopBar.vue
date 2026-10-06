<template>
  <header class="topbar">
    <div class="brand">
      <div class="logo" :style="{ background: `var(--md-primary)` }">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="var(--md-on-primary)">
          <path d="M12 3v10.6l3.9-3.9 1.4 1.4L12 16.4 6.7 11.1l1.4-1.4L12 13.6V3h0zm-7 15h14v2H5v-2z" />
        </svg>
      </div>
      <span class="title">VD视频下载器</span>
      <span class="ver" v-if="store.sysInfo">v{{ store.sysInfo.version }}</span>
    </div>

    <div class="spacer"></div>

    <div class="actions">
      <!-- D3：最小化到系统托盘按钮（仅 Windows） -->
      <button
        v-if="store.sysInfo?.isWindows"
        class="btn btn-secondary btn-sm"
        title="最小化到系统托盘（窗口隐藏，托盘驻留）"
        @click="minimizeToTray"
      >
        <MdIcon name="tray" :size="15" /> 最小化到托盘
      </button>
      <button class="btn btn-text btn-sm" @click="go('download')">
        <MdIcon name="add" :size="15" /> 新建下载
      </button>
      <!-- 用户头像入口：点击进入个人页；未登录则直接拉起登录 -->
      <button class="avatar-btn" :title="store.auth.loggedIn ? (store.auth.username || '个人中心') : '未登录，点击登录'" @click="openProfile">
        <MdIcon :name="store.auth.loggedIn ? 'accountCircle' : 'person'" :size="20" />
        <span v-if="store.auth.loggedIn" class="avatar-name">{{ store.auth.username || '我' }}</span>
      </button>
      <button class="icon-btn" title="设置" @click="go('settings')">
        <MdIcon name="settings" :size="18" />
      </button>
    </div>
  </header>
</template>

<script setup lang="ts">
import { store, toast } from '../store/app'
import MdIcon from './MdIcon.vue'

function go(view: 'download' | 'settings'): void {
  store.view = view
}

/** 进入个人页；未登录时递增登录请求，个人页会自动弹出登录窗口 */
function openProfile(): void {
  if (!store.auth.loggedIn) store.loginRequest++
  store.view = 'profile'
}

async function minimizeToTray(): Promise<void> {
  const ok = await window.vd.minimizeToTray()
  if (!ok) toast('当前系统不支持托盘驻留', 'error')
}
</script>

<style scoped>
.topbar {
  display: flex;
  align-items: center;
  gap: 12px;
  height: 52px;
  padding: 0 16px;
  background: var(--md-surface-container);
  border-bottom: 1px solid var(--md-outline-variant);
  flex-shrink: 0;
}

.brand {
  display: flex;
  align-items: center;
  gap: 10px;
}

.logo {
  width: 30px;
  height: 30px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.title {
  font-weight: 700;
  font-size: 15px;
}

.ver {
  font-size: 11px;
  color: var(--md-on-surface-variant);
  background: var(--md-secondary-container);
  padding: 2px 8px;
  border-radius: 10px;
}

.spacer {
  flex: 1;
}

.actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.avatar-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 34px;
  max-width: 160px;
  padding: 0 10px;
  border: 1px solid var(--md-outline-variant);
  border-radius: 999px;
  background: var(--md-surface-container-low);
  color: var(--md-on-surface);
  font-family: inherit;
  font-size: 13px;
  cursor: pointer;
  transition: background 0.16s, border-color 0.16s;
}

.avatar-btn:hover {
  background: var(--md-secondary-container);
  border-color: var(--md-primary);
}

.avatar-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
