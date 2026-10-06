<template>
  <div class="danmaku-layer" v-show="visible">
    <div
      v-for="d in active"
      :key="d.key"
      class="dm-item"
      :style="{
        color: d.color,
        top: d.top + 'px',
        animationDuration: d.duration + 's',
        fontSize: d.mode === 4 ? '20px' : '14px',
        textShadow: d.mode === 4 ? '0 0 4px #fff' : '0 1px 2px rgba(0,0,0,0.8)'
      }"
    >
      {{ d.text }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import type { DanmakuItem } from '@shared/types'

const props = defineProps<{ items: DanmakuItem[]; currentTime: number; visible: boolean }>()

interface ActiveDanmaku {
  key: number
  text: string
  color: string
  mode: number
  top: number
  duration: number
}

const active = ref<ActiveDanmaku[]>([])
let keySeq = 0
let lastEmitSec = -1
let lastItems: DanmakuItem[] | null = null

watch(
  () => Math.floor(props.currentTime),
  (sec) => {
    if (sec === lastEmitSec) return
    lastEmitSec = sec
    const now = props.currentTime
    const lowResource = document.documentElement.dataset.lowResource === 'true'
    const maxBatch = lowResource ? 3 : 6
    // 上限下调（150 → 90）：每条弹幕都是一个合成层，同屏过多会显著抬升 GPU 显存与合成开销
    const maxActive = lowResource ? 30 : 90
    const incoming = props.items.filter((d) => d.time > now - 0.05 && d.time <= now + 0.05).slice(0, maxBatch)
    for (const d of incoming) {
      const item: ActiveDanmaku = {
        key: ++keySeq,
        text: d.text,
        color: d.color,
        mode: d.mode,
        top: 18 + Math.floor(Math.random() * 5) * 24,
        duration: 7 + Math.random() * 2
      }
      active.value.push(item)
      setTimeout(() => {
        active.value = active.value.filter((a) => a.key !== item.key)
      }, (item.duration + 0.5) * 1000)
    }
    if (active.value.length > maxActive) {
      active.value = active.value.slice(-maxActive)
    }
  }
)

// 切换媒体时重置
watch(
  () => props.items,
  (items) => {
    if (lastItems !== items) {
      active.value = []
      lastEmitSec = -1
      lastItems = items
    }
  }
)
</script>

<style scoped>
.danmaku-layer {
  position: absolute;
  inset: 0;
  overflow: hidden;
  pointer-events: none;
  z-index: 5;
  /* 隔离绘制范围：弹幕滚动不会触发外层重排/重绘 */
  contain: layout style paint;
}

.dm-item {
  position: absolute;
  left: 100%;
  white-space: nowrap;
  font-weight: 600;
  animation-name: dm-scroll;
  animation-timing-function: linear;
  animation-fill-mode: forwards;
  /* 说明：不再常驻 will-change —— transform 动画本身会被合成器自动提层，
     常驻 will-change 反而让几百条弹幕长期占用合成层显存。 */
  backface-visibility: hidden;
}

@keyframes dm-scroll {
  from {
    transform: translateX(0);
  }
  to {
    transform: translateX(calc(-100vw - 100%));
  }
}
</style>
