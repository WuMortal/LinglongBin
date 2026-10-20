<template>
  <section class="mpage">
    <!-- 设置列表 -->
    <template v-if="!active">
      <!-- <header class="head">
        <h1>设置</h1>
      </header> -->

      <div class="set-group">
        <button v-for="t in tabs" :key="t.key" class="set-row" @click="active = t.key">
          <span class="s-ico" :class="t.tone">
            <component :is="t.icon" :size="18" style="display: inline-flex; flex-shrink: 0" />
          </span>
          <span class="s-name">{{ t.label }}</span>
          <ChevronRight :size="16" class="s-arrow" style="display: inline-flex; flex-shrink: 0" />
        </button>
      </div>
    </template>

    <!-- 子面板：吸顶返回栏 + 复用桌面 pane（embedded） -->
    <template v-else>
      <NavBar :title="activeLabel" @back="active = null" />
      <div class="pane-wrap">
        <component :is="paneMap[active]" embedded />
      </div>
    </template>
  </section>
</template>

<script setup lang="ts">
import { ref, computed, type Component } from 'vue'
import { ChevronRight, Settings, Database, Folder, Truck, Info, BookText } from 'lucide-vue-next'
import NavBar from '../../components/mobile/NavBar.vue'
import Categories from '../Categories.vue'
import Suppliers from '../Suppliers.vue'
import BasicData from '../BasicData.vue'
import GeneralSettings from '../GeneralSettings.vue'
import DataStorage from '../DataStorage.vue'
import AboutPane from '../AboutPane.vue'

/**
 * 移动端设置 Tab：分组列表入口 → 子面板复用桌面 Settings 的 pane 组件（embedded 模式）。
 * pane 内部布局的移动端适配后续专项优化，先保证可达可用。
 */
const tabs = [
  { key: 'general', label: '常规', icon: Settings, tone: 'blue' },
  { key: 'data', label: '数据存储', icon: Database, tone: 'teal' },
  { key: 'dicts', label: '基础数据', icon: BookText, tone: 'purple' },
  { key: 'categories', label: '分类管理', icon: Folder, tone: 'blue' },
  { key: 'suppliers', label: '供应商管理', icon: Truck, tone: 'teal' },
  { key: 'about', label: '关于', icon: Info, tone: 'red' },
] as const

type TabKey = typeof tabs[number]['key']
const active = ref<TabKey | null>(null)

const paneMap: Record<TabKey, Component> = {
  general: GeneralSettings,
  data: DataStorage,
  dicts: BasicData,
  categories: Categories,
  suppliers: Suppliers,
  about: AboutPane,
}

const activeLabel = computed(() => tabs.find(t => t.key === active.value)?.label || '')
</script>

<style scoped>
.mpage {
  display: flex;
  flex-direction: column;
  min-height: 100%;
}

.head {
  margin-bottom: 12px;
}

.head h1 {
  margin: 0;
  font-size: var(--fs-xl);
  font-weight: 700;
  letter-spacing: -0.02em;
}

/* ===== 设置列表（分组卡片行） ===== */
.set-group {
  display: flex;
  flex-direction: column;
  background: var(--c-surface);
  border: 1px solid var(--c-border);
  border-radius: var(--r-xl);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  overflow: hidden;
}

.set-row {
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 52px;
  padding: 8px 14px;
  border: none;
  border-bottom: 1px solid var(--c-border-hairline);
  background: transparent;
  color: var(--c-text);
  font-family: inherit;
  font-size: var(--fs-md);
  font-weight: 500;
  text-align: left;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}

.set-row:last-child {
  border-bottom: none;
}

.set-row:active {
  background: var(--c-surface-hover);
}

.s-ico {
  width: 32px;
  height: 32px;
  border-radius: var(--r-md);
  display: grid;
  place-items: center;
  flex-shrink: 0;
}

.s-ico.blue {
  background: var(--c-primary-soft);
  color: var(--c-primary);
}

.s-ico.teal {
  background: rgba(52, 218, 191, 0.12);
  color: var(--c-accent);
}

.s-ico.red {
  background: rgba(255, 92, 114, 0.12);
  color: var(--c-danger);
}

.s-ico.purple {
  background: rgba(167, 139, 250, 0.12);
  color: var(--c-purple);
}

.s-name {
  flex: 1;
  min-width: 0;
}

.s-arrow {
  color: var(--c-text-3);
}

/* ===== 子面板 ===== */
.pane-wrap {
  margin-top: 14px;
}
</style>
