<template>
  <aside class="sidebar">
    <nav>
      <button
        v-for="item in items"
        :key="item.id"
        class="tab"
        :class="{ active: isActive(item.id) }"
        @click="store.view = item.id"
      >
        <MdIcon :name="item.icon" :size="18" class="nav-icon" />
        <span>{{ item.label }}</span>
        <span v-if="item.id === 'download' && activeCount" class="count">{{ activeCount }}</span>
      </button>
    </nav>

    <div class="side-foot">
      <button class="chip foot-btn" :title="store.auth.loggedIn ? store.auth.username || '已登录 B站' : '未登录，点击前往登录'" @click="store.view = 'profile'">
        <MdIcon :name="store.auth.loggedIn ? 'accountCircle' : 'person'" :size="14" />
        <span class="foot-text">{{ store.auth.loggedIn ? store.auth.username || '已登录' : '未登录（点击登录）' }}</span>
      </button>
    </div>
  </aside>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { store } from '../store/app'
import MdIcon from './MdIcon.vue'

const items = [
  { id: 'download', label: '下载任务', icon: 'download' },
  { id: 'explore', label: '探索', icon: 'explore' },
  { id: 'player', label: '播放器', icon: 'play' },
  { id: 'favorites', label: '收藏夹', icon: 'star' },
  { id: 'library', label: '视频列表', icon: 'folder' },
  { id: 'settings', label: '设置', icon: 'settings' }
] as const

/** 子页面也算作所属主导航激活（如探索页的在线播放仍高亮「探索」） */
function isActive(id: string): boolean {
  if (id === 'explore') return store.view === 'explore' || store.view === 'explorePlayer'
  if (id === 'library') return store.view === 'library' || store.view === 'libraryDetail'
  if (id === 'player') return store.view === 'player'
  return store.view === id
}

const activeCount = computed(
  () => store.tasks.filter((t) => ['pending', 'downloading', 'merging', 'distributing', 'resolving'].includes(t.state)).length
)
</script>

<style scoped>
.sidebar {
  width: 180px;
  flex-shrink: 0;
  background: var(--md-surface-container);
  border-right: 1px solid var(--md-outline-variant);
  padding: 12px 10px;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
}

.nav-icon {
  width: 20px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}

.count {
  margin-left: auto;
  background: var(--md-primary);
  color: var(--md-on-primary);
  font-size: 11px;
  border-radius: 10px;
  padding: 1px 7px;
  font-weight: 600;
}

.side-foot {
  padding: 10px 6px;
}

.side-foot .chip {
  width: 100%;
  justify-content: center;
}

.foot-btn {
  border: none;
  font-family: inherit;
  cursor: pointer;
  transition: background 0.16s;
}

.foot-btn:hover {
  background: var(--md-secondary-container);
}

.foot-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 120px;
}
</style>
