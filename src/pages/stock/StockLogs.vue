<template>
  <section class="tab">
    <div class="filters">
      <Segmented v-model="logType" :options="[
        { value: 'all', label: '全部' },
        { value: 'in', label: '入库' },
        { value: 'out', label: '出库' },
      ]" />
      <div class="f-cat">
        <AppSelect v-model="logRange" :options="rangeOptions" :min-width="0" />
      </div>
      <div class="f-cat">
        <AppSelect v-model="logStatus" :options="statusOptions" :min-width="0" />
      </div>
      <div class="f-search">
        <Search :size="15" class="s-ico" style="display: inline-flex; flex-shrink: 0" />
        <input v-model="logKw" placeholder="搜索单号 / 标题 / 物料" />
      </div>
    </div>

    <div class="logs-wrap">
      <EmptyState v-if="!orders.length && !logLoading" :icon="Inbox" title="暂无出入库单" />
      <ul v-else class="log-list">
        <li v-for="o in orders" :key="o.id"
          :class="[o.type, { 'is-void': o.status === 'void' }]" @click="curOrder = o">
          <div class="tag-wrap"><span class="tag">{{ o.type === 'in' ? '入' : '出' }}</span></div>
          <div class="info">
            <strong>{{ o.title || o.note || (o.type === 'in' ? '入库单' : '出库单') }}</strong>
            <small>
              <span class="no">{{ o.order_no || '无单号' }}</span> · {{ sourceLabel(o.source) }}
              <template v-if="o.suppliers?.name"> · {{ o.suppliers.name }}</template>
              · {{ o.item_count }} 项
            </small>
            <small v-if="o.status === 'void'" class="void-reason">
              <Ban :size="11" style="display: inline-flex; flex-shrink: 0" />
              已撤销<template v-if="o.void_reason">：{{ o.void_reason }}</template>
            </small>
          </div>
          <span class="q">{{ o.type === 'in' ? '+' : '-' }}{{ o.total_qty }}</span>
          <time>{{ fmtFull(o.created_at) }}</time>
          <div class="op" @click.stop>
            <button v-if="o.status !== 'void'" class="btn btn-ghost btn-sm void-btn" :disabled="voidBusy"
              title="撤销整单（库存同步回滚）" @click="openVoid(o)">
              <Undo2 :size="13" style="display: inline-flex; flex-shrink: 0" /> 撤销
            </button>
            <span v-else class="void-chip">已撤销</span>
          </div>
        </li>
      </ul>
    </div>

    <Pager :page="logPage" :page-size="logPageSize" :total="logTotal" @change="onLogPage"
      @update:page-size="onLogSize" />

    <!-- 单据明细抽屉：点击单据行打开 -->
    <StockOrderDrawer :order="curOrder" @close="curOrder = null" @void="openVoidFromDrawer" />

    <!-- 撤销整单：填写撤销原因后确认，单据与明细保留、库存回滚 -->
    <Teleport to="body">
      <div v-if="voidTarget" class="modal-mask" @click.self="closeVoid">
        <div class="modal void-modal">
          <div class="modal-head">
            <h3>撤销出入库单</h3>
            <button class="modal-x" @click="closeVoid">
              <X :size="16" style="display: inline-flex; flex-shrink: 0" />
            </button>
          </div>
          <div class="modal-body">
            <p class="vd-sum">
              {{ voidTarget.title || voidTarget.order_no || (voidTarget.type === 'in' ? '入库单' : '出库单') }}
              · {{ voidTarget.item_count }} 项
              · {{ voidTarget.type === 'in' ? '入库' : '出库' }} <b>{{ voidTarget.total_qty }}</b>
              · {{ fmtFull(voidTarget.created_at) }}
            </p>
            <p class="vd-tip">
              撤销后该单与明细保留并标记「已撤销」，{{ voidTarget.item_count }} 条明细的库存将同步反向回滚
              （{{ voidTarget.type === 'in' ? '扣回' : '加回' }} <b>{{ voidTarget.total_qty }}</b>）。
              部分物料库存不足时整单撤销失败，不会产生部分撤销。
            </p>
            <label class="field">
              <span>撤销原因 <em>*</em></span>
              <textarea v-model="voidReason" rows="3" placeholder="如：录入有误 / 数量填错 / 退货至供应商"
                @keydown.ctrl.enter.prevent="submitVoid" />
            </label>
            <p v-if="voidErr" class="vd-err">{{ voidErr }}</p>
          </div>
          <div class="modal-foot">
            <button class="btn btn-ghost" @click="closeVoid">取消</button>
            <button class="btn btn-danger" :disabled="voidBusy || !voidReason.trim()" @click="submitVoid">
              <span v-if="voidBusy" class="spinner-sm" />
              <Undo2 v-else :size="15" style="display: inline-flex; flex-shrink: 0" />
              确认撤销整单
            </button>
          </div>
        </div>
      </div>
    </Teleport>
  </section>
</template>

<script setup lang="ts">
import { ref, watch, onActivated } from 'vue'
import { Inbox, Search, Undo2, Ban, X } from 'lucide-vue-next'
import type { StockOrder } from '../../lib/types'
import AppSelect from '../../components/form/AppSelect.vue'
import Segmented from '../../components/form/Segmented.vue'
import EmptyState from '../../components/EmptyState.vue'
import Pager from '../../components/Pager.vue'
import StockOrderDrawer from '../../components/business/StockOrderDrawer.vue'
import { pageStockOrders, voidStockOrder } from '../../lib/db'
import { useToast } from '../../composables/toast'
import { useStockData } from '../../composables/useStockData'

const toast = useToast()
const { refreshList, refreshSummary, refreshLogs } = useStockData()

const logType = ref<'all' | 'in' | 'out'>('all')
const logRange = ref<'all' | 'today' | '7d' | '30d'>('all')
const logStatus = ref<'all' | 'normal' | 'void'>('all')
const logKw = ref('')

const logPage = ref(1)
const logPageSize = ref(20)
const logTotal = ref(0)
const orders = ref<StockOrder[]>([])
const logLoading = ref(false)

const rangeOptions = [
  { value: 'all', label: '全部时间' },
  { value: 'today', label: '今天' },
  { value: '7d', label: '近7天' },
  { value: '30d', label: '近30天' },
]

const statusOptions = [
  { value: 'all', label: '全部状态' },
  { value: 'normal', label: '有效' },
  { value: 'void', label: '已撤销' },
]

const SOURCE_LABELS: Record<string, string> = {
  manual: '手工', init: '初始入库', import: '订单导入', bom: 'BOM 领料',
  purchase: '待采入库', stocktake: '盘点', legacy: '历史数据',
}
function sourceLabel(s: string) { return SOURCE_LABELS[s] ?? s }

/** 时间范围 → 查询用的起止 ISO 时间 */
function rangeBounds(): { from?: string; to?: string } {
  if (logRange.value === 'all') return {}
  const end = new Date()
  let start: Date
  if (logRange.value === 'today') { start = new Date(); start.setHours(0, 0, 0, 0) }
  else { const days = logRange.value === '7d' ? 7 : 30; start = new Date(Date.now() - days * 86400000) }
  return { from: start.toISOString(), to: end.toISOString() }
}

let kwTimer: ReturnType<typeof setTimeout> | null = null

async function loadLogs() {
  logLoading.value = true
  try {
    const { from, to } = rangeBounds()
    const res = await pageStockOrders({
      type: logType.value === 'all' ? undefined : logType.value,
      status: logStatus.value === 'all' ? undefined : logStatus.value,
      keyword: logKw.value.trim(),
      from, to,
      limit: logPageSize.value,
      offset: (logPage.value - 1) * logPageSize.value,
    })
    orders.value = res.rows
    logTotal.value = res.total
  } catch (e: unknown) {
    // 之前是静默失败，排查困难；这里显式提示（如云端 SQL / 字段未迁移导致的 400）
    toast.error('查询失败：' + ((e as Error)?.message || e))
  }
  finally { logLoading.value = false }
}

// 类型 / 时间范围 / 状态变化 → 回到第 1 页并重新查询
watch([logType, logRange, logStatus], () => { logPage.value = 1; void loadLogs() })
// 关键词输入做 300ms 防抖，避免逐字触发查询
watch(logKw, () => {
  if (kwTimer) clearTimeout(kwTimer)
  kwTimer = setTimeout(() => { logPage.value = 1; void loadLogs() }, 300)
})
// 切到本 tab 时自动重拉（keep-alive 不会重新挂载，故用 onActivated 而非 onMounted）
onActivated(() => { logPage.value = 1; void loadLogs() })

// 供父级「刷新」按钮调用：回到第 1 页重查
defineExpose({ refresh: () => { logPage.value = 1; return loadLogs() } })

function onLogPage(p: number) { logPage.value = p; void loadLogs() }
function onLogSize(s: number) { logPageSize.value = s; logPage.value = 1; void loadLogs() }

// ===== 单据明细抽屉 =====
const curOrder = ref<StockOrder | null>(null)

/** 抽屉内点「撤销整单」：直接以当前单打开撤销确认框 */
function openVoidFromDrawer() {
  if (curOrder.value) openVoid(curOrder.value)
}

// ===== 撤销整单 =====
const voidTarget = ref<StockOrder | null>(null)
const voidReason = ref('')
const voidErr = ref('')
const voidBusy = ref(false)

function openVoid(o: StockOrder) {
  if (o.status === 'void') { toast.warning('该单据已撤销'); return }
  voidTarget.value = o
  voidReason.value = ''
  voidErr.value = ''
}

function closeVoid() {
  if (voidBusy.value) return
  voidTarget.value = null
  voidReason.value = ''
  voidErr.value = ''
}

async function submitVoid() {
  const target = voidTarget.value
  if (!target) return
  const reason = voidReason.value.trim()
  if (!reason) { voidErr.value = '请填写撤销原因'; return }
  voidBusy.value = true
  voidErr.value = ''
  try {
    await voidStockOrder(target.id, reason)
    toast.success(target.type === 'in' ? '入库单已撤销，库存已扣回' : '出库单已撤销，库存已加回')
    voidTarget.value = null
    voidReason.value = ''
    // 撤销后当前抽屉里的单据状态已过期：关闭避免展示「有效」旧态
    curOrder.value = null
    // 库存与汇总已变化：同步刷新共享的物料列表 / 汇总 / 流水，避免其它 tab 与 KPI 看到旧值
    void Promise.all([refreshList(), refreshSummary(), refreshLogs()]).catch(() => { })
    await loadLogs()
  } catch (e: unknown) {
    voidErr.value = (e as Error)?.message || '撤销失败，请重试'
  } finally { voidBusy.value = false }
}

function fmtFull(t: string) {
  if (!t) return ''
  const d = new Date(t)
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}
</script>

<style scoped>
.tab {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.filters {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  padding: 12px 16px;
  border-bottom: 1px solid var(--c-border-hairline);
  flex-shrink: 0;
}

.f-cat {
  min-width: 95px;
}

.f-search {
  position: relative;
  display: flex;
  align-items: center;
}

.s-ico {
  position: absolute;
  left: 10px;
  color: var(--c-text-3);
  pointer-events: none;
}

.f-search input {
  height: var(--ctrl-h);
  width: 220px;
  padding: 0 var(--ctrl-px) 0 32px;
  font-size: var(--fs-sm);
  background: var(--c-glass);
  border: 1px solid var(--c-border);
  border-radius: var(--r-md);
  color: var(--c-text);
  transition: all var(--motion);
}

.f-search input:focus {
  border-color: var(--c-primary);
  background: var(--c-surface);
  box-shadow: 0 0 0 3px var(--c-primary-glow);
}

/* ===== 出入库单列表 ===== */
.logs-wrap {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  padding: 8px 16px 16px;
}

.log-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
  overflow-y: auto;
  flex: 1;
  padding-right: 4px;
}

.log-list li {
  display: grid;
  grid-template-columns: 32px minmax(0, 1fr) auto auto auto;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  border-radius: var(--r-md);
  border: 1px solid transparent;
  cursor: pointer;
  transition: all var(--motion);
}

/* 已撤销：整行弱化 */
.log-list li.is-void {
  opacity: 0.55;
}

.log-list li.is-void .info strong,
.log-list li.is-void .q {
  text-decoration: line-through;
  text-decoration-thickness: 1px;
}

.log-list li:hover {
  background: var(--c-surface-hover);
  border-color: var(--c-border-hairline);
}

.tag-wrap {
  display: flex;
  align-items: center;
  justify-content: center;
}

.log-list .tag {
  width: 24px;
  height: 24px;
  border-radius: 6px;
  display: grid;
  place-items: center;
  font-size: var(--fs-xs);
  font-weight: 700;
  flex-shrink: 0;
}

.log-list li.in .tag {
  background: rgba(52, 218, 191, 0.15);
  color: #34DABF;
}

.log-list li.out .tag {
  background: rgba(255, 107, 107, 0.15);
  color: #FF6B6B;
}

/* 撤销原因（紧跟在标题下一行） */
.void-reason {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: var(--c-danger) !important;
  text-decoration: none !important;
}

/* 操作列：悬停前留白占位，避免行高跳动 */
.op {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  min-width: 62px;
}

.void-btn {
  height: var(--ctrl-h-sm);
  padding: 0 8px;
  font-size: var(--fs-xs);
  transition: opacity var(--motion), color var(--motion), border-color var(--motion);
}

/* 支持悬停的设备（桌面端）上默认隐藏，行悬停时才出现；触屏设备常显 */
@media (hover: hover) {
  .void-btn {
    opacity: 0;
  }

  .log-list li:hover .void-btn {
    opacity: 1;
  }
}

.void-btn:hover:not(:disabled) {
  color: var(--c-danger);
  border-color: var(--c-danger);
}

.void-chip {
  font-size: var(--fs-xs);
  color: var(--c-danger);
  background: rgba(255, 92, 114, 0.12);
  border: 1px solid rgba(255, 92, 114, 0.25);
  border-radius: var(--r-pill);
  padding: 2px 8px;
  white-space: nowrap;
}

.info {
  display: flex;
  flex-direction: column;
  min-width: 0;
  gap: 2px;
}

.info strong {
  font-size: var(--fs-sm);
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.info small {
  color: var(--c-text-2);
  font-size: var(--fs-xs);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.info small .no {
  font-family: var(--font-mono, monospace);
  color: var(--c-text-3);
}

.q {
  font-weight: 700;
  font-size: var(--fs-md);
}

.log-list li.in .q {
  color: var(--c-accent);
}

.log-list li.out .q {
  color: var(--c-danger);
}

.log-list time {
  font-size: var(--fs-xs);
  color: var(--c-text-3);
}

/* ===== 撤销弹窗（沿用全局 .modal-mask / .modal 主题） ===== */
.modal-mask .void-modal {
  max-width: 440px;
}

.modal-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.modal-x {
  border: none;
  background: transparent;
  font-size: 18px;
  line-height: 1;
  color: var(--c-text-3);
  cursor: pointer;
}

.modal-x:hover {
  color: var(--c-text);
}

.vd-sum {
  margin: 0 0 8px;
  font-size: var(--fs-sm);
  color: var(--c-text-2);
}

.vd-sum b {
  color: var(--c-text);
}

.vd-tip {
  margin: 0 0 14px;
  padding: 8px 10px;
  font-size: var(--fs-xs);
  line-height: 1.6;
  color: var(--c-text-2);
  background: var(--c-glass);
  border: 1px solid var(--c-border);
  border-radius: var(--r-md);
}

.vd-tip b {
  color: var(--c-danger);
}

.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: 0;
}

.field>span {
  font-size: var(--fs-xs);
  color: var(--c-text-2);
  font-weight: 500;
}

.field>span em {
  color: var(--c-danger);
  font-style: normal;
}

.vd-err {
  margin: 8px 0 0;
  font-size: var(--fs-xs);
  color: var(--c-danger);
}

@media (max-width: 820px) {
  .filters {
    flex-direction: column;
    align-items: stretch;
  }

  .f-search {
    flex: 1;
  }

  .f-search input {
    width: 100%;
  }

  .f-cat {
    min-width: 0;
  }
}
</style>
