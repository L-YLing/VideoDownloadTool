<template>
  <div class="history-view">
    <section class="card">
      <div class="row-between">
        <h3 class="section-title" style="margin-bottom: 0">
          <MdIcon name="history" :size="17" /> 历史记录
        </h3>
        <div class="row" style="gap: 6px">
          <input v-model="keyword" class="input" style="width: 180px" placeholder="筛选标题 / UP主 / 路径" />
          <button class="btn btn-text btn-sm" :disabled="loading" @click="load">
            <MdIcon name="refresh" :size="15" /> 刷新
          </button>
          <button class="btn btn-secondary btn-sm" :disabled="items.length === 0" @click="clearAll">
            <MdIcon name="close" :size="15" /> 清空
          </button>
        </div>
      </div>

      <div v-if="loading && items.length === 0" class="empty" style="padding: 40px">
        <MdIcon name="refresh" :size="30" class="empty-icon spinner" />
        <div>正在读取播放历史…</div>
      </div>
      <div v-else-if="filtered.length === 0" class="empty" style="padding: 40px">
        <MdIcon name="history" :size="36" class="empty-icon" />
        <div>{{ items.length === 0 ? '还没有播放记录' : '没有匹配的记录' }}</div>
        <p class="hint" style="max-width: 420px">观看过的本地视频、下载文件与探索预览都会记录在这里，可直接续播。</p>
      </div>
      <div v-else class="rows">
        <div
          v-for="(h, i) in pagedRows"
          :key="h.id"
          class="row-item"
          :class="{ alt: i % 2 === 1 }"
        >
          <div class="thumb">
            <img v-if="h.cover && !failedCovers.has(h.id)" :src="coverSrc(h.cover)" :alt="h.title" @error="markFailed(h.id)" />
            <MdIcon v-else :name="isAudio(h.path) ? 'lyric' : 'movie'" :size="22" />
          </div>
          <div class="meta">
            <div class="title" :title="h.title">{{ h.title }}</div>
            <div class="sub">
              <span v-if="h.uploader"><MdIcon name="person" :size="11" /> {{ h.uploader }}</span>
              <span v-if="h.from">{{ h.from }}</span>
              <span>{{ relTime(h.watchedAt) }}</span>
            </div>
            <div class="path mono" :title="h.path">{{ h.path }}</div>
          </div>
          <div class="progress-cell">
            <ProgressBar :value="pct(h)" />
            <div class="progress-text mono">
              {{ fmtTime(h.position) }} / {{ h.duration ? fmtTime(h.duration) : '—' }}
            </div>
          </div>
          <div class="ops">
            <button class="btn btn-sm" :disabled="!exists(h)" :title="exists(h) ? '从上次位置继续播放' : '文件已不存在'" @click="resume(h)">
              <MdIcon name="play" :size="14" /> 续播
            </button>
            <button class="icon-btn" title="在文件夹中显示" :disabled="!exists(h)" @click="reveal(h.path)">
              <MdIcon name="folderOpen" :size="15" />
            </button>
            <button class="icon-btn" title="移除该记录" @click="remove(h.id)">
              <MdIcon name="close" :size="15" />
            </button>
          </div>
        </div>
      </div>

      <Pagination
        v-if="filtered.length > 0"
        :page="page"
        :total="filtered.length"
        :page-size="pageSize"
        :page-size-options="true"
        :size-choices="[5, 10, 20, 30, 50]"
        @update:page="page = $event"
        @update:page-size="onPageSize"
      />
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import type { WatchHistoryItem } from '@shared/types'
import { store, toast, updateSettings } from '../store/app'
import { playMedia } from '../player'
import MdIcon from '../components/MdIcon.vue'
import ProgressBar from '../components/ProgressBar.vue'
import Pagination from '../components/Pagination.vue'

const items = ref<WatchHistoryItem[]>([])
const loading = ref(false)
const keyword = ref('')
const failedCovers = ref<Set<string>>(new Set())

/** 分页 */
const page = ref(1)
const pageSize = computed(() => store.settings?.historyPageSize ?? 10)

const filtered = computed(() => {
  const k = keyword.value.trim().toLowerCase()
  if (!k) return items.value
  return items.value.filter(
    (h) =>
      h.title.toLowerCase().includes(k) ||
      (h.uploader ?? '').toLowerCase().includes(k) ||
      h.path.toLowerCase().includes(k)
  )
})

const pagedRows = computed(() => {
  const size = pageSize.value
  const start = (page.value - 1) * size
  return filtered.value.slice(start, start + size)
})

// 筛选条件变化 → 回到第 1 页
watch(keyword, () => {
  page.value = 1
})
// 页码越界自动收敛
watch(
  () => filtered.value.length,
  (len) => {
    const max = Math.max(1, Math.ceil(len / pageSize.value))
    if (page.value > max) page.value = max
  }
)

function onPageSize(size: number): void {
  page.value = 1
  void updateSettings({ historyPageSize: size })
}

onMounted(() => void load())

async function load(): Promise<void> {
  loading.value = true
  try {
    items.value = (await window.vd.listPlayHistory()) ?? []
  } finally {
    loading.value = false
  }
}

function coverSrc(url: string): string {
  return window.vd.imgUrl(url)
}

function markFailed(id: string): void {
  const next = new Set(failedCovers.value)
  next.add(id)
  failedCovers.value = next
}

function isAudio(p: string): boolean {
  return /\.(mp3|flac|wav|m4a|aac|ogg|oga|opus|wma|ape|aiff|aif|cop)$/i.test(p)
}

/** 文件是否仍存在（主进程读取列表时已补充） */
function exists(h: WatchHistoryItem | string): boolean {
  return typeof h === 'string' ? true : h.exists !== false
}

async function resume(h: WatchHistoryItem): Promise<void> {
  // 播放器打开时会自动读取已保存的进度并跳转，实现「续播」
  const ok = await playMedia(h.path, { title: h.title, uploader: h.uploader, cover: h.cover, from: h.from })
  if (!ok) toast('无法打开该文件（可能已被移动或删除）', 'error')
}

async function reveal(p: string): Promise<void> {
  await window.vd.showInFolder(p)
}

async function remove(id: string): Promise<void> {
  items.value = (await window.vd.removePlayHistory(id)) ?? []
  toast('已移除该记录')
}

async function clearAll(): Promise<void> {
  items.value = (await window.vd.clearPlayHistory()) ?? []
  toast('已清空播放历史')
}

function pct(h: WatchHistoryItem): number {
  if (!h.duration) return 0
  return Math.min(100, (h.position / h.duration) * 100)
}

function fmtTime(sec: number): string {
  const s = Math.max(0, Math.floor(sec || 0))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const ss = s % 60
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}`
    : `${m}:${String(ss).padStart(2, '0')}`
}

function relTime(ts: number): string {
  const diff = Date.now() - ts
  const min = Math.floor(diff / 60000)
  if (min < 1) return '刚刚'
  if (min < 60) return `${min} 分钟前`
  const hour = Math.floor(min / 60)
  if (hour < 24) return `${hour} 小时前`
  const day = Math.floor(hour / 24)
  if (day < 30) return `${day} 天前`
  return new Date(ts).toLocaleDateString()
}
</script>

<style scoped>
.history-view {
  display: flex;
  flex-direction: column;
  gap: 16px;
  max-width: 1100px;
}

.rows {
  margin-top: 12px;
  display: flex;
  flex-direction: column;
  border-radius: var(--md-radius-md);
  overflow: hidden;
}

.row-item {
  display: grid;
  grid-template-columns: 56px minmax(0, 1fr) 170px auto;
  gap: 12px;
  align-items: center;
  padding: 8px 10px;
  background: var(--md-surface-container-low);
}

/* 相邻两项不同底色区分（可读性） */
.row-item.alt {
  background: var(--md-surface-container-highest);
}

.thumb {
  width: 56px;
  height: 38px;
  border-radius: 6px;
  background: var(--md-outline-variant);
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  opacity: 0.92;
}

.thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.meta {
  min-width: 0;
}

.title {
  font-size: 13px;
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sub {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 11px;
  color: var(--md-on-surface-variant);
  margin-top: 2px;
  flex-wrap: wrap;
}

.sub span {
  display: inline-flex;
  align-items: center;
  gap: 3px;
}

.path {
  font-size: 11px;
  color: var(--md-on-surface-variant);
  opacity: 0.75;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  margin-top: 2px;
}

.progress-cell {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.progress-text {
  font-size: 11px;
  color: var(--md-on-surface-variant);
  text-align: right;
}

.ops {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
}

.spinner {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

@media (max-width: 900px) {
  .row-item {
    grid-template-columns: 56px minmax(0, 1fr);
  }
  .progress-cell,
  .ops {
    grid-column: 2;
  }
}
</style>
