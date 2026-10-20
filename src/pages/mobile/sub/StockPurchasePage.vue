<template>
  <SubPage title="待采单">
    <PullRefresh @refresh="onRefresh">
      <div class="mpage">
        <!-- 状态筛选 + 统计（桌面：Segmented + 右侧统计） -->
        <div class="topbar">
          <div class="chip-row">
            <button v-for="s in statusOpts" :key="s.value" class="chip" :class="{ on: status === s.value }"
              @click="setStatus(s.value)">{{ s.label }}</button>
          </div>
          <p class="stat">
            采购中 <b>{{ pendingCount }}</b> · 已完成 <b>{{ doneCount }}</b>
          </p>
        </div>

        <p v-if="error" class="error">
          {{ error }}
          <button class="retry-link" @click="load">重试</button>
        </p>

        <div v-if="loading" class="hint"><div class="spinner-lg" /></div>

        <div v-else-if="!orders.length" class="empty">
          <div class="empty-ico"><ShoppingCart :size="40" style="display: inline-flex; flex-shrink: 0" /></div>
          <h3>{{ status === 'all' ? '还没有待采单' : '没有该状态的待采单' }}</h3>
          <p>点右下角「新建」，把缺料物料加进来统一采购</p>
        </div>

        <template v-else>
          <article v-for="o in orders" :key="o.id" class="pcard" @click="open(o)">
            <div class="p-head">
              <h3>{{ o.name }}</h3>
              <span class="pill" :class="o.status === 'done' ? 'ok' : 'warn'">
                {{ o.status === 'done' ? '已完成' : '采购中' }}
              </span>
            </div>
            <p v-if="o.note" class="p-note">{{ o.note }}</p>
            <div class="p-prog">
              <span class="pg">待采 <b>{{ progOf(o).undone }}</b></span>
              <span class="pg">已采 <b>{{ progOf(o).done }}</b></span>
              <span class="pg total">共 {{ progOf(o).total }} 项</span>
              <span class="p-time">{{ fmtDate(o.created_at) }}</span>
            </div>
            <div class="p-ops">
              <button v-if="o.status !== 'done'" class="op-done" :disabled="busyId === o.id"
                @click.stop="complete(o)">
                <span v-if="busyId === o.id" class="spinner-sm" />完成采购
              </button>
              <button v-if="o.status !== 'done'" class="op-del" title="删除" @click.stop="askDelete(o)">
                <Trash2 :size="15" style="display: inline-flex; flex-shrink: 0" />
              </button>
            </div>
          </article>

          <div v-if="hasMore" class="load-more">
            <div v-if="loadingMore" class="spinner-sm" />
            <span v-else>上拉加载更多</span>
          </div>
          <div v-else class="load-end">没有更多了</div>
        </template>

        <div ref="sentinelEl" class="sentinel" />

        <button class="fab" title="新建待采单" @click="goNew">
          <Plus :size="22" style="display: inline-flex; flex-shrink: 0" />
        </button>
      </div>
    </PullRefresh>
  </SubPage>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { useRouter } from 'vue-router'
import { ShoppingCart, Plus, Trash2 } from 'lucide-vue-next'
import SubPage from '../../../components/mobile/SubPage.vue'
import PullRefresh from '../../../components/mobile/PullRefresh.vue'
import {
  listPurchaseOrdersPage, countPurchaseOrders, listPurchaseItems, deletePurchaseOrder,
  updatePurchaseItem, updatePurchaseOrder, stockInOrder,
} from '../../../lib/db'
import { withAuthRetry } from '../../../lib/authRetry'
import { confirm } from '../../../composables/confirm'
import { useToast } from '../../../composables/toast'
import { useStockData } from '../../../composables/useStockData'
import type { PurchaseOrder, PurchaseItem } from '../../../lib/types'

/**
 * 移动端待采单列表：卡片流（进度、完成采购、删除）+ FAB 新建。
 * 与桌面 StockPurchase 的差异（见 demo/MOBILE_STOCK_PLAN.md）：
 * - DataTable 6 列 → 卡片；三态抽屉 → 列表页 / 详情页 两个路由
 * - 明细条数沿用「按当前页订单并发拉 items」的做法（PC 同款），但只拉可见页
 */
const router = useRouter()
const toast = useToast()
const { comps, summaryMap, sumOf, refreshList, refreshSummary, refreshLogs } = useStockData()

const statusOpts = [
  { value: 'all', label: '全部' },
  { value: 'pending', label: '采购中' },
  { value: 'done', label: '已完成' },
]
const status = ref<'all' | 'pending' | 'done'>('all')
function setStatus(v: string) {
  status.value = v as typeof status.value
  load()
}

const orders = ref<PurchaseOrder[]>([])
/** orderId → 明细（用于进度展示） */
const itemsMap = ref<Record<string, PurchaseItem[]>>({})
const pendingCount = ref(0)
const doneCount = ref(0)
const loading = ref(false)
const loadingMore = ref(false)
const error = ref('')
const busyId = ref<string | null>(null)
const PAGE_SIZE = 20
const offset = ref(0)
const total = ref(0)
const hasMore = computed(() => orders.value.length < total.value)

const pad = (n: number) => String(n).padStart(2, '0')
function fmtDate(iso: string) {
  const d = new Date(iso)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function progOf(o: PurchaseOrder) {
  const items = itemsMap.value[o.id] || []
  const done = items.filter(i => i.done).length
  return { done, undone: items.length - done, total: items.length }
}

async function load() {
  loading.value = true
  error.value = ''
  offset.value = 0
  try {
    const [page, c1, c2] = await withAuthRetry(() => Promise.all([
      listPurchaseOrdersPage({
        status: status.value === 'all' ? null : status.value,
        limit: PAGE_SIZE, offset: 0,
      }),
      countPurchaseOrders('pending'),
      countPurchaseOrders('done'),
    ]))
    orders.value = page.rows
    total.value = page.total
    pendingCount.value = c1
    doneCount.value = c2
    // 进度需要明细：只拉当前页（与 PC 同款策略）
    const lists = await Promise.all(page.rows.map(o =>
      listPurchaseItems(o.id).catch(() => [] as PurchaseItem[])))
    itemsMap.value = Object.fromEntries(page.rows.map((o, i) => [o.id, lists[i]]))
  } catch (e: unknown) {
    error.value = '加载失败：' + ((e as Error).message || e)
  } finally {
    loading.value = false
  }
}

async function loadMore() {
  if (loading.value || loadingMore.value || !hasMore.value || error.value) return
  loadingMore.value = true
  try {
    offset.value += PAGE_SIZE
    const page = await withAuthRetry(() => listPurchaseOrdersPage({
      status: status.value === 'all' ? null : status.value,
      limit: PAGE_SIZE, offset: offset.value,
    }))
    orders.value.push(...page.rows)
    const lists = await Promise.all(page.rows.map(o =>
      listPurchaseItems(o.id).catch(() => [] as PurchaseItem[])))
    for (let i = 0; i < page.rows.length; i++) itemsMap.value[page.rows[i].id] = lists[i]
  } catch (e: unknown) {
    error.value = '加载更多失败：' + ((e as Error).message || e)
  } finally {
    loadingMore.value = false
  }
}

/** 详情页没有「按 id 取单张待采单」的后端接口，名称/原因/状态顺路带过去 */
function open(o: PurchaseOrder) {
  router.push({
    path: `/m/stock/purchase/${o.id}`,
    query: { name: o.name, note: o.note || '', status: o.status || 'pending' },
  })
}
function goNew() { router.push('/m/stock/purchase/new') }

/** 完成采购：一次入库单（source=purchase）+ 明细置为已采 + 单据转已完成 */
async function complete(o: PurchaseOrder) {
  if (o.status === 'done') { toast.error('该待采单已完成'); return }
  const items = itemsMap.value[o.id] || await listPurchaseItems(o.id)
  const stockable = items.filter(i => i.material_id)
  const skipped = items.length - stockable.length
  const rows = stockable
    .map(it => ({ it, qty: it.lack_qty > 0 ? it.lack_qty : it.qty }))
    .filter(x => x.qty > 0)
  const totalQty = rows.reduce((s, x) => s + x.qty, 0)
  const ok = await confirm({
    content: `完成「${o.name}」的采购？将对 ${rows.length} 项物料入库共 ${totalQty} 件`
      + (skipped ? `；另有 ${skipped} 项未关联库存物料将被跳过` : '')
      + '。完成后本单变为「已完成」，不可再编辑或删除。',
    confirmText: '完成采购',
  })
  if (!ok) return
  busyId.value = o.id
  try {
    const poNote = `待采入库（${o.name}）`
    if (rows.length) {
      const { finals } = await withAuthRetry(() => stockInOrder({
        type: 'in', source: 'purchase', source_id: o.id,
        title: `待采入库：${o.name}`, note: poNote,
        items: rows.map(x => ({ material_id: x.it.material_id as string, qty: x.qty, note: poNote })),
      }))
      for (const x of rows) {
        const mid = x.it.material_id as string
        const fresh = finals.get(mid) ?? 0
        const idx = comps.value.findIndex(c => c.id === mid)
        if (idx >= 0) comps.value[idx] = { ...comps.value[idx], qty: fresh }
        const s = sumOf(mid)
        s.total_in += x.qty
        s.last30_in += x.qty
        summaryMap.value.set(mid, s)
        await withAuthRetry(() => updatePurchaseItem(x.it.id, { done: true, stock_qty: fresh, lack_qty: 0 }))
      }
    }
    await withAuthRetry(() => updatePurchaseOrder(o.id, { status: 'done' }))
    await Promise.all([refreshList(), refreshSummary(), refreshLogs()])
    toast.success('已完成采购，库存已更新')
    await load()
  } catch (e: unknown) {
    toast.error('完成采购失败：' + ((e as Error).message || e))
  } finally {
    busyId.value = null
  }
}

async function askDelete(o: PurchaseOrder) {
  if (o.status === 'done') { toast.error('已完成的待采单不可删除'); return }
  const ok = await confirm({
    content: `删除待采单「${o.name}」及其全部明细？`, confirmText: '删除', danger: true,
  })
  if (!ok) return
  try {
    await withAuthRetry(() => deletePurchaseOrder(o.id))
    toast.success('已删除')
    await load()
  } catch (e: unknown) {
    toast.error('删除失败：' + ((e as Error).message || e))
  }
}

async function onRefresh(done: () => void) {
  await load()
  done()
}

const sentinelEl = ref<HTMLElement | null>(null)
let io: IntersectionObserver | null = null

onMounted(() => {
  load()
  io = new IntersectionObserver(es => {
    if (es.some(e => e.isIntersecting)) loadMore()
  }, { rootMargin: '600px 0px' })
  if (sentinelEl.value) io.observe(sentinelEl.value)
})
onBeforeUnmount(() => io?.disconnect())
</script>

<style scoped>
.mpage {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-height: 100%;
}

.topbar {
  position: sticky;
  top: 0;
  z-index: 10;
  margin: 0 -16px;
  padding: 0 16px 10px;
  background: var(--c-bg);
  border-bottom: 1px solid var(--c-border-hairline);
}

.chip-row {
  display: flex;
  gap: 6px;
  overflow-x: auto;
  scrollbar-width: none;
}

.chip-row::-webkit-scrollbar {
  display: none;
}

.chip {
  flex-shrink: 0;
  height: 30px;
  padding: 0 14px;
  border: 1px solid var(--c-border);
  border-radius: 999px;
  background: var(--c-surface);
  color: var(--c-text-2);
  font-family: inherit;
  font-size: var(--fs-sm);
  font-weight: 500;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}

.chip.on {
  border-color: var(--c-primary);
  background: var(--c-primary-soft);
  color: var(--c-primary);
  font-weight: 600;
}

.stat {
  margin: 8px 0 0;
  font-size: var(--fs-xs);
  color: var(--c-text-3);
}

.stat b {
  color: var(--c-text-2);
  font-variant-numeric: tabular-nums;
}

.pcard {
  padding: 12px 14px;
  background: var(--c-surface);
  border: 1px solid var(--c-border);
  border-radius: var(--r-xl);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  transition: background var(--motion-fast);
}

.pcard:active {
  background: var(--c-surface-hover);
}

.p-head {
  display: flex;
  align-items: center;
  gap: 8px;
}

.p-head h3 {
  flex: 1;
  min-width: 0;
  margin: 0;
  font-size: var(--fs-md);
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.pill {
  flex-shrink: 0;
  padding: 2px 9px;
  border-radius: 999px;
  font-size: var(--fs-xs);
  font-weight: 600;
}

.pill.warn {
  background: rgba(255, 176, 32, 0.14);
  color: var(--c-warn, #ffb020);
}

.pill.ok {
  background: rgba(52, 218, 191, 0.12);
  color: var(--c-accent);
}

.p-note {
  margin: 4px 0 0;
  font-size: var(--fs-xs);
  color: var(--c-text-3);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.p-prog {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 8px;
  font-size: var(--fs-xs);
  color: var(--c-text-3);
  flex-wrap: wrap;
}

.pg b {
  color: var(--c-text);
  font-variant-numeric: tabular-nums;
}

.p-time {
  margin-left: auto;
}

.p-ops {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 10px;
}

.op-done {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 34px;
  padding: 0 14px;
  border: none;
  border-radius: var(--r-md);
  background: var(--c-primary);
  color: #fff;
  font-family: inherit;
  font-size: var(--fs-sm);
  font-weight: 600;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}

.op-done:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.op-del {
  margin-left: auto;
  width: 34px;
  height: 34px;
  display: grid;
  place-items: center;
  border: 1px solid var(--c-border);
  border-radius: var(--r-md);
  background: transparent;
  color: var(--c-text-3);
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}

.op-del:active {
  color: var(--c-danger);
  border-color: var(--c-danger);
}

.fab {
  position: fixed;
  right: 16px;
  bottom: calc(70px + env(safe-area-inset-bottom));
  z-index: 90;
  width: 52px;
  height: 52px;
  display: grid;
  place-items: center;
  border: none;
  border-radius: 50%;
  background: var(--c-primary);
  color: #fff;
  box-shadow: var(--shadow-pop);
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  transition: transform var(--motion-fast);
}

.fab:active {
  transform: scale(0.92);
}

/* 状态 */
.hint {
  display: flex;
  justify-content: center;
  padding: 24px 0;
}

.empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 40px 0;
  text-align: center;
}

.empty-ico {
  color: var(--c-text-3);
}

.empty h3 {
  margin: 6px 0 0;
  font-size: var(--fs-md);
  font-weight: 600;
}

.empty p {
  margin: 0;
  font-size: var(--fs-sm);
  color: var(--c-text-3);
}

.error {
  margin: 0;
  padding: 10px 0;
  font-size: var(--fs-sm);
  color: var(--c-danger);
}

.retry-link {
  margin-left: 8px;
  border: none;
  background: transparent;
  color: var(--c-primary);
  font-family: inherit;
  font-size: var(--fs-sm);
  font-weight: 600;
  cursor: pointer;
}

.load-more,
.load-end {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 14px 0 calc(14px + env(safe-area-inset-bottom));
  font-size: var(--fs-xs);
  color: var(--c-text-3);
}

.sentinel {
  height: 1px;
}

.spinner-lg {
  width: 26px;
  height: 26px;
  border: 3px solid var(--c-border);
  border-top-color: var(--c-primary);
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
}

.spinner-sm {
  width: 16px;
  height: 16px;
  border: 2px solid var(--c-border);
  border-top-color: var(--c-primary);
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}
</style>
