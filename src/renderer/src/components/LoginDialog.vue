<template>
  <div v-if="open" class="modal-mask" @click.self="emit('close')">
    <div class="modal">
      <h3>B站登录</h3>
      <p class="hint" style="margin: 4px 0 14px">凭据仅本地加密保存，不上传任何服务器。</p>

      <div class="login-methods">
        <!-- 内嵌窗口登录（推荐） -->
        <section class="login-card login-card-primary">
          <div class="login-card-head">
            <MdIcon name="desktop" :size="24" />
            <div>
              <strong class="login-title">内嵌窗口登录</strong>
              <span class="login-badge">推荐</span>
            </div>
          </div>
          <p class="login-desc">
            在本应用内打开登录窗口，扫码 / 账号登录完成后<strong>自动捕获 Cookie</strong>
          </p>
          <button class="btn" :disabled="quickLoggingIn" style="width: 100%" @click="doQuickLogin">
            <MdIcon name="link" :size="15" />
            {{ quickLoggingIn ? '打开中…' : '开始内嵌登录' }}
          </button>
        </section>

        <!-- 外部浏览器登录 -->
        <section class="login-card">
          <div class="login-card-head">
            <MdIcon name="globe" :size="24" />
            <div><strong class="login-title">外部浏览器登录</strong></div>
          </div>
          <p class="login-desc">
            拉起系统默认浏览器到 B 站登录页，登录完成后 <strong>F12 → 网络 → 复制 Cookie</strong> 粘贴到下方输入框
          </p>
          <button class="btn btn-secondary" style="width: 100%" @click="doOpenBrowserLogin">
            <MdIcon name="globe" :size="15" /> 打开浏览器登录
          </button>
        </section>

        <!-- 粘贴 Cookie -->
        <section class="login-card">
          <div class="login-card-head">
            <MdIcon name="clipboard" :size="24" />
            <div><strong class="login-title">直接粘贴 Cookie</strong></div>
          </div>
          <p class="login-desc">
            已在浏览器中登录？按 <kbd>F12</kbd> → 网络 → 刷新 → 点击任一请求 → 复制 Cookie 请求头粘贴
          </p>
          <textarea
            v-model="cookieText"
            class="textarea"
            style="min-height: 56px"
            placeholder="粘贴 Cookie（需包含 SESSDATA）…"
          ></textarea>
          <button class="btn btn-secondary" style="width: 100%; margin-top: 8px" :disabled="!cookieText.trim()" @click="doLogin">
            粘贴并登录
          </button>
        </section>
      </div>

      <div class="row" style="justify-content: flex-end; gap: 8px; margin-top: 12px">
        <button class="btn btn-text" @click="emit('close')">关闭</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { toast } from '../store/app'
import MdIcon from './MdIcon.vue'

/**
 * 复用的 B站登录弹窗。
 * 收藏夹页 / 用户个人页共用，避免两处各写一套登录 UI。
 */
withDefaults(defineProps<{ open: boolean }>(), { open: false })

const emit = defineEmits<{ (e: 'close'): void; (e: 'success'): void }>()

const cookieText = ref('')
const quickLoggingIn = ref(false)

async function doLogin(): Promise<void> {
  const res = await window.vd.loginCookie(cookieText.value)
  if (res.ok) {
    cookieText.value = ''
    toast('登录成功', 'success')
    emit('success')
    emit('close')
  } else {
    toast(`登录失败: ${res.error}`, 'error')
  }
}

async function doOpenBrowserLogin(): Promise<void> {
  await window.vd.openBrowserLogin()
  toast('已拉起默认浏览器，登录完成后回来粘贴 Cookie')
}

async function doQuickLogin(): Promise<void> {
  quickLoggingIn.value = true
  toast('正在打开内嵌登录窗口…请在其中完成 B 站登录')
  try {
    const res = await window.vd.quickLogin()
    if (res.ok) {
      toast('登录成功', 'success')
      emit('success')
      emit('close')
    } else {
      toast(res.error ?? '登录未完成', 'error')
    }
  } catch (e) {
    toast(`快速登录异常: ${e instanceof Error ? e.message : String(e)}`, 'error')
  } finally {
    quickLoggingIn.value = false
  }
}
</script>

<style scoped>
.login-methods {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.login-card {
  border: 1px solid var(--md-outline-variant);
  border-radius: var(--md-radius-md);
  padding: 14px;
  background: var(--md-surface-container-low);
  transition: border-color 0.2s;
}

.login-card:hover {
  border-color: var(--md-outline);
}

.login-card-primary {
  background: var(--md-primary-container);
  border-color: transparent;
}

.login-card-primary:hover {
  border-color: color-mix(in srgb, var(--md-primary) 40%, transparent);
}

.login-card-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
}

.login-title {
  font-size: 14px;
  font-weight: 600;
}

.login-badge {
  margin-left: 6px;
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 8px;
  background: var(--md-primary);
  color: var(--md-on-primary);
  font-weight: 600;
  vertical-align: middle;
}

.login-desc {
  font-size: 12px;
  color: var(--md-on-surface-variant);
  line-height: 1.6;
  margin-bottom: 10px;
}

.login-card-primary .login-desc {
  color: color-mix(in srgb, var(--md-on-primary-container) 85%, var(--md-on-surface-variant));
}

.login-desc strong {
  color: var(--md-on-surface);
  font-weight: 600;
}

.login-card-primary .login-desc strong {
  color: var(--md-on-primary-container);
}

.login-desc kbd {
  background: var(--md-surface-container-highest);
  padding: 1px 5px;
  border-radius: 4px;
  font-size: 11px;
  font-family: var(--md-font-mono);
}
</style>
