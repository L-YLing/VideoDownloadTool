<template>
  <div class="lib-detail">
    <div class="detail-top">
      <button class="btn btn-text btn-sm" @click="goBack">
        <MdIcon name="arrowLeft" :size="15" /> 返回视频列表
      </button>
      <div class="detail-title" :title="list?.name">{{ list?.name ?? '列表详情' }}</div>
      <span class="chip">{{ total }} 个媒体</span>
      <span v-if="list?.rootPath" class="hint mono root" :title="list.rootPath">{{ list.rootPath }}</span>
    </div>

    <section class="card">
      <div v-if="!list" class="empty" style="padding: 40px">
        <MdIcon name="folder" :size="36" class="empty-icon" />
        <div>列表不存在或已被删除</div>
        <button class="btn btn-secondary btn-sm" style="margin-top: 10px" @click="goBack">返回</button>
      </div>

      <template v-else>
        <div class="row-between" style="flex-wrap: wrap; gap: 8px">
          <div class="row" style="gap: 6px">
            <input
              v-model="keyword"
              class="input"
              style="width: 200px"
              placeholder="筛选标题 / 路径"
            />
            <button class="btn btn-text btn-sm" @click="refresh">
              <MdIcon name="refresh" :size="14" /> 刷新
            </button>
          </div>
          <div class="row" style="gap: 6px">
            <button class="btn btn-sm" :disabled="filtered.length === 0" @click="playAll()">
              <MdIcon name="play" :size="14" /> 播放全部
            </button>
            <button class="btn btn-secondary btn-sm" @click="importFiles">
              <MdIcon name="add" :size="14" /> 导入文件
            </button>
            <button class="btn btn-text btn-sm" @click="importFolder">导入文件夹</button>
          </div>
        </div>

        <div v-if="filtered.length === 0" class="empty" style="padding: 36px">
          <MdIcon name="list" :size="32" class="empty-icon" />
          <div>{{ total === 0 ? '该列表还没有媒体' : '没有匹配的条目' }}</div>
        </div>
        <div v-else class="rows">
          <div v-for="(item, i) in paged" :key="item.id" class="row-item" :class="{ alt: i % 2 === 1 }">
            <button class="icon-btn" title="播放" @click="play(item)">
              <MdIcon name="play" :size="15" />
            </button>
            <div class="info" @dblclick="play(item)">
              <div class="t" :title="item.title">{{ item.title }}</div>
              <div class="p" :title="item.path">{{ item.path }}</div>
            </div>
            <span class="mono size">{{ fmtSize(item.size) }}</span>
            <button class="icon-btn" title="以该项为起点播放整个列表" @click="playFrom(item)">
              <MdIcon name="playlist" :size="15" />
            </button>
            <button class="icon-btn" title="在文件夹中显示" @click="reveal(item.path)">
              <MdIcon name="folderOpen" :size="15" />
            </button>
            <button class="icon-btn" title="从列表移除" @click="removeItem(item)">
              <MdIcon name="close" :size="14" />
            </button>
          </div>
        </div>

        <Pagination
          v-if="filtered.length > 0"
          :page="page"
          :total="filtered.length"
          :page-size="pageSize"
          :total-pages="totalPages"
          :page-size-options="true"
          :size-choices="[10, 20, 30, 50, 100]"
          @update:page="page = $event"
          @update:page-size="onPageSize"
        />
      </template>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import type { MediaItem, VideoList } from '@shared/types'
import { store, toast } from '../store/app'
import { playMedia, playPlaylist } from '../player'
import MdIcon from '../components/MdIcon.vue'
import Pagination from '../components/Pagination.vue'

const lists = ref<VideoList[]>([])
const keyword = ref('')
const page = ref(1)
const pageSize = ref(20)

const list = computed(() => lists.value.find((l) => l.id === store.libraryDetailId) ?? null)
const total = computed(() => list.value?.items.length ?? 0)

const filtered = computed(() => {
  const all = list.value?.items ?? []
  const k = keyword.value.trim().toLowerCase()
  if (!k) return all
  return all.filter(
    (it) => it.title.toLowerCase().includes(k) || it.path.toLowerCase().includes(k)
  )
})

const totalPages = computed(() => Math.max(1, Math.ceil(filtered.length / pageSize.value)))

/** 只把当前页放进视图，列表很长也不会一次渲染上千行 */
const paged = computed(() => {
  const start = (page.value - 1) * pageSize.value
  return filtered.value.slice(start, start + pageSize.value)
})

watch(keyword, () => {
  page.value = 1
})
watch(
  () => filtered.value.length,
  (len) => {
    const max = Math.max(1, Math.ceil(len / pageSize.value))
    if (page.value > max) page.value = max
  }
)

onMounted(() => void refresh())

async function refresh(): Promise<void> {
  lists.value = await window.vd.listLists()
}

function goBack(): void {
  store.view = 'library'
}

function onPageSize(size: number): void {
  pageSize.value = size
  page.value = 1
}

function play(item: MediaItem): void {
  void playMedia(item.path).then((ok) => {
    if (!ok) toast('打开媒体失败，文件可能已损坏或不存在', 'error')
  })
}

function playFrom(item: MediaItem): void {
  void playAll(item)
}

/** 整个列表送入播放队列，可指定起点 */
async function playAll(start?: MediaItem): Promise<void> {
  const l = list.value
  if (!l || l.items.length === 0) return
  const items = l.items.map((it) => ({ id: it.id, path: it.path, title: it.title, from: l.name }))
  const ok = await playPlaylist(items, start?.id, l.name)
  if (!ok) toast('打开媒体失败，文件可能已损坏或不存在', 'error')
}

async function reveal(p: string): Promise<void> {
  await window.vd.showInFolder(p)
}

async function removeItem(item: MediaItem): Promise<void> {
  const l = list.value
  if (!l) return
  await window.vd.removeListItem(l.id, item.id)
  await refresh()
}

async function importFiles(): Promise<void> {
  const l = list.value
  if (!l) return
  const files = await window.vd.openFile()
  if (files.length === 0) return
  await window.vd.importFilesToList(l.id, files)
  toast(`已导入 ${files.length} 个文件`, 'success')
  await refresh()
}

async function importFolder(): Promise<void> {
  const l = list.value
  if (!l) return
  const folder = await window.vd.openDirectory()
  if (!folder) return
  await window.vd.importFolderToList(l.id, folder)
  toast('已导入文件夹（递归扫描媒体）', 'success')
  await refresh()
}

function fmtSize(n: number | undefined): string {
  if (!n) return ''
  if (n >= 1024 ** 3) return (n / 1024 ** 3).toFixed(2) + ' GB'
  if (n >= 1024 ** 2) return (n / 1024 ** 2).toFixed(1) + ' MB'
  return Math.round(n / 1024) + ' KB'
}
</script>

<style scoped>
.lib-detail {
  display: flex;
  flex-direction: column;
  gap: 14px;
  max-width: 1100px;
}

.detail-top {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  min-width: 0;
}

.detail-title {
  font-size: 15px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 340px;
}

.root {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.rows {
  margin-top: 12px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.row-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border-radius: var(--md-radius-sm);
  background: var(--md-surface-container-low);
}

.row-item.alt {
  background: var(--md-surface-container-highest);
}

.info {
  flex: 1;
  min-width: 0;
  cursor: pointer;
}

.t {
  font-size: 13px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.p {
  font-size: 11px;
  color: var(--md-on-surface-variant);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.size {
  flex-shrink: 0;
  color: var(--md-on-surface-variant);
}
</style>
