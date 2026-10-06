<template>
  <div class="profile-view">
    <!-- 未登录 -->
    <section v-if="!store.auth.loggedIn" class="card empty">
      <MdIcon name="accountCircle" :size="52" class="empty-icon" />
      <div>当前未登录</div>
      <p class="hint" style="max-width: 420px">登录后可使用「探索」、查看并下载自己的收藏夹、点赞等互动功能。</p>
      <button class="btn" style="margin-top: 12px" @click="showLogin = true">
        <MdIcon name="person" :size="16" /> 去登录
      </button>
    </section>

    <template v-else>
      <!-- 个人信息卡 -->
      <section class="card profile-card">
        <div class="profile-head">
          <div class="avatar">
            <img
              v-if="profile?.face && !avatarFailed"
              :src="coverSrc(profile.face)"
              :alt="profile.name"
              @error="avatarFailed = true"
            />
            <MdIcon v-else name="accountCircle" :size="46" />
          </div>
          <div class="profile-main">
            <div class="row" style="gap: 8px; flex-wrap: wrap">
              <span class="profile-name">{{ profile?.name || store.auth.username || '已登录' }}</span>
              <span v-if="levelChip" class="chip ok">LV{{ profile?.level }}</span>
              <span v-if="vipChip" class="chip">{{ vipChip }}</span>
            </div>
            <div class="profile-mid mono">UID: {{ profile?.mid ?? store.auth.mid ?? '—' }}</div>
            <div class="profile-stats">
              <div class="stat"><b>{{ fmtNum(profile?.following) }}</b><span>关注</span></div>
              <div class="stat"><b>{{ fmtNum(profile?.follower) }}</b><span>粉丝</span></div>
              <div class="stat"><b>{{ profile?.coins ?? 0 }}</b><span>硬币</span></div>
            </div>
          </div>
          <div class="row" style="gap: 6px; flex-shrink: 0">
            <button class="btn btn-text btn-sm" :disabled="loading" @click="load">
              <MdIcon name="refresh" :size="15" /> 刷新
            </button>
            <button class="btn btn-secondary btn-sm" @click="doLogout">
              <MdIcon name="logout" :size="15" /> 退出登录
            </button>
          </div>
        </div>
        <div v-if="error" class="profile-err">{{ error }}</div>
      </section>

      <!-- 快捷入口 -->
      <section class="card">
        <h4 class="sec-title">快捷入口</h4>
        <div class="shortcut-grid">
          <button class="shortcut" @click="go('explore')">
            <MdIcon name="explore" :size="26" />
            <span>探索</span>
            <span class="hint">分区浏览与在线预览</span>
          </button>
          <button class="shortcut" @click="go('favorites')">
            <MdIcon name="star" :size="26" />
            <span>我的收藏</span>
            <span class="hint">查看并下载收藏夹</span>
          </button>
          <button class="shortcut" @click="go('download')">
            <MdIcon name="download" :size="26" />
            <span>下载任务</span>
            <span class="hint">进行中与历史记录</span>
          </button>
          <button class="shortcut" @click="go('player')">
            <MdIcon name="play" :size="26" />
            <span>播放器</span>
            <span class="hint">播放本地媒体与列表</span>
          </button>
          <button class="shortcut" @click="go('history')">
            <MdIcon name="history" :size="26" />
            <span>历史记录</span>
            <span class="hint">近期看过的视频，可续播</span>
          </button>
          <button class="shortcut" @click="go('logs')">
            <MdIcon name="list" :size="26" />
            <span>日志</span>
            <span class="hint">下载日志 / 软件日志</span>
          </button>
        </div>
      </section>
    </template>

    <LoginDialog :open="showLogin" @close="showLogin = false" @success="onLoginSuccess" />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import type { UserProfile } from '@shared/types'
import { store, toast } from '../store/app'
import MdIcon from '../components/MdIcon.vue'
import LoginDialog from '../components/LoginDialog.vue'

const profile = ref<UserProfile | null>(null)
const loading = ref(false)
const error = ref('')
const avatarFailed = ref(false)
const showLogin = ref(false)

const levelChip = computed(() => typeof profile.value?.level === 'number' && profile.value.level > 0)
const vipChip = computed(() => {
  const t = profile.value?.vipType ?? 0
  if (t <= 0) return ''
  return t >= 2 ? '年度大会员' : '大会员'
})

onMounted(() => {
  if (store.auth.loggedIn) void load()
})

watch(
  () => store.auth.loggedIn,
  (v) => {
    if (v) void load()
    else profile.value = null
  }
)

// 顶栏头像在未登录时点击会递增 loginRequest → 自动拉起登录窗口
watch(
  () => store.loginRequest,
  (v) => {
    if (v > 0 && !store.auth.loggedIn) showLogin.value = true
  },
  { immediate: true }
)

function coverSrc(url: string): string {
  return window.vd.imgUrl(url)
}

async function load(): Promise<void> {
  loading.value = true
  error.value = ''
  avatarFailed.value = false
  try {
    const res = await window.vd.getUserProfile()
    if (res) profile.value = res
    else error.value = '未能获取用户信息，请尝试重新登录'
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    loading.value = false
  }
}

function onLoginSuccess(): void {
  void load()
}

async function doLogout(): Promise<void> {
  await window.vd.logout()
  profile.value = null
  toast('已退出登录')
}

function go(view: 'explore' | 'favorites' | 'download' | 'player' | 'history' | 'logs'): void {
  store.view = view
}

function fmtNum(n?: number): string {
  const v = Number(n ?? 0)
  if (v >= 1e8) return `${(v / 1e8).toFixed(1)}亿`
  if (v >= 1e4) return `${(v / 1e4).toFixed(1)}万`
  return String(v)
}
</script>

<style scoped>
.profile-view {
  display: flex;
  flex-direction: column;
  gap: 16px;
  max-width: 900px;
}

.profile-head {
  display: flex;
  align-items: flex-start;
  gap: 16px;
  flex-wrap: wrap;
}

.avatar {
  width: 74px;
  height: 74px;
  border-radius: 50%;
  overflow: hidden;
  background: var(--md-secondary-container);
  color: var(--md-on-secondary-container);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.profile-main {
  flex: 1;
  min-width: 200px;
}

.profile-name {
  font-size: 20px;
  font-weight: 700;
}

.profile-mid {
  font-size: 12px;
  color: var(--md-on-surface-variant);
  margin-top: 2px;
}

.profile-stats {
  display: flex;
  gap: 22px;
  margin-top: 10px;
}

.stat {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
}

.stat b {
  font-size: 16px;
}

.stat span {
  font-size: 11px;
  color: var(--md-on-surface-variant);
}

.profile-err {
  margin-top: 10px;
  font-size: 12px;
  color: var(--md-error);
}

.shortcut-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  gap: 12px;
  margin-top: 4px;
}

.shortcut {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 4px;
  padding: 14px;
  border: 1px solid var(--md-outline-variant);
  border-radius: var(--md-radius-md);
  background: var(--md-surface-container-low);
  color: var(--md-on-surface);
  font-family: inherit;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  text-align: left;
  transition: background 0.16s, border-color 0.16s;
}

.shortcut:hover {
  background: var(--md-secondary-container);
  border-color: var(--md-primary);
}

.shortcut .hint {
  font-weight: 400;
}
</style>
