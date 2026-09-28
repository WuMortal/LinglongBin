<template>
  <div class="desktop">
    <aside class="sidebar">
      <div class="brand" role="button" tabindex="0" title="在 GitHub 查看源码" @click="openRepo" @keydown.enter="openRepo">
        <div class="logo">
          <img :src="logoUrl" alt="logo" />
        </div>
        <span class="brand-name">玲珑 Bin</span>
      </div>
      <nav class="nav">
        <router-link
          v-for="r in nav" :key="r.path" :to="r.path" class="nav-item"
          :class="{ 'router-link-active': menuActive(r.path) }"
        >
          <component :is="iconOf(r.meta?.icon)" :size="20" style="display: inline-flex; flex-shrink: 0" />
          <span class="label">{{ r.meta?.title }}</span>
        </router-link>
      </nav>
      <div class="bottom">
        <div class="bottom-row">
          <button v-if="!isOffline" class="nav-item bottom-main" @click="logout">
            <LogOut :size="18" style="display: inline-flex; flex-shrink: 0" />
            <span class="label">退出登录</span>
          </button>
          <button v-else class="nav-item offline-tag bottom-main" disabled>
            <HardDrive :size="18" style="display: inline-flex; flex-shrink: 0" />
            <span class="label">离线模式</span>
          </button>
          <button class="nav-item icon-btn" title="设置" @click="settingsOpen = true">
            <Settings :size="18" style="display: inline-flex; flex-shrink: 0" />
          </button>
        </div>
      </div>
    </aside>
    <main class="content">
      <slot />
    </main>
    <SettingsModal v-model="settingsOpen" />
  </div>
</template>

<script setup lang="ts">
import type { Component } from 'vue'
import { computed, ref } from 'vue'
import { useRoute } from 'vue-router'
import { Box, LayoutGrid, ArrowLeftRight, List, BarChart3, ScanLine, Settings, Folder, LogOut, HardDrive, Wrench } from 'lucide-vue-next'
import { routes } from '../router'
import { signOut } from '../lib/auth'
import { openExternal } from '../lib/db'
import { resolveRepoUrl, assertRepoUrl } from '../lib/strKit'
import { activeMode as getActiveMode } from '../lib/storage'
import SettingsModal from '../pages/Settings.vue'
import logoUrl from '../../src-tauri/icons/logo.svg'

const settingsOpen = ref(false)

const iconMap: Record<string, Component> = {
  grid: LayoutGrid,
  swap: ArrowLeftRight,
  list: List,
  chart: BarChart3,
  scan: ScanLine,
  gear: Settings,
  folder: Folder,
  wrench: Wrench,
  box: Box,
}
function iconOf(name?: string): Component {
  return (name && iconMap[name]) || LayoutGrid
}

const route = useRoute()
const nav = routes.filter(r => !!r.meta?.title && !r.meta?.hidden)
// 隐藏子页面（如 /categories、/suppliers）通过 meta.activeMenu 归并到所属菜单高亮
function menuActive(path: string): boolean {
  return route.path === path || route.meta?.activeMenu === path
}
const isOffline = computed(() => getActiveMode() === 'sqlite')
function logout() { void signOut() }
function openRepo() {
  if (!assertRepoUrl()) return
  void openExternal(resolveRepoUrl(), false)
}
</script>

<style scoped>
.desktop {
  display: flex;
  height: 100%;
}

.sidebar {
  width: var(--sidebar-w-expanded);
  flex-shrink: 0;
  background: var(--c-surface);
  backdrop-filter: blur(24px) saturate(180%);
  -webkit-backdrop-filter: blur(24px) saturate(180%);
  border-right: 1px solid var(--c-border);
  /* box-shadow: 1px 0 0 rgba(255,255,255,0.02), 4px 0 24px rgba(0,0,0,0.18); */
  padding: 18px 14px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  position: relative;
}

/* 品牌渐变收尾，过渡更自然 */
.sidebar::after {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  top: 76px;
  height: 1px;
  background: linear-gradient(90deg, transparent, rgba(79, 140, 255, 0.35), rgba(52, 218, 191, 0.25), transparent);
  opacity: 0.6;
  pointer-events: none;
}

.brand {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 4px 8px 18px;
  cursor: pointer;
  border-radius: var(--r-md);
  transition: background var(--motion);
}
.brand:hover {
  background: var(--c-surface-hover);
}
.brand:hover .brand-name {
  color: var(--c-primary);
}
.brand:focus-visible {
  outline: 2px solid var(--c-primary);
  outline-offset: 1px;
}

.brand-name {
  font-size: var(--fs-xl);
  font-weight: 700;
  color: var(--c-text);
  letter-spacing: 0.2px;
}

.logo {
  width: 36px;
  height: 36px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--r-sm);
  overflow: hidden;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.12);
}

.logo img {
  width: 100%;
  height: 100%;
  object-fit: contain;
  display: block;
}

.nav {
  display: flex;
  flex-direction: column;
  gap: 4px;
  flex: 1;
  padding-top: 6px;
}

.nav-item {
  position: relative;
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  height: 48px;
  padding: 0 12px;
  border-radius: var(--r-md);
  color: var(--c-text-2);
  border: 1px solid transparent;
  transition: all var(--motion);
  cursor: pointer;
}

.nav-item:hover {
  background: var(--c-surface-hover);
  border-color: var(--c-border);
  color: var(--c-text);
  /* transform: translateY(-1px); */
}

.nav-item.router-link-active {
  background: var(--c-primary-soft);
  border-color: rgba(79, 140, 255, 0.25);
  color: var(--c-primary);
  font-weight: 600;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.05), 0 2px 8px rgba(79, 140, 255, 0.12);
}

/* .nav-item.router-link-active::before {
  content: '';
  position: absolute;
  left: -1px;
  top: 50%;
  transform: translateY(-50%);
  width: 3px;
  height: 20px;
  border-radius: 0 2px 2px 0;
  background: var(--grad-brand);
  box-shadow: 0 0 8px var(--c-primary-glow);
} */

.nav-item :deep(.icon) {
  color: inherit;
  flex-shrink: 0;
  transition: transform var(--motion);
}

.nav-item:hover :deep(.icon) {
  transform: scale(1.1);
}

.nav-item.router-link-active :deep(.icon) {
  filter: drop-shadow(0 0 4px var(--c-primary-glow));
}

.nav-item .label {
  font-size: var(--fs-md);
  font-weight: inherit;
  white-space: nowrap;
}

.bottom {
  display: flex;
  flex-direction: column;
  padding-top: 10px;
  border-top: 1px solid var(--c-border-hairline);
  margin-top: 4px;
}

.bottom-row {
  display: flex;
  gap: 6px;
  align-items: stretch;
}

.bottom-row .bottom-main {
  flex: 1;
  min-width: 0;
}

.bottom .nav-item:hover {
  color: var(--c-danger);
  border-color: rgba(255, 92, 114, 0.25);
  background: rgba(255, 92, 114, 0.08);
}

.bottom .nav-item.offline-tag {
  opacity: 0.55;
  cursor: not-allowed;
  color: var(--c-text-3);
}

.bottom .nav-item.offline-tag:hover {
  background: transparent;
  border-color: transparent;
}

.bottom .nav-item.icon-btn {
  flex: none;
  width: 48px;
  height: 48px;
  padding: 0;
  justify-content: center;
}

.bottom .nav-item.icon-btn:hover {
  color: var(--c-primary);
  border-color: rgba(79, 140, 255, 0.25);
  background: var(--c-primary-soft);
}

.content {
  flex: 1;
  overflow: auto;
  padding: 24px 32px;
  position: relative;
}
</style>
