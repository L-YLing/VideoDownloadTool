<template>
  <div class="syslog-view">
    <section class="card">
      <div class="row-between" style="flex-wrap: wrap; gap: 8px">
        <h3 class="section-title" style="margin-bottom: 0">
          <MdIcon name="list" :size="17" /> 系统日志
        </h3>
        <div class="row" style="gap: 6px">
          <button class="btn btn-text btn-sm" :disabled="loading" @click="load(page)">
            <MdIcon name="refresh" :size="15" /> 刷新
          </button>
          <button class="btn btn-text btn-sm" @click="openLogsDir">
            <MdIcon name="folderOpen" :size="15" /> 软件日志目录
          </button>
        </div>
      </div>

      <!-- 分类：软件日志 + Windows 事件日志 -->
      <div class="cat-row">
        <MdTabs v-model="channel" :tabs="channelTabs" />
      </div>

      <!-- 过滤：关键词 + 级别 -->
      <div class="filter-bar">
        <div class="search">
          <MdIcon name="search" :size="15" />
          <input v-model="keyword" class="search-input" placeholder="筛选来源 / 内容" />
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
          <MdSelect v-model="pageSize" :options="pageSizeOptions" />
        </div>
      </div>

      <div class="log-stat mono">
        <span v-if="total > 0">第 {{ page }} / {{ totalPages }} 页 · 共 {{ total }} 条</span>
        <span v-else>暂无数据</span>
        <span v-if="error" class="err"> · {{ error }}</span>
      </div>

      <!-- 列表：内部滚动；文本可选中复制 -->
      <div class="log-list selectable">
        <div v-if="loading && entries.length === 0" class="empty" style="padding: 36px">
          <MdIcon name="refresh" :size="28" class="empty-icon spinner" />
          <div>正在读取日志…</div>
        </div>
        <div v-else-if="filtered.length === 0" class="empty" style="padding: 36px">
          <MdIcon name="list" :size="34" class="empty-icon" />
          <div>{{ entries.length === 0 ? '暂无日志' : '没有匹配的日志' }}</div>
        </div>
        <template v-else>
          <div v-for="(e, i) in filtered" :key="e.id" class="log-row" :class="{ alt: i % 2 === 1 }">
            <span class="log-time mono">{{ fmtTime(e.time) }}</span>
            <span class="log-level" :class="e.level">{{ levelLabel(e.level) }}</span>
            <span class="log-scope" :title="e.scope">{{ e.scope }}</span>
            <span class="log-msg">{{ e.message }}</span>
          </div>
        </template>
      </div>

      <Pagination
        :page="page"
        :total="total"
        :page-size="pageSize"
        :total-pages="totalPages"
        :has-more="hasMore"
        :disabled="loading"
        always-show
        @update:page="load"
      />
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { toast } from '../store/app'
import MdIcon from '../components/MdIcon.vue'
import MdTabs from '../components/MdTabs.vue'
import MdSelect from '../components/MdSelect.vue'
import Pagination from '../components/Pagination.vue'

type Level = 'success' | 'info' | 'warn' | 'error'
interface Row {
  id: string
  time: number
  level: Level
  scope: string
  message: string
}

const channels = ref<Array<{ id: string; label: string; source: 'app' | 'system'; needsAdmin?: boolean }>>([])
const channel = ref('app')
const entries = ref<Row[]>([])
const total = ref(0)
const page = ref(1)
const pageSize = ref(50)
const hasMore = ref(false)
const loading = ref(false)
const error = ref('')
const keyword = ref('')
const levelFilter = ref<Set<Level>>(new Set(['success', 'info', 'warn', 'error']))

const channelTabs = computed(() => channels.value.map((c) => ({ label: c.label, value: c.id })))
const totalPages = computed(() => Math.max(1, Math.ceil(total.value / Math.max(1, pageSize.value))))

const levels: Array<{ value: Level; label: string }> = [
  { value: 'success', label: '成功' },
  { value: 'info', label: '信息' },
  { value: 'warn', label: '警告' },
  { value: 'error', label: '错误' }
]
const pageSizeOptions = [
  { label: '每页 30', value: 30 },
  { label: '每页 50', value: 50 },
  { label: '每页 100', value: 100 },
  { label: '每页 200', value: 200 }
]

const filtered = computed(() => {
  const k = keyword.value.trim().toLowerCase()
  return entries.value.filter((e) => {
    if (!levelFilter.value.has(e.level)) return false
    if (!k) return true
    return e.scope.toLowerCase().includes(k) || e.message.toLowerCase().includes(k)
  })
})

onMounted(async () => {
  try {
    channels.value = await window.vd.systemLogChannels()
  } catch {
    channels.value = [{ id: 'app', label: '程序日志', source: 'app' }]
  }
  await load(1)
})

// 切分类 / 改每页条数 → 回到第一页重载
watch([channel, pageSize], () => void load(1))

async function load(p = 1): Promise<void> {
  loading.value = true
  error.value = ''
  try {
    const res = await window.vd.systemLog(channel.value, p, pageSize.value)
    entries.value = (res.entries ?? []) as Row[]
    total.value = res.total ?? 0
    hasMore.value = Boolean(res.hasMore)
    page.value = res.page ?? p
    if (!res.ok && res.error) error.value = res.error
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
    entries.value = []
  } finally {
    loading.value = false
  }
}

function toggleLevel(lv: Level): void {
  const next = new Set(levelFilter.value)
  if (next.has(lv)) next.delete(lv)
  else next.add(lv)
  levelFilter.value = next
}

async function openLogsDir(): Promise<void> {
  const dir = await window.vd.openLogsDir()
  toast(`软件日志目录：${dir}`)
}

function levelLabel(lv: Level): string {
  return { success: '成功', info: '信息', warn: '警告', error: '错误' }[lv] ?? lv
}

function fmtTime(ts: number): string {
  if (!ts) return '—'
  const d = new Date(ts)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}
</script>

<style scoped>
.syslog-view {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.cat-row {
  margin-top: 12px;
  overflow-x: auto;
  padding-bottom: 2px;
}

.cat-row :deep(.md-tabs) {
  min-width: max-content;
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

.log-stat .err {
  color: var(--md-error);
}

.log-list {
  display: flex;
  flex-direction: column;
  border-radius: var(--md-radius-md);
  overflow: hidden auto;
  max-height: 58vh;
}

.log-row {
  display: grid;
  grid-template-columns: 158px 52px 200px minmax(0, 1fr);
  gap: 10px;
  align-items: baseline;
  padding: 6px 10px;
  font-size: 12px;
  background: var(--md-surface-container-low);
}

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
  word-break: break-word;
  white-space: pre-wrap;
}

.spinner {
  animation: spin 0.8s linear infinite;
}

@media (max-width: 900px) {
  .log-row {
    grid-template-columns: 130px 46px minmax(0, 1fr);
  }
  .log-scope {
    display: none;
  }
}
</style>
