<template>
  <section class="page">
    <header class="head">
      <div>
        <h1>库存</h1>
        <p>按物料聚合的进出汇总，点击行查看累计与流水</p>
      </div>
    </header>

    <div v-if="loading" class="page-loading">
      <div class="spinner-lg" />
      <span>加载中…</span>
    </div>

    <template v-else>
      <KpiCards :items="kpiItems" compact />

      <div class="main card">
        <div class="toolbar">
          <Segmented :model-value="activeTab" :options="tabs" @update:model-value="go" />
          <button class="btn-refresh" :disabled="refreshing" :title="refreshing ? '刷新中…' : '刷新'"
            @click="refresh">
            <RefreshCw :size="15" :class="{ 'icon-spin': refreshing }" />
          </button>
        </div>
        <!-- 4 个 tab 共用一份已加载数据；KeepAlive 保留切换前的页内状态（筛选、展开、导入向导等）。
             过渡只作用在 tab 内容区，整页（标题/KPI/工具栏）保持不动 -->
        <router-view v-slot="{ Component }">
          <transition name="tabfade" mode="out-in">
            <keep-alive>
              <component :is="Component" :ref="setActive" />
            </keep-alive>
          </transition>
        </router-view>
      </div>
    </template>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { Boxes, History, ShoppingCart, Upload, ClipboardCheck, RefreshCw } from 'lucide-vue-next'
import KpiCards from '../components/KpiCards.vue'
import Segmented from '../components/form/Segmented.vue'
import { useStockData } from '../composables/useStockData'

const router = useRouter()
const route = useRoute()
const { loading, kpiItems, load, refreshList } = useStockData()

/** 顶部刷新按钮：触发当前 tab 暴露的 refresh()，并顺便刷新共享的物料列表（KPI 用） */
const refreshing = ref(false)
const activeInst = ref<unknown>(null)
function setActive(el: unknown) { activeInst.value = el }
async function refresh() {
  refreshing.value = true
  try {
    await Promise.all([
      (activeInst.value as { refresh?: () => unknown })?.refresh?.(),
      refreshList().catch(() => {}),
    ])
  } finally { refreshing.value = false }
}

const tabs = [
  { value: 'list', label: '库存列表', icon: Boxes },
  { value: 'logs', label: '出入库记录', icon: History },
  { value: 'take', label: '盘点', icon: ClipboardCheck },
  { value: 'purchase', label: '待采单', icon: ShoppingCart },
  { value: 'import', label: '导入入库', icon: Upload },
]

const tabToPath: Record<string, string> = {
  list: '/stock',
  logs: '/stock/logs',
  purchase: '/stock/purchase',
  import: '/stock/import',
  take: '/stock/take',
}

const activeTab = computed(() => {
  const n = route.name
  if (n === 'stock-logs') return 'logs'
  if (n === 'stock-purchase') return 'purchase'
  if (n === 'stock-import') return 'import'
  if (n === 'stock-take') return 'take'
  return 'list'
})

function go(v: string) {
  const p = tabToPath[v]
  if (p) router.push(p)
}

onMounted(load)
</script>

<style scoped>
.page {
  height: 100%;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.head h1 {
  margin: 0;
  font-size: var(--fs-xl);
  font-weight: 700;
  letter-spacing: -0.02em;
}

.head p {
  margin: 4px 0 0;
  color: var(--c-text-2);
  font-size: var(--fs-sm);
}

.page-loading {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  color: var(--c-text-2);
}

/* ===== 主区 ===== */
.main {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  padding: 14px 16px;
  border-bottom: 1px solid var(--c-border-hairline);
  flex-shrink: 0;
}

/* 右侧刷新按钮 */
.btn-refresh {
  margin-left: auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: var(--ctrl-h);
  height: var(--ctrl-h);
  flex-shrink: 0;
  color: var(--c-text-2);
  background: var(--c-glass);
  border: 1px solid var(--c-border);
  border-radius: var(--r-md);
  cursor: pointer;
  transition: all var(--motion);
}

.btn-refresh:hover:not(:disabled) {
  color: var(--c-primary);
  border-color: var(--c-primary);
  background: var(--c-surface);
}

.btn-refresh:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.icon-spin {
  animation: spin 0.8s linear infinite;
}

/* ===== tab 内容区轻过渡（仅内容卡内淡入，不影响整页） ===== */
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

.spinner-lg {
  width: 28px;
  height: 28px;
  border: 3px solid var(--c-border);
  border-top-color: var(--c-primary);
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
