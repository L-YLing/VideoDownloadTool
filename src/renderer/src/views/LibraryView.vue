<template>
  <div class="library-view">
    <div class="row-between" style="margin-bottom: 12px">
      <h3 class="section-title">视频列表</h3>
      <button class="btn" @click="showCreate = true">
        <MdIcon name="add" :size="16" /> 新建列表
      </button>
    </div>

    <div v-if="lists.length === 0" class="card empty">
      <MdIcon name="folder" :size="40" class="empty-icon" />
      <div>创建或导入一个视频列表，管理本地媒体文件</div>
      <button class="btn btn-secondary btn-sm" style="margin-top: 10px" @click="showCreate = true">
        <MdIcon name="add" :size="15" /> 新建列表
      </button>
    </div>

    <div v-else class="lists">
      <section v-for="l in lists" :key="l.id" class="card">
        <div class="row-between">
          <h4 class="list-name">
            <span class="list-title" :title="l.name">{{ l.name }}</span>
            <span class="chip">{{ l.items.length }} 个媒体</span>
            <span v-if="l.rootPath" class="hint mono" :title="l.rootPath">{{ shortPath(l.rootPath) }}</span>
          </h4>
          <div class="row" style="gap: 4px">
            <button class="btn btn-secondary btn-sm" :disabled="l.items.length === 0" @click="playAll(l)">
              <MdIcon name="play" :size="14" /> 播放全部
            </button>
            <button class="btn btn-text btn-sm" @click="importFolder(l.id)">导入文件夹</button>
            <button class="btn btn-text btn-sm" @click="importFiles(l.id)">导入文件</button>
            <button class="btn btn-text btn-sm" :disabled="!l.rootPath" @click="scan(l.id)">重新扫描</button>
            <button class="icon-btn" title="重命名" @click="openRename(l)">
              <MdIcon name="edit" :size="15" />
            </button>
            <button class="icon-btn" title="删除列表" @click="removeList(l.id)">
              <MdIcon name="delete" :size="16" />
            </button>
          </div>
        </div>

        <div v-if="l.items.length === 0" class="empty" style="padding: 24px">
          <div>列表为空，导入文件夹或文件</div>
        </div>
        <template v-else>
          <!-- 首页只预览 2 条，其余进详情页查看，避免长列表把页面撑爆 -->
          <div class="item-list">
            <div v-for="item in l.items.slice(0, PREVIEW_COUNT)" :key="item.id" class="item-row card-hover">
              <button class="icon-btn play-btn" title="播放" @click="play(item.path)">
                <MdIcon name="play" :size="14" />
              </button>
              <div class="item-info" @dblclick="play(item.path)">
                <div class="item-title" :title="item.title">{{ item.title }}</div>
                <div class="item-sub" :title="item.path">{{ item.path }}</div>
              </div>
              <span v-if="item.size" class="mono size">{{ fmtSize(item.size) }}</span>
              <button class="icon-btn" title="播放并加入播放列表" @click="playWithList(l, item)">
                <MdIcon name="playlist" :size="15" />
              </button>
            </div>
          </div>
          <div class="preview-foot">
            <span class="hint">
              仅预览前 {{ Math.min(PREVIEW_COUNT, l.items.length) }} 条，共 {{ l.items.length }} 条
            </span>
            <button class="btn btn-secondary btn-sm" @click="openDetail(l)">
              <MdIcon name="list" :size="14" /> 查看详情（全部 {{ l.items.length }} 条）
            </button>
          </div>
        </template>
      </section>
    </div>

    <!-- 新建列表 -->
    <InputDialog
      :open="showCreate"
      title="新建视频列表"
      desc="创建后可导入文件夹或单个媒体文件；删除列表不会删除磁盘上的文件。"
      label="列表名称"
      placeholder="例如：纪录片收藏"
      :default-value="`我的列表 ${lists.length + 1}`"
      confirm-text="创建"
      @confirm="createList"
      @cancel="showCreate = false"
    />

    <!-- 重命名列表 -->
    <InputDialog
      :open="showRename"
      title="重命名列表"
      label="列表名称"
      :default-value="renaming?.name ?? ''"
      confirm-text="保存"
      @confirm="doRename"
      @cancel="showRename = false"
    />
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import type { MediaItem, VideoList } from '@shared/types'
import { store, toast } from '../store/app'
import { playMedia, playPlaylist } from '../player'
import MdIcon from '../components/MdIcon.vue'
import InputDialog from '../components/InputDialog.vue'

/** 首页每个列表只预览的条数，其余进「查看详情」页 */
const PREVIEW_COUNT = 2

const lists = ref<VideoList[]>([])
const showCreate = ref(false)
const showRename = ref(false)
const renaming = ref<VideoList | null>(null)

onMounted(async () => {
  await refresh()
})

async function refresh(): Promise<void> {
  lists.value = await window.vd.listLists()
}

async function createList(name: string): Promise<void> {
  showCreate.value = false
  try {
    await window.vd.createList(name)
    await refresh()
    toast(`已创建列表「${name}」`, 'success')
  } catch (e) {
    toast(`创建失败: ${e instanceof Error ? e.message : String(e)}`, 'error')
  }
}

function openRename(l: VideoList): void {
  renaming.value = l
  showRename.value = true
}

async function doRename(name: string): Promise<void> {
  showRename.value = false
  const l = renaming.value
  renaming.value = null
  if (!l) return
  await window.vd.renameList(l.id, name)
  await refresh()
  toast('已重命名', 'success')
}

async function importFolder(id: string): Promise<void> {
  const folder = await window.vd.openDirectory()
  if (!folder) return
  await window.vd.importFolderToList(id, folder)
  toast('已导入文件夹（递归扫描媒体）', 'success')
  await refresh()
}

async function importFiles(id: string): Promise<void> {
  const files = await window.vd.openFile()
  if (files.length === 0) return
  await window.vd.importFilesToList(id, files)
  toast(`已导入 ${files.length} 个文件`, 'success')
  await refresh()
}

async function scan(id: string): Promise<void> {
  await window.vd.scanList(id)
  toast('扫描完成', 'success')
  await refresh()
}

async function removeList(id: string): Promise<void> {
  const l = lists.value.find((x) => x.id === id)
  if (l && !window.confirm(`删除列表「${l.name}」？（不会删除磁盘文件）`)) return
  await window.vd.deleteList(id)
  await refresh()
  toast('已删除列表')
}

/** 进入列表详情页（完整条目 + 分页，见 LibraryDetailView） */
function openDetail(l: VideoList): void {
  store.libraryDetailId = l.id
  store.view = 'libraryDetail'
}

async function play(p: string): Promise<void> {
  const ok = await playMedia(p)
  if (!ok) toast('打开媒体失败，文件可能已损坏或不存在', 'error')
}

/** 把整个列表送入播放队列并从指定项开始 */
async function playAll(l: VideoList, start?: MediaItem): Promise<void> {
  const items = l.items.map((it) => ({ id: it.id, path: it.path, title: it.title, from: l.name }))
  if (items.length === 0) return
  const ok = await playPlaylist(items, start?.id, l.name)
  if (!ok) toast('打开媒体失败，文件可能已损坏或不存在', 'error')
}

/** 单个条目：以该条为起点播放整个列表 */
function playWithList(l: VideoList, item: MediaItem): void {
  void playAll(l, item)
}

function shortPath(p: string): string {
  const parts = p.replace(/[\\/]+$/, '').split(/[\\/]/)
  return parts.length > 2 ? `…/${parts.slice(-2).join('/')}` : p
}

function fmtSize(n: number | undefined): string {
  if (!n) return ''
  if (n >= 1024 ** 3) return (n / 1024 ** 3).toFixed(2) + ' GB'
  if (n >= 1024 ** 2) return (n / 1024 ** 2).toFixed(1) + ' MB'
  return Math.round(n / 1024) + ' KB'
}
</script>

<style scoped>
/* 说明：.section-title / .hint / .mono / .empty / .btn 等统一在 styles/ 目录 */
.library-view {
  max-width: 1000px;
}

.lists {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.list-name {
  font-size: 14px;
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.list-title {
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 220px;
}

.item-list {
  margin-top: 10px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.item-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border-radius: var(--md-radius-sm);
  cursor: default;
}

.play-btn {
  flex-shrink: 0;
}

.item-info {
  flex: 1;
  min-width: 0;
  cursor: pointer;
}

.item-title {
  font-size: 13px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.item-sub {
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

.hint {
  padding: 8px 4px;
}

/* 预览尾部：说明 + 查看详情入口 */
.preview-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  flex-wrap: wrap;
  margin-top: 8px;
}

.preview-foot .hint {
  padding: 0;
}
</style>
