<template>
  <div class="ep-view">
    <!-- 顶部：返回 + 标题（左侧侧栏与顶栏保持不变） -->
    <div class="ep-top">
      <button class="btn btn-text btn-sm" @click="goBack">
        <MdIcon name="arrowLeft" :size="15" /> 返回探索
      </button>
      <div class="ep-title" :title="video?.title">{{ video?.title ?? '在线播放' }}</div>
      <span v-if="video?.isAd" class="chip warn">广告</span>
    </div>

    <div v-if="!video || !src" class="card empty" style="padding: 48px">
      <MdIcon name="movie" :size="40" class="empty-icon" />
      <div>还没有正在播放的内容</div>
      <button class="btn" style="margin-top: 10px" @click="goBack">去探索页选择一个视频</button>
    </div>

    <div v-else class="ep-layout">
      <!-- 主区：播放器 + 信息 + 评论 -->
      <div class="ep-main">
        <div class="stage">
          <video
            ref="videoEl"
            :src="src"
            controls
            autoplay
            playsinline
            :muted="Boolean(audioSrc)"
            @timeupdate="onTimeUpdate"
            @loadedmetadata="onLoaded"
            @error="onError"
            @play="syncAudioPlay"
            @pause="syncAudioPause"
            @seeking="syncAudioSeek"
            @waiting="syncAudioPause"
            @playing="syncAudioPlay"
            @ratechange="syncAudioRate"
          ></video>

          <!-- DASH 模式下视频流不含音频，需独立的音频元素同步播放 -->
          <audio
            v-if="audioSrc"
            ref="audioEl"
            :src="audioSrc"
            preload="auto"
            @error="onAudioError"
          ></audio>

          <DanmakuLayer :items="danmakuItems" :current-time="currentTime" :visible="danmakuOn" />
        </div>

        <!-- 后台播放状态提示 -->
        <div v-if="!watching || !store.foreground" class="notice">
          <MdIcon name="eyeOff" :size="15" />
          <span v-if="!bgEnabled">已关闭「后台播放」，窗口回到前台后自动继续</span>
          <span v-else>后台播放中（仅保留音频，已停止加载视频流以节省资源）</span>
          <button class="btn btn-text btn-sm" @click="store.view = 'settings'">后台播放设置</button>
        </div>

        <!-- 自定义音量条：视频流无音轨 + 原生控件音量无效，故单独控制音频元素 -->
        <div v-if="audioSrc" class="vol-bar">
          <button class="icon-btn" :title="muted ? '取消静音' : '静音'" @click="toggleMute">
            <MdIcon :name="muted || volume === 0 ? 'eyeOff' : 'eye'" :size="15" />
          </button>
          <input v-model.number="volume" type="range" min="0" max="1" step="0.01" class="vol-range" @input="applyVolume" />
          <span class="mono vol-text">{{ Math.round((muted ? 0 : volume) * 100) }}%</span>
          <span class="hint">（音视频分流在线播放，音量以此为准）</span>
        </div>

        <!-- 标题 + UP 主 + 互动 -->
        <div class="card info-card">
          <div class="info-title">{{ video.title }}</div>
          <div class="info-meta">
            <span><MdIcon name="play" :size="13" /> {{ fmtNum(video.play) }} 播放</span>
            <span><MdIcon name="info" :size="13" /> {{ fmtNum(video.danmaku) }} 弹幕</span>
            <span v-if="video.duration">时长 {{ fmtDur(video.duration) }}</span>
          </div>
          <div class="info-ops">
            <span class="up">
              <MdIcon name="person" :size="15" />
              <span class="up-name">{{ video.uploader || '未知 UP 主' }}</span>
            </span>
            <div class="row" style="gap: 6px; flex-wrap: wrap">
              <button class="btn btn-sm" :class="{ liked: liked }" @click="toggleLike">
                <MdIcon :name="liked ? 'thumbUp' : 'thumbUpOutline'" :size="14" /> {{ liked ? '已赞' : '点赞' }}
              </button>
              <button class="btn btn-secondary btn-sm" @click="showFav = true">
                <MdIcon name="star" :size="14" /> 收藏
              </button>
              <button class="btn btn-secondary btn-sm" @click="download">
                <MdIcon name="download" :size="14" /> 下载到本地
              </button>
              <button v-if="localPath" class="btn btn-text btn-sm" @click="openWithSystem">
                <MdIcon name="desktop" :size="14" /> 系统播放器
              </button>
              <button v-if="localPath" class="btn btn-text btn-sm" @click="reveal">
                <MdIcon name="folderOpen" :size="14" /> 打开所在文件夹
              </button>
              <button v-else class="btn btn-text btn-sm" @click="switchToCacheMode">
                <MdIcon name="download" :size="14" /> 直链播不动？改缓存播放
              </button>
              <button class="btn btn-text btn-sm" :title="danmakuOn ? '关闭弹幕' : '开启弹幕'" @click="danmakuOn = !danmakuOn">
                <MdIcon :name="danmakuOn ? 'eye' : 'eyeOff'" :size="14" /> 弹幕
              </button>
            </div>
          </div>
          <p class="hint" style="margin-top: 8px">
            在线预览使用低画质缓存副本播放；如需原画请点「下载到本地」。缓存位于应用缓存目录，可被定时清理回收。
          </p>
        </div>

        <!-- 评论：分页 + 仅当前页驻留内存 + 分页条固定底部 -->
        <div class="card comment-card">
          <div class="row-between" style="margin-bottom: 8px">
            <h4 class="sec-title" style="margin-bottom: 0">
              评论
              <span v-if="commentsTotal" class="chip" style="margin-left: 6px">{{ commentsTotal }} 条</span>
            </h4>
            <button class="btn btn-text btn-sm" :disabled="loadingComments" @click="loadComments(currentCommentsPage)">
              <MdIcon name="refresh" :size="14" /> 刷新
            </button>
          </div>
          <CommentPanel
            :items="comments"
            :total="commentsTotal"
            :page="currentCommentsPage"
            :page-size="commentPageSize"
            :has-more="commentsHasMore"
            :loading="loadingComments"
            :error="commentsError"
            :aid="localPath ? 0 : (video?.aid ?? 0)"
            empty-text="暂无评论（或接口未返回）"
            @update:page="loadComments"
          />
        </div>
      </div>

      <!-- 侧栏：弹幕列表 + 快捷信息 -->
      <aside class="ep-side">
        <div class="card">
          <h4 class="sec-title">弹幕 {{ danmakuItems.length ? `(${danmakuItems.length})` : '' }}</h4>
          <div v-if="!danmakuItems.length" class="hint">暂无弹幕</div>
          <div v-else class="dm-list">
            <button
              v-for="(d, i) in danmakuItems.slice(0, 300)"
              :key="i"
              class="dm-row"
              :class="{ alt: i % 2 === 1 }"
              @click="seekTo(d.time)"
            >
              <span class="dm-time mono">{{ fmtTime(d.time) }}</span>
              <span class="dm-text">{{ d.text }}</span>
            </button>
          </div>
        </div>

        <div class="card">
          <h4 class="sec-title">本视频</h4>
          <div class="kv"><span>BV 号</span><b class="mono">{{ video.bvid }}</b></div>
          <div class="kv"><span>AV 号</span><b class="mono">av{{ video.aid }}</b></div>
          <div class="kv"><span>编码</span><b>{{ codecText }}</b></div>
          <button class="btn btn-text btn-sm" style="margin-top: 8px" @click="openOnBili">
            <MdIcon name="globe" :size="14" /> 在浏览器打开
          </button>
        </div>
      </aside>
    </div>

    <FavDialog :open="showFav" :aid="video?.aid ?? 0" @close="showFav = false" @login="showLogin" @done="onFavDone" />
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { CommentItem } from '@shared/types'
import { store, toast } from '../store/app'
import MdIcon from '../components/MdIcon.vue'
import DanmakuLayer from '../components/DanmakuLayer.vue'
import FavDialog from '../components/FavDialog.vue'
import CommentPanel from '../components/CommentPanel.vue'

const videoEl = ref<HTMLVideoElement | null>(null)
const currentTime = ref(0)
const duration = ref(0)
const danmakuOn = ref(true)
const danmakuItems = ref<Array<{ time: number; mode: number; color: string; text: string }>>([])
/** 评论区：只保存「当前页」的评论，其余页不驻留内存 */
const comments = ref<CommentItem[]>([])
const commentsTotal = ref(0)
const commentsHasMore = ref(false)
const commentsError = ref('')
const currentCommentsPage = ref(1)
const commentPageSize = ref(50)
const loadingComments = ref(false)
/** 在线评论用游标翻页：pageOffsets[p-1] = 第 p 页的起始游标 */
const pageOffsets = ref<string[]>([''])
const liked = ref(false)
const codecText = ref('未知')
const showFav = ref(false)

let saveTimer: ReturnType<typeof setInterval> | null = null

const audioEl = ref<HTMLAudioElement | null>(null)
const volume = ref(1)
const muted = ref(false)

const video = computed(() => store.exploreCurrent?.video ?? null)
const localPath = computed(() => store.exploreCurrent?.path ?? '')
const stream = computed(() => store.exploreCurrent?.stream ?? null)

/** 视频源：在线直链优先（免下载秒开），否则用本地缓存文件 */
const src = computed(() => {
  const s = stream.value
  if (s?.videoUrl) return window.vd.streamUrl(s.videoUrl, 'v')
  const p = localPath.value
  return p ? window.vd.mediaUrl(p) : ''
})

/** 分离的音频流（DASH 才有）；有值说明需要双元素同步播放 */
const audioSrc = computed(() => {
  const s = stream.value
  if (!s?.audioUrl || s.muxed) return ''
  return window.vd.streamUrl(s.audioUrl, 'a')
})

onMounted(async () => {
  const v = video.value
  if (!v) return

  // 弹幕 / 评论：本地缓存模式读伴生文件，在线直链模式直接走接口
  try {
    if (localPath.value) {
      const media = await window.vd.openMedia(localPath.value)
      codecText.value = fmtCodec(media?.codec)
      if (media?.hasDanmaku) {
        const res = await window.vd.getDanmaku(localPath.value)
        danmakuItems.value = res.items ?? []
      }
    } else {
      const side = await window.vd.exploreSide(v)
      danmakuItems.value = side?.danmaku ?? []
      codecText.value = stream.value?.muxed ? 'H.264 + AAC（混流直链）' : 'H.264 + AAC（分流直链）'
    }
  } catch {
    /* 弹幕/编码信息失败不影响播放 */
  }
  // 评论单独分页拉取（只保留当前页）
  void loadComments(1)

  try {
    const it = await window.vd.exploreInteraction(v.bvid)
    liked.value = Boolean(it?.like)
  } catch {
    /* 未登录或接口失败 */
  }

  // 写入播放历史（每 5 秒一次）；在线直链没有本地文件，记录其缓存占位路径
  saveTimer = setInterval(() => {
    const hist = historyPath()
    if (!hist) return
    void window.vd.saveProgress(hist, currentTime.value, duration.value, {
      title: v.title,
      uploader: v.uploader,
      cover: v.cover,
      from: '探索预览'
    })
  }, 5000)
})

onBeforeUnmount(() => {
  if (saveTimer) clearInterval(saveTimer)
  const v = video.value
  const hist = historyPath()
  if (v && hist) {
    void window.vd.saveProgress(hist, currentTime.value, duration.value, {
      title: v.title,
      uploader: v.uploader,
      cover: v.cover,
      from: '探索预览'
    })
  }
})

// ---------- 评论分页 ----------

/**
 * 确保拿到第 page 页的起始游标：
 * 已知直接用；未知则从最近的已知游标向后按 30 条/次推进（游标串很短，内存开销可忽略）。
 */
async function ensureOffset(page: number, aid: number): Promise<string | null> {
  const known = pageOffsets.value[page - 1]
  if (known != null) return known
  let from = Math.min(page - 2, pageOffsets.value.length - 1)
  while (from > 0 && pageOffsets.value[from] == null) from--
  let off = pageOffsets.value[from] ?? ''
  let cursor = from
  let guard = 0
  while (cursor < page - 1 && guard < 30) {
    const r = await window.vd.exploreComments(aid, off, 30)
    if (!r.ok) return null
    off = r.nextOffset
    cursor++
    pageOffsets.value[cursor] = off
    if (!r.hasMore) break
    guard++
  }
  return off
}

async function loadComments(page: number): Promise<void> {
  const p = Math.max(1, page)
  const v = video.value
  if (!v) return
  loadingComments.value = true
  commentsError.value = ''
  try {
    if (localPath.value) {
      // 本地伴生评论：主进程按下标切片，仅当前页回传
      const res = await window.vd.getCommentsPage(localPath.value, p, commentPageSize.value)
      comments.value = (res.items ?? []) as CommentItem[]
      commentsTotal.value = res.total ?? 0
      commentsHasMore.value = Boolean(res.hasMore)
      currentCommentsPage.value = p
      return
    }
    // 在线：游标翻页（默认 50 条/页，主进程内部按 30 条分块凑满）
    const offset = await ensureOffset(p, v.aid)
    if (offset == null) {
      commentsError.value = '无法定位该页评论'
      return
    }
    const res = await window.vd.exploreComments(v.aid, offset, commentPageSize.value)
    if (!res.ok) {
      commentsError.value = res.error ?? '评论加载失败'
      comments.value = []
      return
    }
    // 只保留当前页
    comments.value = (res.items ?? []) as CommentItem[]
    commentsTotal.value = res.total ?? 0
    commentsHasMore.value = Boolean(res.hasMore)
    pageOffsets.value[p] = res.nextOffset
    currentCommentsPage.value = p
  } catch (e) {
    commentsError.value = `评论加载失败：${e instanceof Error ? e.message : String(e)}`
  } finally {
    loadingComments.value = false
  }
}

/** 播放历史用的路径：有本地文件用文件，在线直链用 bvid 伪路径 */
function historyPath(): string {
  if (localPath.value) return localPath.value
  return `online://${video.value?.bvid ?? ''}`
}

function onLoaded(): void {
  const el = videoEl.value
  if (el) duration.value = el.duration || 0
  applyVolume()
}

function onTimeUpdate(): void {
  const el = videoEl.value
  if (!el) return
  currentTime.value = el.currentTime
  // 分流模式：纠正音视频漂移（超过 0.35s 重新对齐）
  const a = audioEl.value
  if (a && !a.paused) {
    const drift = el.currentTime - a.currentTime
    if (Math.abs(drift) > 0.35) a.currentTime = el.currentTime
  }
}

// ---------- 音视频同步（分流 DASH 模式） ----------

function syncAudioPlay(): void {
  const a = audioEl.value
  if (!a) return
  if (Math.abs(a.currentTime - (videoEl.value?.currentTime ?? 0)) > 0.35) {
    a.currentTime = videoEl.value?.currentTime ?? 0
  }
  void a.play().catch(() => undefined)
}

function syncAudioPause(): void {
  audioEl.value?.pause()
}

function syncAudioSeek(): void {
  const a = audioEl.value
  if (!a) return
  a.currentTime = videoEl.value?.currentTime ?? 0
}

function syncAudioRate(): void {
  const a = audioEl.value
  if (a) a.playbackRate = videoEl.value?.playbackRate ?? 1
}

function applyVolume(): void {
  const a = audioEl.value
  if (a) {
    a.volume = volume.value
    a.muted = muted.value
  }
}

function toggleMute(): void {
  muted.value = !muted.value
  applyVolume()
}

function onAudioError(): void {
  toast('音频流加载失败，已切换为静音观看', 'error')
}


// ---------- 后台播放策略 ----------

const watching = ref(true)

const bgEnabled = computed(() => store.settings?.backgroundPlayEnabled !== false)
const bgAudioOnly = computed(() => store.settings?.backgroundAudioOnly !== false)

/**
 * 窗口进入/离开前台时调整播放：
 * - 关闭「后台播放」→ 后台直接暂停
 * - 开启「后台省资源」→ 后台卸载视频流（省带宽与解码），仅保留音频；回到前台再恢复画面
 */
watch(
  () => store.foreground,
  (fg) => {
    const v = videoEl.value
    if (!v) return

    if (!fg) {
      // 进入后台
      if (!bgEnabled.value) {
        v.pause()
        syncAudioPause()
        watching.value = false
        return
      }
      if (!bgAudioOnly.value) return
      // 分流模式才能真的省下视频流；混流（单 URL）暂停画面就没有声音了，故保持不变
      if (audioSrc.value) {
        const pos = v.currentTime
        v.pause()
        // 卸载视频源，停止继续下载与解码
        v.removeAttribute('src')
        v.load()
        const a = audioEl.value
        if (a) {
          a.currentTime = pos
          void a.play().catch(() => undefined)
        }
        watching.value = false
      }
      return
    }

    // 回到前台：恢复画面并同步到音频当前进度
    if (watching.value) return
    watching.value = true
    const a = audioEl.value
    const pos = a?.currentTime ?? 0
    // 重新挂载视频源（src 是 computed，清空后需要重新赋值）
    v.src = src.value
    v.currentTime = pos
    void v.play().catch(() => undefined)
    if (a) void a.play().catch(() => undefined)
    v.muted = Boolean(audioSrc.value)
  }
)

/** 直链/缓存播放失败时的兜底（只自动尝试一次） */
let fallbackTried = false

async function onError(): Promise<void> {
  if (fallbackTried) {
    toast('该视频无法播放，可点「下载到本地」后用其他播放器打开', 'error')
    return
  }
  fallbackTried = true

  // 直链模式失败 → 回退到「下载缓存后播放」（本地文件 Chromium 一定吃）
  if (stream.value) {
    toast('直链播放失败，正在改为缓存后播放…')
    await switchToCacheMode()
    return
  }

  if (store.settings?.playerSystemFallback === false || !localPath.value) {
    toast('内置播放器无法解码该视频，可点「系统播放器」播放或「下载到本地」', 'error')
    return
  }
  toast('内置播放器无法解码，正在尝试系统播放器…')
  await openWithSystem()
}

/** 把当前在线直链播放切换成「下载缓存后播放」 */
async function switchToCacheMode(): Promise<void> {
  const v = video.value
  if (!v) return
  const res = await window.vd.explorePreview(v)
  if (res.ok && res.path) {
    if (store.exploreCurrent) {
      store.exploreCurrent = { video: store.exploreCurrent.video, path: res.path }
    }
    fallbackTried = false
    toast('已切换为缓存播放', 'success')
  } else {
    toast(`缓存播放也失败：${res.error ?? '未知错误'}`, 'error')
  }
}

function seekTo(t: number): void {
  const el = videoEl.value
  if (el) el.currentTime = t
}

function goBack(): void {
  store.view = 'explore'
}

async function toggleLike(): Promise<void> {
  const v = video.value
  if (!v) return
  if (!store.auth.loggedIn) {
    toast('请先登录后再点赞', 'error')
    return
  }
  const res = await window.vd.exploreLike(v.bvid, !liked.value)
  if (!res.ok) {
    toast(res.error ?? '操作失败', 'error')
    return
  }
  liked.value = !liked.value
  toast(liked.value ? '点赞成功' : '已取消点赞')
}

async function download(): Promise<void> {
  const v = video.value
  if (!v) return
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
    toast(`下载失败：${e instanceof Error ? e.message : String(e)}`, 'error')
  }
}

async function openWithSystem(): Promise<void> {
  if (!localPath.value) return
  const res = await window.vd.openWithExternalPlayer(
    localPath.value,
    store.settings?.externalPlayerPath || undefined,
    Math.floor(currentTime.value)
  )
  if (res.ok) toast(`已用系统播放器「${res.player}」打开`, 'success')
  else toast(res.error ?? '未找到可用的系统播放器', 'error')
}

async function reveal(): Promise<void> {
  if (localPath.value) await window.vd.showInFolder(localPath.value)
}

function openOnBili(): void {
  const v = video.value
  if (v) void window.vd.openExternal(`https://www.bilibili.com/video/${v.bvid}`)
}

function showLogin(): void {
  toast('请先登录后再收藏', 'error')
}

function onFavDone(): void {
  toast('收藏操作成功', 'success')
}

function fmtCodec(c?: { videoCodec?: string; audioCodec?: string }): string {
  if (!c) return '未知'
  const wrap = (n?: string): string => {
    if (!n) return '无'
    const x = n.toLowerCase()
    if (x.startsWith('avc1') || x === 'h264') return 'H.264'
    if (x.startsWith('hev1') || x.startsWith('hvc1') || x === 'hevc') return 'H.265'
    if (x.startsWith('av01') || x === 'av1') return 'AV1'
    if (x.startsWith('vp09')) return 'VP9'
    if (x === 'aac' || x.startsWith('mp4a')) return 'AAC'
    return n
  }
  return `${wrap(c.videoCodec)} + ${wrap(c.audioCodec)}`
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

function fmtTime(sec: number): string {
  return fmtDur(Math.max(0, Math.floor(sec || 0)))
}

function fmtNum(n?: number): string {
  const v = Number(n ?? 0)
  if (v >= 1e8) return `${(v / 1e8).toFixed(1)}亿`
  if (v >= 1e4) return `${(v / 1e4).toFixed(1)}万`
  return String(v)
}
</script>

<style scoped>
.ep-view {
  display: flex;
  flex-direction: column;
  gap: 14px;
  max-width: 1400px;
}

.ep-top {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.ep-title {
  flex: 1;
  min-width: 0;
  font-size: 15px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* B站 式左右分栏 */
.ep-layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 340px;
  gap: 14px;
  align-items: start;
}

.ep-main,
.ep-side {
  display: flex;
  flex-direction: column;
  gap: 14px;
  min-width: 0;
}

.stage {
  position: relative;
  width: 100%;
  aspect-ratio: 16 / 9;
  background: #000;
  border-radius: var(--md-radius-md);
  overflow: hidden;
}

.stage video {
  width: 100%;
  height: 100%;
  display: block;
  background: #000;
}

.info-title {
  font-size: 17px;
  font-weight: 700;
  line-height: 1.35;
  /* 标题可选中复制 */
  user-select: text;
}

/* 探索页/详情页里需要复制的内容：BV 号、AV 号、UP 主、弹幕文本等 */
.ep-title,
.up-name,
.kv b,
.kv span,
.dm-text {
  user-select: text;
}

.info-meta {
  display: flex;
  gap: 14px;
  flex-wrap: wrap;
  font-size: 12px;
  color: var(--md-on-surface-variant);
  margin-top: 6px;
}

.info-meta span {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.info-ops {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  flex-wrap: wrap;
  margin-top: 10px;
}

.up {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  font-weight: 500;
}

.up-name {
  max-width: 180px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.liked {
  color: var(--md-primary);
}

/* 自定义音量条（音视频分流播放时原生控件音量无效） */
.vol-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  border-radius: var(--md-radius-sm);
  background: var(--md-surface-container-low);
}

.vol-range {
  width: 140px;
  accent-color: var(--md-primary);
}

.vol-text {
  font-size: 11px;
  color: var(--md-on-surface-variant);
  min-width: 34px;
}

/* 评论区：固定可视高度，内部滚动 + 底部分页条固定 */
.comment-card {
  display: flex;
  flex-direction: column;
  height: 440px;
  min-height: 260px;
}

/* 弹幕列表：可点击跳转 */
.dm-list {
  display: flex;
  flex-direction: column;
  border-radius: var(--md-radius-sm);
  overflow: hidden;
  max-height: 420px;
  overflow-y: auto;
}

.dm-row {
  display: grid;
  grid-template-columns: 46px minmax(0, 1fr);
  gap: 8px;
  align-items: baseline;
  padding: 5px 8px;
  border: none;
  background: var(--md-surface-container-low);
  color: var(--md-on-surface);
  font-family: inherit;
  font-size: 12px;
  text-align: left;
  cursor: pointer;
}

.dm-row.alt {
  background: var(--md-surface-container-highest);
}

.dm-row:hover {
  background: var(--md-secondary-container);
}

.dm-time {
  color: var(--md-primary);
  font-size: 11px;
}

.dm-text {
  min-width: 0;
  word-break: break-word;
}

.kv {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  font-size: 12px;
  padding: 5px 0;
  border-bottom: 1px dashed var(--md-outline-variant);
}

.kv:last-of-type {
  border-bottom: none;
}

.kv span {
  color: var(--md-on-surface-variant);
}

@media (max-width: 1080px) {
  .ep-layout {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
