<template>
  <div v-if="open" class="modal-mask" @click.self="cancel">
    <div class="modal dialog">
      <h3>{{ title }}</h3>
      <p v-if="desc" class="hint" style="margin: 4px 0 12px">{{ desc }}</p>
      <div class="field">
        <span class="label">{{ label }}</span>
        <input
          ref="inputEl"
          v-model="value"
          class="input"
          :placeholder="placeholder"
          @keyup.enter="confirm"
          @keyup.esc="cancel"
        />
      </div>
      <div class="row" style="justify-content: flex-end; gap: 8px; margin-top: 4px">
        <button class="btn btn-text" @click="cancel">取消</button>
        <button class="btn" :disabled="!value.trim()" @click="confirm">{{ confirmText }}</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'

/**
 * 应用内输入弹窗。
 * 取代 window.prompt —— Electron 下 window.prompt 可用性不稳定，
 * 且原生弹窗与 Material3 风格不一致。
 */
const props = withDefaults(
  defineProps<{
    open: boolean
    title: string
    label?: string
    desc?: string
    placeholder?: string
    defaultValue?: string
    confirmText?: string
  }>(),
  { label: '名称', placeholder: '', defaultValue: '', confirmText: '确定', desc: '' }
)

const emit = defineEmits<{ (e: 'confirm', value: string): void; (e: 'cancel'): void }>()

const value = ref(props.defaultValue)
const inputEl = ref<HTMLInputElement | null>(null)

watch(
  () => props.open,
  (v) => {
    if (v) {
      value.value = props.defaultValue
      void nextTick(() => {
        inputEl.value?.focus()
        inputEl.value?.select()
      })
    }
  },
  { immediate: true }
)

function confirm(): void {
  const v = value.value.trim()
  if (!v) return
  emit('confirm', v)
}

function cancel(): void {
  emit('cancel')
}
</script>

<style scoped>
.dialog {
  width: min(420px, 92vw);
}
</style>
