<template>
  <section class="mpage">
    <!-- 返回：回到设置列表（/m/settings）。这里不挂 @back，交给 NavBar 默认行为：
         有历史就 router.back()（从子面板返回列表），无历史（深链直达）就 replace 到 fallback -->
    <NavBar :title="label" :fallback="'/m/settings'" />
    <div class="pane-wrap">
      <component v-if="paneComp" :is="paneComp" v-bind="paneProps" embedded />
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, type Component } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Settings, Database, Folder, Truck, Info, BookText } from 'lucide-vue-next'
import NavBar from '../../components/mobile/NavBar.vue'
import Categories from '../Categories.vue'
import Suppliers from '../Suppliers.vue'
import BasicData from '../BasicData.vue'
import GeneralSettings from '../GeneralSettings.vue'
import DataStorage from '../DataStorage.vue'
import AboutPane from '../AboutPane.vue'

/**
 * 设置子面板（独立路由页）：从 /m/settings 列表点进去后，URL 为 /m/settings/:tab，
 * 因此系统返回键 / 手势返回会回到 /m/settings 列表，而不是退出设置。
 */
const route = useRoute()
const router = useRouter()

const tabs = [
  { key: 'general', label: '常规', icon: Settings, tone: 'blue' },
  { key: 'data', label: '数据存储', icon: Database, tone: 'teal' },
  { key: 'dicts', label: '基础数据', icon: BookText, tone: 'purple' },
  { key: 'categories', label: '分类管理', icon: Folder, tone: 'blue' },
  { key: 'suppliers', label: '供应商管理', icon: Truck, tone: 'teal' },
  { key: 'about', label: '关于', icon: Info, tone: 'red' },
] as const

type TabKey = typeof tabs[number]['key']
const validKeys = new Set<string>(tabs.map(t => t.key))

const tab = computed<TabKey | null>(() => {
  const t = route.params.tab
  return typeof t === 'string' && validKeys.has(t) ? (t as TabKey) : null
})

// 非法 tab 参数（如手改 URL）→ 回设置列表
if (!tab.value) router.replace('/m/settings')

const label = computed(() => tabs.find(t => t.key === tab.value)?.label || '设置')

const paneMap: Record<TabKey, Component> = {
  general: GeneralSettings,
  data: DataStorage,
  dicts: BasicData,
  categories: Categories,
  suppliers: Suppliers,
  about: AboutPane,
}

const paneComp = computed<Component | null>(() => (tab.value ? paneMap[tab.value] : null))

/** 账户区已上移到设置首页的 ProfileCard，进「常规」时隐藏 pane 内那份，避免重复 */
const paneProps = computed<Record<string, unknown>>(() =>
  tab.value === 'general' ? { showProfile: false } : {}
)
</script>

<style scoped>
.mpage {
  display: flex;
  flex-direction: column;
  min-height: 100%;
}

.pane-wrap {
  margin-top: 14px;
}
</style>
