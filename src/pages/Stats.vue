<template>
  <section class="page">
    <header class="head">
      <div>
        <h1>数据概览</h1>
        <p>库存总览 · 分类占比 · 出入库趋势 · 低库存预警</p>
      </div>
      <button class="btn btn-ghost" :disabled="loading" @click="load">
        <RefreshCw :size="16" style="display: inline-flex; flex-shrink: 0" />{{ loading ? '加载中…' : '刷新' }}
      </button>
    </header>

    <div v-if="loading && !ov.totalMaterials" class="page-loading">
      <div class="spinner-lg" />
      <span>加载数据中…</span>
    </div>

    <template v-else>
    <div class="kpis">
      <div class="kpi">
        <div class="kpi-ico blue"><Box :size="22" style="display: inline-flex; flex-shrink: 0" /></div>
        <div class="kpi-body">
          <span class="label">物料种类</span>
          <b>{{ ov.totalMaterials }}</b>
          <span class="trend">SKU 总数</span>
        </div>
      </div>
      <div class="kpi">
        <div class="kpi-ico teal"><Inbox :size="22" style="display: inline-flex; flex-shrink: 0" /></div>
        <div class="kpi-body">
          <span class="label">库存总量</span>
          <b>{{ ov.totalQty }}</b>
          <span class="trend">件物料</span>
        </div>
      </div>
      <div class="kpi">
        <div class="kpi-ico gold"><Tag :size="22" style="display: inline-flex; flex-shrink: 0" /></div>
        <div class="kpi-body">
          <span class="label">库存总价值</span>
          <b>¥{{ ov.totalValue.toFixed(0) }}</b>
          <span class="trend">按单价估算</span>
        </div>
      </div>
      <div class="kpi">
        <div class="kpi-ico red"><TriangleAlert :size="22" style="display: inline-flex; flex-shrink: 0" /></div>
        <div class="kpi-body">
          <span class="label">低库存预警</span>
          <b>{{ low.length }}</b>
          <span class="trend">需补货</span>
        </div>
      </div>
    </div>

    <div class="scroll-area">
    <div class="charts">
      <div class="chart-card card">
        <div class="chart-head">
          <h3>分类占比</h3>
          <span class="chart-sub">按数量</span>
        </div>
        <div ref="pieEl" class="echart"></div>
      </div>
      <div class="chart-card card">
        <div class="chart-head">
          <h3>出入库趋势</h3>
          <div class="legend-mini">
            <span class="li in"><i></i>入库</span>
            <span class="li out"><i></i>出库</span>
          </div>
        </div>
        <div ref="barEl" class="echart"></div>
      </div>
    </div>

    <div class="card low-card">
      <div class="card-head">
        <h3><TriangleAlert :size="16" class="alert-ico" style="display: inline-flex; flex-shrink: 0" />低库存预警</h3>
        <div class="head-actions">
          <span class="count-badge">{{ low.length }}</span>
          <!-- <button class="btn btn-primary mini" :disabled="!low.length || genBusy" @click="genPoFromLow">
            <ListChecks :size="14" style="display: inline-flex; flex-shrink: 0" />一键生成采购单
          </button> -->
        </div>
      </div>
      <template v-if="loading"><div class="hint"><div class="spinner-lg" /></div></template>
      <template v-else>
        <table v-if="low.length">
          <thead><tr><th>名称</th><th>型号</th><th>库存</th><th>阈值</th><th>缺口</th></tr></thead>
          <tbody>
            <tr v-for="c in low" :key="c.id">
              <td class="name">{{ c.name }}</td>
              <td class="mono">{{ c.model || '—' }}</td>
              <td class="bad">{{ c.qty }}</td>
              <td>{{ c.threshold }}</td>
              <td class="gap">缺 {{ Math.max(0, c.threshold - c.qty) }}</td>
            </tr>
          </tbody>
        </table>
        <div v-else class="ok-state">
          <div class="ok-ico"><Check :size="28" style="display: inline-flex; flex-shrink: 0" /></div>
          <p>库存充足，无预警</p>
        </div>
      </template>
    </div>
      <div class="card low-card">
        <div class="card-head">
          <h3><Clock :size="16" style="display: inline-flex; flex-shrink: 0" />呆滞料 <span class="muted">(180 天未动)</span></h3>
          <span class="count-badge">{{ stagnant.length }}</span>
        </div>
        <template v-if="loading"><div class="hint"><div class="spinner-lg" /></div></template>
        <template v-else>
          <table v-if="stagnant.length">
            <thead><tr><th>名称</th><th>型号</th><th>库存</th><th>未动天数</th><th>最近出入库</th></tr></thead>
            <tbody>
              <tr v-for="c in stagnant.slice(0, 30)" :key="c.id">
                <td class="name">{{ c.name }}</td>
                <td class="mono">{{ c.model || '—' }}</td>
                <td>{{ c.qty }}</td>
                <td class="gap">{{ c.days }} 天</td>
                <td class="mono">{{ c.last_move ? c.last_move.slice(0, 10) : '无记录' }}</td>
              </tr>
            </tbody>
          </table>
          <div v-else class="ok-state">
            <div class="ok-ico"><Check :size="28" style="display: inline-flex; flex-shrink: 0" /></div>
            <p>无呆滞料，库存活跃</p>
          </div>
        </template>
      </div>
    </div>
    </template>
  </section>
</template>

<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from 'vue'
import { RefreshCw, Box, Inbox, Tag, TriangleAlert, Check, Clock, ListChecks } from 'lucide-vue-next'
import * as echarts from 'echarts/core'
import { PieChart, BarChart } from 'echarts/charts'
import { TooltipComponent, LegendComponent, GridComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import { statsOverview, statsByCategory, stockTrend, lowStockMaterials, stagnantMaterials, createPurchaseOrder, createPurchaseItems } from '../lib/db'
import { assertRepoUrl } from '../lib/strKit'
import type { StagnantRow } from '../lib/types'
import { confirm } from '../composables/confirm'

echarts.use([PieChart, BarChart, TooltipComponent, LegendComponent, GridComponent, CanvasRenderer])

const loading = ref(false)
const ov = ref<{ totalMaterials: number; totalQty: number; totalValue: number }>({ totalMaterials: 0, totalQty: 0, totalValue: 0 })
const low = ref<Awaited<ReturnType<typeof lowStockMaterials>>>([])
const stagnant = ref<StagnantRow[]>([])
const genBusy = ref(false)
const pieEl = ref<HTMLElement | null>(null)
const barEl = ref<HTMLElement | null>(null)
type EChartsInstance = ReturnType<typeof echarts.init>
let pie: EChartsInstance | null = null
let bar: EChartsInstance | null = null

const PIE_COLORS = ['#4F8CFF', '#34DABF', '#FFA94D', '#FF6B6B', '#B197FC', '#74C0FC', '#69DB7C', '#FF8787']

async function load() {
  loading.value = true
  // 兜底：开源地址被篡改时，即使不点链接、打开统计页也会报错
  assertRepoUrl()
  try {
    ov.value = await statsOverview()
    const cats = await statsByCategory()
    const trend = await stockTrend(14)
    low.value = await lowStockMaterials()
    stagnant.value = await stagnantMaterials(180)
    renderPie(cats)
    renderBar(trend)
  } catch (e) { console.error(e) }
  finally { loading.value = false }
}

function renderPie(cats: Awaited<ReturnType<typeof statsByCategory>>) {
  if (!pieEl.value) return
  if (pie) pie.dispose()
  pie = echarts.init(pieEl.value, null, { renderer: 'canvas' })
  pie.setOption({
    tooltip: {
      trigger: 'item',
      backgroundColor: 'rgba(24,27,35,0.95)',
      borderColor: 'rgba(255,255,255,0.08)',
      textStyle: { color: '#e9ecef', fontSize: 12 },
      padding: [8, 12],
      borderRadius: 8
    },
    series: [{
      type: 'pie', radius: ['55%', '78%'], center: ['50%', '50%'], avoidLabelOverlap: true,
      itemStyle: { borderRadius: 6, borderColor: 'rgba(12,14,20,0.8)', borderWidth: 2 },
      label: {
        show: true,
        color: '#adb5bd',
        fontSize: 11,
        formatter: '{b}\n{d}%'
      },
      labelLine: { lineStyle: { color: '#495057' } },
      data: cats.map((c, i) => ({ name: c.name, value: c.qty, itemStyle: { color: PIE_COLORS[i % PIE_COLORS.length] } }))
    }]
  })
}
function renderBar(trend: Awaited<ReturnType<typeof stockTrend>>) {
  if (!barEl.value) return
  if (bar) bar.dispose()
  bar = echarts.init(barEl.value, null, { renderer: 'canvas' })
  bar.setOption({
    tooltip: {
      trigger: 'axis',
      backgroundColor: 'rgba(24,27,35,0.95)',
      borderColor: 'rgba(255,255,255,0.08)',
      textStyle: { color: '#e9ecef', fontSize: 12 },
      padding: [8, 12],
      borderRadius: 8,
      axisPointer: { type: 'shadow', shadowStyle: { color: 'rgba(255,255,255,0.03)' } }
    },
    grid: { left: 40, right: 16, top: 16, bottom: 32, containLabel: false },
    xAxis: {
      type: 'category', data: trend.map(d => d.date.slice(5)),
      axisLine: { show: false }, axisTick: { show: false },
      axisLabel: { color: '#868e96', fontSize: 10 }
    },
    yAxis: {
      type: 'value',
      axisLine: { show: false }, axisTick: { show: false }, splitLine: { lineStyle: { color: 'rgba(255,255,255,0.04)' } },
      axisLabel: { color: '#868e96', fontSize: 10 }
    },
    series: [
      { name: '入库', type: 'bar', barWidth: '35%', barGap: '20%', data: trend.map(d => d.in), itemStyle: { color: '#34DABF', borderRadius: [4, 4, 0, 0] } },
      { name: '出库', type: 'bar', barWidth: '35%', data: trend.map(d => d.out), itemStyle: { color: '#FF6B6B', borderRadius: [4, 4, 0, 0] } }
    ]
  })
}

function resize() { pie?.resize(); bar?.resize() }
window.addEventListener('resize', resize)

onMounted(load)
onBeforeUnmount(() => { window.removeEventListener('resize', resize); pie?.dispose(); bar?.dispose() })

async function genPoFromLow() {
  if (!low.value.length) return
  const ok = await confirm({
    title: '生成采购单',
    content: `将基于 ${low.value.length} 条低库存物料生成一张采购单（补货数量 = 阈值 − 当前库存）。是否继续？`,
    danger: false,
  })
  if (!ok) return
  genBusy.value = true
  try {
    const name = `低库存补货 ${new Date().toLocaleDateString('zh-CN')}`
    const order = await createPurchaseOrder({ name, source: 'manual', note: '由统计看板一键生成' })
    const items = low.value.map(c => ({
      order_id: order.id, material_id: c.id, name: c.name, model: c.model,
      brand: null, package: null, part_no: null,
      qty: Math.max(1, Math.max(0, c.threshold - c.qty)),
      stock_qty: c.qty, lack_qty: Math.max(0, c.threshold - c.qty),
      remark: null,
    }))
    await createPurchaseItems(order.id, items)
    await confirm({
      title: '已生成采购单',
      content: `「${name}」已创建，共 ${items.length} 项，请到「库存中心 / 采购单」查看。`,
      danger: false,
    })
    await load()
  } catch (e: any) {
    await confirm({ title: '生成失败', content: e?.message || '生成采购单失败', danger: true })
  } finally {
    genBusy.value = false
  }
}
</script>

<style scoped>
.page { height: 100%; display: flex; flex-direction: column; gap: 20px; overflow: hidden; }
.page > .head, .page > .kpis { flex-shrink: 0; }
.page > .scroll-area { flex: 1; overflow-y: auto; overflow-x: hidden; display: flex; flex-direction: column; gap: 20px; padding-bottom: 8px; }
.page > .scroll-area::-webkit-scrollbar { width: 4px; }
.page > .scroll-area::-webkit-scrollbar-thumb { background: var(--c-border-strong); border-radius: 999px; }

.head { display: flex; justify-content: space-between; align-items: flex-end; }
.head h1 { margin: 0; font-size: var(--fs-xl); font-weight: 700; letter-spacing: -0.02em; }
.head p { margin: 4px 0 0; color: var(--c-text-2); font-size: var(--fs-sm); }

.kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; }
.kpi {
  background: var(--c-surface); border: 1px solid var(--c-border);
  border-radius: var(--r-xl); padding: 16px 18px;
  backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px);
  display: flex; align-items: center; gap: 14px;
  transition: all var(--motion);
}
.kpi:hover { background: var(--c-surface-hover); transform: translateY(-2px); box-shadow: var(--shadow-md); }
.kpi-ico {
  width: 44px; height: 44px; border-radius: var(--r-md);
  display: grid; place-items: center; flex-shrink: 0;
}
.kpi-ico.blue { background: linear-gradient(135deg, rgba(79,140,255,0.2), rgba(79,140,255,0.08)); color: #4F8CFF; }
.kpi-ico.teal { background: linear-gradient(135deg, rgba(52,218,191,0.2), rgba(52,218,191,0.08)); color: #34DABF; }
.kpi-ico.gold { background: linear-gradient(135deg, rgba(255,169,77,0.2), rgba(255,169,77,0.08)); color: #FFA94D; }
.kpi-ico.red { background: linear-gradient(135deg, rgba(255,107,107,0.2), rgba(255,107,107,0.08)); color: #FF6B6B; }
.kpi-body { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.kpi-body .label { font-size: var(--fs-xs); color: var(--c-text-2); }
.kpi-body b { font-size: var(--fs-xl); font-weight: 700; line-height: 1.2; letter-spacing: -0.02em; }
.kpi-body .trend { font-size: 10px; color: var(--c-text-3); }

.charts { display: grid; grid-template-columns: 1fr 1.4fr; gap: 12px; }
.chart-card { padding: 18px; display: flex; flex-direction: column; min-width: 0; }
.chart-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
.chart-head h3 { margin: 0; font-size: var(--fs-md); font-weight: 600; }
.chart-sub { font-size: var(--fs-xs); color: var(--c-text-3); background: var(--c-glass); padding: 3px 10px; border-radius: 999px; border: 1px solid var(--c-border); }
.legend-mini { display: flex; gap: 14px; }
.li { display: inline-flex; align-items: center; gap: 5px; font-size: var(--fs-xs); color: var(--c-text-2); }
.li i { width: 8px; height: 8px; border-radius: 2px; display: block; }
.li.in i { background: #34DABF; }
.li.out i { background: #FF6B6B; }
.echart { width: 100%; height: 240px; }

.low-card { padding: 20px; }
.card-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px; }
.card-head h3 { margin: 0; font-size: var(--fs-md); font-weight: 600; display: inline-flex; align-items: center; gap: 6px; }
.alert-ico { color: var(--c-danger); }
.count-badge { background: rgba(255,107,107,0.12); color: var(--c-danger); padding: 3px 10px; border-radius: 999px; font-size: var(--fs-xs); font-weight: 600; }

.hint { display: grid; place-items: center; padding: 40px; }
.spinner-lg { width: 28px; height: 28px; border: 3px solid var(--c-border); border-top-color: var(--c-primary); border-radius: 50%; animation: spin 0.7s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }

table { width: 100%; border-collapse: collapse; font-size: var(--fs-sm); }
thead th {
  text-align: left; padding: 8px 12px; color: var(--c-text-3); font-weight: 600; font-size: var(--fs-xs);
  text-transform: uppercase; letter-spacing: 0.04em; border-bottom: 1px solid var(--c-border-hairline);
}
tbody td { padding: 10px 12px; border-bottom: 1px solid var(--c-border-hairline); }
tbody tr:last-child td { border-bottom: none; }
tbody tr:hover { background: var(--c-surface-hover); }
.name { font-weight: 500; }
.mono { font-family: ui-monospace, 'SF Mono', Menlo, Consolas, monospace; font-size: var(--fs-xs); color: var(--c-text-2); }
.bad { color: var(--c-danger); font-weight: 700; font-size: var(--fs-md); }
.gap { color: var(--c-warning); font-size: var(--fs-xs); font-weight: 500; }

.ok-state { display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 32px; color: var(--c-text-2); }
.ok-ico { width: 56px; height: 56px; border-radius: 50%; background: rgba(52,218,191,0.12); color: var(--c-accent); display: grid; place-items: center; }
.ok-state p { margin: 0; font-size: var(--fs-sm); }

.head-actions { display: flex; align-items: center; gap: 10px; }
.muted { color: var(--c-text-3); font-weight: 400; font-size: var(--fs-xs); }
.btn.mini { padding: 5px 10px; font-size: var(--fs-xs); }

@media (max-width: 900px) {
  .kpis { grid-template-columns: repeat(2, 1fr); }
  .charts { grid-template-columns: 1fr; }
}
@media (max-width: 520px) {
  .kpis { grid-template-columns: 1fr; }
}
</style>
