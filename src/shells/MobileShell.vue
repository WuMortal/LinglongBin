<template>
  <div class="mobile">
    <main class="content" :class="{ bare: isBare }">
      <slot />
    </main>
    <!-- tabbar：首页 / 物料 / 统计 / 设置（设置已是独立 Tab 路由 /m/settings） -->
    <nav v-if="!isBare" class="tabbar">
      <router-link v-for="r in nav" :key="r.path" :to="r.path" class="tab"
        :class="{ 'router-link-active': menuActive(r.path) }">
        <div class="tab-ico">
          <component :is="iconOf(r.meta?.icon)" :size="22" style="display: inline-flex; flex-shrink: 0" />
        </div>
        <span class="label">{{ r.meta?.title }}</span>
      </router-link>
    </nav>
  </div>
</template>

<script setup lang="ts">
import type { Component } from 'vue'
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { LayoutGrid, List, BarChart3, ScanLine, Settings, Folder, Box, Wrench, House } from 'lucide-vue-next'
import { mobileRoutes } from '../router'

// 全屏页（详情等）：隐藏 tabbar，页面自带返回栏与底部操作栏
const route = useRoute()
const isBare = computed(() => !!route.meta?.bare)

const iconMap: Record<string, Component> = {
  home: House,
  grid: LayoutGrid,
  list: List,
  chart: BarChart3,
  scan: ScanLine,
  gear: Settings,
  folder: Folder,
  box: Box,
  wrench: Wrench,
}
function iconOf(name?: string): Component {
  return (name && iconMap[name]) || LayoutGrid
}

const nav = mobileRoutes.filter(r => !!r.meta?.title)
// 隐藏子页面通过 meta.activeMenu 归并到所属菜单高亮（与桌面侧栏一致）
function menuActive(path: string): boolean {
  return route.path === path || route.meta?.activeMenu === path
}
</script>

<style scoped>
.mobile {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.content {
  flex: 1;
  overflow: auto;
  padding: 0px 16px;
  padding-bottom: calc(var(--tabbar-h) + env(safe-area-inset-bottom) + 8px);
}

/* 全屏页（bare）：无 tabbar，底部只留常规留白 */
.content.bare {
  padding-bottom: 16px;
}

.tabbar {
  position: fixed;
  left: 12px;
  right: 12px;
  bottom: 12px;
  min-height: 56px;
  padding: 6px 4px calc(6px + env(safe-area-inset-bottom));
  background: var(--c-glass-strong);
  backdrop-filter: blur(24px);
  -webkit-backdrop-filter: blur(24px);
  border: 1px solid var(--c-border);
  border-radius: var(--r-xl);
  display: flex;
  justify-content: space-around;
  align-items: center;
  box-shadow: var(--shadow-lg);
  z-index: 50;
}

.tab {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 3px;
  color: var(--c-text-3);
  text-decoration: none;
  font-size: 10px;
  font-weight: 500;
  transition: color var(--motion);
  background: transparent;
  border: none;
  padding: 0;
  cursor: pointer;
  font-family: inherit;
}

.tab:hover {
  color: var(--c-text-2);
}

.tab-ico {
  width: 32px;
  height: 32px;
  border-radius: var(--r-sm);
  display: grid;
  place-items: center;
  transition: all var(--motion);
}

.tab.router-link-active {
  color: var(--c-primary);
}

.tab.router-link-active .tab-ico {
  background: var(--c-surface-active);
}

.tab :deep(.icon) {
  color: inherit;
}
</style>
