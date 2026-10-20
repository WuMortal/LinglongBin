<template>
  <section class="prof-card">
    <div class="avatar"><span>{{ initial }}</span></div>

    <div class="info">
      <div class="email" :title="email">{{ email }}</div>
      <div class="chips">
        <span class="chip" :class="offline ? 'off' : 'sync'">
          <component :is="offline ? HardDrive : Cloud" :size="12" class="ci" />
          {{ offline ? '本地 SQLite' : '云端同步' }}
        </span>
        <span class="chip ok"><i class="dot" />{{ offline ? '已就绪' : '在线' }}</span>
      </div>
    </div>

    <button v-if="needLogin" class="btn btn-danger logout" @click="onLogout">
      <LogOut :size="14" style="display: inline-flex; flex-shrink: 0" />退出
    </button>
    <span v-else class="offline-tag">
      <HardDrive :size="13" style="display: inline-flex; flex-shrink: 0" />离线模式
    </span>
  </section>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { Cloud, HardDrive, LogOut } from 'lucide-vue-next'
import { signOut, getSession } from '../../lib/auth'
import { isAuthRequired } from '../../lib/appSettings'
import { activeMode } from '../../lib/storage'
import { confirm } from '../../composables/confirm'

/**
 * 移动端账户卡片（设置 Tab 顶部）。
 * 桌面端账户信息在 GeneralSettings 的 .profile 里，移动端把它提到设置首页单独成卡，
 * 子面板复用桌面 pane 时通过 show-profile=false 隐藏，避免重复。
 * 每次从子面板返回列表都会重新挂载，存储模式 / 登录态自然拿到最新值。
 */
const email = ref('—')
const mode = ref(activeMode())
const offline = computed(() => mode.value === 'sqlite')
const needLogin = computed(() => isAuthRequired())
const initial = computed(() => email.value.charAt(0).toUpperCase() || 'U')

async function refresh() {
  const { data } = await getSession()
  const u = (data as { session?: { user?: { email?: string } } | null })?.session?.user
  email.value = u?.email || (needLogin.value ? '—' : '本地用户')
}

async function onLogout() {
  const ok = await confirm({
    title: '退出登录？',
    content: '退出后需要重新登录才能同步云端数据，本地 SQLite 数据不受影响。',
    confirmText: '退出',
    cancelText: '取消',
  })
  if (!ok) return
  await signOut()
  location.reload()
}

onMounted(() => {
  mode.value = activeMode()
  void refresh()
})
</script>

<style scoped>
.prof-card {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px;
  background: var(--c-surface);
  border: 1px solid var(--c-border);
  border-radius: var(--r-xl);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
}

.avatar {
  width: 46px;
  height: 46px;
  border-radius: 50%;
  background: var(--grad-brand);
  color: #fff;
  display: grid;
  place-items: center;
  font-size: 19px;
  font-weight: 700;
  flex-shrink: 0;
  box-shadow: 0 4px 12px -6px var(--c-primary-glow);
}

.info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.email {
  font-size: var(--fs-md);
  font-weight: 600;
  letter-spacing: -0.01em;
  color: var(--c-text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.chips {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 20px;
  padding: 0 8px;
  border-radius: var(--r-sm);
  background: var(--c-surface-hover);
  color: var(--c-text-2);
  font-size: var(--fs-xs);
  font-weight: 500;
  white-space: nowrap;
}

.chip.sync {
  background: var(--c-primary-soft);
  color: var(--c-primary);
}

.chip.off {
  background: var(--c-surface-hover);
  color: var(--c-text-2);
}

.chip.ok {
  background: rgba(52, 218, 191, 0.12);
  color: var(--c-accent);
}

.chip .ci {
  display: inline-flex;
  flex-shrink: 0;
}

.dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--c-accent);
  box-shadow: 0 0 6px var(--c-accent);
  flex-shrink: 0;
}

.logout {
  height: 30px;
  padding: 0 12px;
  font-size: var(--fs-xs);
  flex-shrink: 0;
}

.offline-tag {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 26px;
  padding: 0 10px;
  border-radius: var(--r-sm);
  border: 1px solid var(--c-border);
  background: var(--c-glass);
  color: var(--c-text-3);
  font-size: var(--fs-xs);
  font-weight: 500;
  flex-shrink: 0;
}
</style>
