<template>
  <div v-if="show" class="pagination">
    <span v-if="showSummary" class="pg-summary">
      {{ summaryText }}
    </span>

    <div class="pg-controls">
      <button class="icon-btn" title="第一页" :disabled="disabled || page <= 1" @click="go(1)">
        <MdIcon name="pageFirst" :size="16" />
      </button>
      <button class="icon-btn" title="上一页" :disabled="disabled || page <= 1" @click="go(page - 1)">
        <MdIcon name="chevronLeft" :size="16" />
      </button>

      <button
        v-for="p in pages"
        :key="p.key"
        class="pg-num"
        :class="{ active: p.value === page, dots: p.dots }"
        :disabled="disabled || p.dots"
        @click="!p.dots && go(p.value)"
      >
        {{ p.dots ? '…' : p.value }}
      </button>

      <button class="icon-btn" title="下一页" :disabled="disabled || !canNext" @click="go(page + 1)">
        <MdIcon name="chevronRight" :size="16" />
      </button>
      <button
        class="icon-btn"
        title="最后一页"
        :disabled="disabled || !canNext || !totalPages"
        @click="totalPages && go(totalPages)"
      >
        <MdIcon name="pageLast" :size="16" />
      </button>
    </div>

    <label v-if="pageSizeOptions" class="pg-size">
      <span class="hint">每页</span>
      <MdSelect
        :model-value="pageSize"
        :options="sizeOptions"
        @update:model-value="onSize"
      />
    </label>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import MdIcon from './MdIcon.vue'
import MdSelect from './MdSelect.vue'

/**
 * 通用分页条（MD3 风格）。
 *
 * 两种模式：
 * - 已知总页数（totalPages / total 给定）：显示页码 + 首页/末页，末页可跳。
 * - 未知总数（只有 hasMore）：显示「上一页 / 下一页」，不显示页码。
 */
const props = withDefaults(
  defineProps<{
    /** 当前页（从 1 开始） */
    page: number
    /** 每页条数（仅用于展示与「每页 N 条」下拉） */
    pageSize?: number
    /** 总页数（可选；未知时用 hasMore 判断） */
    totalPages?: number
    /** 总条数（可选） */
    total?: number
    /** 是否有下一页（totalPages 未知时使用） */
    hasMore?: boolean
    /** 禁用交互（如加载中） */
    disabled?: boolean
    /** 是否显示「每页 N 条」下拉 */
    pageSizeOptions?: boolean
    /** 每页下拉候选项 */
    sizeChoices?: number[]
    /**
     * 只有一页时也强制显示整条分页栏。
     * 用于评论区这类「必须能看到分页区」的场景，避免用户以为没有翻页功能。
     */
    alwaysShow?: boolean
  }>(),
  { pageSize: 16, disabled: false, pageSizeOptions: false, hasMore: false, alwaysShow: false }
)

const emit = defineEmits<{
  (e: 'update:page', page: number): void
  (e: 'update:pageSize', size: number): void
}>()

/** 只有一页时不显示（避免占位）；alwaysShow 时始终显示 */
const show = computed(() => {
  if (props.alwaysShow) return true
  if (props.totalPages != null) return props.totalPages > 1
  if (props.total != null && props.pageSize) return props.total > props.pageSize
  return props.page > 1 || Boolean(props.hasMore)
})

const canNext = computed(() =>
  props.totalPages != null ? props.page < props.totalPages : Boolean(props.hasMore)
)

const sizeOptions = computed(() => (props.sizeChoices ?? [8, 12, 16, 20, 24, 32, 48]).map((n) => ({ label: String(n), value: n })))

const showSummary = computed(() => props.total != null && props.pageSize != null)

const summaryText = computed(() => {
  const total = props.total ?? 0
  if (!total) return '暂无数据'
  const size = props.pageSize ?? 16
  const from = (props.page - 1) * size + 1
  const to = Math.min(total, props.page * size)
  return `${from}–${to} / 共 ${total}`
})

interface PageItem {
  key: string
  value: number
  dots?: boolean
}

/** 页码窗口：首页、末页、当前 ±1，其余用省略号折叠 */
const pages = computed<PageItem[]>(() => {
  if (props.totalPages == null) return []
  const tp = props.totalPages
  if (tp <= 1) return []
  const cur = Math.min(Math.max(1, props.page), tp)
  const out: PageItem[] = []
  const push = (value: number): void => out.push({ key: `p${value}`, value })
  const pushDots = (): void => out.push({ key: `d${out.length}`, value: -1, dots: true })

  const window = 1
  const set = new Set<number>([1, tp, cur])
  for (let i = 1; i <= window; i++) {
    if (cur - i >= 1) set.add(cur - i)
    if (cur + i <= tp) set.add(cur + i)
  }
  const sorted = [...set].sort((a, b) => a - b)
  let prev = 0
  for (const n of sorted) {
    if (prev && n - prev > 1) pushDots()
    push(n)
    prev = n
  }
  return out
})

function go(p: number): void {
  const min = 1
  const max = props.totalPages ?? Number.MAX_SAFE_INTEGER
  const next = Math.min(Math.max(min, p), max)
  if (next !== props.page) emit('update:page', next)
}

function onSize(v: number | string): void {
  emit('update:pageSize', Number(v))
}
</script>

<style scoped>
.pagination {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  margin-top: 14px;
  padding-top: 12px;
  border-top: 1px solid var(--md-outline-variant);
}

.pg-summary {
  font-size: 12px;
  color: var(--md-on-surface-variant);
  font-variant-numeric: tabular-nums;
}

.pg-controls {
  display: flex;
  align-items: center;
  gap: 2px;
  margin-left: auto;
}

.pg-num {
  min-width: 32px;
  height: 32px;
  padding: 0 6px;
  border: none;
  border-radius: 999px;
  background: transparent;
  color: var(--md-on-surface-variant);
  font-family: inherit;
  font-size: 13px;
  font-variant-numeric: tabular-nums;
  cursor: pointer;
  transition: background 0.16s, color 0.16s;
}

.pg-num:hover:not(.dots):not(:disabled) {
  background: var(--md-surface-container-low);
  color: var(--md-on-surface);
}

.pg-num.active {
  background: var(--md-primary);
  color: var(--md-on-primary);
  font-weight: 600;
}

.pg-num.dots {
  cursor: default;
  color: var(--md-outline);
}

.pg-size {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.pg-size :deep(.md-select) {
  min-width: 74px;
}

@media (max-width: 720px) {
  .pagination {
    justify-content: center;
  }
  .pg-controls {
    margin-left: 0;
  }
}
</style>
