<template>
  <PullRefresh class="mpage" @refresh="onRefresh">
    <!-- 紧凑页头 -->
    <header class="head">
      <h1>玲珑 Bin</h1>
      <p>管理你的电子物料库</p>
    </header>

    <!-- KPI（复用桌面 KpiCards，移动端覆盖为 2×2） -->
    <KpiCards :items="kpiItems" compact class="kpis-m" />



    <!-- 功能宫格：库存作业 -->
    <section class="group">
      <h2 class="group-title">
        <ArrowLeftRight :size="14" style="display: inline-flex; flex-shrink: 0" />库存中心
      </h2>
      <nav class="grid-entry">
        <button class="entry" @click="go('/m/stock/list')">
          <span class="e-ico blue">
            <Boxes :size="17" style="display: inline-flex; flex-shrink: 0" />
          </span>
          <span class="e-name">库存列表</span>
        </button>
        <button class="entry" @click="go('/m/stock/logs')">
          <span class="e-ico blue">
            <History :size="17" style="display: inline-flex; flex-shrink: 0" />
          </span>
          <span class="e-name">出入库记录</span>
        </button>
        <button class="entry" @click="go('/m/stock/take')">
          <span class="e-ico purple">
            <ClipboardCheck :size="17" style="display: inline-flex; flex-shrink: 0" />
          </span>
          <span class="e-name">盘点</span>
        </button>
        <button class="entry" @click="go('/m/stock/purchase')">
          <span class="e-ico red">
            <ShoppingCart :size="17" style="display: inline-flex; flex-shrink: 0" />
          </span>
          <span class="e-name">待采单</span>
        </button>
        <button class="entry" @click="go('/m/stock/import')">
          <span class="e-ico teal">
            <Upload :size="17" style="display: inline-flex; flex-shrink: 0" />
          </span>
          <span class="e-name">导入入库</span>
        </button>
        <button class="entry" @click="go('/m/stock/batch')">
          <span class="e-ico teal">
            <ArrowLeftRight :size="17" style="display: inline-flex; flex-shrink: 0" />
          </span>
          <span class="e-name">批量出入库</span>
        </button>
        <button class="entry" @click="go('/m/stock/scan-in')">
          <span class="e-ico purple">
            <ScanLine :size="17" style="display: inline-flex; flex-shrink: 0" />
          </span>
          <span class="e-name">扫码入库</span>
        </button>
      </nav>
    </section>

    <!-- 功能宫格：BOM -->
    <section class="group">
      <h2 class="group-title">
        <List :size="14" style="display: inline-flex; flex-shrink: 0" />BOM
      </h2>
      <nav class="grid-entry">
        <button class="entry" @click="go('/m/bom')">
          <span class="e-ico blue">
            <List :size="17" style="display: inline-flex; flex-shrink: 0" />
          </span>
          <span class="e-name">BOM 项目</span>
        </button>
      </nav>
    </section>

    <!-- 库存预警（A）：低库存 Top 5，点行进详情 -->
    <section class="card">
      <header class="card-head">
        <h2 class="card-title danger">
          <TriangleAlert :size="15" style="display: inline-flex; flex-shrink: 0" />库存预警
        </h2>
        <button v-if="alerts.length" class="card-more" @click="go('/m/materials')">管理</button>
      </header>
      <p v-if="!alerts.length" class="card-ok">
        <CircleCheck :size="14" style="display: inline-flex; flex-shrink: 0" />库存充足，暂无预警
      </p>
      <ul v-else class="alert-list">
        <li v-for="a in alerts" :key="a.id" @click="go(`/m/material/${a.id}`)">
          <div class="a-info">
            <span class="a-name">{{ a.name }}</span>
            <small v-if="a.model" class="a-model">{{ a.model }}</small>
          </div>
          <span class="a-qty">
            <b>{{ a.qty }}</b> / 阈值 {{ a.threshold }}
          </span>
        </li>
      </ul>
    </section>

    <!-- 最近单据（B）：最近 3 笔，点行进出入库记录 -->
    <section class="card">
      <header class="card-head">
        <h2 class="card-title">
          <History :size="15" style="display: inline-flex; flex-shrink: 0" />最近单据
        </h2>
        <button class="card-more" @click="go('/m/stock/logs')">全部</button>
      </header>
      <p v-if="!recent.length" class="card-ok">暂无出入库单据</p>
      <ul v-else class="order-list">
        <li v-for="o in recent" :key="o.id" @click="go('/m/stock/logs')">
          <span class="o-tag" :class="o.type">{{ o.type === 'in' ? '入' : '出' }}</span>
          <div class="o-info">
            <span class="o-title">{{ o.title || o.order_no || '出入库单' }}</span>
            <small class="o-time">{{ fmtTime(o.created_at) }}</small>
          </div>
          <span class="o-qty" :class="o.type">{{ o.type === 'in' ? '+' : '-' }}{{ o.total_qty }}</span>
        </li>
      </ul>
    </section>

  </PullRefresh>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import {
  Boxes, History, ShoppingCart, Upload, ClipboardCheck, ArrowLeftRight, List,
  TriangleAlert, CircleCheck, ScanLine,
} from 'lucide-vue-next'
import KpiCards from '../../components/KpiCards.vue'
import PullRefresh from '../../components/mobile/PullRefresh.vue'
import { useStockData } from '../../composables/useStockData'
import { lowStockMaterials, pageStockOrders } from '../../lib/db'
import type { StockOrder } from '../../lib/types'
import type { LowStockRow } from '../../lib/storage/types'

/**
 * 移动端首页（库存工作台）：KPI 概览 + 库存预警 + 最近单据 + 功能宫格。
 * KPI 与桌面库存中心共用 useStockData（模块级单例，子页改动即时同步）；
 * 下拉刷新全量拉起 KPI / 预警 / 最近单据；宫格子页复用桌面组件（SubPage 壳），后续 P2 再逐个移动化。
 */
const router = useRouter()
const { loading, kpiItems, load } = useStockData()

/** 低库存预警 Top 5 */
const alerts = ref<LowStockRow[]>([])
/** 最近 3 笔出入库单 */
const recent = ref<StockOrder[]>([])

function go(path: string) {
  router.push(path)
}

async function loadAlerts() {
  try { alerts.value = (await lowStockMaterials()).slice(0, 5) }
  catch { /* 静默：预警加载失败不阻塞首页 */ }
}

async function loadRecent() {
  try {
    const page = await pageStockOrders({ status: 'normal', limit: 3 })
    recent.value = page.rows
  } catch { /* 静默 */ }
}

function fmtTime(iso: string) {
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  const now = new Date()
  const sameDay = d.toDateString() === now.toDateString()
  // 今天只显示时间，更早显示日期
  return sameDay ? `${pad(d.getHours())}:${pad(d.getMinutes())}` : `${d.getMonth() + 1}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** 下拉刷新：KPI + 预警 + 最近单据 全量刷新 */
async function onRefresh(done: () => void) {
  await Promise.all([load(), loadAlerts(), loadRecent()])
  done()
}

onMounted(() => {
  load()
  loadAlerts()
  loadRecent()
})
</script>

<style scoped>
/* PullRefresh 根节点挂 .mpage，但实际内容布局在内部 .pr-content 上 */
.mpage :deep(.pr-content) {
  display: flex;
  flex-direction: column;
  gap: 16px;
  min-height: 100%;
}

/* ===== 内容卡片（预警 / 最近单据） ===== */
.card {
  background: var(--c-surface);
  border: 1px solid var(--c-border);
  border-radius: var(--r-xl);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  padding: 12px 14px;
}

.card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}

.card-title {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin: 0;
  font-size: var(--fs-md);
  font-weight: 700;
}

.card-title.danger {
  color: var(--c-danger);
}

.card-more {
  border: none;
  background: transparent;
  color: var(--c-primary);
  font-family: inherit;
  font-size: var(--fs-sm);
  font-weight: 600;
  cursor: pointer;
  padding: 4px 6px;
  margin: -4px -6px;
  -webkit-tap-highlight-color: transparent;
}

.card-ok {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 4px 0;
  padding: 6px 0;
  color: var(--c-text-3);
  font-size: var(--fs-sm);
}

/* 预警行 */
.alert-list,
.order-list {
  list-style: none;
  margin: 0;
  padding: 0;
}

.alert-list li,
.order-list li {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 44px;
  padding: 6px 0;
  border-bottom: 1px solid var(--c-border-hairline);
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}

.alert-list li:last-child,
.order-list li:last-child {
  border-bottom: none;
  padding-bottom: 0;
}

.alert-list li:active,
.order-list li:active {
  background: var(--c-surface-hover);
}

.a-info,
.o-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.a-name,
.o-title {
  font-size: var(--fs-md);
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.a-model,
.o-time {
  font-size: var(--fs-xs);
  color: var(--c-text-3);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.a-qty {
  flex-shrink: 0;
  font-size: var(--fs-xs);
  color: var(--c-text-3);
  font-variant-numeric: tabular-nums;
}

.a-qty b {
  color: var(--c-danger);
  font-size: var(--fs-md);
  font-weight: 800;
}

/* 单据行 */
.o-tag {
  flex-shrink: 0;
  width: 24px;
  height: 24px;
  display: grid;
  place-items: center;
  border-radius: var(--r-sm);
  font-size: var(--fs-xs);
  font-weight: 700;
}

.o-tag.in {
  background: var(--c-primary-soft);
  color: var(--c-primary);
}

.o-tag.out {
  background: rgba(255, 107, 107, 0.12);
  color: var(--c-danger);
}

.o-qty {
  flex-shrink: 0;
  font-size: var(--fs-md);
  font-weight: 800;
  font-variant-numeric: tabular-nums;
}

.o-qty.in {
  color: var(--c-primary);
}

.o-qty.out {
  color: var(--c-danger);
}

/* ===== 分组（标题 + 宫格） ===== */
.group {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.group-title {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 0;
  padding: 0 2px;
  font-size: var(--fs-sm);
  font-weight: 600;
  color: var(--c-text-2);
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

/* KPI：复用桌面 KpiCards，窄屏覆盖为 2×2（视觉与 PC 一致） */
.kpis-m :deep(.kpis) {
  grid-template-columns: repeat(2, 1fr);
  gap: 10px;
}

/* 宫格入口：卡片风格与 KPI/PC 卡片一致 */
.grid-entry {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px;
}

.entry {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 12px 4px 10px;
  background: var(--c-surface);
  border: 1px solid var(--c-border);
  border-radius: var(--r-xl);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  font-family: inherit;
  cursor: pointer;
  transition: transform 120ms ease-out, background-color var(--motion-fast);
  -webkit-tap-highlight-color: transparent;
}

.entry:active {
  transform: scale(0.96);
  background: var(--c-surface-hover);
}

.e-ico {
  width: 36px;
  height: 36px;
  border-radius: var(--r-md);
  display: grid;
  place-items: center;
}

.e-name {
  font-size: var(--fs-xs);
  font-weight: 600;
  color: var(--c-text);
  white-space: nowrap;
}

/* 图标 tone：与桌面 KpiCards 的 soft 底色语言一致 */
.e-ico.blue {
  background: var(--c-primary-soft);
  color: var(--c-primary);
}

.e-ico.teal {
  background: rgba(52, 218, 191, 0.12);
  color: var(--c-accent);
}

.e-ico.red {
  background: rgba(255, 92, 114, 0.12);
  color: var(--c-danger);
}

.e-ico.purple {
  background: rgba(167, 139, 250, 0.12);
  color: var(--c-purple);
}
</style>
