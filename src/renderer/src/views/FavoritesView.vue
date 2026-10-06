<template>
  <div class="fav-view">
    <!-- 页面切换：我的收藏 / 收藏夹预览（两个页面互相独立） -->
    <div class="page-head">
      <MdTabs v-model="page" :tabs="pageTabs" />
      <div class="row" style="gap: 6px">
        <template v-if="store.auth.loggedIn">
          <span class="chip ok">
            <MdIcon name="person" :size="13" /> {{ store.auth.username || '已登录' }}
          </span>
          <button class="btn btn-text btn-sm" @click="doLogout">退出登录</button>
        </template>
        <button v-else class="btn btn-secondary btn-sm" @click="showLogin = true">
          <MdIcon name="person" :size="15" /> Cookie 登录
        </button>
      </div>
    </div>

    <!-- ============ 页面一：我的收藏 ============ -->
    <template v-if="page === 'mine'">
      <section class="card">
        <div class="row-between">
          <div>
            <h3 class="section-title" style="margin-bottom: 2px">我的收藏夹</h3>
            <p class="hint">登录后可查看并下载自己的收藏夹（含私密收藏夹）</p>
          </div>
          <button class="btn btn-secondary btn-sm" :disabled="mineLoading" @click="loadMine">
            <MdIcon name="refresh" :size="15" /> {{ mineLoading ? '加载中…' : '刷新' }}
          </button>
        </div>

        <div v-if="!store.auth.loggedIn" class="empty">
          <MdIcon name="person" :size="40" class="empty-icon" />
          <div>未登录，登录后可查看自己的收藏夹</div>
          <button class="btn btn-sm" style="margin-top: 10px" @click="showLogin = true">去登录</button>
        </div>
        <div v-else-if="mineLoading && !mine" class="empty">
          <MdIcon name="refresh" :size="30" class="empty-icon spinner" />
          <div>正在加载收藏夹…</div>
        </div>
        <div v-else-if="mineError" class="empty">
          <MdIcon name="warning" :size="36" class="empty-icon" />
          <div>{{ mineError }}</div>
        </div>
        <div v-else-if="mine && mine.length === 0" class="empty">
          <MdIcon name="folder" :size="36" class="empty-icon" />
          <div>暂无收藏夹</div>
        </div>
        <div v-else class="mine-grid">
          <div v-for="f in mine" :key="f.id" class="mine-card card-hover">
            <div class="mine-cover">
              <MdIcon name="folder" :size="34" />
              <span class="mine-count">{{ f.videoCount }}</span>
            </div>
            <div class="mine-body">
              <div class="fav-title" :title="f.name">{{ f.name }}</div>
              <div class="fav-sub">
                <MdIcon name="person" :size="12" />
                <span>{{ f.owner || '我' }}</span>
              </div>
              <div class="row" style="gap: 6px; margin-top: 8px">
                <button class="btn btn-secondary btn-sm" @click="previewMine(f)">
                  <MdIcon name="search" :size="14" /> 预览
                </button>
                <button class="btn btn-sm" @click="downloadMine(f)">
                  <MdIcon name="download" :size="14" /> 下载
                </button>
              </div>
            </div>
          </div>
        </div>
      </section>
    </template>

    <!-- ============ 页面二：收藏夹预览 ============ -->
    <template v-else>
      <section class="card">
        <h3 class="section-title">收藏夹批量下载</h3>
        <p class="hint" style="margin: 8px 0">
          粘贴收藏夹链接（如 https://space.bilibili.com/123456/favlist?fid=789 ），解析后先预览再下载。
        </p>
        <div class="row" style="gap: 8px; align-items: flex-start">
          <input v-model="favUrl" class="input" placeholder="收藏夹链接" @keyup.enter="resolve" />
          <button class="btn" :disabled="!favUrl.trim() || resolving" @click="resolve">
            <MdIcon name="search" :size="15" /> {{ resolving ? '解析中…' : '解析预览' }}
          </button>
          <button class="btn btn-secondary" :disabled="!preview" @click="downloadFav">
            <MdIcon name="download" :size="15" /> 批量下载
          </button>
        </div>
        <div v-if="!store.auth.loggedIn" class="hint" style="margin-top: 8px">
          未登录只能解析公开收藏夹；私密收藏夹请先登录。
        </div>
      </section>

      <section v-if="preview" class="card">
        <div class="row-between" style="margin-bottom: 10px; flex-wrap: wrap; gap: 8px">
          <div class="row" style="gap: 8px; flex-wrap: wrap">
            <strong>{{ preview.info.name }}</strong>
            <span class="chip">{{ preview.info.videoCount }} 个视频</span>
            <span v-if="preview.info.owner" class="chip">
              <MdIcon name="person" :size="12" /> {{ preview.info.owner }}
            </span>
          </div>
          <div class="row" style="gap: 8px; flex-wrap: wrap">
            <MdSelect v-model="favContent" :options="contentOptions" />
            <MdSelect v-model="favQuality" :options="qualityOptions" />
            <button class="btn" @click="downloadFav">
              <MdIcon name="download" :size="15" /> 下载全部 {{ preview.info.videoCount }} 个
            </button>
          </div>
        </div>

        <div v-if="preview.videos.length === 0" class="empty">
          <MdIcon name="folder" :size="36" class="empty-icon" />
          <div>该收藏夹没有可下载的视频</div>
        </div>
        <div v-else class="fav-grid">
          <div v-for="v in preview.videos" :key="v.bvid" class="fav-card list-item">
            <div class="fav-thumb">
              <img
                v-if="v.cover && !failedCovers.has(v.bvid)"
                :src="coverSrc(v.cover)"
                :alt="v.title"
                loading="lazy"
                @error="markFailed(v.bvid)"
              />
              <div v-else class="fav-thumb-ph">
                <MdIcon name="movie" :size="28" />
              </div>
              <span v-if="v.duration" class="fav-dur">{{ fmtDur(v.duration) }}</span>
            </div>
            <div class="fav-info">
              <div class="fav-title" :title="v.title">{{ v.title }}</div>
              <div class="fav-sub">
                <MdIcon name="person" :size="12" />
                <span class="fav-uploader" :title="v.uploader">{{ v.uploader || '未知 UP 主' }}</span>
              </div>
              <div class="fav-sub mono">{{ v.bvid }}</div>
            </div>
          </div>
        </div>
      </section>

      <section v-else class="card empty">
        <MdIcon name="search" :size="36" class="empty-icon" />
        <div>输入收藏夹链接后点「解析预览」，这里会显示视频列表</div>
        <div class="hint">也可以切到「我的收藏」页，直接预览自己的收藏夹</div>
      </section>
    </template>

    <!-- 登录弹窗（与个人页共用同一组件） -->
    <LoginDialog :open="showLogin" @close="showLogin = false" @success="onLoginSuccess" />
  </div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import type { FavoriteInfo, FavoriteVideo } from '@shared/types'
import { store, toast } from '../store/app'
import MdIcon from '../components/MdIcon.vue'
import MdSelect from '../components/MdSelect.vue'
import MdTabs from '../components/MdTabs.vue'
import LoginDialog from '../components/LoginDialog.vue'

type PageId = 'mine' | 'preview'
const page = ref<PageId>('mine')

const pageTabs = [
  { label: '我的收藏', value: 'mine', icon: 'star' },
  { label: '收藏夹预览', value: 'preview', icon: 'search' }
]

const favUrl = ref('')
const resolving = ref(false)
const preview = ref<{ info: FavoriteInfo; videos: FavoriteVideo[] } | null>(null)
const favContent = ref<'audio' | 'video' | 'both'>('both')
const favQuality = ref(1080)
const showLogin = ref(false)
const mine = ref<FavoriteInfo[] | null>(null)
const mineLoading = ref(false)
const mineError = ref('')

const contentOptions = [
  { label: '仅音频', value: 'audio' },
  { label: '仅视频', value: 'video' },
  { label: '音视频', value: 'both' }
]
const qualityOptions = [
  { label: '360P', value: 360 },
  { label: '480P', value: 480 },
  { label: '720P', value: 720 },
  { label: '1080P', value: 1080 }
]
/** 封面加载失败的 bvid（避免反复重试） */
const failedCovers = ref<Set<string>>(new Set())
let unsubFavUpdate: (() => void) | null = null
let currentToken = 0 // 当前活跃的收藏夹解析 token，旧 token 的事件被丢弃

onMounted(() => {
  unsubFavUpdate = window.vd.onFavVideoUpdate(({ index, video, token }) => {
    if (currentToken && token !== currentToken) return // 旧 token → 丢弃
    if (!preview.value || index >= preview.value.videos.length) return
    const target = preview.value.videos[index]
    if (!target) return
    if (video.title) target.title = video.title
    if (video.uploader) target.uploader = video.uploader
    if (video.duration) target.duration = video.duration
    if (video.cover) target.cover = video.cover
  })
  if (store.auth.loggedIn) void loadMine()
})

onBeforeUnmount(() => {
  if (unsubFavUpdate) unsubFavUpdate()
})

/** 远端封面走主进程 vdimg:// 代理（带 Referer），避免 CDN 拒绝直连导致图裂 */
function coverSrc(url: string): string {
  return window.vd.imgUrl(url)
}

function markFailed(bvid: string): void {
  const next = new Set(failedCovers.value)
  next.add(bvid)
  failedCovers.value = next
}

async function resolve(): Promise<void> {
  const input = favUrl.value.trim()
  if (!input) return
  resolving.value = true
  currentToken = 0
  preview.value = null
  failedCovers.value = new Set()
  try {
    const res = await window.vd.resolveFavorite(input)
    currentToken = res.token ?? 0
    preview.value = res
    toast(`解析到 ${res.videos.length} 个视频`, 'success')
  } catch (e) {
    toast(`解析失败: ${e instanceof Error ? e.message : String(e)}`, 'error')
  } finally {
    resolving.value = false
  }
}

async function downloadFav(): Promise<void> {
  if (!preview.value) return
  await downloadByUrl(favUrl.value.trim())
}

/** 登录成功（LoginDialog 回调） */
function onLoginSuccess(): void {
  void loadMine()
}

async function doLogout(): Promise<void> {
  await window.vd.logout()
  mine.value = null
  toast('已退出登录')
}

async function loadMine(): Promise<void> {
  mineLoading.value = true
  mineError.value = ''
  try {
    const res = await window.vd.getMyFavorites()
    if (res.ok) {
      mine.value = res.favorites
      if (!res.favorites?.length) mineError.value = '暂无收藏夹'
    } else {
      mine.value = null
      mineError.value = res.error ?? '获取收藏夹失败'
      toast(res.error ?? '获取收藏夹失败', 'error')
    }
  } finally {
    mineLoading.value = false
  }
}

/** 服务端下发的地址含真实 mid，登录态下可正常解析（含私密收藏夹） */
function favUrlOf(f: FavoriteInfo): string {
  return f.url || `https://space.bilibili.com/${store.auth.mid ?? 0}/favlist?fid=${f.id}`
}

async function previewMine(f: FavoriteInfo): Promise<void> {
  favUrl.value = favUrlOf(f)
  page.value = 'preview'
  await resolve()
}

async function downloadMine(f: FavoriteInfo): Promise<void> {
  await downloadByUrl(favUrlOf(f))
}

async function downloadByUrl(url: string): Promise<void> {
  try {
    const res = await window.vd.downloadFavorite(url, {
      content: favContent.value,
      quality: favQuality.value,
      fullDownload: store.settings?.fullDownload ?? false
    })
    toast(`已添加 ${res.taskIds.length} 个下载任务`, 'success')
    store.view = 'download'
  } catch (e) {
    toast(`下载失败: ${e instanceof Error ? e.message : String(e)}`, 'error')
  }
}

function fmtDur(sec: number): string {
  if (!sec) return '未知时长'
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = Math.floor(sec % 60)
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`
}
</script>

<style scoped>
.fav-view {
  max-width: 1000px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.page-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}

/* ---- 我的收藏卡片 ---- */
.mine-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 12px;
  margin-top: 12px;
}

.mine-card {
  background: var(--md-surface-container-low);
  border-radius: var(--md-radius-md);
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.mine-cover {
  position: relative;
  height: 84px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--md-secondary-container);
  color: var(--md-on-secondary-container);
}

.mine-count {
  position: absolute;
  right: 8px;
  bottom: 8px;
  font-size: 12px;
  font-weight: 700;
  background: rgba(0, 0, 0, 0.6);
  color: #fff;
  padding: 1px 8px;
  border-radius: 10px;
}

.mine-body {
  padding: 10px 12px 12px;
}

.mine-body .fav-title {
  font-size: 13px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mine-body .fav-sub {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: var(--md-on-surface-variant);
  margin-top: 3px;
}

/* ---- 预览卡片 ---- */
.fav-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: 10px;
  max-height: 520px;
  overflow-y: auto;
  padding: 2px;
}

.fav-card {
  border-radius: var(--md-radius-sm);
  background: var(--md-surface-container-low);
  overflow: hidden;
  cursor: default;
}

.fav-thumb {
  position: relative;
  width: 100%;
  aspect-ratio: 16/10;
  background: var(--md-outline-variant);
  overflow: hidden;
}

.fav-thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.fav-thumb-ph {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0.45;
}

.fav-dur {
  position: absolute;
  right: 6px;
  bottom: 6px;
  background: rgba(0, 0, 0, 0.72);
  color: #fff;
  font-size: 11px;
  padding: 1px 5px;
  border-radius: 3px;
}

.fav-card .fav-info {
  padding: 8px 10px 10px;
}

.fav-card .fav-title {
  font-size: 12px;
  line-height: 1.3;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  white-space: normal;
  min-height: 32px;
}

.fav-card .fav-sub {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  color: var(--md-on-surface-variant);
  margin-top: 4px;
  overflow: hidden;
  white-space: nowrap;
}

.fav-uploader {
  overflow: hidden;
  text-overflow: ellipsis;
}

/* 登录弹窗样式已抽到 components/LoginDialog.vue，此处不再保留副本 */
</style>
