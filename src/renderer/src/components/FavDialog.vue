<template>
  <div v-if="open" class="modal-mask" @click.self="close">
    <div class="modal fav-modal">
      <h3>收藏到收藏夹</h3>
      <p v-if="!store.auth.loggedIn" class="hint" style="margin: 6px 0 12px">
        需要登录才能收藏，<button class="btn btn-text btn-sm" @click="$emit('login')">立即登录</button>
      </p>
      <div v-if="loading" class="hint" style="padding: 20px; text-align: center">正在加载收藏夹列表…</div>
      <div v-else-if="folders.length === 0" class="empty" style="padding: 20px">
        <MdIcon name="folder" :size="28" class="empty-icon" />
        <div>暂无收藏夹</div>
      </div>
      <div v-else class="fav-list">
        <label
          v-for="f in folders"
          :key="f.id"
          class="fav-row"
          :class="{ checked: checked.has(f.id) }"
        >
          <input
            type="checkbox"
            :checked="checked.has(f.id)"
            @change="toggle(f.id)"
            class="fav-check"
          />
          <MdIcon :name="checked.has(f.id) ? 'star' : 'starOutline'" :size="16" class="fav-icon" />
          <span class="fav-name">{{ f.title }}</span>
          <span class="fav-count mono">{{ f.media_count }}</span>
        </label>
      </div>

      <!-- 新建收藏夹 -->
      <div class="fav-create">
        <input
          v-model="newName"
          class="input fav-input"
          placeholder="新建收藏夹…"
          @keydown.enter="createAndAdd"
        />
        <button class="btn btn-sm" :disabled="!newName.trim() || creating" @click="createAndAdd">
          <MdIcon name="add" :size="14" /> 新建并收藏
        </button>
      </div>

      <div class="row" style="justify-content: flex-end; margin-top: 12px; gap: 8px">
        <button class="btn btn-text" @click="close">取消</button>
        <button class="btn" :disabled="submitting" @click="submit">
          <MdIcon name="star" :size="14" /> {{ submitting ? '提交中…' : '确认收藏' }}
        </button>
      </div>
      <div v-if="error" class="hint" style="color: var(--md-error); margin-top: 8px">{{ error }}</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import { store, toast } from '../store/app'
import MdIcon from './MdIcon.vue'

const props = defineProps<{
  open: boolean
  /** 视频 aid（用于查询已收藏的收藏夹 + 执行收藏/取消收藏） */
  aid: number
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'login'): void
  (e: 'done'): void
}>()

interface FavFolder {
  id: number
  title: string
  media_count: number
}

const folders = ref<FavFolder[]>([])
const checked = ref<Set<number>>(new Set())
const loading = ref(false)
const submitting = ref(false)
const creating = ref(false)
const newName = ref('')
const error = ref('')

/** 已收藏的收藏夹 id（用于对比出增删差异） */
let original = new Set<number>()

// 打开时加载收藏夹列表 + 查询已收藏状态
watch(
  () => props.open,
  async (open) => {
    if (!open) return
    error.value = ''
    newName.value = ''
    if (!store.auth.loggedIn) {
      loading.value = false
      return
    }
    loading.value = true
    try {
      // ① 我的收藏夹列表（getMyFavorites → { ok, favorites?: FavoriteInfo[] }）
      const mine = await window.vd.getMyFavorites()
      if (!mine?.ok) {
        error.value = mine?.error ?? '获取收藏夹失败（请先登录）'
        folders.value = []
      } else {
        folders.value = (mine.favorites ?? []).map((f: { id: string | number; name: string; videoCount?: number }) => ({
          id: Number(f.id),
          title: f.name,
          media_count: Number(f.videoCount ?? 0)
        }))
      }
      // ② 该视频已收藏在哪些收藏夹（favCollectedFolders → { ok, folderIds? }）
      const col = await window.vd.favCollectedFolders(props.aid)
      const ids = col?.ok ? (col.folderIds ?? []).map(Number) : []
      original = new Set(ids)
      checked.value = new Set(ids)
    } catch (e) {
      error.value = `加载失败: ${e instanceof Error ? e.message : String(e)}`
    } finally {
      loading.value = false
    }
  },
  { immediate: true }
)

function toggle(id: number): void {
  const next = new Set(checked.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  checked.value = next
}

function close(): void {
  emit('close')
}

async function submit(): Promise<void> {
  if (!store.auth.loggedIn) {
    emit('login')
    return
  }
  submitting.value = true
  error.value = ''
  try {
    // 对比原始已选和当前勾选，计算 add / del
    const addIds = [...checked.value].filter((id) => !original.has(id))
    const delIds = [...original].filter((id) => !checked.value.has(id))
    if (addIds.length === 0 && delIds.length === 0) {
      toast('收藏状态未变化')
      close()
      return
    }
    const res = await window.vd.favDeal(props.aid, addIds, delIds)
    if (!res.ok) {
      error.value = res.error ?? '操作失败'
      return
    }
    const parts: string[] = []
    if (addIds.length) parts.push(`收藏到 ${addIds.length} 个夹`)
    if (delIds.length) parts.push(`从 ${delIds.length} 个夹移除`)
    toast(parts.join('，'), 'success')
    emit('done')
    close()
  } catch (e) {
    error.value = `操作失败: ${e instanceof Error ? e.message : String(e)}`
  } finally {
    submitting.value = false
  }
}

async function createAndAdd(): Promise<void> {
  const name = newName.value.trim()
  if (!name) return
  creating.value = true
  error.value = ''
  try {
    const res = await window.vd.favCreate(name)
    if (!res.ok || !res.id) {
      error.value = res.error ?? '新建失败'
      return
    }
    // 把新建的收藏夹加入列表并勾选
    folders.value = [...folders.value, { id: res.id, title: name, media_count: 0 }]
    const next = new Set(checked.value)
    next.add(res.id)
    checked.value = next
    newName.value = ''
    toast(`已创建收藏夹「${name}」`, 'success')
  } catch (e) {
    error.value = `新建失败: ${e instanceof Error ? e.message : String(e)}`
  } finally {
    creating.value = false
  }
}
</script>

<style scoped>
.fav-modal {
  width: min(440px, 100%);
}

.fav-list {
  max-height: 280px;
  overflow-y: auto;
  margin: 8px 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.fav-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border-radius: var(--md-radius-sm);
  cursor: pointer;
  transition: background 0.15s;
}

.fav-row:hover {
  background: var(--md-surface-container-low);
}

.fav-row.checked {
  background: var(--md-primary-container);
  color: var(--md-on-primary-container);
}

.fav-check {
  display: none;
}

.fav-icon {
  color: var(--md-on-surface-variant);
}

.fav-row.checked .fav-icon {
  color: var(--md-primary);
}

.fav-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
}

.fav-count {
  font-size: 11px;
  color: var(--md-on-surface-variant);
  opacity: 0.7;
}

.fav-create {
  display: flex;
  gap: 8px;
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px solid var(--md-outline-variant);
}

.fav-input {
  flex: 1;
  height: var(--md-control-h-sm);
  font-size: 12px;
}
</style>
