<template>
  <div class="toast-wrap">
    <div v-for="t in store.toasts" :key="t.id" class="toast" :class="t.type">
      {{ t.text }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { store } from '../store/app'
</script>
