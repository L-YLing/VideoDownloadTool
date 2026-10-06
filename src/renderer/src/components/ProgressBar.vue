<template>
  <div class="progress"><div class="bar" :style="{ width: pct + '%' }"></div></div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
const props = defineProps<{ value: number }>()
const pct = computed(() => Math.max(0, Math.min(100, props.value)))
</script>
