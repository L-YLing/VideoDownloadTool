<template>
  <div class="app-shell">
    <TopBar />
    <div class="body">
      <Sidebar />
      <!-- 设置页需要左右分栏铺满整块内容区，故取消其自身滚动与内边距 -->
      <main class="content" :class="{ 'content-fill': store.view === 'settings' }">
        <KeepAlive>
          <div :key="store.view" class="view-enter" :class="{ 'view-fill': store.view === 'settings' }">
            <component :is="currentView" />
          </div>
        </KeepAlive>
      </main>
    </div>
    <ToastHost />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { initApp, store } from './store/app'
import TopBar from './components/TopBar.vue'
import Sidebar from './components/Sidebar.vue'
import ToastHost from './components/ToastHost.vue'
import DownloadView from './views/DownloadView.vue'
import PlayerView from './views/PlayerView.vue'
import FavoritesView from './views/FavoritesView.vue'
import LibraryView from './views/LibraryView.vue'
import LibraryDetailView from './views/LibraryDetailView.vue'
import SettingsView from './views/SettingsView.vue'
import ExploreView from './views/ExploreView.vue'
import ExplorePlayerView from './views/ExplorePlayerView.vue'
import ProfileView from './views/ProfileView.vue'
import HistoryView from './views/HistoryView.vue'
import LogsView from './views/LogsView.vue'
import SystemLogView from './views/SystemLogView.vue'

const views = {
  download: DownloadView,
  player: PlayerView,
  favorites: FavoritesView,
  library: LibraryView,
  libraryDetail: LibraryDetailView,
  settings: SettingsView,
  explore: ExploreView,
  explorePlayer: ExplorePlayerView,
  profile: ProfileView,
  history: HistoryView,
  logs: LogsView,
  systemLog: SystemLogView
} as const

const currentView = computed(() => views[store.view])

onMounted(() => {
  void initApp()
})
</script>

<style scoped>
.app-shell {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.body {
  display: flex;
  flex: 1;
  min-height: 0;
}

.content {
  flex: 1;
  min-width: 0;
  overflow-y: auto;
  padding: 20px 24px;
}

/* 设置页：内容区不再滚动/留白，由设置页内部的左右分栏各自填满 */
.content-fill {
  overflow: hidden;
  padding: 0;
  display: flex;
  min-height: 0;
}

.view-fill {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
}

.view-fill > * {
  flex: 1;
  min-width: 0;
}
</style>
