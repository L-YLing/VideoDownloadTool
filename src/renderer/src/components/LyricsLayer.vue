<template>
  <div class="lyrics" :class="{ 'lyrics-empty': lines.length === 0 }">
    <div v-if="lines.length === 0" class="lyrics-hint">
      <MdIcon name="lyric" :size="18" />
      <span>仅音频模式：可「导入 LRC 歌词」或打开 .cop 音频包</span>
    </div>
    <div
      v-else
      ref="boxEl"
      class="lyrics-box"
      :class="{ karaoke: karaokeOn }"
      :style="{ '--karaoke-p': fillPercent + '%' }"
    >
      <div
        v-for="(l, i) in lines"
        :key="i"
        class="lyric-line"
        :class="{ current: i === activeIndex, near: Math.abs(i - activeIndex) === 1 }"
        @click="$emit('seek', l.time)"
      >
        {{ l.text }}
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch, nextTick, onBeforeUnmount } from 'vue'
import type { LyricLine } from '@shared/types'
import { store } from '../store/app'
import MdIcon from './MdIcon.vue'

const props = withDefaults(
  defineProps<{ lines: LyricLine[]; currentTime: number; playing?: boolean }>(),
  { playing: false }
)
defineEmits<{ (e: 'seek', time: number): void }>()

const boxEl = ref<HTMLElement | null>(null)

/** 是否启用卡拉OK染色（跟随设置） */
const karaokeOn = computed(() => store.settings?.lyricKaraoke !== false)

// ---------- 平滑时间轴：timeupdate 只有约 4Hz，用 rAF 在两次回调间插值，染色才顺滑 ----------
const smooth = ref(props.currentTime)
let lastPropTime = props.currentTime
let lastPropAt = performance.now()
let rafId = 0

watch(
  () => props.currentTime,
  (t) => {
    // 跳转（seek）时直接对齐，避免插值慢慢爬
    if (Math.abs(t - smooth.value) > 0.6) smooth.value = t
    lastPropTime = t
    lastPropAt = performance.now()
  }
)

function tick(): void {
  if (!props.playing) {
    rafId = 0
    return // 暂停时停掉 rAF，避免空转烧 CPU
  }
  const elapsed = (performance.now() - lastPropAt) / 1000
  smooth.value = lastPropTime + elapsed
  rafId = requestAnimationFrame(tick)
}

/** 只在播放中驱动 rAF；暂停/卸载立即停止 */
watch(
  () => props.playing,
  (p) => {
    if (p && !rafId) {
      lastPropTime = props.currentTime
      lastPropAt = performance.now()
      rafId = requestAnimationFrame(tick)
    } else if (!p && rafId) {
      cancelAnimationFrame(rafId)
      rafId = 0
    }
  },
  { immediate: true }
)

onBeforeUnmount(() => {
  if (rafId) cancelAnimationFrame(rafId)
  rafId = 0
})

const activeIndex = computed(() => {
  const list = props.lines
  if (!list || list.length === 0) return -1
  const t = smooth.value
  let lo = 0
  let hi = list.length - 1
  let ans = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (list[mid].time <= t) {
      ans = mid
      lo = mid + 1
    } else {
      hi = mid - 1
    }
  }
  return ans
})

/** 当前行演唱进度（0–100），用于「从左到右」染色；由 CSS 变量驱动，避免逐行重算 */
const fillPercent = computed(() => {
  const idx = activeIndex.value
  const list = props.lines
  if (idx < 0 || !list[idx]) return 0
  const start = list[idx].time
  const next = list[idx + 1]?.time
  // 末行没有下一行：按 5 秒估算
  const span = next != null ? Math.max(0.4, next - start) : 5
  const p = ((smooth.value - start) / span) * 100
  return Math.max(0, Math.min(100, p))
})

// 当前行滚动到可视区中央
watch(activeIndex, async (idx) => {
  if (idx < 0) return
  await nextTick()
  const box = boxEl.value
  if (!box) return
  const el = box.children[idx] as HTMLElement | undefined
  if (!el) return
  const target = el.offsetTop - box.clientHeight / 2 + el.offsetHeight / 2
  box.scrollTo({ top: Math.max(0, target), behavior: 'smooth' })
})
</script>

<style scoped>
.lyrics {
  position: relative;
  height: 180px;
  border-radius: var(--md-radius-md);
  background: var(--md-surface-container-low);
  overflow: hidden;
}

.lyrics-empty {
  display: flex;
  align-items: center;
  justify-content: center;
}

.lyrics-hint {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 16px;
  font-size: 12px;
  color: var(--md-on-surface-variant);
  text-align: center;
}

.lyrics-box {
  height: 100%;
  overflow-y: auto;
  padding: 12px 16px;
  scrollbar-width: thin;
  -webkit-mask-image: linear-gradient(transparent, #000 12%, #000 88%, transparent);
  mask-image: linear-gradient(transparent, #000 12%, #000 88%, transparent);
}

.lyric-line {
  padding: 7px 4px;
  font-size: 13px;
  line-height: 1.5;
  text-align: center;
  color: var(--md-on-surface-variant);
  opacity: 0.55;
  cursor: pointer;
  transition: opacity 0.2s, transform 0.2s, font-size 0.2s;
}

.lyric-line.near {
  opacity: 0.8;
}

.lyric-line.current {
  font-weight: 700;
  font-size: 15px;
  opacity: 1;
  transform: scale(1.02);
}

/* ---- 卡拉OK：当前行从左到右渐变染色 ---- */
.lyrics-box.karaoke .lyric-line.current {
  background-image: linear-gradient(
    90deg,
    var(--md-primary) 0%,
    var(--md-primary) calc(var(--karaoke-p) - 6%),
    color-mix(in srgb, var(--md-primary) 45%, var(--md-on-surface-variant)) var(--karaoke-p),
    var(--md-on-surface-variant) calc(var(--karaoke-p) + 6%),
    var(--md-on-surface-variant) 100%
  );
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
  color: transparent;
}

/* 未开启卡拉OK时，退化为纯高亮色 */
.lyrics-box:not(.karaoke) .lyric-line.current {
  color: var(--md-primary);
}

.lyric-line:hover {
  opacity: 1;
}
</style>
