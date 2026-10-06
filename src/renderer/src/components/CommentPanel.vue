<template>
  <div class="comment-panel">
    <!-- 可滚动区：上下滚动查看当前页评论 -->
    <div ref="scrollEl" class="cp-scroll">
      <div v-if="loading" class="empty" style="padding: 28px">
        <MdIcon name="refresh" :size="26" class="empty-icon spinner" />
        <div>正在加载评论…</div>
      </div>
      <div v-else-if="error" class="empty" style="padding: 28px">
        <MdIcon name="warning" :size="26" class="empty-icon" />
        <div>{{ error }}</div>
      </div>
      <div v-else-if="items.length === 0" class="empty" style="padding: 28px">
        <MdIcon name="info" :size="26" class="empty-icon" />
        <div>{{ emptyText }}</div>
      </div>
      <template v-else>
        <div v-for="(c, i) in items" :key="c.rpid || i" class="c-row" :class="{ alt: i % 2 === 1 }">
          <div class="c-head">
            <span class="c-floor mono" :title="`第 ${floorOf(i)} 楼`">{{ floorOf(i) }}楼</span>
            <span class="c-user" :title="c.user">
              <MdIcon name="person" :size="11" />{{ c.user }}
            </span>
            <span v-if="c.like" class="c-stat" :title="`${c.like} 赞`">
              <MdIcon name="thumbUp" :size="11" />{{ c.like }}
            </span>
            <span v-if="c.replyCount" class="c-stat" :title="`共 ${c.replyCount} 条回复`">
              <MdIcon name="info" :size="11" />{{ c.replyCount }} 条回复
            </span>
            <span class="c-time">{{ relTime(c.time) }}</span>
          </div>

          <!-- 正文：过长默认折叠，「展开全文」可展开 -->
          <div class="c-text" :class="{ collapsed: isLong(c) && !expanded.has(rowKey(c, i)) }">{{ c.content }}</div>
          <button v-if="isLong(c)" class="c-more" @click="toggleExpand(rowKey(c, i))">
            <MdIcon :name="expanded.has(rowKey(c, i)) ? 'arrowUp' : 'arrowDown'" :size="13" />
            {{ expanded.has(rowKey(c, i)) ? '收起' : '展开全文' }}
          </button>

          <!-- 楼中楼：二级 / n 级回复与一级评论同区块显示 -->
          <div v-if="subsOf(c, i).length > 0 || canLoadSubs(c, i)" class="c-subs">
            <div v-for="(s, si) in subsOf(c, i)" :key="s.rpid || si" class="c-sub">
              <span class="c-sub-line"></span>
              <div class="c-sub-body">
                <div class="c-sub-head">
                  <span class="c-sub-user" :title="s.user">{{ s.user }}</span>
                  <span v-if="s.like" class="c-stat"><MdIcon name="thumbUp" :size="10" />{{ s.like }}</span>
                  <span class="c-time">{{ relTime(s.time) }}</span>
                </div>
                <div class="c-text c-sub-text">{{ s.content }}</div>
              </div>
            </div>
            <button v-if="canLoadSubs(c, i)" class="c-more" :disabled="subLoading.has(rowKey(c, i))" @click="loadSubs(c, i)">
              <MdIcon :name="subLoading.has(rowKey(c, i)) ? 'refresh' : 'arrowDown'" :size="13" :class="{ spinner: subLoading.has(rowKey(c, i)) }" />
              {{ subLoading.has(rowKey(c, i)) ? '加载中…' : `查看更多回复（还有 ${Math.max(0, (c.replyCount ?? 0) - subsOf(c, i).length)} 条）` }}
            </button>
          </div>
        </div>
      </template>
    </div>

    <!-- 分页条：固定在底部，不随评论滚动；只有一页时也显示，避免"找不到翻页按钮" -->
    <div class="cp-bar">
      <div class="cp-info mono">
        <span v-if="total > 0">第 {{ page }} / {{ totalPages }} 页 · 共 {{ total }} 条</span>
        <span v-else>暂无评论</span>
      </div>
      <Pagination
        :page="page"
        :total="total"
        :page-size="pageSize"
        :total-pages="totalPages"
        :has-more="hasMore"
        :disabled="loading"
        always-show
        @update:page="onPage"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import type { CommentItem } from '@shared/types'
import MdIcon from './MdIcon.vue'
import Pagination from './Pagination.vue'

const props = withDefaults(
  defineProps<{
    items: CommentItem[]
    total: number
    page: number
    pageSize: number
    hasMore?: boolean
    loading?: boolean
    error?: string
    emptyText?: string
    /** 在线评论的视频 aid（>0 时支持展开楼中楼） */
    aid?: number
    /** 长评论折叠阈值（字符数），默认 160 */
    foldAt?: number
  }>(),
  { hasMore: false, loading: false, error: '', emptyText: '暂无评论', aid: 0, foldAt: 160 }
)

const emit = defineEmits<{ (e: 'update:page', page: number): void }>()

const scrollEl = ref<HTMLElement | null>(null)

/** 已展开发全文的行 */
const expanded = reactive(new Set<string>())
/** 正在加载楼中楼的行 */
const subLoading = reactive(new Set<string>())
/** 行内已加载的楼中楼（在线按需加载；本地已在数据里） */
const loadedSubs = reactive(new Map<string, CommentItem[]>())
/** 每行楼中楼的下一页页码 */
const subPage = reactive(new Map<string, number>())

const totalPages = computed(() => Math.max(1, Math.ceil(props.total / Math.max(1, props.pageSize))))

/** 行唯一键：优先 rpid，否则用「页内下标」兜底 */
function rowKey(c: CommentItem, i: number): string {
  return c.rpid ? String(c.rpid) : `p${props.page}-${i}`
}

/** 楼层号：当前页内按顺序推导（B站新版接口不返回 floor 字段） */
function floorOf(i: number): number {
  return (props.page - 1) * props.pageSize + i + 1
}

/** 过长判定：字符数超阈值或换行过多 */
function isLong(c: CommentItem): boolean {
  const text = c.content ?? ''
  return text.length > props.foldAt || (text.match(/\n/g)?.length ?? 0) > 5
}

function toggleExpand(key: string): void {
  if (expanded.has(key)) expanded.delete(key)
  else expanded.add(key)
}

/** 当前行要展示的楼中楼（本地已归位 / 在线已加载） */
function subsOf(c: CommentItem, i: number): CommentItem[] {
  const key = rowKey(c, i)
  return loadedSubs.get(key) ?? c.subReplies ?? []
}

/** 是否还能继续加载楼中楼 */
function canLoadSubs(c: CommentItem, i: number): boolean {
  if (!props.aid || !c.rpid) return false
  const shown = subsOf(c, i).length
  return (c.replyCount ?? 0) > shown || c.subHasMore === true
}

/** 展开楼中楼：按需拉取下一页并追加到该一级评论下 */
async function loadSubs(c: CommentItem, i: number): Promise<void> {
  const key = rowKey(c, i)
  if (subLoading.has(key) || !props.aid || !c.rpid) return
  subLoading.add(key)
  try {
    const nextPage = (subPage.get(key) ?? 0) + 1
    const res = await window.vd.exploreSubReplies(props.aid, String(c.rpid), nextPage, 10)
    if (!res.ok) return
    const prev = loadedSubs.get(key) ?? c.subReplies ?? []
    const merged = [...prev, ...((res.items ?? []) as CommentItem[])]
    loadedSubs.set(key, merged)
    subPage.set(key, nextPage)
    c.subHasMore = res.hasMore
  } finally {
    subLoading.delete(key)
  }
}

function onPage(p: number): void {
  emit('update:page', p)
}

// 换页后：复位滚动与展开状态（避免状态串页）
watch(
  () => props.page,
  () => {
    if (scrollEl.value) scrollEl.value.scrollTop = 0
    expanded.clear()
    loadedSubs.clear()
    subPage.clear()
  }
)

function relTime(ts: number): string {
  if (!ts) return ''
  const diff = Date.now() - ts
  const min = Math.floor(diff / 60000)
  if (min < 1) return '刚刚'
  if (min < 60) return `${min} 分钟前`
  const hour = Math.floor(min / 60)
  if (hour < 24) return `${hour} 小时前`
  const day = Math.floor(hour / 24)
  if (day < 30) return `${day} 天前`
  const d = new Date(ts)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
</script>

<style scoped>
.comment-panel {
  display: flex;
  flex-direction: column;
  min-height: 0;
  flex: 1;
}

.cp-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  border-radius: var(--md-radius-sm);
  padding-right: 2px;
}

/* 底部分页条：始终可见、不随评论滚动 */
.cp-bar {
  flex-shrink: 0;
  margin-top: 6px;
  border-top: 1px solid var(--md-outline-variant);
}

.cp-info {
  font-size: 11px;
  color: var(--md-on-surface-variant);
  padding: 6px 2px 0;
}

.cp-bar :deep(.pagination) {
  margin-top: 0;
  padding-top: 4px;
  border-top: none;
}

.c-row {
  padding: 9px 10px;
  background: var(--md-surface-container-low);
  border-radius: var(--md-radius-sm);
  margin-bottom: 4px;
}

.c-row.alt {
  background: var(--md-surface-container-highest);
}

.c-head {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  margin-bottom: 4px;
}

.c-floor {
  flex-shrink: 0;
  font-size: 11px;
  font-weight: 600;
  color: var(--md-primary);
  background: color-mix(in srgb, var(--md-primary) 14%, transparent);
  border-radius: 8px;
  padding: 1px 6px;
}

.c-user {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  font-size: 12px;
  font-weight: 500;
  color: var(--md-primary);
  max-width: 180px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.c-stat {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  font-size: 11px;
  color: var(--md-on-surface-variant);
}

.c-time {
  margin-left: auto;
  font-size: 11px;
  color: var(--md-on-surface-variant);
  opacity: 0.8;
  flex-shrink: 0;
}

/* 评论正文：允许选中复制 */
.c-text {
  font-size: 13px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
  user-select: text;
  cursor: text;
}

/* 过长默认折叠为 5 行 */
.c-text.collapsed {
  display: -webkit-box;
  -webkit-line-clamp: 5;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.c-more {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin-top: 4px;
  border: none;
  background: transparent;
  color: var(--md-primary);
  font-family: inherit;
  font-size: 12px;
  cursor: pointer;
  padding: 2px 0;
}

.c-more:hover:not(:disabled) {
  text-decoration: underline;
}

.c-more:disabled {
  opacity: 0.6;
  cursor: default;
}

/* 楼中楼区块：与一级评论同区块，用左侧竖线表示从属关系 */
.c-subs {
  margin-top: 8px;
  padding-left: 10px;
  border-left: 2px solid var(--md-outline-variant);
}

.c-sub {
  display: flex;
  gap: 8px;
  padding: 5px 0;
}

.c-sub + .c-sub {
  border-top: 1px dashed var(--md-outline-variant);
}

.c-sub-line {
  width: 0;
}

.c-sub-body {
  flex: 1;
  min-width: 0;
}

.c-sub-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 2px;
}

.c-sub-user {
  font-size: 12px;
  font-weight: 500;
  color: var(--md-primary);
  max-width: 160px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.c-sub-text {
  font-size: 12.5px;
}

.spinner {
  animation: spin 0.8s linear infinite;
}
</style>
