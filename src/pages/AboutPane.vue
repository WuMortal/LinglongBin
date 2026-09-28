<template>
  <div class="about-pane">
    <div class="about-logo">
      <img :src="logoUrl" alt="logo" />
      <div class="about-meta">
        <b class="app-name">LinglongBin</b>
        <span class="app-tagline">🔧 玲珑 Bin · 电子物料库存管家</span>
      </div>
      <div class="about-actions">
        <span class="about-version">v{{ currentVersion || '0.1.0' }}</span>
        <button class="btn-check-update"
          :disabled="status === 'checking' || status === 'downloading' || status === 'installing'" @click="handleCheck">
          <RefreshCw v-if="status === 'checking'" class="icon-spin" :size="12" />
          <RefreshCw v-else :size="12" />
          {{ status === 'checking' ? '检查中...' : '检查更新' }}
        </button>
        <a class="repo-link" role="button" tabindex="0" title="在 GitHub 查看源码" @click="openRepo"
          @keydown.enter="openRepo">
          <Github :size="13" style="display: inline-flex; flex-shrink: 0" />
          <span>开源地址</span>
        </a>
      </div>
    </div>
    <!-- 功能介绍 -->
    <div class="feature-section">
      <span class="section-title">功能介绍</span>
      <div class="feature-grid">
        <div v-for="f in features" :key="f.title" class="feature-card">
          <component :is="f.icon" class="fc-icon" :size="18" />
          <div class="fc-body">
            <b class="fc-title">{{ f.title }}</b>
            <span class="fc-desc">{{ f.desc }}</span>
          </div>
        </div>
      </div>
    </div>

    <!-- 更新区域：仅在检查出结果后展示（未触发更新时隐藏标题） -->
    <div v-if="status !== 'idle' && status !== 'checking'" class="update-section">
      <div class="update-head">
        <span class="update-title">软件更新</span>
      </div>

      <div class="update-body">
        <!-- 发现新版本 -->
        <div v-if="(status === 'available' || status === 'downloading' || status === 'installing') && updateInfo"
          class="update-available">
          <div class="ua-header">
            <PartyPopper class="ua-icon" :size="15" />
            <span class="ua-version">发现新版本 v{{ updateInfo.version }}</span>
            <span class="ua-date">{{ updateInfo.date || '' }}</span>
            <button class="btn-install" :disabled="status === 'downloading' || status === 'installing'"
              @click="handleInstall">
              <RefreshCw v-if="status === 'downloading'" class="icon-spin" :size="13" />
              <Download v-else :size="13" />
              {{ status === 'downloading' ? '下载中...' : status === 'installing' ? '安装中...' : '下载并安装' }}
            </button>
          </div>
          <pre v-if="updateInfo.body" class="ua-notes">{{ updateInfo.body }}</pre>
          <div v-if="status === 'downloading'" class="ua-progress">
            <div class="progress-bar">
              <div class="progress-fill" :style="{ width: progress.percent + '%' }"></div>
            </div>
            <span class="progress-text">
              {{ progress.percent }}% · {{ formatBytes(progress.downloaded) }} / {{ formatBytes(progress.contentLength)
              }}
            </span>
          </div>
        </div>

        <!-- 已是最新 -->
        <div v-else-if="status === 'up-to-date'" class="update-msg success">
          <CheckCircle2 :size="14" />
          <span>当前已是最新版本</span>
        </div>

        <!-- 出错 -->
        <div v-else-if="status === 'error'" class="update-msg error">
          <XCircle :size="14" />
          <span>{{ errorMsg || '检查更新失败' }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted } from 'vue'
import { RefreshCw, Download, CheckCircle2, XCircle, PartyPopper, Boxes, Warehouse, ListTree, PackageSearch, BarChart3, Cloud, Github } from 'lucide-vue-next'
import logoUrl from '../../src-tauri/icons/logo.svg'
import { useUpdaterStore } from '@/stores/updater'
import { openExternal } from '@/lib/db'
import { resolveRepoUrl, assertRepoUrl } from '@/lib/strKit'

defineProps<{ embedded?: boolean }>()

const features = [
  { icon: Boxes, title: '物料管理', desc: '统一管理电阻、电容、芯片等元器件，支持分类、参数与图片' },
  { icon: Warehouse, title: '库存中心', desc: '出入库记录、待采单与批量导入，库存变动全程可追溯' },
  { icon: ListTree, title: 'BOM 管理', desc: '维护 BOM 项目与物料清单，关联物料库存' },
  { icon: PackageSearch, title: '立创匹配', desc: '立创官网物料库存查询，快速匹配缺失物料' },
  { icon: BarChart3, title: '统计看板', desc: '库存价值、用量趋势与低库存预警一目了然' },
  { icon: Cloud, title: '数据多模式', desc: '本地 SQLite 与 Supabase 云同步，离线模式可用' },
]

const { status, errorMsg, currentVersion, updateInfo, progress, loadCurrentVersion, checkForUpdate, downloadAndInstall } =
  useUpdaterStore()

onMounted(() => {
  loadCurrentVersion()
})

async function handleCheck() {
  await checkForUpdate()
}

async function handleInstall() {
  await downloadAndInstall()
}

function openRepo() {
  if (!assertRepoUrl()) return
  void openExternal(resolveRepoUrl(), false)
}

function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(1024))
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`
}
</script>

<style scoped>
.about-pane {
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.about-logo {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 16px 0;
}

.about-logo img {
  width: 64px;
  height: 64px;
  border-radius: var(--r-md);
  flex-shrink: 0;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.12);
}

.about-meta {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.about-meta .app-name {
  font-size: var(--fs-xl);
  font-weight: 700;
  color: var(--c-text);
  letter-spacing: -0.01em;
}

.about-meta .app-tagline {
  font-size: var(--fs-sm);
  color: var(--c-text-2);
}

.repo-link {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  margin-top: 2px;
  width: fit-content;
  font-size: var(--fs-xs);
  color: var(--c-primary);
  cursor: pointer;
  transition: color var(--motion-fast), opacity var(--motion-fast);
}

.repo-link:hover {
  opacity: 0.8;
  text-decoration: underline;
}

.repo-link:focus-visible {
  outline: 2px solid var(--c-primary);
  outline-offset: 2px;
  border-radius: 3px;
}

.about-actions {
  margin-left: auto;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 6px;
}

.about-version {
  font-size: var(--fs-xs);
  color: var(--c-text-2);
  font-family: monospace;
}

/* ===== 功能介绍 ===== */
.feature-section {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding-top: 16px;
  border-top: 1px solid var(--c-border-hairline);
}

.section-title {
  font-size: var(--fs-sm);
  font-weight: 600;
  color: var(--c-text);
}

.feature-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 12px;
}

.feature-card {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 12px;
  background: var(--c-surface);
  border: 1px solid var(--c-border-hairline);
  border-radius: var(--r-md);
  transition: border-color var(--motion-fast), box-shadow var(--motion-fast);
}

.feature-card:hover {
  border-color: var(--c-primary);
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.06);
}

.fc-icon {
  color: var(--c-primary);
  flex-shrink: 0;
  margin-top: 1px;
}

.fc-body {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}

.fc-title {
  font-size: var(--fs-sm);
  font-weight: 600;
  color: var(--c-text);
}

.fc-desc {
  font-size: var(--fs-xs);
  color: var(--c-text-2);
  line-height: 1.5;
}

/* ===== 更新区域 ===== */
.update-section {
  padding-top: 16px;
  border-top: 1px solid var(--c-border-hairline);
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.update-head {
  display: flex;
  align-items: center;
  gap: 12px;
}

.update-title {
  font-size: var(--fs-sm);
  font-weight: 600;
  color: var(--c-text);
}

.btn-check-update {
  margin-left: auto;
  padding: 5px 12px;
  border: 1px solid var(--c-primary);
  background: var(--c-primary-soft);
  color: var(--c-primary);
  border-radius: var(--r-sm);
  cursor: pointer;
  font-size: var(--fs-xs);
  font-weight: 500;
  transition: all var(--motion-fast);
  display: inline-flex;
  align-items: center;
  gap: 5px;
}

.btn-check-update:hover:not(:disabled) {
  background: var(--c-primary);
  color: #fff;
}

.btn-check-update:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.update-body {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.update-available {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px 12px;
  background: var(--c-primary-soft);
  border: 1px solid var(--c-primary);
  border-radius: var(--r-sm);
}

.ua-header {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.ua-icon {
  color: var(--c-primary);
  flex-shrink: 0;
}

.ua-version {
  font-size: var(--fs-sm);
  font-weight: 600;
  color: var(--c-primary);
}

.ua-date {
  font-size: var(--fs-xs);
  color: var(--c-text-2);
}

.btn-install {
  margin-left: auto;
  padding: 5px 12px;
  border: none;
  background: var(--c-primary);
  color: #fff;
  border-radius: var(--r-sm);
  cursor: pointer;
  font-size: var(--fs-xs);
  font-weight: 500;
  transition: all var(--motion-fast);
  display: inline-flex;
  align-items: center;
  gap: 5px;
}

.btn-install:hover:not(:disabled) {
  filter: brightness(0.95);
}

.btn-install:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.ua-notes {
  margin: 0;
  padding: 8px 10px;
  background: var(--c-surface);
  border-radius: var(--r-sm);
  max-height: 140px;
  overflow-y: auto;
  font-family: inherit;
  font-size: var(--fs-xs);
  color: var(--c-text);
  white-space: pre-wrap;
  word-break: break-word;
}

.ua-progress {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.progress-bar {
  width: 100%;
  height: 6px;
  background: var(--c-surface);
  border-radius: 3px;
  overflow: hidden;
}

.progress-fill {
  height: 100%;
  background: var(--c-primary);
  border-radius: 3px;
  transition: width 0.2s ease;
}

.progress-text {
  font-size: var(--fs-xs);
  color: var(--c-text-2);
  font-family: monospace;
}

.update-msg {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
  border-radius: var(--r-sm);
  font-size: var(--fs-sm);
}

.update-msg.success {
  color: var(--c-success, #2e9e5b);
  background: color-mix(in srgb, var(--c-success, #2e9e5b) 12%, transparent);
}

.update-msg.error {
  color: var(--c-danger, #d6453d);
  background: color-mix(in srgb, var(--c-danger, #d6453d) 12%, transparent);
}

.icon-spin {
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  from {
    transform: rotate(0deg);
  }

  to {
    transform: rotate(360deg);
  }
}

@media (max-width: 600px) {
  .feature-grid {
    grid-template-columns: 1fr;
  }
}
</style>
