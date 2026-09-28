<template>
  <div class="login">
    <div class="bg-glow"></div>
    <div class="card">
      <div class="brand">
        <div class="logo"><Box :size="28" style="display: inline-flex; flex-shrink: 0" /></div>
        <h1>玲珑 Bin</h1>
        <p class="sub">电子物料库存管理</p>
      </div>
      <div class="form">
        <label class="field">
          <Mail :size="16" class="ico" style="display: inline-flex; flex-shrink: 0" />
          <input v-model="email" type="email" placeholder="邮箱" autocomplete="email" />
        </label>
        <label class="field">
          <Lock :size="16" class="ico" style="display: inline-flex; flex-shrink: 0" />
          <input v-model="password" type="password" placeholder="密码" autocomplete="current-password" />
        </label>
        <label class="remember">
          <input type="checkbox" v-model="remember" />
          <span>记住邮箱</span>
        </label>
        <button class="btn btn-primary submit" :disabled="loading" style="display: inline-flex; align-items: center; justify-content: center; gap: 6px" @click="doLogin">
          <span v-if="loading" class="spinner" />
          <LogIn v-else :size="16" style="display: inline-flex; flex-shrink: 0" />
          {{ loading ? '登录中…' : '登录' }}
        </button>
        <div class="form-row">
          <button class="btn signup" :disabled="loading" style="display: inline-flex; align-items: center; justify-content: center; gap: 6px" @click="doSignup">
            <UserPlus :size="16" style="display: inline-flex; flex-shrink: 0" />注册账号
          </button>
          <button class="btn offline-btn" :disabled="loading" style="display: inline-flex; align-items: center; justify-content: center; gap: 6px" @click="enterOffline">
            <HardDrive :size="16" style="display: inline-flex; flex-shrink: 0" />离线模式
          </button>
        </div>
        <p v-if="msg" class="msg" :class="{ err: isErr }">{{ msg }}</p>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { Box, Mail, Lock, LogIn, UserPlus, HardDrive } from 'lucide-vue-next'
import { signIn, signUp, setAuthState } from '../lib/auth'
import { setDataMode } from '../lib/appSettings'

const REMEMBER_KEY = 'vault:remember-email'
const router = useRouter()

const email = ref('')
const password = ref('')
const msg = ref('')
const isErr = ref(false)
const loading = ref(false)
const remember = ref(false)

onMounted(() => {
  const saved = localStorage.getItem(REMEMBER_KEY)
  if (saved) { email.value = saved; remember.value = true }
})

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function fail(msgText: string) {
  isErr.value = true
  msg.value = msgText
}

async function doLogin() {
  if (loading.value) return
  const e = email.value.trim()
  const p = password.value
  if (!e || !p) { fail('请输入邮箱和密码'); return }
  if (!EMAIL_RE.test(e)) { fail('邮箱格式不正确'); return }
  msg.value = ''; isErr.value = false; loading.value = true
  try {
    const { data, error } = await signIn(e, p)
    if (error) { isErr.value = true; msg.value = error.message }
    else {
      if (remember.value) localStorage.setItem(REMEMBER_KEY, e)
      else localStorage.removeItem(REMEMBER_KEY)
      setAuthState(true)
      router.push('/')
    }
  } finally { loading.value = false }
}
async function doSignup() {
  if (loading.value) return
  const e = email.value.trim()
  const p = password.value
  if (!e || !p) { fail('请输入邮箱和密码'); return }
  if (!EMAIL_RE.test(e)) { fail('邮箱格式不正确'); return }
  msg.value = ''; isErr.value = false; loading.value = true
  try {
    const { data, error } = await signUp(e, p)
    if (error) { isErr.value = true; msg.value = error.message }
    else if (data.session) { setAuthState(true); router.push('/') }
    else { msg.value = '注册成功，请查收验证邮件后再登录' }
  } finally { loading.value = false }
}
/** 进入离线模式：切到本地 SQLite，重载后免登录直接进入主界面 */
async function enterOffline() {
  if (loading.value) return
  msg.value = ''; isErr.value = false; loading.value = true
  try {
    await setDataMode('sqlite')
    location.reload()
  } catch {
    loading.value = false
    isErr.value = true
    msg.value = '切换离线模式失败，请重试'
  }
}
</script>

<style scoped>
.login {
  height: 100%; display: grid; place-items: center; padding: 24px;
  position: relative; overflow: hidden;
}
.bg-glow {
  position: absolute; inset: -20%;
  background:
    radial-gradient(ellipse 600px 400px at 30% 20%, rgba(79,140,255,0.15), transparent),
    radial-gradient(ellipse 500px 500px at 70% 70%, rgba(52,218,191,0.12), transparent);
  pointer-events: none;
}
.card {
  position: relative; width: 100%; max-width: 380px;
  background: var(--c-glass-strong);
  border: 1px solid var(--c-border);
  border-radius: var(--r-2xl);
  backdrop-filter: blur(32px);
  -webkit-backdrop-filter: blur(32px);
  padding: 36px 28px;
  box-shadow: var(--shadow-lg);
}
.brand { text-align: center; margin-bottom: 28px; }
.logo {
  width: 56px; height: 56px; border-radius: var(--r-lg); color: #fff;
  background: var(--grad-brand);
  display: grid; place-items: center;
  margin: 0 auto 16px;
  box-shadow: 0 6px 24px var(--c-primary-glow);
}
h1 { margin: 0; font-size: var(--fs-xl); font-weight: 700; letter-spacing: -0.02em; }
.sub { margin: 4px 0 0; color: var(--c-text-2); font-size: var(--fs-sm); }

.form { display: flex; flex-direction: column; gap: 12px; }
.field { position: relative; display: flex; align-items: center; }
.ico { position: absolute; left: 12px; color: var(--c-text-3); pointer-events: none; z-index: 1; }
.field input {
  width: 100%; height: var(--ctrl-h-lg); padding: 0 var(--btn-px) 0 38px;
  font-size: var(--fs-sm);
  background: var(--c-glass); border: 1px solid var(--c-border);
}
.field input:focus { background: var(--c-surface); }

.remember {
  display: flex; align-items: center; gap: 8px;
  font-size: var(--fs-sm); color: var(--c-text-2); cursor: pointer; user-select: none;
}
.remember input {
  width: 16px; height: 16px; cursor: pointer; accent-color: var(--c-primary);
  border-radius: var(--r-xs);
}
.remember span { line-height: 1; }

.submit {
  height: var(--ctrl-h-lg); font-size: var(--fs-md); font-weight: 600;
  margin-top: 4px;
}
.form-row { display: flex; gap: 10px; }
.signup {
  background: var(--c-primary-soft); border-color: var(--c-primary); color: var(--c-primary);
  height: var(--ctrl-h-lg); flex: 1; font-weight: 600;
}
.signup:hover { background: var(--c-primary); color: #fff; }
.offline-btn {
  background: transparent; border-color: var(--c-border); color: var(--c-text-2);
  height: var(--ctrl-h-lg); flex: 1;
}
.offline-btn:hover { color: var(--c-primary); border-color: var(--c-primary); background: var(--c-surface); }

.spinner {
  width: 16px; height: 16px; border: 2px solid rgba(255,255,255,0.3);
  border-top-color: #fff; border-radius: 50%; animation: spin 0.7s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }

.msg { font-size: var(--fs-sm); margin: 0; text-align: center; color: var(--c-success); }
.msg.err { color: var(--c-danger); }
</style>
