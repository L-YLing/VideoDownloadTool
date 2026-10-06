<template>
  <div class="download-view">
    <!-- 批量输入区 -->
    <section class="card input-card">
      <div class="row-between">
        <h3 class="section-title">下载任务</h3>
        <div class="row" style="gap: 6px">
          <button class="btn btn-text btn-sm" @click="importTxt">导入 txt</button>
          <button class="btn btn-text btn-sm" @click="clearInput">清空</button>
        </div>
      </div>
      <textarea
        v-model="inputText"
        class="textarea"
        placeholder="每行一个：B站视频链接 / BV 号 / AV 号 / 收藏夹链接&#10;例：https://www.bilibili.com/video/BV1xx411c7mD&#10;    BV1xx411c7mD&#10;    av170001"
      ></textarea>

      <div class="options">
        <div class="field">
          <span class="label">下载内容</span>
          <!-- 选项卡改用 MdTabs：激活态由滑块指示器呈现（与全局样式统一） -->
          <MdTabs
            :model-value="form.content"
            :tabs="contentOptions"
            fill
            @update:model-value="onContentChange"
          />
        </div>

        <div class="field">
          <span class="label">画质</span>
          <MdSelect v-model="form.quality" :options="qualityOptions" />
        </div>

        <div class="field">
          <span class="label">下载到（单选）</span>
          <MdSelect v-model="form.dest" :options="destOptions" placeholder="主目标地址" />
          <button class="btn btn-text btn-sm" style="margin-top: 4px" @click="goSettings">
            管理目标地址 / 设为主目标…
          </button>
        </div>
      </div>

      <div class="row-between" style="flex-wrap: wrap; gap: 8px">
        <div class="row" style="gap: 14px; flex-wrap: wrap">
          <label class="row" style="gap: 6px; cursor: pointer">
            <ToggleSwitch v-model="form.fullDownload" />
            <span class="opt-label">全量下载（弹幕/评论/字幕/封面）</span>
          </label>
          <label
            class="row"
            style="gap: 6px; cursor: pointer"
            :title="
              destinations.length < 2
                ? '设置里只有 1 个目标地址，无需分发'
                : '开启后，同一文件会同时落到设置里配置的全部目标地址；关闭时只下到上面选择的那个'
            "
          >
            <ToggleSwitch v-model="form.distributeAll" :disabled="destinations.length < 2" />
            <span class="opt-label">同时分发到全部目标地址（共 {{ destinations.length }} 个）</span>
          </label>
          <label
            v-if="form.distributeAll && destinations.length > 1"
            class="row"
            style="gap: 6px; cursor: pointer"
            title="方式一：先下载一份再复制到其他地址（省网络）；方式二：每个地址各开一个下载任务（快但占磁盘）"
          >
            <ToggleSwitch v-model="form.distributionParallel" />
            <span class="opt-label">并行分发（方式二）</span>
          </label>
        </div>
        <div class="row" style="gap: 8px">
          <button class="btn btn-secondary" :disabled="!canStart || parsing" @click="parsePreview">
            <MdIcon name="search" :size="16" /> {{ parsing ? '解析中…' : '解析预览' }}
          </button>
          <button v-if="previewItems.length > 0" class="btn" :disabled="selectedCount === 0" @click="downloadSelected">
            <MdIcon name="download" :size="16" /> 下载选中 {{ selectedCount }}
          </button>
          <button v-else class="btn" :disabled="!canStart || parsing" @click="startDownload">
            <MdIcon name="download" :size="16" /> 直接下载
          </button>
        </div>
      </div>
      <p class="hint">未登录也可下载公开内容；自定义源当前返回 502 占位（插件开发中）。</p>
      <p class="hint">保存位置：{{ savePreview }}</p>

      <!-- 解析预览：先看到标题/作者/封面/大小，再决定是否下载 -->
      <div v-if="previewItems.length > 0" class="preview">
        <div class="row-between preview-head">
          <div class="row" style="gap: 8px">
            <strong>解析结果</strong>
            <span class="chip">{{ previewItems.length }} 个</span>
            <span v-if="previewTotalSize > 0" class="chip">约 {{ fmtSize(previewTotalSize) }}</span>
          </div>
          <div class="row" style="gap: 6px">
            <button class="btn btn-text btn-sm" @click="selectAll(true)">全选</button>
            <button class="btn btn-text btn-sm" @click="selectAll(false)">全不选</button>
            <button class="btn btn-text btn-sm" @click="clearPreview">关闭</button>
          </div>
        </div>
        <div class="pv-grid">
          <div
            v-for="it in previewItems"
            :key="it.id"
            class="pv-card list-item"
            :class="{ selected: selected.has(it.id), failed: !!it.error }"
            @click="toggle(it.id)"
          >
            <div class="pv-thumb">
              <img
                v-if="it.thumbnail && !failedCovers.has(it.id)"
                :src="coverSrc(it.thumbnail)"
                :alt="it.title"
                loading="lazy"
                @error="markFailed(it.id)"
              />
              <div v-else class="pv-thumb-ph">
                <MdIcon name="movie" :size="26" />
              </div>
              <span v-if="it.duration" class="pv-dur">{{ fmtDur(it.duration) }}</span>
              <span class="pv-check"><MdIcon name="check" :size="14" /></span>
            </div>
            <div class="pv-info">
              <div class="pv-title" :title="it.title || it.source">{{ it.title || it.source }}</div>
              <div class="pv-sub">
                <MdIcon name="person" :size="12" />
                <span class="pv-uploader">{{ it.uploader || '未知作者' }}</span>
              </div>
              <div class="pv-sub mono">
                <span v-if="it.size">{{ fmtSize(it.size) }}</span>
                <span v-if="it.parentTitle" class="pv-parent">{{ it.parentTitle }}</span>
              </div>
              <div v-if="it.error" class="pv-err" :title="it.error">{{ it.error }}</div>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- 任务列表 -->
    <section class="card">
      <div class="row-between">
        <h3 class="section-title">
          任务队列 <span v-if="runningCount" class="chip" style="margin-left: 6px">{{ runningCount }} 进行中</span>
        </h3>
        <div class="row" style="gap: 6px">
          <button class="btn btn-text btn-sm" @click="clearPending">清空排队</button>
          <button class="btn btn-text btn-sm" :disabled="!hasFinished" title="从队列中移走已完成 / 失败 / 已取消的任务（不影响下载历史）" @click="clearQueueHistory">
            <MdIcon name="delete" :size="14" /> 清空历史
          </button>
        </div>
      </div>

      <div v-if="store.tasks.length === 0" class="empty">
        <MdIcon name="download" :size="40" class="empty-icon" />
        <div>暂无任务，输入链接开始下载</div>
      </div>

      <div v-else class="task-list">
        <div v-for="t in pagedTasks" :key="t.id" class="task-item card-hover" style="animation: task-row-in 0.25s ease both">
          <div class="task-main">
            <div class="task-title" :title="t.title || t.input.source">
              {{ t.title || t.input.source }}
              <span class="chip" :class="'st-' + t.state">{{ stateLabel(t.state) }}</span>
            </div>
            <div class="task-sub">
              <span v-if="t.size && t.progress > 0" class="mono">{{ fmtSize(t.size * t.progress / 100) }} / {{ fmtSize(t.size) }}</span>
              <span v-else-if="t.size" class="mono">约 {{ fmtSize(t.size) }}</span>
              <span v-if="t.progress > 0 && t.state !== 'completed'" class="mono">{{ t.progress.toFixed(1) }}%</span>
              <span v-if="t.speed" class="mono">{{ t.speed }}</span>
              <span v-if="t.eta != null" class="mono">剩余 {{ fmtEta(t.eta) }}</span>
              <span v-if="t.detail" class="detail">{{ t.detail }}</span>
            </div>
            <ProgressBar v-if="activeState(t.state)" :value="t.progress" style="margin-top: 6px" />
            <div v-if="t.error" class="task-error">{{ t.error }}</div>
          </div>
          <div class="task-actions">
            <template v-if="t.state === 'downloading' || t.state === 'merging' || t.state === 'distributing' || t.state === 'resolving'">
              <button class="icon-btn" title="暂停" @click="pause(t.id)"><MdIcon name="pause" :size="15" /></button>
              <button class="icon-btn" title="取消" @click="cancel(t.id)"><MdIcon name="close" :size="15" /></button>
            </template>
            <template v-else-if="t.state === 'paused'">
              <button class="icon-btn" title="继续" @click="resume(t.id)"><MdIcon name="play" :size="15" /></button>
              <button class="icon-btn" title="取消" @click="cancel(t.id)"><MdIcon name="close" :size="15" /></button>
            </template>
            <template v-else-if="t.state === 'failed'">
              <button class="icon-btn" title="重试" @click="retry(t.id)"><MdIcon name="refresh" :size="15" /></button>
              <button class="icon-btn" title="取消" @click="cancel(t.id)"><MdIcon name="close" :size="15" /></button>
            </template>
            <template v-else-if="t.state === 'completed'">
              <button v-if="t.outputPaths?.[0]" class="icon-btn" title="播放" @click="play(t)"><MdIcon name="play" :size="15" /></button>
              <button class="icon-btn" title="打开所在文件夹" @click="showInFolder(t)"><MdIcon name="folderOpen" :size="16" /></button>
            </template>
            <template v-else-if="t.state === 'pending'">
              <button class="icon-btn" title="上移" @click="queueMove(t.id, 'up')"><MdIcon name="arrowUp" :size="15" /></button>
              <button class="icon-btn" title="下移" @click="queueMove(t.id, 'down')"><MdIcon name="arrowDown" :size="15" /></button>
              <button class="icon-btn" title="取消" @click="cancel(t.id)"><MdIcon name="close" :size="15" /></button>
            </template>
          </div>
        </div>
      </div>

      <Pagination
        v-if="store.tasks.length > 0"
        :page="queuePage"
        :total="store.tasks.length"
        :page-size="queuePageSize"
        :page-size-options="true"
        :size-choices="[5, 10, 20, 30, 50]"
        @update:page="queuePage = $event"
        @update:page-size="onQueuePageSize"
      />
    </section>

    <!-- 历史 -->
    <section class="card">
      <div class="row-between">
        <h3 class="section-title">下载历史</h3>
        <button class="btn btn-text btn-sm" @click="clearHistory">清空历史</button>
      </div>
      <div v-if="store.history.length === 0" class="empty">
        <MdIcon name="history" :size="36" class="empty-icon" />
        <div>暂无历史记录</div>
      </div>
      <div v-else class="hist-list">
        <div v-for="h in pagedHistory" :key="h.id" class="hist-item row-between">
          <div class="hist-info">
            <div class="task-title">{{ h.title || h.input.source }}</div>
            <div class="task-sub">
              <span class="chip" :class="'st-' + h.state">{{ stateLabel(h.state) }}</span>
              <span v-if="h.size" class="mono">{{ fmtSize(h.size) }}</span>
              <span class="mono">{{ fmtTime(h.finishedAt) }}</span>
            </div>
          </div>
          <div class="row" style="gap: 4px">
            <button v-if="h.outputPaths?.[0]" class="icon-btn" title="播放" @click="playPath(h.outputPaths[0])">
              <MdIcon name="play" :size="15" />
            </button>
            <button v-if="h.outputPaths?.[0]" class="icon-btn" title="打开所在文件夹" @click="showFolder(h.outputPaths[0])">
              <MdIcon name="folderOpen" :size="16" />
            </button>
            <button class="icon-btn" title="重新下载" @click="requeue(h.id)"><MdIcon name="refresh" :size="15" /></button>
          </div>
        </div>
      </div>

      <Pagination
        v-if="store.history.length > 0"
        :page="historyPage"
        :total="store.history.length"
        :page-size="downloadHistoryPageSize"
        :page-size-options="true"
        :size-choices="[5, 10, 20, 30, 50]"
        @update:page="historyPage = $event"
        @update:page-size="onHistoryPageSize"
      />
    </section>

    <!-- 合集确认弹窗（C3） -->
    <div v-if="collectionPrompt" class="modal-mask">
      <div class="modal">
        <h3>检测到合集</h3>
        <p style="margin: 12px 0">
          当前收藏夹内视频属于合集「<strong>{{ collectionPrompt.name }}</strong>」（共 {{ collectionPrompt.count }} 个视频）。
          是否同时下载合集内全部？
        </p>
        <div class="row" style="justify-content: flex-end; gap: 8px">
          <button class="btn btn-text" @click="confirmCollection(false)">仅下载收藏夹内容</button>
          <button class="btn" @click="confirmCollection(true)">同时下载合集全部</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import type { ContentType, DownloadOptions, PreviewItem, QualityLevel, TaskSnapshot } from '@shared/types'
import { store, toast, updateSettings } from '../store/app'
import { playMedia } from '../player'
import ProgressBar from '../components/ProgressBar.vue'
import ToggleSwitch from '../components/ToggleSwitch.vue'
import MdIcon from '../components/MdIcon.vue'
import MdSelect from '../components/MdSelect.vue'
import MdTabs from '../components/MdTabs.vue'
import Pagination from '../components/Pagination.vue'
import { resolveOutputTemplate } from '@shared/template'

const inputText = ref('')
const collectionPrompt = ref<{ name: string; count: number } | null>(null)

/** 解析预览 */
const previewItems = ref<PreviewItem[]>([])
const selected = ref<Set<string>>(new Set())
const parsing = ref(false)
const failedCovers = ref<Set<string>>(new Set())

const form = reactive({
  content: 'both' as ContentType,
  quality: 1080 as QualityLevel,
  fullDownload: false,
  /** 单选的目标目录（默认取设置里的主目标 = destinations[0]） */
  dest: '',
  /** 是否把同一文件同时分发到设置里的全部目标地址（默认关闭 → 只下到一个文件夹） */
  distributeAll: false,
  distributionParallel: false
})

const contentOptions = [
  { value: 'audio', label: '仅音频' },
  { value: 'video', label: '仅视频' },
  { value: 'both', label: '音视频' }
]

const destinations = computed(() => store.settings?.destinations ?? [])

/**
 * 设置里的目标地址变化时，让「下载到」始终指向一个有效目录（默认主目标）。
 * 注意：必须声明在 destinations 之后 —— 若写在前面，immediate:true 会立刻求值，
 * 触发 TDZ（Cannot access 'destinations' before initialization），导致整个页面白屏。
 */
watch(
  destinations,
  (list) => {
    if (!list || list.length === 0) {
      form.dest = ''
      return
    }
    if (!form.dest || !list.includes(form.dest)) form.dest = list[0]
    if (list.length < 2) form.distributeAll = false
  },
  { immediate: true }
)
const qualityOptions = [
  { label: '360P', value: 360 },
  { label: '480P', value: 480 },
  { label: '720P', value: 720 },
  { label: '1080P', value: 1080 }
]
const destOptions = computed(() => destinations.value.map((d) => ({ label: shortName(d), value: d })))
const canStart = computed(() => inputText.value.trim().length > 0)
const selectedCount = computed(() => selected.value.size)
const previewTotalSize = computed(() => previewItems.value.reduce((sum, i) => sum + (i.size ?? 0), 0))

/** 目录模式 → 预览保存位置（让「同目录 / 作者隔离 / 自定义」可见可验证） */
const savePreview = computed(() => {
  const s = store.settings
  const dir = form.dest || s?.destinations?.[0] || ''
  if (!dir) return '请先在设置中添加下载目标'
  const rel = s ? resolveOutputTemplate(s) : '{title}.{ext}'
  return `${dir}\\${rel}`
})

const runningCount = computed(
  () => store.tasks.filter((t) => ['pending', 'downloading', 'merging', 'distributing', 'resolving', 'paused'].includes(t.state)).length
)

// ---------- 任务队列 / 下载历史 分页 ----------
const queuePage = ref(1)
const historyPage = ref(1)

const queuePageSize = computed(() => store.settings?.queuePageSize ?? 10)
const downloadHistoryPageSize = computed(() => store.settings?.downloadHistoryPageSize ?? 10)

const pagedTasks = computed(() => {
  const size = queuePageSize.value
  const start = (queuePage.value - 1) * size
  return store.tasks.slice(start, start + size)
})

const pagedHistory = computed(() => {
  const size = downloadHistoryPageSize.value
  const start = (historyPage.value - 1) * size
  return store.history.slice(start, start + size)
})

/** 是否存在可清除的已结束任务（决定「清空历史」按钮是否可点） */
const hasFinished = computed(() =>
  store.tasks.some((t) => t.state === 'completed' || t.state === 'failed' || t.state === 'cancelled')
)

// 任务/历史数量变化后，页码可能越界，自动回到有效页
watch(
  () => store.tasks.length,
  (len) => {
    const max = Math.max(1, Math.ceil(len / queuePageSize.value))
    if (queuePage.value > max) queuePage.value = max
  }
)
watch(
  () => store.history.length,
  (len) => {
    const max = Math.max(1, Math.ceil(len / downloadHistoryPageSize.value))
    if (historyPage.value > max) historyPage.value = max
  }
)

function onQueuePageSize(size: number): void {
  queuePage.value = 1
  void updateSettings({ queuePageSize: size })
}

function onHistoryPageSize(size: number): void {
  historyPage.value = 1
  void updateSettings({ downloadHistoryPageSize: size })
}

async function clearQueueHistory(): Promise<void> {
  try {
    const tasks = await window.vd.queueClearFinished()
    if (Array.isArray(tasks)) store.tasks = tasks
    queuePage.value = 1
    toast('已清空队列中的历史任务')
  } catch (e) {
    toast(`清空失败：${e instanceof Error ? e.message : String(e)}`, 'error')
  }
}

function shortName(p: string): string {
  const parts = p.replace(/[\\/]+$/, '').split(/[\\/]/)
  return parts[parts.length - 1] || p
}

function goSettings(): void {
  store.view = 'settings'
}

/** 改变下载内容后，已有预览的大小估算失效，清空重解析 */
function onContentChange(v: string): void {
  form.content = v as ContentType
  if (previewItems.value.length > 0) clearPreview()
}

function buildInputs(): Array<{ source: string; kind: 'single' | 'favorite' | 'collection' }> {
  return inputText.value
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'))
    .map((l) => ({ source: l, kind: detectKind(l) }))
}

/** 先解析，把标题/作者/封面/大小呈现给用户 */
async function parsePreview(): Promise<void> {
  const inputs = buildInputs()
  if (inputs.length === 0) return
  parsing.value = true
  failedCovers.value = new Set()
  try {
    const res = await window.vd.previewSources(inputs, {
      content: form.content,
      quality: form.quality
    })
    previewItems.value = res.items ?? []
    // 默认全选可下载项
    const next = new Set<string>()
    for (const it of previewItems.value) if (!it.error) next.add(it.id)
    selected.value = next
    const failed = previewItems.value.filter((i) => i.error).length
    if (failed > 0) toast(`${failed} 个地址解析失败`, 'error')
    else toast(`解析到 ${previewItems.value.length} 个视频`, 'success')
  } catch (e) {
    toast(`解析失败: ${e instanceof Error ? e.message : String(e)}`, 'error')
  } finally {
    parsing.value = false
  }
}

function toggle(id: string): void {
  const next = new Set(selected.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  selected.value = next
}

function selectAll(on: boolean): void {
  const next = new Set<string>()
  if (on) for (const it of previewItems.value) if (!it.error) next.add(it.id)
  selected.value = next
}

function clearPreview(): void {
  previewItems.value = []
  selected.value = new Set()
  failedCovers.value = new Set()
}

function markFailed(id: string): void {
  const next = new Set(failedCovers.value)
  next.add(id)
  failedCovers.value = next
}

/** 远端封面走主进程 vdimg:// 代理（带 Referer），避免 CDN 拒绝直连 */
function coverSrc(url: string): string {
  return window.vd.imgUrl(url)
}

/** 把选中的解析结果加入下载队列 */
async function downloadSelected(): Promise<void> {
  const chosen = previewItems.value.filter((i) => selected.value.has(i.id) && !i.error)
  if (chosen.length === 0) return
  await enqueue(chosen.map((i) => ({ source: i.source, kind: i.kind })))
  clearPreview()
}

/** 不预览、直接下载（保留原路径，供批量文本快速使用） */
async function startDownload(): Promise<void> {
  const inputs = buildInputs()
  if (inputs.length === 0) return
  await enqueue(inputs)
}

async function enqueue(inputs: Array<{ source: string; kind: 'single' | 'favorite' | 'collection' }>): Promise<void> {
  const dest = form.dest || store.settings?.destinations?.[0] || ''
  // 默认只下载到「下载到」里选中的那一个目录；
  // 只有显式勾选「同时分发到全部目标地址」时才传多个目标，
  // 避免「我只选了一个文件夹，却同步到了其它已配置目录」。
  const dests =
    form.distributeAll && destinations.value.length > 0
      ? [...destinations.value]
      : dest
        ? [dest]
        : undefined
  const options: DownloadOptions = {
    content: form.content,
    quality: form.quality,
    fullDownload: form.fullDownload,
    destinations: dests,
    distribution: form.distributionParallel ? 'parallel' : 'copyAfter'
  }
  try {
    const result = await window.vd.enqueue(inputs, options)
    if (result?.collectionPrompt) {
      collectionPrompt.value = { name: result.collectionPrompt.name, count: result.collectionPrompt.count }
    }
    if (result?.taskIds?.length) {
      toast(`已添加 ${result.taskIds.length} 个任务`, 'success')
      inputText.value = ''
    }
  } catch (e) {
    toast(`添加任务失败: ${e instanceof Error ? e.message : String(e)}`, 'error')
  }
}

function detectKind(line: string): 'single' | 'favorite' | 'collection' {
  // 仅识别路径中的收藏夹/合集标识，避免 query 参数中偶然出现 favlist/medialist 导致误判
  if (/\/favlist|\/medialist|list\?fid=/.test(line)) return 'favorite'
  if (/\/collection|\/channel|\/medialist\/play/.test(line) && !/\/video\//.test(line)) return 'collection'
  return 'single'
}

async function importTxt(): Promise<void> {
  const files = await window.vd.openFile({ filters: [{ name: '文本文件', extensions: ['txt'] }] })
  if (files.length === 0) return
  const result = await window.vd.readTextFile(files[0])
  if (typeof result === 'string') {
    inputText.value = (inputText.value ? inputText.value + '\n' : '') + result
  } else {
    toast(`读取文件失败: ${result.error}`, 'error')
  }
}

function clearInput(): void {
  inputText.value = ''
  clearPreview()
}

async function confirmCollection(includeAll: boolean): Promise<void> {
  collectionPrompt.value = null
  const result = await window.vd.confirmCollection(includeAll)
  if (result?.taskIds?.length) {
    toast(includeAll ? '已加入合集全部视频' : '仅下载收藏夹内容', 'success')
  }
}

function pause(id: string): void {
  void window.vd.pause(id)
}
function resume(id: string): void {
  void window.vd.resume(id)
}
function cancel(id: string): void {
  void window.vd.cancel(id)
}
function retry(id: string): void {
  void window.vd.retry(id)
}
function clearPending(): void {
  void window.vd.queueClear()
  toast('已清空排队任务')
}
function clearHistory(): void {
  void window.vd.clearHistory()
  store.history = []
}
function requeue(id: string): void {
  void window.vd.requeue(id)
}
function queueMove(id: string, dir: 'up' | 'down'): void {
  void window.vd.queueMove(id, dir)
}
function showInFolder(t: TaskSnapshot): void {
  const p = t.outputPaths?.[0]
  if (p) void window.vd.showInFolder(p)
}
function showFolder(p: string): void {
  void window.vd.showInFolder(p)
}
function play(t: TaskSnapshot): void {
  const p = t.outputPaths?.[0]
  if (p) void playMedia(p)
}
function playPath(p: string): void {
  void playMedia(p)
}

function activeState(s: string): boolean {
  return ['downloading', 'merging', 'distributing', 'resolving'].includes(s)
}

function stateLabel(s: string): string {
  const map: Record<string, string> = {
    pending: '排队中',
    resolving: '解析中',
    downloading: '下载中',
    merging: '合并中',
    distributing: '分发中',
    completed: '已完成',
    failed: '失败',
    paused: '已暂停',
    cancelled: '已取消'
  }
  return map[s] ?? s
}

function fmtSize(n: number | undefined): string {
  if (n == null || n <= 0) return ''
  if (n >= 1024 ** 3) return (n / 1024 ** 3).toFixed(2) + ' GB'
  if (n >= 1024 ** 2) return (n / 1024 ** 2).toFixed(1) + ' MB'
  return Math.round(n / 1024) + ' KB'
}

function fmtDur(sec: number): string {
  if (!sec) return ''
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = Math.floor(sec % 60)
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`
}

function fmtEta(sec: number): string {
  if (sec < 60) return sec + 's'
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}m${String(s).padStart(2, '0')}s`
}

function fmtTime(ts: number | undefined): string {
  if (!ts) return ''
  const d = new Date(ts)
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}
</script>

<style scoped>
.download-view {
  display: flex;
  flex-direction: column;
  gap: 16px;
  max-width: 1000px;
}

/* 说明：.section-title / .hint / .seg / .seg-btn / .opt-label / .mono / .st-* 统一在 styles/ 目录 */
.input-card .options {
  display: grid;
  grid-template-columns: 1fr 160px 1fr;
  gap: 16px;
  margin-top: 12px;
}

@media (max-width: 800px) {
  .input-card .options {
    grid-template-columns: 1fr;
  }
}

/* ---- 解析预览 ---- */
.preview {
  margin-top: 14px;
  border-top: 1px solid var(--md-outline-variant);
  padding-top: 12px;
}

.preview-head {
  margin-bottom: 10px;
  flex-wrap: wrap;
  gap: 8px;
}

.pv-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: 10px;
  max-height: 460px;
  overflow-y: auto;
  padding: 2px;
}

.pv-card {
  border-radius: var(--md-radius-sm);
  background: var(--md-surface-container-low);
  overflow: hidden;
  cursor: pointer;
  border: 2px solid transparent;
  transition: border-color 0.18s, opacity 0.18s;
}

.pv-card.selected {
  border-color: var(--md-primary);
}

.pv-card.failed {
  opacity: 0.6;
  cursor: not-allowed;
}

.pv-thumb {
  position: relative;
  width: 100%;
  aspect-ratio: 16/10;
  background: var(--md-outline-variant);
  overflow: hidden;
}

.pv-thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.pv-thumb-ph {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0.45;
}

.pv-dur {
  position: absolute;
  right: 6px;
  bottom: 6px;
  background: rgba(0, 0, 0, 0.72);
  color: #fff;
  font-size: 11px;
  padding: 1px 5px;
  border-radius: 3px;
}

.pv-check {
  position: absolute;
  left: 6px;
  top: 6px;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(255, 255, 255, 0.85);
  color: #333;
  opacity: 0;
  transition: opacity 0.18s;
}

.pv-card.selected .pv-check {
  opacity: 1;
  background: var(--md-primary);
  color: var(--md-on-primary);
}

.pv-info {
  padding: 8px 10px 10px;
}

.pv-title {
  font-size: 12px;
  line-height: 1.3;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  min-height: 32px;
}

.pv-sub {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  color: var(--md-on-surface-variant);
  margin-top: 3px;
  overflow: hidden;
  white-space: nowrap;
}

.pv-uploader,
.pv-parent {
  overflow: hidden;
  text-overflow: ellipsis;
}

.pv-parent {
  flex-shrink: 0;
  max-width: 50%;
}

.pv-err {
  margin-top: 4px;
  font-size: 11px;
  color: var(--md-error);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* ---- 任务 / 历史 ---- */
.task-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 10px;
}

.task-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  border: 1px solid var(--md-outline-variant);
  border-radius: var(--md-radius-sm);
}

.task-main {
  flex: 1;
  min-width: 0;
}

.task-title {
  font-size: 13px;
  font-weight: 500;
  display: flex;
  align-items: center;
  gap: 8px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.task-sub {
  display: flex;
  gap: 10px;
  font-size: 12px;
  color: var(--md-on-surface-variant);
  margin-top: 2px;
  flex-wrap: wrap;
}

.detail {
  color: var(--md-on-surface-variant);
}

.task-error {
  color: var(--md-error);
  font-size: 12px;
  margin-top: 4px;
  word-break: break-all;
}

.task-actions {
  display: flex;
  gap: 2px;
  flex-shrink: 0;
}

.hist-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 10px;
}

.hist-item {
  padding: 8px 10px;
  border-radius: var(--md-radius-sm);
  background: var(--md-surface-container-low);
}

.hist-info {
  min-width: 0;
}

.hist-info .task-title {
  max-width: 420px;
}
</style>
