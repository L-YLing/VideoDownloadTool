<template>
  <div class="logs-view">
    <section class="card">
      <div class="row-between">
        <h3 class="section-title" style="margin-bottom: 0">
          <MdIcon name="list" :size="17" /> 日志
        </h3>
        <div class="row" style="gap: 6px">
          <MdTabs v-model="kind" :tabs="kindTabs" />
        </div>
      </div>

      <!-- 过滤栏（只读查看，不做编辑） -->
      <div class="filter-bar">
        <div class="search">
          <MdIcon name="search" :size="15" />
          <input v-model="keyword" class="search-input" placeholder="筛选关键词（模块 / 内容）" />
          <button v-if="keyword" class="icon-btn" title="清除筛选" @click="keyword = ''">
            <MdIcon name="close" :size="14" />
          </button>
        </div>
        <div class="level-chips">
          <button
            v-for="lv in levels"
            :key="lv.value"
            class="chip level-chip"
            :class="[lv.value, { off: !levelFilter.has(lv.value) }]"
            @click="toggleLevel(lv.value)"
          >
            {{ lv.label }}
          </button>
        </div>
        <div class="row" style="gap: 6px; margin-left: auto">
          <MdSelect v-model="limit" :options="limitOptions" />
          <button class="btn btn-text btn-sm" :disabled="loading" @click="load">
            <MdIcon name="refresh" :size="15" /> 刷新
          </button>
          <button class="btn btn-text btn-sm" @click="openDir">
            <MdIcon name="folderOpen" :size="15" /> 日志目录
          </button>
          <button class="btn btn-secondary btn-sm" :disabled="entries.length === 0" @click="clear">
            <MdIcon name="close" :size="15" /> 清空
          </button>
        </div>
      </div>

      <div class="log-stat mono">
        共 {{ page.total }} 条，显示最近 {{ entries.length }} 条（只读，不可编辑）
      </div>

      <!-- 日志列表：相邻两条不同底色区分 -->
      <div v-if="loading && entries.length === 0" class="empty" style="padding: 40px">
        <MdIcon name="refresh" :size="30" class="empty-icon spinner" />
        <div>正在读取日志…</div>
      </div>
      <div v-else-if="filtered.length === 0" class="empty" style="padding: 40px">
        <MdIcon name="list" :size="36" class="empty-icon" />
        <div>{{ entries.length === 0 ? '暂无日志' : '没有匹配的日志' }}</div>
      </div>
      <div v-else class="log-list">
        <div v-for="(e, i) in filtered" :key="e.id" class="log-row" :class="{ alt: i % 2 === 1 }">
          <span class="log-time mono">{{ fmtTime(e.time) }}</span>
          <span class="log-level" :class="e.level">{{ levelLabel(e.level) }}</span>
          <span class="log-scope">{{ e.scope }}</span>
          <span class="log-msg">{{ e.message }}</span>
        </div>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import type { LogEntry, LogKind, LogLevel } from '@shared/types'
import { toast } from '../store/app'
import MdIcon from '../components/MdIcon.vue'
import MdTabs from '../components/MdTabs.vue'
import MdSelect from '../components/MdSelect.vue'

const kind = ref<LogKind>('download')
const entries = ref<LogEntry[]>([])
const page = ref<{ entries: LogEntry[]; total: number }>({ entries: [], total: 0 })
const loading = ref(false)
const keyword = ref('')
const limit = ref(500)
const levelFilter = ref<Set<LogLevel>>(new Set(['info', 'warn', 'error', 'success']))

const kindTabs = [
  { label: '下载日志', value: 'download', icon: 'download' },
  { label: '软件日志', value: 'app', icon: 'settings' }
]
const levels: Array<{ value: LogLevel; label: string }> = [
  { value: 'success', label: '成功' },
  { value: 'info', label: '信息' },
  { value: 'warn', label: '警告' },
  { value: 'error', label: '错误' }
]
const limitOptions = [
  { label: '最近 200 条', value: 200 },
  { label: '最近 500 条', value: 500 },
  { label: '最近 1000 条', value: 1000 }
]

const filtered = computed(() => {
  const k = keyword.value.trim().toLowerCase()
  return entries.value.filter((e) => {
    if (!levelFilter.value.has(e.level)) return false
    if (!k) return true
    return e.scope.toLowerCase().includes(k) || e.message.toLowerCase().includes(k)
  })
})

onMounted(() => void load())

// 切换日志类型 / 条数自动重新加载
async function load(): Promise<void> {
  loading.value = true
  try {
    const res = await window.vd.getLogs(kind.value, limit.value)
    page.value = res
    entries.value = res?.entries ?? []
  } finally {
    loading.value = false
  }
}

function toggleLevel(lv: LogLevel): void {
  const next = new Set(levelFilter.value)
  if (next.has(lv)) next.delete(lv)
  else next.add(lv)
  levelFilter.value = next
}

async function clear(): Promise<void> {
  await window.vd.clearLogs(kind.value)
  entries.value = []
  page.value = { entries: [], total: 0 }
  toast(`已清空${kind.value === 'download' ? '下载' : '软件'}日志`)
}

async function openDir(): Promise<void> {
  const dir = await window.vd.openLogsDir()
  toast(`日志目录：${dir}`)
}

function levelLabel(lv: LogLevel): string {
  return { success: '成功', info: '信息', warn: '警告', error: '错误' }[lv] ?? lv
}

function fmtTime(ts: number): string {
  const d = new Date(ts)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}
</script>

<style scoped>
.logs-view {
  display: flex;
  flex-direction: column;
  gap: 16px;
  max-width: 1180px;
}

.filter-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  margin-top: 12px;
}

.search {
  display: flex;
  align-items: center;
  gap: 6px;
  height: var(--md-control-h);
  padding: 0 8px;
  border: 1px solid var(--md-outline-variant);
  border-radius: var(--md-radius-sm);
  background: var(--md-surface-container-low);
  min-width: 220px;
  flex: 1;
}

.search-input {
  flex: 1;
  min-width: 0;
  border: none;
  outline: none;
  background: transparent;
  color: var(--md-on-surface);
  font-family: inherit;
  font-size: 13px;
}

.level-chips {
  display: flex;
  gap: 6px;
}

.level-chip {
  border: none;
  cursor: pointer;
  font-family: inherit;
  transition: opacity 0.16s;
}

.level-chip.off {
  opacity: 0.35;
  text-decoration: line-through;
}

.log-stat {
  font-size: 11px;
  color: var(--md-on-surface-variant);
  margin: 10px 2px 6px;
}

.log-list {
  display: flex;
  flex-direction: column;
  border-radius: var(--md-radius-md);
  overflow: hidden;
  max-height: 62vh;
  overflow-y: auto;
}

.log-row {
  display: grid;
  grid-template-columns: 160px 52px 72px minmax(0, 1fr);
  gap: 10px;
  align-items: baseline;
  padding: 6px 10px;
  font-size: 12px;
  background: var(--md-surface-container-low);
}

/* 相邻两项不同底色（ZorinOS 日志查看器风格） */
.log-row.alt {
  background: var(--md-surface-container-highest);
}

.log-time {
  color: var(--md-on-surface-variant);
  white-space: nowrap;
}

.log-level {
  font-size: 10px;
  font-weight: 700;
  text-align: center;
  padding: 1px 0;
  border-radius: 8px;
}

.log-level.info {
  background: color-mix(in srgb, var(--md-primary) 18%, transparent);
  color: var(--md-primary);
}

.log-level.success {
  background: color-mix(in srgb, var(--md-success) 18%, transparent);
  color: var(--md-success);
}

.log-level.warn {
  background: color-mix(in srgb, var(--md-warning) 20%, transparent);
  color: var(--md-warning);
}

.log-level.error {
  background: color-mix(in srgb, var(--md-error) 18%, transparent);
  color: var(--md-error);
}

.log-scope {
  color: var(--md-on-surface-variant);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.log-msg {
  word-break: break-all;
  white-space: pre-wrap;
}

.spinner {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

@media (max-width: 760px) {
  .log-row {
    grid-template-columns: 130px 46px minmax(0, 1fr);
  }
  .log-scope {
    display: none;
  }
}
</style>
