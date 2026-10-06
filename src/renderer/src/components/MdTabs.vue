<template>
  <div
    ref="tabsEl"
    class="md-tabs"
    :class="{
      'tabs-primary': variant === 'primary',
      'tabs-vertical': orientation === 'vertical',
      'tabs-fill': fill
    }"
    role="tablist"
  >
    <!-- 滑动指示器：位置/尺寸由激活项实时测量，过渡产生滑块效果 -->
    <span class="tabs-indicator" :style="indicatorStyle" :class="{ ready: indicatorReady }"></span>

    <button
      v-for="(t, i) in tabs"
      :key="String(t.value)"
      ref="itemEls"
      class="md-tab"
      :class="{ active: String(t.value) === String(modelValue) }"
      role="tab"
      :aria-selected="String(t.value) === String(modelValue)"
      :title="t.label"
      @click="emit('update:modelValue', t.value)"
    >
      <MdIcon v-if="t.icon" :name="t.icon" :size="17" class="tab-icon" />
      <span class="tab-text">{{ t.label }}</span>
      <span v-if="t.badge" class="tab-badge">{{ t.badge }}</span>
      <span class="sr-only">{{ i }}</span>
    </button>
  </div>
</template>

<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch, computed } from 'vue'
import MdIcon from './MdIcon.vue'

export interface MdTabItem {
  label: string
  value: string | number
  icon?: string
  badge?: string | number
}

/**
 * MD3 选项卡（Primary / Secondary Tabs）。
 * 激活态不是「每个按钮各自高亮」，而是一个独立指示器在选项卡之间滑动：
 * 位置与宽度随激活项变化，用 transform + width 做过渡（不触发重排）。
 */
const props = withDefaults(
  defineProps<{
    modelValue: string | number
    tabs: MdTabItem[]
    variant?: 'primary' | 'secondary'
    /** 纵向排列（左侧栏导航用），指示器改为上下滑动 */
    orientation?: 'horizontal' | 'vertical'
    /** 撑满容器宽度（横向时各选项卡等分） */
    fill?: boolean
  }>(),
  { variant: 'secondary', orientation: 'horizontal', fill: false }
)

const emit = defineEmits<{ (e: 'update:modelValue', v: string | number): void }>()

const tabsEl = ref<HTMLElement | null>(null)
const itemEls = ref<HTMLElement[]>([])
const indicatorReady = ref(false)
const box = ref({ left: 0, width: 0 })

function measure(): void {
  const container = tabsEl.value
  if (!container) return
  const idx = props.tabs.findIndex((t) => String(t.value) === String(props.modelValue))
  const el = itemEls.value[idx < 0 ? 0 : idx]
  if (!el) return
  /**
   * 用 getBoundingClientRect 精确对齐：
   * 指示器是 position:absolute，其定位原点是容器的「padding 盒」，
   * 而 offsetTop/offsetLeft 的基准与 padding/border 的关系在不同场景下不一致，
   * 之前纵向还额外减了 4px（padding），导致高亮块比选项卡高 4px，
   * 看起来就是「active 下文字没有垂直居中」。这里统一换算成与选项卡完全重合。
   */
  const c = container.getBoundingClientRect()
  const r = el.getBoundingClientRect()
  box.value =
    props.orientation === 'vertical'
      ? { left: r.top - c.top - container.clientTop, width: r.height }
      : { left: r.left - c.left - container.clientLeft, width: r.width }
  if (!indicatorReady.value) {
    // 首次测量后启用过渡，避免从 0 滑入
    requestAnimationFrame(() => {
      indicatorReady.value = true
    })
  }
}

const indicatorStyle = computed(() =>
  props.orientation === 'vertical'
    ? { transform: `translateY(${box.value.left}px)`, height: `${box.value.width}px` }
    : { transform: `translateX(${box.value.left}px)`, width: `${box.value.width}px` }
)

let ro: ResizeObserver | null = null

onMounted(() => {
  void nextTick(measure)
  if (typeof ResizeObserver !== 'undefined' && tabsEl.value) {
    ro = new ResizeObserver(() => measure())
    ro.observe(tabsEl.value)
  }
  window.addEventListener('resize', measure)
})

onBeforeUnmount(() => {
  ro?.disconnect()
  window.removeEventListener('resize', measure)
})

watch(() => props.modelValue, () => void nextTick(measure))
watch(() => props.tabs, () => void nextTick(measure), { deep: false })
</script>

<style scoped>
.md-tabs {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 3px;
  border-radius: 999px;
  background: var(--md-surface-container-highest);
  max-width: 100%;
  overflow-x: auto;
  scrollbar-width: none;
}

.md-tabs::-webkit-scrollbar {
  display: none;
}

/* Primary tabs：无容器背景，靠下划线指示 */
.tabs-primary {
  background: transparent;
  border-radius: 0;
  border-bottom: 1px solid var(--md-outline-variant);
  padding: 0;
}

.md-tab {
  position: relative;
  z-index: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  height: calc(var(--md-control-h) - 8px);
  padding: 0 14px;
  border: none;
  border-radius: 999px;
  background: transparent;
  color: var(--md-on-surface-variant);
  font-family: inherit;
  font-size: 13px;
  cursor: pointer;
  white-space: nowrap;
  transition: color 0.2s cubic-bezier(0.2, 0, 0, 1);
}

.md-tab.compact {
  height: var(--md-control-h-sm);
  padding: 0 12px;
  font-size: 12px;
}

.md-tab:hover {
  color: var(--md-on-surface);
}

/* 激活态：只改文字色，背景交给滑动指示器 */
.md-tab.active {
  color: var(--md-on-primary);
  font-weight: 600;
}

.tabs-primary .md-tab {
  border-radius: 0;
  height: 48px;
}

.tabs-primary .md-tab.active {
  color: var(--md-primary);
}

/* 滑动指示器 */
.tabs-indicator {
  position: absolute;
  left: 0;
  top: 3px;
  bottom: 3px;
  z-index: 0;
  border-radius: 999px;
  background: var(--md-primary);
  box-shadow: var(--md-elevation-1);
  pointer-events: none;
}

/* 纵向（左侧栏导航）：指示器整块覆盖，上下滑动 */
.tabs-vertical {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 2px;
  padding: 4px;
  border-radius: var(--md-radius-md);
  overflow: visible;
}

.tabs-vertical .md-tab {
  justify-content: flex-start;
  width: 100%;
  height: 40px;
  padding: 0 12px;
  border-radius: 999px;
}

.tabs-vertical .tabs-indicator {
  left: 4px;
  right: 4px;
  top: 0;
  bottom: auto;
  width: auto;
  height: 40px;
}

/* 撑满容器：横向时等分空间 */
.tabs-fill {
  display: flex;
  width: 100%;
}

.tabs-fill:not(.tabs-vertical) .md-tab {
  flex: 1;
  min-width: 0;
}

.tabs-indicator.ready {
  /* 同时过渡 transform 与尺寸：横向滑 width、纵向滑 height */
  transition:
    transform 0.28s cubic-bezier(0.2, 0, 0, 1),
    width 0.28s cubic-bezier(0.2, 0, 0, 1),
    height 0.28s cubic-bezier(0.2, 0, 0, 1);
}

.tabs-primary .tabs-indicator {
  left: 0;
  top: auto;
  bottom: -1px;
  height: 3px;
  border-radius: 3px 3px 0 0;
}

.tab-icon {
  flex-shrink: 0;
}

.tab-text {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}

.tab-badge {
  flex-shrink: 0;
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  border-radius: 9px;
  background: var(--md-error);
  color: var(--md-on-error);
  font-size: 11px;
  font-weight: 700;
  line-height: 18px;
  text-align: center;
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
}

/* 低资源模式：直接跳到位，不做滑动 */
:global(:root[data-low-resource='true']) .tabs-indicator {
  transition: none;
}
</style>
