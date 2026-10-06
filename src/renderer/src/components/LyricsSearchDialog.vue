<template>
  <div v-if="open" class="modal-mask" @click.self="close">
    <div class="modal lyric-modal">
      <div class="row-between">
        <h3>在线搜索歌词</h3>
        <button class="icon-btn" title="关闭" @click="close"><MdIcon name="close" :size="16" /></button>
      </div>
      <p class="hint" style="margin: 4px 0 12px">
        输入歌曲名 / 歌手，从结果中挑选后自动导入歌词（标准 LRC，带时间轴）。
      </p>

      <div class="row" style="gap: 8px">
        <input
          ref="inputEl"
          v-model="keyword"
          class="input"
          style="flex: 1"
          placeholder="例如：海阔天空 Beyond"
          @keydown.enter="doSearch"
        />
        <button class="btn btn-sm" :disabled="!keyword.trim() || loading" @click="doSearch">
          <MdIcon name="search" :size="14" /> {{ loading ? '搜索中…' : '搜索' }}
        </button>
      </div>

      <div v-if="error" class="hero-error">{{ error }}</div>

      <div v-if="loading" class="empty" style="padding: 28px">
        <MdIcon name="refresh" :size="28" class="empty-icon spinner" />
        <div>正在搜索…</div>
      </div>
      <div v-else-if="results.length === 0 && searched" class="empty" style="padding: 28px">
        <MdIcon name="lyric" :size="28" class="empty-icon" />
        <div>没有搜到结果，换个关键词试试</div>
      </div>
      <div v-else-if="results.length > 0" class="lyric-list">
        <button
          v-for="(r, i) in results"
          :key="r.id"
          class="lyric-row"
          :class="{ alt: i % 2 === 1, busy: pickingId === r.id }"
          :disabled="pickingId != null"
          @click="pick(r)"
        >
          <div class="lyric-main">
            <div class="lyric-title">
              {{ r.title }}
              <span v-if="pickingId === r.id" class="chip">导入中…</span>
            </div>
            <div class="lyric-sub">
              <span v-if="r.artist"><MdIcon name="person" :size="11" /> {{ r.artist }}</span>
              <span v-if="r.album">《{{ r.album }}》</span>
            </div>
          </div>
          <span class="mono lyric-dur">{{ fmtDur(r.duration) }}</span>
          <MdIcon name="download" :size="15" class="lyric-ic" />
        </button>
      </div>

      <div class="row" style="justify-content: flex-end; margin-top: 14px">
        <span class="hint" style="flex: 1">歌词来源：网易云音乐公开接口</span>
        <button class="btn btn-text" @click="close">取消</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
import type { LyricLine, LyricSearchItem } from '@shared/types'
import { toast } from '../store/app'
import MdIcon from './MdIcon.vue'

const props = withDefaults(
  defineProps<{ open: boolean; initialKeyword?: string }>(),
  { initialKeyword: '' }
)

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'pick', lines: LyricLine[]): void
}>()

const inputEl = ref<HTMLInputElement | null>(null)
const keyword = ref('')
const results = ref<LyricSearchItem[]>([])
const loading = ref(false)
const searched = ref(false)
const error = ref('')
const pickingId = ref<number | null>(null)

// 打开时用当前媒体标题预填关键词，并自动搜一次
watch(
  () => props.open,
  async (open) => {
    if (!open) return
    error.value = ''
    pickingId.value = null
    searched.value = false
    results.value = []
    keyword.value = (props.initialKeyword ?? '').trim()
    await nextTick()
    inputEl.value?.focus()
    if (keyword.value) void doSearch()
  }
)

async function doSearch(): Promise<void> {
  const kw = keyword.value.trim()
  if (!kw || loading.value) return
  loading.value = true
  error.value = ''
  searched.value = false
  try {
    const res = await window.vd.searchLyrics(kw, 20)
    if (!res.ok) {
      error.value = res.error ?? '搜索失败'
      results.value = []
    } else {
      results.value = res.items ?? []
    }
  } catch (e) {
    error.value = `搜索失败：${e instanceof Error ? e.message : String(e)}`
    results.value = []
  } finally {
    loading.value = false
    searched.value = true
  }
}

async function pick(item: LyricSearchItem): Promise<void> {
  if (pickingId.value != null) return
  pickingId.value = item.id
  try {
    const res = await window.vd.fetchLyric(item.id)
    if (!res.ok || !res.lines?.length) {
      toast(res.error ?? '该曲目暂无可用歌词', 'error')
      return
    }
    emit('pick', res.lines as LyricLine[])
    toast(`已导入 ${res.lines.length} 行歌词（${item.title}）`, 'success')
  } catch (e) {
    toast(`导入失败：${e instanceof Error ? e.message : String(e)}`, 'error')
  } finally {
    pickingId.value = null
  }
}

function close(): void {
  emit('close')
}

function fmtDur(sec: number): string {
  if (!sec) return ''
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}
</script>

<style scoped>
.lyric-modal {
  width: min(560px, 100%);
}

.hero-error {
  margin-top: 10px;
  padding: 8px 12px;
  border-radius: var(--md-radius-sm);
  background: color-mix(in srgb, var(--md-error) 12%, transparent);
  color: var(--md-error);
  font-size: 12px;
}

.lyric-list {
  margin-top: 12px;
  max-height: 320px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  border-radius: var(--md-radius-sm);
  overflow-x: hidden;
}

.lyric-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 12px;
  border: none;
  background: var(--md-surface-container-low);
  color: var(--md-on-surface);
  font-family: inherit;
  text-align: left;
  cursor: pointer;
  transition: background 0.15s;
}

.lyric-row.alt {
  background: var(--md-surface-container-highest);
}

.lyric-row:hover:not(:disabled) {
  background: var(--md-secondary-container);
}

.lyric-row.busy {
  opacity: 0.7;
}

.lyric-main {
  flex: 1;
  min-width: 0;
}

.lyric-title {
  font-size: 13px;
  font-weight: 500;
  display: flex;
  align-items: center;
  gap: 8px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.lyric-sub {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 11px;
  color: var(--md-on-surface-variant);
  margin-top: 3px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.lyric-sub span {
  display: inline-flex;
  align-items: center;
  gap: 3px;
}

.lyric-dur {
  color: var(--md-on-surface-variant);
  flex-shrink: 0;
}

.lyric-ic {
  color: var(--md-primary);
  flex-shrink: 0;
}

.spinner {
  animation: spin 0.8s linear infinite;
}
</style>
