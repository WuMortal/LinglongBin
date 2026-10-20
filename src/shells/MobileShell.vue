<template>
  <div class="mobile">
    <main class="content" :class="{ bare: isBare }">
      <slot />
    </main>
    <nav v-if="!isBare" class="tabbar" @contextmenu.prevent>
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
/* 刘海屏 / 打孔屏：状态栏区域从滚动区里划出去。
   不能只给 .content 加 padding-top —— 那是滚动容器的内边距，会跟着内容一起滚，
   静态首屏看着对，一滑内容就钻到状态栏底下去了。
   这里在「滚动容器的外面」预留：.mobile 是 border-box + height:100%，
   padding-top 会把 .content 整体下压，滚动区从状态栏下缘开始，内容永远滚不上去。 */
.mobile {
  display: flex;
  flex-direction: column;
  height: 100%;
  padding-top: env(safe-area-inset-top);
}

.content {
  flex: 1;
  overflow: auto;
  padding: 0px 16px;
  padding-bottom: calc(var(--tabbar-h) + max(12px, env(safe-area-inset-bottom)) + 8px);
}

/* 全屏页（bare）：无 tabbar，底部只留常规留白 */
.content.bare {
  padding-bottom: 16px;
}

.tabbar {
  position: fixed;
  left: 12px;
  right: 12px;
  /* 手势条 / 三大金刚键区：整卡抬到系统区上方，不再往卡内垫 env，
     否则图标被顶起、卡底留一大截空玻璃（真机上显得底部很高） */
  bottom: max(12px, env(safe-area-inset-bottom));
  min-height: 56px;
  padding: 6px 4px;
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
  /* 长按：禁选中 / 禁拖拽 / 禁 iOS 长按菜单与放大镜 / 去掉双击缩放带来的点击延迟 */
  user-select: none;
  -webkit-user-select: none;
  -webkit-user-drag: none;
  -webkit-touch-callout: none;
  touch-action: manipulation;
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
