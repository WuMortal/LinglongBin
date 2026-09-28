<template>
  <div class="pane-general">
    <div class="profile">
      <div class="avatar">
        <span>{{ email.charAt(0).toUpperCase() || 'U' }}</span>
      </div>
      <div class="prof-info">
        <div class="prof-row">
          <span class="prof-label">邮箱</span>
          <b>{{ email }}</b>
        </div>
        <div class="prof-row">
          <span class="prof-label">存储</span>
          <b v-if="activeMode === 'sqlite'" class="off">
            <HardDrive :size="12" style="display: inline-flex; flex-shrink: 0" />本地 SQLite
          </b>
          <b v-else class="sync">
            <Cloud :size="12" style="display: inline-flex; flex-shrink: 0" />云端同步
          </b>
        </div>
        <div class="prof-row">
          <span class="prof-label">状态</span>
          <b class="ok"><span class="dot" />{{ activeMode === 'sqlite' ? '已就绪' : '在线' }}</b>
        </div>
      </div>
      <button v-if="needLogin" class="btn btn-danger prof-logout" @click="logout">
        <LogOut :size="14" style="display: inline-flex; flex-shrink: 0" />退出
      </button>
      <button v-else class="btn prof-logout" disabled style="opacity: 0.6; cursor: not-allowed;">
        <HardDrive :size="14" style="display: inline-flex; flex-shrink: 0" />离线模式
      </button>
    </div>

    <div class="theme-section">
      <div class="theme-label">
        <Palette :size="13" style="display: inline-flex; flex-shrink: 0" />外观主题
      </div>
      <div class="theme-opts-compact">
        <button class="theme-opt-c" :class="{ on: theme === 'light' }" @click="setTheme('light')">
          <Sun :size="13" style="display: inline-flex; flex-shrink: 0" /><span>浅色</span>
        </button>
        <button class="theme-opt-c" :class="{ on: theme === 'dark' }" @click="setTheme('dark')">
          <Moon :size="13" style="display: inline-flex; flex-shrink: 0" /><span>深色</span>
        </button>
        <button class="theme-opt-c" :class="{ on: theme === 'auto' }" @click="setTheme('auto')">
          <Palette :size="13" style="display: inline-flex; flex-shrink: 0" /><span>自动</span>
        </button>
      </div>
    </div>

    <div class="cache-section">
      <div class="cache-label">
        <Database :size="13" style="display: inline-flex; flex-shrink: 0" />立创数据缓存
      </div>
      <div class="cache-row">
        <span class="cache-meta">本地已缓存立创查询与图片共 {{ cacheCount === null ? '—' : cacheCount + ' 条' }}</span>
        <button class="btn btn-ghost cache-btn" :disabled="clearingCache" @click="clearLcscCache">
          <Trash2 :size="14" style="display: inline-flex; flex-shrink: 0" />
          {{ clearingCache ? '清理中…' : '清空' }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { Cloud, LogOut, Palette, Sun, Moon, HardDrive, Trash2, Database } from 'lucide-vue-next'
import { signOut, getSession } from '../lib/auth'
import { isAuthRequired } from '../lib/appSettings'
import { activeMode as getActiveMode } from '../lib/storage'
import { useTheme } from '../composables/useTheme'
import { lcscCacheClear, lcscCacheCount } from '../lib/lcscCache'
import { confirm } from '../composables/confirm'
import { useToast } from '../composables/toast'

defineProps<{ embedded?: boolean }>()

const { theme, setTheme } = useTheme()
const email = ref('—')
const activeMode = ref(getActiveMode())
const needLogin = computed(() => isAuthRequired())

async function refreshData() {
  const { data } = await getSession()
  const u = (data as { session?: { user?: { email?: string } } | null })?.session?.user
  email.value = u?.email || (needLogin.value ? '—' : '本地用户')
}

async function logout() {
  await signOut()
  location.reload()
}

const toast = useToast()
const cacheCount = ref<number | null>(null)
const clearingCache = ref(false)

onMounted(() => {
  void refreshData()
  void (async () => { cacheCount.value = await lcscCacheCount() })()
})

/** 清空立创查询缓存（跨重启的本地缓存，删除后下次查询重新联网） */
async function clearLcscCache() {
  const ok = await confirm({
    title: '清空立创缓存？',
    content: '将删除本地保存的立创物料查询、搜索结果与图片映射记录。清空后再次查询会重新联网获取，不影响已入库的物料数据。',
    confirmText: '清空',
    cancelText: '取消',
  })
  if (!ok) return
  clearingCache.value = true
  try {
    await lcscCacheClear()
    cacheCount.value = 0
    toast.success('已清空立创缓存')
  } catch (e: unknown) {
    toast.error('清空失败：' + ((e as Error).message || e))
  } finally {
    clearingCache.value = false
  }
}
</script>

<style scoped>
.pane-general {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

/* 账户 */
.profile {
  display: flex;
  gap: 16px;
  align-items: flex-start;
  padding-bottom: 16px;
  border-bottom: 1px solid var(--c-border-hairline);
}

.avatar {
  width: 52px;
  height: 52px;
  border-radius: 50%;
  background: var(--grad-brand);
  color: #fff;
  display: grid;
  place-items: center;
  font-size: 22px;
  font-weight: 700;
  flex-shrink: 0;
}

.prof-info {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
  flex: 1;
}

.prof-row {
  display: flex;
  align-items: center;
  gap: 18px;
  font-size: var(--fs-sm);
  flex-wrap: wrap;
}

.prof-label {
  color: var(--c-text-2);
  font-size: var(--fs-xs);
  line-height: var(--fs-xs);
  min-width: 32px;
}

.prof-row b {
  font-weight: 500;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  word-break: break-all;
}

.prof-row .sync {
  color: var(--c-primary);
}

.prof-row .ok {
  color: var(--c-accent);
}

.prof-row .ok .dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--c-accent);
  box-shadow: 0 0 6px var(--c-accent);
}

.prof-logout {
  height: 28px;
  padding: 0 12px;
  font-size: var(--fs-xs);
  align-self: flex-start;
  flex-shrink: 0;
}

/* 主题 */
.theme-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.theme-label {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: var(--fs-xs);
  color: var(--c-text-2);
  font-weight: 500;
}

.theme-opts-compact {
  display: flex;
  gap: 6px;
}

.theme-opt-c {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 5px 12px;
  height: 30px;
  border-radius: var(--r-sm);
  border: 1px solid var(--c-border);
  background: var(--c-glass);
  color: var(--c-text-2);
  font-size: var(--fs-xs);
  font-weight: 500;
  cursor: pointer;
  transition: all var(--motion-fast);
}

.theme-opt-c:hover {
  background: var(--c-surface-hover);
  border-color: var(--c-border-strong);
}

.theme-opt-c.on {
  border-color: var(--c-primary);
  background: rgba(79, 140, 255, 0.1);
  color: var(--c-primary);
}

/* 立创数据缓存 */
.cache-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
  /* padding-top: 14px;
  border-top: 1px solid var(--c-border-hairline); */
}

.cache-label {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: var(--fs-xs);
  color: var(--c-text-2);
  font-weight: 500;
}

.cache-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.cache-meta {
  font-size: var(--fs-xs);
  color: var(--c-text-3);
}

.cache-btn {
  height: 28px;
  padding: 0 12px;
  font-size: var(--fs-xs);
  flex-shrink: 0;
}
</style>
