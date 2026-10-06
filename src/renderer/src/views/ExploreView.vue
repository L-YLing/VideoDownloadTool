<template>
  <div class="explore-view">
    <!-- 顶部分类栏：下拉可直达任意分类（横向放不下时也能全选） + 可滑动选项卡 -->
    <div class="cat-bar">
      <MdSelect v-model="rid" :options="catOptions" class="cat-select" placeholder="选择分类" />
      <MdTabs v-model="rid" :tabs="catTabs" class="cat-tabs" />
      <!-- 搜索 -->
      <div class="search-bar">
        <input v-model="searchKeyword" class="input search-input" placeholder="搜索关键字 / BV号" @keydown.enter="doSearch" />
        <button class="btn btn-sm" :disabled="!searchKeyword.trim() || loading" @click="doSearch">
          <MdIcon name="search" :size="14" /> 搜索
        </button>
        <button v-if="isSearchMode" class="btn btn-text btn-sm" @click="exitSearch">
          <MdIcon name="close" :size="14" /> 退出搜索
        </button>
      </div>
      <button class="btn btn-text btn-sm" :disabled="loading" @click="isSearchMode ? doSearch() : load(1)">
        <MdIcon name="refresh" :size="15" /> 刷新
      </button>
    </div>

    <!-- 未登录提示（浏览/预览无需登录，仅互动与下载收藏需要） -->
    <div v-if="!store.auth.loggedIn" class="notice">
      <MdIcon name="info" :size="15" />
      <span>当前未登录：可以浏览与在线预览；点赞、收藏夹等互动功能需登录。</span>
      <button class="btn btn-text btn-sm" @click="showLogin = true">立即登录</button>
    </div>

    <!-- 列表 -->
    <section class="card">
      <div v-if="loading && videos.length === 0" class="empty" style="padding: 40px">
        <MdIcon name="refresh" :size="32" class="empty-icon spinner" />
        <div>正在加载 {{ currentCatName }}…</div>
      </div>
      <div v-else-if="error" class="empty" style="padding: 40px">
        <MdIcon name="warning" :size="36" class="empty-icon" />
        <div>{{ error }}</div>
        <button class="btn btn-secondary btn-sm" style="margin-top: 10px" @click="load(1)">重试</button>
      </div>
      <div v-else-if="videos.length === 0" class="empty" style="padding: 40px">
        <MdIcon name="movie" :size="36" class="empty-icon" />
        <div>该分区暂无内容</div>
      </div>
      <div v-else class="video-grid">
        <div v-for="v in videos" :key="v.bvid" class="video-card card-hover">
          <div class="vc-thumb" @click="preview(v)">
            <img
              v-if="v.cover && !failedCovers.has(v.bvid)"
              :src="coverSrc(v.cover)"
              :alt="v.title"
              loading="lazy"
              @error="markFailed(v.bvid)"
            />
            <div v-else class="vc-thumb-ph"><MdIcon name="movie" :size="30" /></div>
            <span v-if="v.duration" class="vc-dur">{{ fmtDur(v.duration) }}</span>
            <span v-if="v.isAd" class="vc-ad">广告</span>
            <span class="vc-play"><MdIcon name="play" :size="26" /></span>
          </div>
          <div class="vc-body">
            <div class="vc-title" :title="v.title" @click="preview(v)">{{ v.title }}</div>
            <div class="vc-meta">
              <span class="vc-up" :title="v.uploader">
                <MdIcon name="person" :size="12" />{{ v.uploader || '未知 UP 主' }}
              </span>
            </div>
            <div class="vc-stat">
              <span><MdIcon name="play" :size="12" /> {{ fmtNum(v.play) }}</span>
              <span><MdIcon name="info" :size="12" /> {{ fmtNum(v.danmaku) }}</span>
            </div>
            <div class="vc-actions">
              <button class="btn btn-sm" @click="preview(v)">
                <MdIcon name="play" :size="14" /> 预览
              </button>
              <button
                class="icon-btn"
                :class="{ liked: likedSet.has(v.bvid) }"
                :title="likedSet.has(v.bvid) ? '取消点赞' : '点赞'"
                @click="toggleLike(v)"
              >
                <MdIcon :name="likedSet.has(v.bvid) ? 'thumbUp' : 'thumbUpOutline'" :size="15" />
              </button>
              <button class="icon-btn" title="用系统播放器播放（借用系统解码库）" @click="playWithSystem(v)">
                <MdIcon name="desktop" :size="15" />
              </button>
              <button class="icon-btn" title="下载该视频" @click="downloadOne(v)">
                <MdIcon name="download" :size="15" />
              </button>
            </div>
          </div>
        </div>
      </div>

      <div v-if="videos.length > 0" class="row" style="justify-content: center; margin-top: 14px">
        <Pagination
          :page="page"
          :total="totalResults"
          :page-size="effectivePageSize"
          :page-size-options="true"
          :size-choices="[8, 12, 16, 20, 24, 32, 48]"
          :has-more="hasMore"
          :disabled="loading"
          @update:page="isSearchMode ? searchPage($event) : load($event)"
          @update:page-size="onPageSizeChange"
        />
      </div>
    </section>

    <!-- 预览准备进度 -->
    <div v-if="previewing" class="modal-mask">
      <div class="modal preview-modal">
        <h3>正在准备预览</h3>
        <p class="hint" style="margin: 4px 0 12px">
          {{ previewTitle }}<br />
          拉取低画质副本 + 弹幕 / 评论，稍候将自动用内置播放器播放。
        </p>
        <ProgressBar :value="previewPct" />
        <div class="row" style="justify-content: space-between; margin-top: 8px">
          <span class="mono">{{ Math.round(previewPct) }}%</span>
          <button class="btn btn-text btn-sm" @click="cancelPreview">取消</button>
        </div>
      </div>
    </div>

    <LoginDialog :open="showLogin" @close="showLogin = false" @success="onLoginSuccess" />
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { ExploreCategory, ExploreVideo } from '@shared/types'
import { store, toast, updateSettings } from '../store/app'
import MdIcon from '../components/MdIcon.vue'
import MdTabs from '../components/MdTabs.vue'
import MdSelect from '../components/MdSelect.vue'
import ProgressBar from '../components/ProgressBar.vue'
import LoginDialog from '../components/LoginDialog.vue'
import Pagination from '../components/Pagination.vue'

const cats = ref<ExploreCategory[]>([])
const rid = ref<number>(0)
const videos = ref<ExploreVideo[]>([])
const page = ref(1)
const hasMore = ref(false)
const loading = ref(false)
const error = ref('')
const failedCovers = ref<Set<string>>(new Set())
const likedSet = ref<Set<string>>(new Set())
const showLogin = ref(false)

/** 搜索相关 */
const searchKeyword = ref('')
const isSearchMode = ref(false)
const totalResults = ref<number | undefined>(undefined)

/** 有效每页条数：用户可在分页条下拉里改 */
const effectivePageSize = computed(() => store.settings?.explorePageSize ?? 16)

const previewing = ref(false)
const previewPct = ref(0)
const previewTitle = ref('')
let cancelFlag = false
let unsubProgress: (() => void) | null = null

const catTabs = computed(() => cats.value.map((c) => ({ label: c.name, value: c.rid })))
const catOptions = computed(() => cats.value.map((c) => ({ label: c.name, value: c.rid })))
const currentCatName = computed(() => cats.value.find((c) => c.rid === rid.value)?.name ?? '内容')

onMounted(async () => {
  cats.value = await window.vd.exploreCategories()
  // 浏览与预览不需要登录；登录态只影响点赞等互动
  void load(1)
  if (!store.auth.loggedIn) {
    // 后台静默刷新一次登录态，避免「其实已登录却被显示成未登录」
    try {
      const status = await window.vd.refreshAuth()
      if (status) store.auth = status
    } catch {
      /* 忽略 */
    }
  }
})

onBeforeUnmount(() => {
  if (unsubProgress) unsubProgress()
})

// 切换分区自动重新拉取
watch(rid, () => void load(1))

function onLoginSuccess(): void {
  toast('登录成功', 'success')
}

function coverSrc(url: string): string {
  return window.vd.imgUrl(url)
}

function markFailed(bvid: string): void {
  const next = new Set(failedCovers.value)
  next.add(bvid)
  failedCovers.value = next
}

async function load(p: number): Promise<void> {
  if (loading.value) return
  isSearchMode.value = false
  loading.value = true
  error.value = ''
  try {
    const ps = effectivePageSize.value
    const res = await window.vd.exploreFeed(rid.value, p, ps)
    videos.value = res.videos
    hasMore.value = res.hasMore
    page.value = p
    totalResults.value = undefined // feed 模式无精确总数
    failedCovers.value = new Set()
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    loading.value = false
  }
}

/** 预览播放：拉取低画质副本 + 弹幕/评论伴生文件，然后交给内置播放器 */
async function preview(v: ExploreVideo): Promise<void> {
  if (previewing.value) return
  cancelFlag = false
  previewing.value = true
  previewPct.value = 0
  previewTitle.value = v.title
  unsubProgress = window.vd.onExploreProgress((p) => {
    previewPct.value = p.percent
  })
  const meta = plainVideo(v)
  try {
    // ① 先尝试「直接引用网页视频」：只解析直链、不下载 → 秒开
    const st = await window.vd.exploreStream(meta, store.settings?.quality ?? 720)
    if (st.ok && st.videoUrl) {
      store.exploreCurrent = {
        video: meta,
        stream: { videoUrl: st.videoUrl, audioUrl: st.audioUrl, muxed: st.muxed }
      }
      store.view = 'explorePlayer'
      toast(st.muxed ? '在线播放中' : '在线播放中（视频流 + 音频流同步）', 'success')
      return
    }
    // ② 直链不可用（少数视频受限）→ 回退到「缓存下载后播放」
    toast(`直链播放不可用（${st.error ?? '未知原因'}），改为缓存后播放`, 'error')
    unsubProgress = window.vd.onExploreProgress((p) => {
      previewPct.value = p.percent
    })
    const res = await window.vd.explorePreview(meta)
    if (cancelFlag) return
    if (res.ok && res.path) {
      store.exploreCurrent = { video: meta, path: res.path }
      store.view = 'explorePlayer'
      toast('缓存就绪，已开始播放', 'success')
    } else {
      toast(`预览失败: ${res.error ?? '未知错误'}`, 'error')
    }
  } catch (e) {
    // 关键：之前缺 catch，任何异常都会「点了没反应」且没有任何提示
    console.error('[explore] 预览失败:', e)
    toast(`预览失败：${e instanceof Error ? e.message : String(e)}`, 'error')
  } finally {
    previewing.value = false
    if (unsubProgress) {
      unsubProgress()
      unsubProgress = null
    }
  }
}

/** 把列表项转成可安全跨 IPC 传输的纯对象 */
function plainVideo(v: ExploreVideo): {
  bvid: string
  aid: number
  cid?: number
  title: string
  uploader: string
  cover?: string
  duration?: number
  play?: number
  danmaku?: number
  isAd?: boolean
} {
  return {
    bvid: v.bvid,
    aid: v.aid,
    cid: v.cid,
    title: v.title,
    uploader: v.uploader,
    cover: v.cover,
    duration: v.duration,
    play: v.play,
    danmaku: v.danmaku,
    isAd: v.isAd
  }
}

function cancelPreview(): void {
  cancelFlag = true
  previewing.value = false
  toast('已取消预览')
}

/** 借用系统播放器直接播放（不下载；适合内置解码不了的编码） */
async function playWithSystem(v: ExploreVideo): Promise<void> {
  toast('正在调用系统播放器…')
  try {
    const res = await window.vd.explorePreview(plainVideo(v))
    if (!res.ok || !res.path) {
      toast(`准备失败：${res.error ?? '未知错误'}`, 'error')
      return
    }
    const opened = await window.vd.openWithExternalPlayer(
      res.path,
      store.settings?.externalPlayerPath || undefined,
      0
    )
    if (opened.ok) toast(`已用「${opened.player}」播放`, 'success')
    else toast(opened.error ?? '没有可用的系统播放器', 'error')
  } catch (e) {
    toast(`准备失败：${e instanceof Error ? e.message : String(e)}`, 'error')
  }
}

async function toggleLike(v: ExploreVideo): Promise<void> {
  if (!store.auth.loggedIn) {
    showLogin.value = true
    return
  }
  const liked = likedSet.value.has(v.bvid)
  const res = await window.vd.exploreLike(v.bvid, !liked)
  if (!res.ok) {
    toast(res.error ?? '点赞失败', 'error')
    return
  }
  const next = new Set(likedSet.value)
  if (liked) next.delete(v.bvid)
  else next.add(v.bvid)
  likedSet.value = next
  toast(liked ? '已取消点赞' : '点赞成功', 'success')
}

async function downloadOne(v: ExploreVideo): Promise<void> {
  const s = store.settings
  try {
    const res = await window.vd.enqueue([{ source: `https://www.bilibili.com/video/${v.bvid}`, kind: 'single' }], {
      content: s?.content ?? 'both',
      quality: s?.quality ?? 1080,
      fullDownload: s?.fullDownload ?? false
    })
    toast(`已添加下载任务（${res.taskIds.length}）`, 'success')
    store.view = 'download'
  } catch (e) {
    toast(`下载失败: ${e instanceof Error ? e.message : String(e)}`, 'error')
  }
}

function fmtDur(sec: number): string {
  if (!sec) return ''
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = Math.floor(sec % 60)
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`
}

function fmtNum(n?: number): string {
  const v = Number(n ?? 0)
  if (v >= 1e8) return `${(v / 1e8).toFixed(1)}亿`
  if (v >= 1e4) return `${(v / 1e4).toFixed(1)}万`
  return String(v)
}

// ---------- 搜索 ----------

async function doSearch(): Promise<void> {
  const kw = searchKeyword.value.trim()
  if (!kw) return
  if (loading.value) return
  isSearchMode.value = true
  loading.value = true
  error.value = ''
  page.value = 1
  try {
    const ps = effectivePageSize.value
    const res = await window.vd.exploreSearch(kw, 1, ps)
    videos.value = res.videos ?? []
    hasMore.value = (res.videos?.length ?? 0) >= ps
    totalResults.value = res.total
    failedCovers.value = new Set()
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    loading.value = false
  }
}

async function searchPage(p: number): Promise<void> {
  const kw = searchKeyword.value.trim()
  if (!kw || loading.value) return
  loading.value = true
  error.value = ''
  try {
    const ps = effectivePageSize.value
    const res = await window.vd.exploreSearch(kw, p, ps)
    videos.value = res.videos ?? []
    hasMore.value = (res.videos?.length ?? 0) >= ps
    totalResults.value = res.total
    page.value = p
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    loading.value = false
  }
}

function exitSearch(): void {
  isSearchMode.value = false
  searchKeyword.value = ''
  totalResults.value = undefined
  void load(1)
}

function onPageSizeChange(size: number): void {
  void updateSettings({ explorePageSize: size })
  if (isSearchMode.value) void doSearch()
  else void load(1)
}
</script>

<style scoped>
.explore-view {
  display: flex;
  flex-direction: column;
  gap: 16px;
  max-width: 1180px;
}

.cat-bar {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.cat-select {
  flex-shrink: 0;
}

.cat-tabs {
  flex: 1;
  min-width: 200px;
}

.search-bar {
  display: flex;
  align-items: center;
  gap: 6px;
}

.search-input {
  width: 200px;
  height: var(--md-control-h-sm);
  font-size: 12px;
}

.notice {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-radius: var(--md-radius-md);
  background: var(--md-surface-container-highest);
  color: var(--md-on-surface-variant);
  font-size: 12px;
}

.notice span {
  flex: 1;
  min-width: 0;
}

.video-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(210px, 1fr));
  gap: 14px;
}

.video-card {
  background: var(--md-surface-container-low);
  border-radius: var(--md-radius-md);
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.vc-thumb {
  position: relative;
  aspect-ratio: 16/10;
  background: var(--md-outline-variant);
  cursor: pointer;
  overflow: hidden;
}

.vc-thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.vc-thumb-ph {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0.4;
}

.vc-thumb .vc-play {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  background: rgba(0, 0, 0, 0.28);
  opacity: 0;
  transition: opacity 0.16s;
}

.vc-thumb:hover .vc-play {
  opacity: 1;
}

.vc-dur {
  position: absolute;
  right: 6px;
  bottom: 6px;
  background: rgba(0, 0, 0, 0.72);
  color: #fff;
  font-size: 11px;
  padding: 1px 5px;
  border-radius: 3px;
}

.vc-ad {
  position: absolute;
  left: 6px;
  top: 6px;
  background: rgba(0, 0, 0, 0.62);
  color: #fff;
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 8px;
}

.vc-body {
  padding: 8px 10px 10px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.vc-title {
  font-size: 13px;
  line-height: 1.35;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  min-height: 35px;
  cursor: pointer;
  /* 允许选中复制标题 */
  user-select: text;
}

.vc-title:hover {
  color: var(--md-primary);
}

.vc-meta,
.vc-stat {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 11px;
  color: var(--md-on-surface-variant);
  min-width: 0;
}

.vc-up {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  /* 允许选中复制 UP 主名称 */
  user-select: text;
}

.vc-stat span {
  display: inline-flex;
  align-items: center;
  gap: 3px;
}

.vc-actions {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-top: 4px;
}

.vc-actions .btn {
  flex: 1;
}

.icon-btn.liked {
  color: var(--md-primary);
}

.preview-modal {
  width: min(420px, 100%);
}

.spinner {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
