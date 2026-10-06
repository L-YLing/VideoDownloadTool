<template>
  <div ref="rootEl" class="md-select" :class="{ 'is-disabled': disabled }">
    <!-- 触发区（MD3 filled select 外观） -->
    <button
      ref="fieldEl"
      type="button"
      class="sel-field"
      :disabled="disabled"
      :aria-expanded="open"
      :title="label ?? ''"
      @click="toggle"
      @keydown.down.prevent="openMenu"
      @keydown.esc="close"
    >
      <span class="sel-label" :class="{ floating: floatLabel }">{{ label }}</span>
      <span class="sel-value">{{ displayText }}</span>
      <MdIcon name="arrowDrop" :size="20" class="sel-arrow" :class="{ open }" />
    </button>
  </div>

  <!--
    浮层菜单：Teleport 到 body 并用 fixed 定位。
    原因：菜单若留在原位，会被祖先的 overflow:hidden/auto（内容区滚动容器、卡片圆角）
    裁剪，且任何祖先滚动都会把菜单顶走，表现为「一展开就收起」。
    脱离文档流后不受裁剪与滚动影响，只需在滚动/缩放时重算坐标。
  -->
  <Teleport to="body">
    <div
      v-if="open"
      ref="menuEl"
      class="md-menu"
      :style="menuStyle"
      role="listbox"
      @mousedown.prevent
      @click.self="close"
    >
      <button
        v-for="(opt, i) in options"
        :key="String(opt.value)"
        type="button"
        class="md-menu-item"
        :class="{ selected: String(opt.value) === String(modelValue), active: i === activeIndex }"
        role="option"
        :aria-selected="String(opt.value) === String(modelValue)"
        :title="opt.desc ?? opt.label"
        @click="pick(opt.value)"
        @mouseenter="activeIndex = i"
      >
        <span class="md-menu-text">{{ opt.label }}</span>
        <span v-if="opt.desc" class="md-menu-desc">{{ opt.desc }}</span>
        <MdIcon v-if="String(opt.value) === String(modelValue)" name="check" :size="16" class="md-menu-check" />
      </button>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import MdIcon from './MdIcon.vue'

/**
 * MD3（Flutter）风格下拉选择器。
 * 原生 <select> 的展开面板由操作系统绘制，无法统一到 Material 3，
 * 因此这里用「字段 + Teleport 浮层菜单」自绘，保证 Windows / 明暗主题下外观一致。
 */
export interface MdOption {
  label: string
  value: string | number
  desc?: string
}

const props = withDefaults(
  defineProps<{
    modelValue: string | number
    options: MdOption[]
    label?: string
    placeholder?: string
    disabled?: boolean
    /** 菜单最大高度，超出滚动 */
    maxHeight?: number
  }>(),
  { placeholder: '请选择', disabled: false, maxHeight: 300, label: '' }
)

const emit = defineEmits<{ (e: 'update:modelValue', v: string | number): void }>()

const open = ref(false)
const rootEl = ref<HTMLElement | null>(null)
const fieldEl = ref<HTMLElement | null>(null)
const menuEl = ref<HTMLElement | null>(null)
const activeIndex = ref(-1)

/** 浮层坐标（fixed 定位，相对视口） */
const pos = ref({ top: 0, left: 0, width: 0, dropUp: false })
/** 刚打开的一小段时间内忽略「关闭」请求，避免任何杂散事件导致秒关 */
let openedAt = 0

const displayText = computed(() => {
  const hit = props.options.find((o) => String(o.value) === String(props.modelValue))
  return hit?.label ?? props.placeholder
})

/** 有值或展开时标签上浮（MD3 outlined/filled 的浮动标签行为） */
const floatLabel = computed(() => open.value || Boolean(props.label))

const menuStyle = computed(() => ({
  maxHeight: `${props.maxHeight}px`,
  minWidth: `${pos.value.width}px`,
  left: `${pos.value.left}px`,
  top: pos.value.dropUp ? 'auto' : `${pos.value.top}px`,
  bottom: pos.value.dropUp ? `${pos.value.bottom}px` : 'auto'
}))

function toggle(): void {
  if (props.disabled) return
  if (open.value) close(true)
  else openMenu()
}

function openMenu(): void {
  if (props.disabled) return
  open.value = true
  openedAt = Date.now()
  activeIndex.value = Math.max(
    0,
    props.options.findIndex((o) => String(o.value) === String(props.modelValue))
  )
  void nextTick(() => {
    updatePos()
    // 让当前项可见
    const el = menuEl.value?.querySelector<HTMLElement>('.md-menu-item.selected')
    el?.scrollIntoView({ block: 'nearest' })
  })
}

/** @param force 用户主动点击关闭（不受「刚打开」保护期限制） */
function close(force = false): void {
  if (!force && Date.now() - openedAt < 150) return
  open.value = false
  activeIndex.value = -1
}

function pick(v: string | number): void {
  emit('update:modelValue', v)
  close(true)
}

/** 依据触发区位置计算浮层坐标（下方空间不足时向上展开） */
function updatePos(): void {
  const el = fieldEl.value
  if (!el) return
  const rect = el.getBoundingClientRect()
  const est = Math.min(props.maxHeight, 280)
  const spaceBelow = window.innerHeight - rect.bottom
  const dropUp = spaceBelow < est + 16
  pos.value = {
    left: rect.left,
    width: rect.width,
    dropUp,
    top: rect.bottom + 4,
    bottom: window.innerHeight - rect.top + 4
  }
}

function onDocClick(e: MouseEvent): void {
  if (!open.value) return
  const t = e.target as Node
  // 菜单已 Teleport 到 body，必须同时判断触发区与浮层
  if (rootEl.value?.contains(t) || menuEl.value?.contains(t)) return
  close()
}

/** 页面/容器滚动时只重算位置，不再关闭菜单（此前是关闭，导致「一展开就收起」） */
function onScroll(): void {
  if (!open.value) return
  updatePos()
}

function onResize(): void {
  if (open.value) close(true)
}

function onKey(e: KeyboardEvent): void {
  if (!open.value) return
  if (e.key === 'Escape') {
    close(true)
    return
  }
  if (e.key === 'ArrowDown') {
    activeIndex.value = Math.min(props.options.length - 1, activeIndex.value + 1)
    e.preventDefault()
  }
  if (e.key === 'ArrowUp') {
    activeIndex.value = Math.max(0, activeIndex.value - 1)
    e.preventDefault()
  }
  if (e.key === 'Enter' && activeIndex.value >= 0) {
    const opt = props.options[activeIndex.value]
    if (opt) pick(opt.value)
  }
  if (e.key === 'Tab') close(true)
}

onMounted(() => {
  document.addEventListener('mousedown', onDocClick)
  // 捕获阶段监听所有容器滚动（内容区滚动时浮层跟随，不关闭）
  window.addEventListener('scroll', onScroll, true)
  window.addEventListener('resize', onResize)
  window.addEventListener('keydown', onKey)
})

onBeforeUnmount(() => {
  document.removeEventListener('mousedown', onDocClick)
  window.removeEventListener('scroll', onScroll, true)
  window.removeEventListener('resize', onResize)
  window.removeEventListener('keydown', onKey)
})

watch(
  () => props.disabled,
  (v) => {
    if (v) close(true)
  }
)
</script>

<style scoped>
.md-select {
  position: relative;
  display: inline-block;
  min-width: 120px;
  max-width: 100%;
}

.sel-field {
  position: relative;
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  height: var(--md-control-h);
  padding: 0 8px 0 12px;
  border: 1px solid var(--md-outline);
  border-radius: var(--md-radius-sm);
  background: var(--md-surface-container-low);
  color: var(--md-on-surface);
  font-family: inherit;
  font-size: 14px;
  cursor: pointer;
  text-align: left;
  transition: border-color 0.16s, background 0.16s, box-shadow 0.16s;
}

.sel-field:hover:not(:disabled) {
  border-color: var(--md-on-surface-variant);
}

.sel-field:focus-visible,
.sel-field[aria-expanded='true'] {
  border-color: var(--md-primary);
  background: var(--md-surface);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--md-primary) 20%, transparent);
}

.sel-field:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

/* 浮动标签（无标签时隐藏） */
.sel-label {
  display: none;
  font-size: 11px;
  color: var(--md-primary);
}

.sel-label.floating {
  display: inline;
}

.sel-value {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sel-arrow {
  flex-shrink: 0;
  opacity: 0.75;
  transition: transform 0.2s cubic-bezier(0.2, 0, 0, 1);
}

.sel-arrow.open {
  transform: rotate(180deg);
  color: var(--md-primary);
}
</style>

<!-- 浮层被 Teleport 到 body，作用域样式无法命中，故这里用全局样式 -->
<style>
.md-menu {
  position: fixed;
  z-index: 900;
  width: max-content;
  max-width: min(360px, 92vw);
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 8px;
  border-radius: 12px;
  background: var(--md-surface-container);
  box-shadow: 0 2px 6px 2px rgba(0, 0, 0, 0.15), 0 1px 2px rgba(0, 0, 0, 0.3);
  transform-origin: top center;
  animation: md-menu-in 0.14s cubic-bezier(0.05, 0.7, 0.1, 1);
}

@keyframes md-menu-in {
  from {
    opacity: 0;
    transform: scaleY(0.9);
  }
  to {
    opacity: 1;
    transform: scaleY(1);
  }
}

.md-menu-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  min-height: 40px;
  padding: 8px 12px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--md-on-surface);
  font-family: var(--md-font);
  font-size: 14px;
  cursor: pointer;
  text-align: left;
  transition: background 0.12s;
}

.md-menu-item:hover,
.md-menu-item.active {
  background: color-mix(in srgb, var(--md-on-surface) 8%, transparent);
}

.md-menu-item.selected {
  color: var(--md-primary);
  font-weight: 600;
}

.md-menu-text {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.md-menu-desc {
  flex-shrink: 1;
  min-width: 0;
  font-size: 11px;
  font-weight: 400;
  color: var(--md-on-surface-variant);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.md-menu-check {
  flex-shrink: 0;
}

/* 低资源模式：关闭动画 */
:root[data-low-resource='true'] .md-menu {
  animation: none;
}
</style>
