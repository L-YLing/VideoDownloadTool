<template>
  <div class="player-view">
    <div class="player-main">
      <!-- 无媒体占位 -->
      <div v-if="!currentMedia" class="player-empty">
        <MdIcon name="movie" :size="48" class="empty-icon" />
        <div>从「视频列表」「下载历史」或「探索」选择文件播放</div>
        <div class="row" style="margin-top: 12px; gap: 8px; flex-wrap: wrap; justify-content: center">
          <button class="btn" @click="openFile">
            <MdIcon name="folderOpen" :size="16" /> 打开本地媒体…
          </button>
          <button class="btn btn-secondary" @click="importCop">
            <MdIcon name="import" :size="16" /> 导入 .cop 音频包…
          </button>
        </div>
        <p class="hint" style="margin-top: 10px; text-align: center">
          .cop 是「音频 + LRC 歌词」打包格式（本质是未压缩 ZIP，改后缀为 .zip 即可解压查看）
        </p>
      </div>

      <!-- 播放区 -->
      <div v-else class="player-stage">
        <div class="stage-inner" :class="{ 'stage-audio': mode === 'audio' }" :style="{ filter: `brightness(${brightness})` }">
          <!-- key 绑定 mediaSrc：切换视频时强制重建元素，彻底解决「选了新视频仍播旧的」 -->
          <video
            v-if="mode !== 'audio'"
            :key="'v-' + mediaSrc"
            ref="videoEl"
            :src="mediaSrc"
            controls
            autoplay
            playsinline
            :muted="mode === 'video'"
            :loop="loopMode === 'single'"
            @timeupdate="onTimeUpdate"
            @loadedmetadata="onLoaded"
            @ended="onEnded"
            @play="isPlaying = true"
            @pause="isPlaying = false"
            @error="onMediaError"
          ></video>
          <audio
            v-else
            :key="'a-' + mediaSrc"
            ref="audioEl"
            :src="mediaSrc"
            controls
            autoplay
            :loop="loopMode === 'single'"
            @timeupdate="onTimeUpdate"
            @loadedmetadata="onLoaded"
            @ended="onEnded"
            @play="isPlaying = true"
            @pause="isPlaying = false"
            @error="onMediaError"
          ></audio>
          <DanmakuLayer :items="danmakuItems" :current-time="currentTime" :visible="danmakuOn && mode !== 'audio'" />

          <!-- 编码不兼容提示 / 转码进度 / 系统播放器兜底 -->
          <div v-if="compat.busy || compat.error || needsCompat" class="compat-mask">
            <div class="compat-card">
              <template v-if="compat.busy">
                <div class="compat-title">正在转码为兼容格式…</div>
                <div class="compat-desc">{{ codecSummary }} → H.264 + AAC / MP4</div>
                <div class="compat-bar"><ProgressBar :value="compat.percent" /></div>
                <div class="row" style="justify-content: flex-end; margin-top: 10px">
                  <button class="btn btn-text btn-sm" @click="cancelTranscode">取消</button>
                </div>
              </template>
              <template v-else>
                <div class="compat-title">内置播放器无法直接解码</div>
                <div class="compat-desc">{{ currentMedia.playableReason || codecSummary }}</div>
                <div class="row" style="justify-content: flex-end; margin-top: 10px; gap: 6px">
                  <button class="btn btn-text btn-sm" @click="openFile">换个文件</button>
                  <button v-if="systemFallback" class="btn btn-secondary btn-sm" @click="openWithSystem">
                    <MdIcon name="desktop" :size="15" /> 用系统播放器
                  </button>
                  <button class="btn btn-sm" @click="startTranscode">
                    <MdIcon name="refresh" :size="15" /> 转码并播放
                  </button>
                </div>
              </template>
              <div v-if="compat.error" class="compat-err">{{ compat.error }}</div>
            </div>
          </div>
        </div>

        <!-- 编码信息 -->
        <div v-if="currentMedia.codec" class="codec-line">
          <span class="chip">{{ codecSummary }}</span>
          <span v-if="currentMedia.playable === false" class="chip warn">需兼容转码</span>
        </div>

        <!-- 已交给系统播放器：提示 + 可改用内置转码 -->
        <div v-if="externalNotice" class="notice">
          <MdIcon name="desktop" :size="15" />
          <span>已在系统播放器「{{ externalNotice }}」中打开（使用系统解码库）</span>
          <button class="btn btn-text btn-sm" @click="externalNotice = ''">知道了</button>
          <button class="btn btn-text btn-sm" @click="startTranscode">改用内置播放</button>
        </div>

        <!-- 控制条 -->
        <div class="controls">
          <div class="row" style="gap: 12px; flex-wrap: wrap">
            <MdTabs v-model="mode" :tabs="modes" class="mode-tabs" />
            <div class="ctrl-group">
              <MdIcon name="volume" :size="15" />
              <input type="range" min="0" max="100" v-model.number="volume" @input="onVolume" />
              <span class="mono">{{ volume }}%</span>
            </div>
            <div class="ctrl-group">
              <span class="ctrl-label">亮度</span>
              <input type="range" min="0.3" max="1.6" step="0.01" v-model.number="brightness" />
            </div>
            <div class="ctrl-group">
              <span class="ctrl-label">倍速</span>
              <MdSelect v-model="rate" :options="rateOptions" />
            </div>
            <div class="ctrl-group">
              <button class="icon-btn" title="上一个" :disabled="pl.items.length < 2" @click="doPrev">
                <MdIcon name="skipPrev" :size="16" />
              </button>
              <button class="icon-btn" title="下一个" :disabled="!hasNext" @click="doNext">
                <MdIcon name="skipNext" :size="16" />
              </button>
              <MdSelect v-model="loopMode" :options="loopOptions" class="loop-select" />
            </div>
            <label class="row" style="gap: 6px; cursor: pointer" :title="danmakuDisabled ? '需开启「全量下载」且源支持才有弹幕数据' : ''">
              <ToggleSwitch v-model="danmakuOn" :disabled="danmakuDisabled" />
              <span class="opt-label">弹幕</span>
            </label>
          </div>
          <div class="progress-line">
            <ProgressBar :value="progressPct" />
            <span class="mono time-label">{{ fmtTime(currentTime) }} / {{ fmtTime(duration) }}</span>
          </div>
        </div>

        <!-- 歌词（仅音频模式） -->
        <div v-if="mode === 'audio'" class="lyrics-wrap">
          <div class="row-between" style="margin-bottom: 8px">
            <span class="hint">歌词（LRC）</span>
            <div class="row" style="gap: 6px">
              <button class="btn btn-text btn-sm" @click="importLyric">
                <MdIcon name="lyric" :size="14" /> 导入 LRC
              </button>
              <button class="btn btn-secondary btn-sm" @click="openLyricSearch">
                <MdIcon name="search" :size="14" /> 在线搜索歌词
              </button>
              <button
                class="btn btn-text btn-sm"
                title="打开 .cop 音频包（自动载入包内音频与歌词）"
                @click="importCop"
              >
                <MdIcon name="import" :size="14" /> 导入 .cop
              </button>
              <button
                class="btn btn-text btn-sm"
                :disabled="!lyrics.length"
                title="在当前文件旁生成同名 .lrc（通用歌词格式，多数播放器可识别）"
                @click="saveLyric"
              >
                <MdIcon name="save" :size="14" /> 保存到 .lrc
              </button>
              <button
                class="btn btn-secondary btn-sm"
                :disabled="!audioSource"
                title="把「音频 + 歌词」打包成单个 .cop 文件，便于备份与传输（本质是未压缩 ZIP，改后缀 .zip 可用任意解压软件打开）"
                @click="exportCop"
              >
                <MdIcon name="save" :size="14" /> 导出 .cop
              </button>
            </div>
          </div>
          <LyricsLayer :lines="lyrics" :current-time="currentTime" :playing="isPlaying" @seek="seekTo" />
        </div>
      </div>

      <!-- 侧栏 -->
      <div v-if="currentMedia" class="player-side">
        <MdTabs v-model="sideTab" :tabs="sideTabs" class="side-tabs" />

        <!-- 播放列表 -->
        <div v-if="sideTab === 'playlist'" class="side-body">
          <div class="row-between pl-head">
            <span class="hint">{{ pl.from || '临时播放列表' }}</span>
            <div class="row" style="gap: 2px">
              <button class="icon-btn" title="导入软件内视频列表" @click="openImportList">
                <MdIcon name="playlist" :size="16" />
              </button>
              <button class="icon-btn" title="添加文件到列表" @click="addFilesToPlaylist">
                <MdIcon name="add" :size="16" />
              </button>
              <button class="icon-btn" title="清空列表" :disabled="!pl.items.length" @click="clearPl">
                <MdIcon name="delete" :size="15" />
              </button>
            </div>
          </div>
          <div v-if="pl.items.length === 0" class="empty" style="padding: 20px">
            <MdIcon name="playlist" :size="30" class="empty-icon" />
            <div>列表为空</div>
            <div class="hint">可在「视频列表」页点「播放全部」，或在此导入</div>
          </div>
          <div
            v-for="item in pl.items"
            :key="item.id"
            class="pl-item list-item"
            :class="{ current: item.id === pl.currentId }"
          >
            <button class="icon-btn play-btn" title="播放" @click="playItem(item)">
              <MdIcon :name="item.id === pl.currentId ? 'pause' : 'play'" :size="14" />
            </button>
            <div class="pl-info" :title="item.path" @click="playItem(item)">
              <div class="pl-title">{{ item.title }}</div>
            </div>
            <button class="icon-btn" title="移除" @click="removeItem(item.id)">
              <MdIcon name="close" :size="13" />
            </button>
          </div>
        </div>

        <!-- 评论：分页（默认 50 条/页），仅当前页驻留内存，分页条固定底部 -->
        <div v-else-if="sideTab === 'comments'" class="side-body side-comments">
          <CommentPanel
            :items="commentItems"
            :total="commentsTotal"
            :page="commentsPage"
            :page-size="COMMENT_PAGE_SIZE"
            :has-more="commentsHasMore"
            :loading="commentsLoading"
            :error="commentsError"
            :empty-text="currentMedia?.hasComments ? '暂无评论数据' : '暂无评论（需全量下载才有伴生评论）'"
            @update:page="loadComments"
          />
        </div>

        <!-- 媒体信息 -->
        <div v-else class="side-body">
          <div class="info-row"><span class="info-key">文件</span><span class="info-val" :title="currentMedia.path">{{ currentMedia.path }}</span></div>
          <div class="info-row"><span class="info-key">容器</span><span class="info-val mono">{{ currentMedia.codec?.container || '—' }}</span></div>
          <div class="info-row"><span class="info-key">视频</span><span class="info-val mono">{{ displayCodec(currentMedia.codec?.videoCodec) }}</span></div>
          <div class="info-row"><span class="info-key">音频</span><span class="info-val mono">{{ displayCodec(currentMedia.codec?.audioCodec) }}</span></div>
          <div class="info-row"><span class="info-key">分辨率</span><span class="info-val mono">{{ resolution }}</span></div>
          <div class="info-row"><span class="info-key">时长</span><span class="info-val mono">{{ fmtTime(currentMedia.codec?.duration ?? 0) }}</span></div>
          <div class="info-row">
            <span class="info-key">可直接播</span>
            <span class="info-val">
              <span class="chip" :class="currentMedia.playable === false ? 'warn' : 'ok'">
                {{ currentMedia.playable === false ? '否' : '是' }}
              </span>
            </span>
          </div>
        </div>
      </div>
    </div>

    <!-- 导入软件内视频列表 -->
    <div v-if="showImport" class="modal-mask" @click.self="showImport = false">
      <div class="modal">
        <h3>导入视频列表</h3>
        <p class="hint" style="margin: 4px 0 12px">选择软件「视频列表」页中已创建的列表，整表送入播放队列。</p>
        <div v-if="lists.length === 0" class="empty" style="padding: 20px">
          <MdIcon name="folder" :size="30" class="empty-icon" />
          <div>还没有列表，请先到「视频列表」新建</div>
        </div>
        <div v-else class="import-list">
          <button v-for="l in lists" :key="l.id" class="import-row" @click="importList(l)">
            <MdIcon name="playlist" :size="16" />
            <span class="import-name">{{ l.name }}</span>
            <span class="chip">{{ l.items.length }} 个</span>
          </button>
        </div>
        <div class="row" style="justify-content: flex-end; margin-top: 12px">
          <button class="btn btn-text" @click="showImport = false">关闭</button>
        </div>
      </div>
    </div>

    <!-- 在线搜索歌词 -->
    <LyricsSearchDialog
      :open="showLyricSearch"
      :initial-keyword="lyricSearchSeed"
      @close="showLyricSearch = false"
      @pick="onLyricPicked"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { CommentItem, LoopMode, LyricLine, PlaylistItem, VideoList } from '@shared/types'
import { store, toast, updateSettings } from '../store/app'
import { isAudioOnly, playMedia, playNext, playPrev, playPlaylist } from '../player'
import { appendToPlaylist, clearPlaylist, hasNext, playlist as pl, removeFromPlaylist, setLoopMode } from '../store/playlist'
import ProgressBar from '../components/ProgressBar.vue'
import ToggleSwitch from '../components/ToggleSwitch.vue'
import DanmakuLayer from '../components/DanmakuLayer.vue'
import LyricsLayer from '../components/LyricsLayer.vue'
import LyricsSearchDialog from '../components/LyricsSearchDialog.vue'
import CommentPanel from '../components/CommentPanel.vue'
import MdIcon from '../components/MdIcon.vue'
import MdTabs from '../components/MdTabs.vue'
import MdSelect from '../components/MdSelect.vue'

const videoEl = ref<HTMLVideoElement | null>(null)
const audioEl = ref<HTMLAudioElement | null>(null)

const mode = ref<'audio' | 'video' | 'both'>('both')
const volume = ref(100)
const brightness = ref(1)
const danmakuOn = ref(false)
const isPlaying = ref(false)
const currentTime = ref(0)
const duration = ref(0)
const sideTab = ref<'playlist' | 'comments' | 'info'>('playlist')
const rate = ref(1)

const modes = [
  { value: 'audio', label: '仅音频' },
  { value: 'video', label: '仅视频' },
  { value: 'both', label: '音视频' }
]

const rateOptions = [0.5, 0.75, 1, 1.25, 1.5, 2].map((r) => ({ label: `${r}×`, value: r }))

const sideTabs = [
  { value: 'playlist', label: '列表', icon: 'playlist' },
  { value: 'comments', label: '评论', icon: 'info' },
  { value: 'info', label: '信息', icon: 'movie' }
]

const loopOptions = [
  { value: 'list', label: '列表循环', icon: 'loop' },
  { value: 'single', label: '单集循环', icon: 'loopOne' },
  { value: 'shuffle', label: '随机播放', icon: 'shuffle' }
]

/** 循环模式：读写设置，保证重启后保留 */
const loopMode = computed({
  get: () => (store.settings?.loopMode ?? pl.loopMode) as LoopMode,
  set: (v: LoopMode) => {
    pl.loopMode = v
    setLoopMode(v)
    void updateSettings({ loopMode: v })
  }
})

/** 兼容转码状态 */
const compat = ref({ busy: false, percent: 0, error: '' })
/** 已交给系统播放器播放时展示的提示（可一键改用内置转码） */
const externalNotice = ref('')
/** 自动兜底只对同一文件尝试一次（防止错误循环） */
let compatTriedFor = ''
let transcodeId = ''
let unsubProgress: (() => void) | null = null

const currentMedia = computed(() => store.player)
const danmakuItems = computed(() => store.danmakuItems)
const lyrics = computed(() => store.lyrics)

// ---------- 评论分页（只保留当前页） ----------
const COMMENT_PAGE_SIZE = 50
const commentItems = ref<CommentItem[]>([])
const commentsTotal = ref(0)
const commentsHasMore = ref(false)
const commentsError = ref('')
const commentsPage = ref(1)
const commentsLoading = ref(false)
/** 已加载过的媒体路径：换媒体后需要重新按页拉取 */
let commentsLoadedFor = ''

async function loadComments(page = 1): Promise<void> {
  const p = currentMedia.value?.path
  if (!p) {
    commentItems.value = []
    return
  }
  commentsLoading.value = true
  commentsError.value = ''
  try {
    const res = await window.vd.getCommentsPage(p, page, COMMENT_PAGE_SIZE)
    commentItems.value = (res.items ?? []) as CommentItem[]
    commentsTotal.value = res.total ?? 0
    commentsHasMore.value = Boolean(res.hasMore)
    commentsPage.value = res.page ?? page
    commentsLoadedFor = p
  } catch (e) {
    commentsError.value = `评论加载失败：${e instanceof Error ? e.message : String(e)}`
    commentItems.value = []
  } finally {
    commentsLoading.value = false
  }
}

/** 切到评论页才拉取（懒加载，避免不看评论也占内存） */
watch(sideTab, (tab) => {
  if (tab !== 'comments') return
  if (commentsLoadedFor === currentMedia.value?.path) return
  void loadComments(1)
})
const danmakuDisabled = computed(() => !currentMedia.value?.hasDanmaku)
const progressPct = computed(() => (duration.value > 0 ? (currentTime.value / duration.value) * 100 : 0))
/** 是否允许回退到系统播放器（用系统解码器） */
const systemFallback = computed(() => store.settings?.playerSystemFallback !== false)

/**
 * 媒体地址：本地文件走 vdmedia:// 受信任协议（支持 Range，可拖动/续播），
 * 在线地址（如探索页直链）直接用原始 URL。
 */
const mediaSrc = computed(() => {
  const p = currentMedia.value?.path
  if (p) return window.vd.mediaUrl(p)
  return currentMedia.value?.source ?? ''
})
const needsCompat = computed(() => currentMedia.value?.playable === false && !compat.value.busy)
/** 导出 .cop 时使用的源音频（本地文件才有意义） */
const audioSource = computed(() => currentMedia.value?.path ?? '')

const codecSummary = computed(() => {
  const c = currentMedia.value?.codec
  if (!c) return '未知编码'
  const parts: string[] = []
  if (c.container) parts.push(String(c.container).toUpperCase())
  if (c.videoCodec) parts.push(c.videoCodec)
  if (c.audioCodec) parts.push(c.audioCodec)
  return parts.join(' · ') || '未知编码'
})

const resolution = computed(() => {
  const c = currentMedia.value?.codec
  return c?.width && c?.height ? `${c.width}×${c.height}` : '—'
})

let saveTimer: ReturnType<typeof setInterval> | null = null

// ---------- 后台播放策略 ----------

/** 后台时用于「只留声音」的伴生音频元素（本地/混流文件没有独立音轨，只能另挂一个） */
let bgAudio: HTMLAudioElement | null = null
const bgAudioActive = ref(false)
/** 因进入后台而暂停（关闭后台播放时），回前台需要自动续播 */
let pausedByBackground = false

const bgEnabled = computed(() => store.settings?.backgroundPlayEnabled !== false)
const bgAudioOnly = computed(() => store.settings?.backgroundAudioOnly !== false)
const mediaIsAudioOnly = computed(() => {
  const p = currentMedia.value?.path ?? currentMedia.value?.source ?? ''
  return isAudioOnly(p)
})

/**
 * 窗口进入后台 / 回到前台时调整播放：
 * - 关闭「后台播放」→ 暂停；回前台自动续播
 * - 开启「后台省资源」且是视频内容 → 暂停画面并挂一个同源音频元素继续放声音
 *   （音频内容无需处理；挂载失败则回退为直接继续播放画面）
 */
watch(
  () => store.foreground,
  (fg) => {
    const el = videoEl()
    if (!el) return

    if (!fg) {
      if (!bgEnabled.value) {
        if (!el.paused) {
          el.pause()
          pausedByBackground = true
        }
        return
      }
      if (!bgAudioOnly.value || mediaIsAudioOnly.value || el.paused) return
      switchToAudioOnly(el)
      return
    }

    // 回到前台
    if (pausedByBackground) {
      pausedByBackground = false
      void el.play().catch(() => undefined)
    }
    if (bgAudioActive.value) restoreFromAudioOnly(el)
  }
)

/** 后台仅音频：暂停画面，用伴生 audio 元素继续播放同一媒体 */
function switchToAudioOnly(el: HTMLVideoElement): void {
  const src = mediaSrc.value
  if (!src) return
  try {
    if (!bgAudio) {
      bgAudio = document.createElement('audio')
      bgAudio.preload = 'auto'
    }
    const pos = el.currentTime
    bgAudio.src = src
    bgAudio.currentTime = pos
    const started = bgAudio.play()
    if (started && typeof started.catch === 'function') {
      started.catch(() => {
        // 播放失败（编解码/权限）→ 回退：继续放画面，至少声音不断
        bgAudioActive.value = false
        void el.play().catch(() => undefined)
      })
    }
    el.pause()
    bgAudioActive.value = true
  } catch {
    bgAudioActive.value = false
    void el.play().catch(() => undefined)
  }
}

/** 回到前台：把音频进度同步回视频元素并恢复画面 */
function restoreFromAudioOnly(el: HTMLVideoElement): void {
  const pos = bgAudio?.currentTime ?? el.currentTime
  bgAudioActive.value = false
  try {
    bgAudio?.pause()
    if (bgAudio) {
      bgAudio.removeAttribute('src')
      bgAudio.load()
    }
  } catch {
    /* ignore */
  }
  if (!el.src) el.src = mediaSrc.value
  el.currentTime = pos
  void el.play().catch(() => undefined)
}

onMounted(() => {
  unsubProgress = window.vd.onTranscodeProgress((p) => {
    if (p.file !== currentMedia.value?.path) return
    // 命中缓存的转码会立刻随 invoke 结果返回，这里不重复处理
    if (p.id === 'cached') return
    transcodeId = p.id
    compat.value.percent = p.percent
    if (p.done) {
      compat.value.busy = false
      if (p.error) {
        compat.value.error = p.error
        toast(`转码失败: ${p.error}`, 'error')
        return
      }
      if (p.output) {
        compat.value.error = ''
        void playMedia(p.output)
      }
    }
  })
})

onBeforeUnmount(() => {
  if (saveTimer) clearInterval(saveTimer)
  if (unsubProgress) unsubProgress()
  // 释放后台伴生音频元素
  try {
    bgAudio?.pause()
    bgAudio = null
  } catch {
    /* ignore */
  }
})

async function openFile(): Promise<void> {
  const files = await window.vd.openFile({
    filters: [
      {
        name: '媒体文件',
        extensions: [
          'mp4', 'mkv', 'webm', 'mov', 'm4v', 'avi', 'flv', 'ts', 'm2ts', 'wmv', 'mpg', 'mpeg', '3gp', 'ogv', 'f4v',
          'mp3', 'm4a', 'flac', 'wav', 'aac', 'ogg', 'oga', 'opus', 'wma', 'ape', 'aiff', 'cop'
        ]
      }
    ]
  })
  if (files.length > 0) await playMedia(files[0])
}

// ---------- 播放列表 ----------

const showImport = ref(false)
const lists = ref<VideoList[]>([])

async function openImportList(): Promise<void> {
  lists.value = await window.vd.listLists()
  showImport.value = true
}

function importList(l: VideoList): void {
  showImport.value = false
  const items: PlaylistItem[] = l.items.map((it) => ({ id: it.id, path: it.path, title: it.title, from: l.name }))
  if (items.length === 0) {
    toast('该列表为空', 'error')
    return
  }
  void playPlaylist(items, undefined, l.name)
  toast(`已导入「${l.name}」共 ${items.length} 个媒体`, 'success')
}

async function addFilesToPlaylist(): Promise<void> {
  const files = await window.vd.openFile()
  if (files.length === 0) return
  appendToPlaylist(
    files.map((f) => ({ id: `pl_${f}`, path: f, title: fileName(f), from: '手动添加' })),
    '手动添加'
  )
  toast(`已添加 ${files.length} 个文件到播放列表`, 'success')
}

function fileName(p: string): string {
  const parts = p.replace(/\\/g, '/').split('/')
  return parts[parts.length - 1] || p
}

function playItem(item: PlaylistItem): void {
  void playMedia(item.path)
}

function removeItem(id: string): void {
  removeFromPlaylist(id)
}

function clearPl(): void {
  clearPlaylist()
}

function doNext(): void {
  void playNext()
}
function doPrev(): void {
  void playPrev()
}

function onEnded(): void {
  // 单集循环由 <video loop> 处理，不会触发 ended
  if (hasNext()) void playNext()
}

// ---------- 歌词 / .cop ----------

async function importLyric(): Promise<void> {
  const files = await window.vd.openFile({ filters: [{ name: '歌词文件', extensions: ['lrc'] }] })
  if (files.length === 0) return
  const lines = await window.vd.parseLyric(files[0])
  if (!lines || lines.length === 0) {
    toast('未能解析出歌词，请确认是标准 LRC 文件', 'error')
    return
  }
  store.lyrics = lines
  toast(`已载入 ${lines.length} 行歌词`, 'success')
}

async function importCop(): Promise<void> {
  const files = await window.vd.openFile({ filters: [{ name: 'VD 音频包', extensions: ['cop'] }] })
  if (files.length === 0) return
  const ok = await playMedia(files[0])
  if (!ok) toast('无法打开 .cop 文件', 'error')
}

// ---------- 在线搜索歌词 ----------

const showLyricSearch = ref(false)
/** 用当前媒体信息预填搜索关键词，减少用户输入 */
const lyricSearchSeed = computed(() => {
  const t = currentMedia.value?.title ?? ''
  // 去掉常见的下载后缀噪音，保留标题主体
  return t.replace(/\.(mp4|mkv|webm|mp3|flac|m4a|wav|cop)$/i, '').trim()
})

function openLyricSearch(): void {
  showLyricSearch.value = true
}

function onLyricPicked(lines: LyricLine[]): void {
  store.lyrics = lines
  showLyricSearch.value = false
}

/**
 * 「保存到文件旁」的目标路径：
 * 若用户打开的是 .cop，则写到 .cop 旁边（同名的 .lrc），而不是缓存目录里解包出的音频旁。
 */
function lyricSidecarTarget(): string {
  return store.openedPath || audioSource.value
}

async function saveLyric(): Promise<void> {
  const p = lyricSidecarTarget()
  if (!p) return
  const ok = await window.vd.saveLyric(p, store.lyrics)
  toast(ok ? '歌词已保存为同名 .lrc' : '保存失败', ok ? 'success' : 'error')
}

async function exportCop(): Promise<void> {
  const p = audioSource.value
  if (!p) return
  const out = await window.vd.saveFile({
    defaultPath: (store.openedPath || p).replace(/\.[^.]+$/, '.cop'),
    filters: [{ name: 'VD 音频包', extensions: ['cop'] }]
  })
  if (!out) return
  // 直接把内存中的歌词打包进去（不再依赖「写侧车文件是否成功」，确保歌词一定随包）
  const res = await window.vd.exportCop(
    p,
    out,
    { title: currentMedia.value?.title },
    undefined,
    store.lyrics.length > 0 ? store.lyrics.map((l) => ({ time: l.time, text: l.text })) : []
  )
  if (!res.ok) {
    toast(`导出失败: ${res.error}`, 'error')
    return
  }
  const hasLyric = Boolean(res.hasLyric)
  toast(
    hasLyric
      ? `已导出 .cop（含 ${store.lyrics.length} 行歌词，改后缀为 .zip 可解压查看）`
      : '已导出 .cop（仅音频：当前没有歌词，可先「在线搜索歌词」再导出）',
    hasLyric ? 'success' : 'info'
  )
}

function seekTo(t: number): void {
  const el = mediaEl()
  if (el) el.currentTime = t
}

// ---------- 播放控制 ----------

/** 自动转码 + 音频格式自动切到「仅音频」 */
watch(
  currentMedia,
  (media) => {
    if (saveTimer) {
      clearInterval(saveTimer)
      saveTimer = null
    }
    compat.value = { busy: false, percent: 0, error: '' }
    externalNotice.value = ''
    compatTriedFor = ''
    transcodeId = ''

    // 换媒体：评论缓存失效；若正停在评论页则立即重新拉取第一页
    if (sideTab.value === 'comments') void loadComments(1)

    const p = media?.path ?? media?.source ?? ''
    // 音频格式（mp3/flac/cop…）默认「仅音频」：音视频模式本来就播不了
    if (p && isAudioOnly(p)) mode.value = 'audio'
    else if (media && !media.codec?.videoCodec && media.codec?.audioCodec && !media.codec?.container?.match(/mp4|mkv|webm|mov/i)) {
      mode.value = 'audio'
    }

    if (media?.playable === false && (store.settings?.playerCompatMode ?? 'auto') === 'auto') {
      void autoCompat()
    }
    // 恢复进度
    const prog = media?.progress
    if (prog && prog.position > 5 && prog.position < prog.duration - 10) {
      void nextTick(() => {
        const el = mediaEl()
        if (el) {
          const doSeek = (): void => {
            el.currentTime = prog.position
          }
          if (el.readyState >= 1) doSeek()
          else el.addEventListener('loadedmetadata', doSeek, { once: true })
        }
      })
    }
  },
  { immediate: true }
)

async function startTranscode(): Promise<void> {
  const p = currentMedia.value?.path
  if (!p) return
  compat.value = { busy: true, percent: 0, error: '' }
  const res = await window.vd.transcodeForPlayback(p)
  if (res.ok && res.path) {
    compat.value.busy = false
    void playMedia(res.path)
    return
  }
  if (!res.ok) compat.value = { busy: false, percent: 0, error: res.error ?? '转码失败' }
}

function cancelTranscode(): void {
  if (transcodeId) void window.vd.cancelTranscode(transcodeId)
  compat.value = { busy: false, percent: 0, error: '已取消转码' }
}

/** 内置解码不了时，调用系统播放器（用系统解码器播放 AV1/HEVC 等） */
async function openWithSystem(): Promise<void> {
  const p = currentMedia.value?.path
  if (!p) return
  const res = await window.vd.openWithExternalPlayer(
    p,
    store.settings?.externalPlayerPath || undefined,
    currentTime.value
  )
  if (res.ok) {
    externalNotice.value = res.player ?? '系统播放器'
    toast(`已用系统播放器「${res.player}」打开`, 'success')
  } else {
    toast(res.error ?? '未找到可用的系统播放器', 'error')
  }
}

/**
 * 自动兼容：优先借用系统解码资源（已装好的播放器/解码库），
 * 找不到系统方案时才退回内置 ffmpeg 转码；仍失败则提示手动处理。
 */
async function autoCompat(): Promise<void> {
  const p = currentMedia.value?.path
  if (!p) return
  if (systemFallback.value) {
    const res = await window.vd.openAuto(p, store.settings?.externalPlayerPath || undefined, 0)
    if (res.fallback && res.ok) {
      externalNotice.value = res.player ?? '系统播放器'
      toast(`内置无法解码，已交给系统播放器「${res.player}」播放`, 'success')
      return
    }
    if (res.fallback && !res.ok) {
      toast(`未找到可用的系统播放器（${res.error ?? '未检测到'}），改用内置转码`, 'error')
    }
  }
  await startTranscode()
  if (compat.value.error) {
    toast('自动兜底失败：可在设置中指定系统播放器，或安装解码组件后重试', 'error')
  }
}

function mediaEl(): HTMLVideoElement | HTMLAudioElement | null {
  return videoEl.value ?? audioEl.value
}

function onLoaded(): void {
  const el = mediaEl()
  if (el) {
    duration.value = el.duration || 0
    el.playbackRate = rate.value
    el.volume = volume.value / 100
  }
}

function onTimeUpdate(): void {
  const el = mediaEl()
  if (!el) return
  currentTime.value = el.currentTime
  if (!saveTimer) {
    saveTimer = setInterval(() => {
      if (currentMedia.value?.path) {
        // 同时带上来源元信息（标题/UP主/封面/来源），供「历史记录」展示
        void window.vd.saveProgress(currentMedia.value.path, currentTime.value, duration.value, store.playerMeta)
      }
    }, 5000)
  }
}

function onVolume(): void {
  const el = mediaEl()
  if (el) el.volume = volume.value / 100
}

watch(rate, (v) => {
  const el = mediaEl()
  if (el) el.playbackRate = v
})

/**
 * 内置解码失败时的自动兜底（每个文件只自动尝试一次，避免错误循环）：
 * ① 调用系统播放器（借用系统已安装的解码库）
 * ② 用 ffmpeg 转为 H.264+AAC/MP4 后在内置播放器播放
 * ③ 都失败才提示用户手动处理
 */
function onMediaError(): void {
  const el = mediaEl()
  const code = el?.error?.code
  if (code !== 3 && code !== 4) return
  const p = currentMedia.value?.path
  if (!p) return
  if (compatTriedFor === p) {
    toast('该文件仍无法播放：可在设置中指定系统播放器，或安装解码组件（K-Lite / LAV / HEVC 扩展）', 'error')
    return
  }
  compatTriedFor = p
  toast('内置播放器解不了该编码，正在自动尝试系统解码资源…')
  void autoCompat()
}

/** 把 ffmpeg 的原始编码名显示为常见写法 */
function displayCodec(name: string | undefined): string {
  if (!name) return '无'
  const n = name.toLowerCase()
  if (n.startsWith('avc1') || n === 'h264') return 'H.264'
  if (n.startsWith('hev1') || n.startsWith('hvc1') || n === 'hevc') return 'H.265 / HEVC'
  if (n.startsWith('av01') || n === 'av1') return 'AV1'
  if (n.startsWith('vp09')) return 'VP9'
  if (n === 'aac' || n.startsWith('mp4a')) return 'AAC'
  if (n === 'opus') return 'Opus'
  if (n === 'mp3') return 'MP3'
  if (n === 'flac') return 'FLAC'
  if (n === 'vorbis') return 'Vorbis'
  return name
}

function fmtTime(sec: number): string {
  if (!isFinite(sec) || sec <= 0) return '00:00'
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = Math.floor(sec % 60)
  return h > 0
    ? `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}
</script>

<style scoped>
.player-view {
  max-width: 1100px;
}

.player-main {
  display: grid;
  grid-template-columns: 1fr 300px;
  gap: 16px;
}

@media (max-width: 900px) {
  .player-main {
    grid-template-columns: 1fr;
  }
}

.player-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 80px 20px;
  background: var(--md-surface-container);
  border-radius: var(--md-radius-lg);
  color: var(--md-on-surface-variant);
}

.player-stage {
  background: var(--md-surface-container);
  border-radius: var(--md-radius-lg);
  padding: 12px;
}

.stage-inner {
  position: relative;
  aspect-ratio: 16/9;
  background: #000;
  border-radius: var(--md-radius-md);
  overflow: hidden;
}

.stage-audio {
  aspect-ratio: auto;
  height: 120px;
}

.stage-inner video,
.stage-inner audio {
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.stage-inner audio {
  display: flex;
  align-items: center;
  justify-content: center;
  margin: 0 auto;
  background: transparent;
}

.compat-mask {
  position: absolute;
  inset: 0;
  z-index: 10;
  background: rgba(0, 0, 0, 0.62);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
}

.compat-card {
  width: min(400px, 100%);
  background: var(--md-surface-container);
  border-radius: var(--md-radius-md);
  padding: 16px;
  box-shadow: var(--md-elevation-2);
}

.compat-title {
  font-size: 14px;
  font-weight: 600;
  margin-bottom: 6px;
}

.compat-desc {
  font-size: 12px;
  color: var(--md-on-surface-variant);
  line-height: 1.6;
  word-break: break-all;
}

.compat-bar {
  margin-top: 12px;
}

.compat-err {
  margin-top: 8px;
  font-size: 12px;
  color: var(--md-error);
  word-break: break-all;
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
  margin-top: 8px;
}

.notice span {
  flex: 1;
  min-width: 0;
}

.codec-line {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  margin-top: 10px;
}

.controls {
  padding: 12px 6px 4px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.ctrl-group {
  display: flex;
  align-items: center;
  gap: 8px;
}

.ctrl-label {
  font-size: 12px;
  color: var(--md-on-surface-variant);
}

.ctrl-group input[type='range'] {
  width: 110px;
  accent-color: var(--md-primary);
}

.loop-select,
.ctrl-group :deep(.md-select) {
  min-width: 104px;
}

.ctrl-group :deep(.sel-field) {
  height: var(--md-control-h-sm);
  font-size: 12px;
}

.progress-line {
  display: flex;
  align-items: center;
  gap: 10px;
}

.time-label {
  flex-shrink: 0;
}

.lyrics-wrap {
  margin-top: 10px;
}

.player-side {
  background: var(--md-surface-container);
  border-radius: var(--md-radius-lg);
  padding: 10px;
  display: flex;
  flex-direction: column;
  min-height: 300px;
  max-height: 620px;
}

.side-tabs {
  margin-bottom: 8px;
  max-width: 100%;
}

.side-tabs :deep(.md-tab) {
  flex: 1;
  padding: 0 8px;
}

.side-body {
  flex: 1;
  overflow-y: auto;
  padding: 4px;
}

.pl-head {
  padding: 0 4px 6px;
}

.pl-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 6px;
  border-radius: var(--md-radius-sm);
}

.pl-item.current {
  background: var(--md-primary-container);
  color: var(--md-on-primary-container);
}

.pl-info {
  flex: 1;
  min-width: 0;
  cursor: pointer;
}

.pl-title {
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.play-btn {
  flex-shrink: 0;
}

.info-row {
  display: flex;
  gap: 10px;
  padding: 6px 4px;
  border-bottom: 1px solid var(--md-outline-variant);
  font-size: 12px;
}

.info-key {
  width: 56px;
  flex-shrink: 0;
  color: var(--md-on-surface-variant);
}

.info-val {
  flex: 1;
  min-width: 0;
  word-break: break-all;
}

/* 评论页：交给 CommentPanel 自己滚动，父容器不滚动，保证底部翻页条固定 */
.side-comments {
  display: flex;
  flex-direction: column;
  overflow: hidden;
  padding: 4px 4px 0;
}

.import-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-height: 320px;
  overflow-y: auto;
}

.import-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  border: none;
  border-radius: var(--md-radius-sm);
  background: var(--md-surface-container-low);
  color: var(--md-on-surface);
  font-family: inherit;
  font-size: 13px;
  cursor: pointer;
  text-align: left;
}

.import-row:hover {
  background: var(--md-secondary-container);
}

.import-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
