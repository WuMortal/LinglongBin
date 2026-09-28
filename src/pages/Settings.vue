<template>
  <Teleport to="body">
    <div v-if="visible" class="modal-mask" @click.self="close">
      <div class="modal settings-modal">
        <!-- <button class="modal-close" title="关闭" @click="close">
          <X :size="16" style="display: inline-flex; flex-shrink: 0" />
        </button> -->
        <div class="modal-body settings-body">
          <aside class="tabs-col">
            <button v-for="t in tabs" :key="t.key" class="tab-item" :class="{ on: tab === t.key }" @click="tab = t.key">
              <component :is="t.icon" :size="16" style="display: inline-flex; flex-shrink: 0" />
              <span>{{ t.label }}</span>
            </button>
          </aside>
          <section class="tab-content">
            <!-- 与库存中心同一套 tab 切换动效：过渡只作用在内容区，左侧 tab 栏与底部按钮保持不动 -->
            <transition name="tabfade" mode="out-in">
              <div :key="tab" class="pane pane-embed">
                <component :is="curPane" embedded />
              </div>
            </transition>
          </section>
        </div>
        <div class="modal-foot">
          <button class="btn btn-ghost" @click="close">关闭</button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import type { Component } from 'vue'
import { Settings, Database, Folder, Truck, Info, BookText } from 'lucide-vue-next'
import Categories from './Categories.vue'
import Suppliers from './Suppliers.vue'
import BasicData from './BasicData.vue'
import GeneralSettings from './GeneralSettings.vue'
import DataStorage from './DataStorage.vue'
import AboutPane from './AboutPane.vue'

const props = defineProps<{ modelValue: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [v: boolean] }>()

const visible = computed({
  get: () => props.modelValue,
  set: v => emit('update:modelValue', v)
})

function close() { visible.value = false }

const tabs = [
  { key: 'general', label: '常规', icon: Settings },
  { key: 'data', label: '数据存储', icon: Database },
  { key: 'dicts', label: '基础数据', icon: BookText },
  { key: 'categories', label: '分类管理', icon: Folder },
  { key: 'suppliers', label: '供应商管理', icon: Truck },
  { key: 'about', label: '关于', icon: Info },
] as const

type TabKey = typeof tabs[number]['key']
const tab = ref<TabKey>('general')

/** tab key → 面板组件 */
const paneMap: Record<TabKey, Component> = {
  general: GeneralSettings,
  data: DataStorage,
  dicts: BasicData,
  categories: Categories,
  suppliers: Suppliers,
  about: AboutPane,
}
const curPane = computed(() => paneMap[tab.value])

// 打开时重置到常规 tab
watch(visible, (v) => {
  if (v) tab.value = 'general'
})

// Esc 关闭
function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape' && visible.value) close()
}
watch(visible, (v) => {
  if (v) window.addEventListener('keydown', onKey)
  else window.removeEventListener('keydown', onKey)
})
</script>

<style scoped>
.modal-mask .settings-modal {
  position: relative;
  max-width: 880px;
  height: min(600px, 86vh);
}

.modal-close {
  position: absolute;
  top: 10px;
  right: 10px;
  z-index: 10;
  width: 28px;
  height: 28px;
  border-radius: var(--r-sm);
  border: none;
  background: transparent;
  color: var(--c-text-2);
  cursor: pointer;
  display: grid;
  place-items: center;
  transition: all var(--motion-fast);
}

.modal-close:hover {
  background: var(--c-surface-active);
  color: var(--c-text);
}

.settings-body {
  padding: 0;
  display: flex;
  flex-direction: row;
  overflow: hidden;
}

.tabs-col {
  width: 150px;
  flex-shrink: 0;
  padding: 10px 8px;
  padding-left: 0px;
  display: flex;
  flex-direction: column;
  gap: 3px;
  border-right: 1px solid var(--c-border-hairline);
}

.tab-item {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  height: 38px;
  padding: 0 12px;
  border-radius: var(--r-sm);
  border: 1px solid transparent;
  background: transparent;
  color: var(--c-text-2);
  font-size: var(--fs-sm);
  font-weight: 500;
  cursor: pointer;
  transition: background-color var(--motion-fast), color var(--motion-fast), border-color var(--motion-fast);
  text-align: left;
}

.tab-item:hover {
  background: var(--c-surface-hover);
  color: var(--c-text);
}

.tab-item.on {
  background: var(--c-primary-soft);
  border-color: rgba(79, 140, 255, 0.25);
  color: var(--c-primary);
  font-weight: 600;
}

.tab-content {
  flex: 1;
  min-width: 0;
  overflow-y: auto;
  padding: 14px 18px;
}

.pane {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

/* 嵌入子页面（常规 / 数据存储 / 基础数据 / 分类 / 供应商 / 关于） */
.pane-embed {
  min-height: 0;
}

/* ===== tab 内容区轻过渡（与 Stock.vue 的 tabfade 同一组参数） ===== */
.tabfade-enter-active,
.tabfade-leave-active {
  transition: opacity 160ms ease, transform 160ms cubic-bezier(0.22, 1, 0.36, 1);
}

.tabfade-enter-from {
  opacity: 0;
  transform: translateY(6px);
}

.tabfade-leave-to {
  opacity: 0;
  transform: translateY(-3px);
}

@media (prefers-reduced-motion: reduce) {

  .tabfade-enter-from,
  .tabfade-leave-to {
    transform: none;
  }
}

@media (max-width: 600px) {
  .settings-modal {
    max-width: 100%;
    height: 90vh;
  }

  .settings-body {
    flex-direction: column;
  }

  .tabs-col {
    width: 100%;
    height: auto;
    flex-direction: row;
    flex-wrap: wrap;
    border-right: none;
    border-bottom: 1px solid var(--c-border-hairline);
    padding: 10px 12px;
  }

  .tab-item {
    flex: 1 1 auto;
  }
}
</style>
