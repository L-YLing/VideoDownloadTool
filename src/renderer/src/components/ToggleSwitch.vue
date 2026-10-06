<template>
  <label class="switch" :class="{ 'is-disabled': disabled }" :title="title">
    <input
      type="checkbox"
      :checked="modelValue"
      :disabled="disabled"
      @change="$emit('update:modelValue', ($event.target as HTMLInputElement).checked)"
    />
    <span class="track"></span>
  </label>
</template>

<script setup lang="ts">
defineProps<{ modelValue: boolean; disabled?: boolean; title?: string }>()
defineEmits<{ (e: 'update:modelValue', v: boolean): void }>()
</script>

<style scoped>
/* 交互与外观统一在 styles/switch.css 的 .switch 中，避免各视图各写一套 */
</style>
