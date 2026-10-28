<template>
  <SubPage title="出入库单">
    <PullRefresh @refresh="onRefresh">
      <div class="mpage">
        <!-- 吸顶：搜索 + 类型 / 时间 / 状态 三组 chip（替代桌面 Segmented + 两个下拉） -->
        <div class="topbar">
          <div class="search">
            <Search :size="14" class="s-ico" style="display: inline-flex; flex-shrink: 0" />
            <input v-model="kw" type="search" placeholder="搜索单号 / 标题 / 物料" />
          </div>
          <div class="chip-row">

            <button v-for="r in rangeOpts" :key="r.value" class="chip" :class="{ on: range === r.value }"
              @click="setRange(r.value)">{{ r.label
              }}</button> <span class="chip-sep" /> <button v-for="t in typeOpts" :key="t.value" class="chip"
              :class="{ on: type === t.value }" @click="setType(t.value)">{{ t.label }}</button>
          </div>
          <div class="chip-row">


            <button v-for="s in statusOpts" :key="s.value" class="chip" :class="{ on: status === s.value }"
              @click="setStatus(s.value)">{{ s.label }}</button>
          </div>
        </div>

        <div class="list-wrap">
          <p v-if="error" class="error">
            {{ error }}
            <button class="retry-link" @click="reload">重试</button>
          </p>

          <div v-if="loading" class="hint">
            <div class="spinner-lg" />
          </div>

          <div v-else-if="!orders.length" class="empty">
            <div class="empty-ico">
              <History :size="40" style="display: inline-flex; flex-shrink: 0" />
            </div>
            <h3>{{ hasFilter ? '没有匹配的单据' : '还没有出入库单据' }}</h3>
            <p>{{ hasFilter ? '换个关键词或筛选条件试试' : '在库存列表里做出入库后会出现在这里' }}</p>
          </div>

          <!-- 账单流：按日期分组 -->
          <template v-else>
            <section v-for="g in groups" :key="g.date" class="day">
              <header class="day-head">
                <span class="day-label">{{ g.label }}</span>
                <span class="day-count">{{ g.items.length }} 笔</span>
              </header>

              <article v-for="o in g.items" :key="o.id" class="ocard" :class="{ void: o.status === 'void' }"
                @click="openDetail(o)">
                <span class="o-tag" :class="o.type">{{ o.type === 'in' ? '入' : '出' }}</span>
                <div class="o-main">
                  <h3>{{ titleOf(o) }}</h3>
                  <p class="o-sub">{{ subOf(o) }}</p>
                  <p v-if="o.status === 'void' && o.void_reason" class="o-void">撤销原因：{{ o.void_reason }}</p>
                </div>
                <div class="o-right">
                  <span class="o-qty" :class="o.type">{{ o.type === 'in' ? '+' : '-' }}{{ o.total_qty }}</span>
                  <span class="o-time">{{ fmtTime(o.created_at) }}</span>
                </div>
              </article>
            </section>

            <div v-if="hasMore" class="load-more">
              <div v-if="loadingMore" class="spinner-sm" />
              <span v-else>上拉加载更多</span>
            </div>
            <div v-else class="load-end">没有更多了</div>
          </template>

          <div ref="sentinelEl" class="sentinel" />
        </div>

        <!-- 单据明细（底部弹层，替代桌面 StockOrderDrawer） -->
        <BottomSheet :open="!!cur" :title="cur ? titleOf(cur) : ''" tall @close="cur = null">
          <div v-if="cur" class="d-body">
            <div class="d-meta">
              <span class="d-kv"><b>单号</b>{{ cur.order_no || '—' }}</span>
              <span class="d-kv"><b>类型</b>
                <i class="d-tag" :class="cur.type">{{ cur.type === 'in' ? '入库' : '出库' }}</i>
              </span>
              <span class="d-kv"><b>来源</b>{{ SOURCE_LABELS[cur.source] || cur.source }}</span>
              <span class="d-kv"><b>时间</b>{{ fmtFull(cur.created_at) }}</span>
              <span v-if="cur.suppliers?.name" class="d-kv"><b>供应商</b>{{ cur.suppliers.name }}</span>
              <span v-if="cur.note" class="d-kv wide"><b>备注</b>{{ cur.note }}</span>
            </div>

            <h4 class="d-title">明细（{{ detailLogs.length || cur.item_count }}）</h4>
            <div v-if="detailLoading" class="hint">
              <div class="spinner-sm" />
            </div>
            <ul v-else class="d-list">
              <li v-for="(l, i) in detailLogs" :key="l.id || i">
                <div class="d-main">
                  <span class="d-name">{{ l.materials?.name || '（物料已删除）' }}</span>
                  <small v-if="metaOf(l)" class="d-model">{{ metaOf(l) }}</small>
                </div>
                <span class="d-qty" :class="l.type">{{ l.type === 'in' ? '+' : '-' }}{{ l.qty }}</span>
              </li>
              <li v-if="!detailLogs.length" class="d-empty">暂无明细</li>
            </ul>
          </div>
          <template #foot>
            <button v-if="cur && cur.status === 'normal'" class="btn-danger" @click="voidTarget = cur">
              撤销整单
            </button>
            <button v-else class="btn-ghost" disabled>该单已撤销</button>
          </template>
        </BottomSheet>

        <!-- 撤销原因（二级弹层） -->
        <BottomSheet :open="!!voidTarget" title="撤销单据" top @close="voidTarget = null">
          <p class="v-tip">撤销后该单明细全部作废、库存反向回滚；若回滚后出现负库存，整单撤销会失败。</p>
          <textarea v-model="voidReason" class="v-input" rows="3" placeholder="请填写撤销原因（必填）" />
          <p v-if="voidErr" class="v-err">{{ voidErr }}</p>
          <template #foot>
            <button class="btn-ghost" @click="voidTarget = null">取消</button>
            <button class="btn-danger" :disabled="voidBusy" @click="submitVoid">
              <span v-if="voidBusy" class="spinner-sm" />{{ voidBusy ? '处理中…' : '确认撤销' }}
            </button>
          </template>
        </BottomSheet>
      </div>
    </PullRefresh>
  </SubPage>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import { Search, History } from 'lucide-vue-next'
import SubPage from '../../../components/mobile/SubPage.vue'
import PullRefresh from '../../../components/mobile/PullRefresh.vue'
import BottomSheet from '../../../components/mobile/BottomSheet.vue'
import { pageStockOrders, listStockLogsByOrder, voidStockOrder } from '../../../lib/db'
import { withAuthRetry } from '../../../lib/authRetry'
import { useStockData } from '../../../composables/useStockData'
import { useToast } from '../../../composables/toast'
import type { StockOrder, StockLog, StockOrderSource } from '../../../lib/types'
import type { StockOrderPageOpts } from '../../../lib/storage/types'

/**
 * 移动端出入库记录：账单流（按日期分组）+ 底部弹层明细 + 撤销（原因必填）。
 * 与桌面 StockLogs 的差异（见 demo/MOBILE_STOCK_PLAN.md）：
 * - 5 列 grid 行 → 卡片；hover 才显形的撤销按钮 → 常显
 * - 桌面 StockOrderDrawer（含「标签打印」死链）→ 底部明细弹层
 * - 居中撤销弹窗 → 二级底部弹层
 */
const toast = useToast()
const { refreshList, refreshSummary, refreshLogs } = useStockData()

const SOURCE_LABELS: Record<StockOrderSource, string> = {
  manual: '手工出入库',
  init: '初始库存',
  import: '订单导入',
  bom: 'BOM 领料',
  purchase: '采购入库',
  stocktake: '盘点调整',
  scan_lcsc: '扫码入库(立创)',
  legacy: '历史迁移',
}

/** 时间范围 → ISO 边界 */
const RANGE_DAYS: Record<string, number | null> = { all: null, today: 0, d7: 7, d30: 30 }
const typeOpts = [
  { value: 'all', label: '全部' },
  { value: 'in', label: '入库' },
  { value: 'out', label: '出库' },
]
const rangeOpts = [
  { value: 'all', label: '全部时间' },
  { value: 'today', label: '今天' },
  { value: 'd7', label: '近 7 天' },
  { value: 'd30', label: '近 30 天' },
]
const statusOpts = [
  { value: 'all', label: '全部状态' },
  { value: 'normal', label: '有效' },
  { value: 'void', label: '已撤销' },
]

const kw = ref('')
const type = ref<'all' | 'in' | 'out'>('all')
const range = ref<'all' | 'today' | 'd7' | 'd30'>('all')
const status = ref<'all' | 'normal' | 'void'>('all')

const orders = ref<StockOrder[]>([])
const loading = ref(false)
const loadingMore = ref(false)
const error = ref('')
const PAGE_SIZE = 20
const offset = ref(0)
const total = ref(0)

const hasMore = computed(() => orders.value.length < total.value)
const hasFilter = computed(() =>
  !!kw.value.trim() || type.value !== 'all' || range.value !== 'all' || status.value !== 'all')

function setType(v: string) { type.value = v as typeof type.value; reload() }
function setRange(v: string) { range.value = v as typeof range.value; reload() }
function setStatus(v: string) { status.value = v as typeof status.value; reload() }

/** 时间范围 → from/to（本地时区，按天取整） */
function rangeBounds(): { from?: string; to?: string } {
  const days = RANGE_DAYS[range.value]
  if (days === null) return {}
  const now = new Date()
  if (days === 0) {
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    return { from: start.toISOString() }
  }
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - days)
  return { from: start.toISOString() }
}

function buildOpts(): StockOrderPageOpts {
  const opts: StockOrderPageOpts = { limit: PAGE_SIZE, offset: offset.value }
  if (type.value !== 'all') opts.type = type.value
  if (status.value !== 'all') opts.status = status.value
  const k = kw.value.trim()
  if (k) opts.keyword = k
  const { from } = rangeBounds()
  if (from) opts.from = from
  return opts
}

async function load() {
  loading.value = true
  error.value = ''
  offset.value = 0
  try {
    const res = await withAuthRetry(() => pageStockOrders(buildOpts()))
    orders.value = res.rows
    total.value = res.total
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
    const res = await withAuthRetry(() => pageStockOrders(buildOpts()))
    orders.value.push(...res.rows)
  } catch (e: unknown) {
    error.value = '加载更多失败：' + ((e as Error).message || e)
  } finally {
    loadingMore.value = false
  }
}

let timer: ReturnType<typeof setTimeout> | null = null
function reload() {
  if (timer) clearTimeout(timer)
  timer = setTimeout(load, 300)
}
watch(kw, reload)

// ===== 展示 =====
function titleOf(o: StockOrder) {
  return o.title || o.note || (o.type === 'in' ? '入库单' : '出库单')
}
function subOf(o: StockOrder) {
  return [o.order_no, SOURCE_LABELS[o.source] || o.source, o.suppliers?.name, `${o.item_count} 项`]
    .filter(Boolean).join(' · ')
}
/** 明细副标题：型号 · 品牌 · 小类（有才拼） */
function metaOf(l: StockLog) {
  return [l.materials?.model, l.materials?.brand, l.materials?.categories?.name]
    .filter(Boolean).join(' · ')
}
const pad = (n: number) => String(n).padStart(2, '0')
function fmtTime(iso: string) {
  const d = new Date(iso)
  const sameDay = d.toDateString() === new Date().toDateString()
  return sameDay
    ? `${pad(d.getHours())}:${pad(d.getMinutes())}`
    : `${d.getMonth() + 1}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}
function fmtFull(iso: string) {
  const d = new Date(iso)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}
function dayKey(iso: string) {
  const d = new Date(iso)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
function dayLabel(key: string) {
  const today = dayKey(new Date().toISOString())
  if (key === today) return '今天'
  const y = new Date()
  y.setDate(y.getDate() - 1)
  if (key === dayKey(y.toISOString())) return '昨天'
  const [, m, d] = key.split('-')
  return `${Number(m)} 月 ${Number(d)} 日`
}

/** 按日期分组（服务端已按时间倒序，组内保持原序） */
const groups = computed(() => {
  const map = new Map<string, StockOrder[]>()
  for (const o of orders.value) {
    const k = dayKey(o.created_at)
    const list = map.get(k)
    if (list) list.push(o)
    else map.set(k, [o])
  }
  return [...map.entries()].map(([date, items]) => ({ date, label: dayLabel(date), items }))
})

// ===== 明细 =====
const cur = ref<StockOrder | null>(null)
const detailLogs = ref<StockLog[]>([])
const detailLoading = ref(false)

async function openDetail(o: StockOrder) {
  cur.value = o
  detailLogs.value = []
  detailLoading.value = true
  try { detailLogs.value = await withAuthRetry(() => listStockLogsByOrder(o.id)) }
  catch { /* 静默：明细失败不阻塞弹层 */ }
  finally { detailLoading.value = false }
}

// ===== 撤销 =====
const voidTarget = ref<StockOrder | null>(null)
const voidReason = ref('')
const voidErr = ref('')
const voidBusy = ref(false)

watch(voidTarget, (v) => {
  voidReason.value = ''
  voidErr.value = ''
  if (v) cur.value = null
})

async function submitVoid() {
  const o = voidTarget.value
  if (!o) return
  const reason = voidReason.value.trim()
  if (!reason) { voidErr.value = '请填写撤销原因'; return }
  voidBusy.value = true
  voidErr.value = ''
  try {
    await withAuthRetry(() => voidStockOrder(o.id, reason))
    toast.success('已撤销该单据')
    voidTarget.value = null
    cur.value = null
    // 撤销会反向回滚库存 → 三处共享数据都要刷，否则首页 KPI 是旧值
    await Promise.all([refreshList(), refreshSummary(), refreshLogs()])
    await load()
  } catch (e: unknown) {
    voidErr.value = '撤销失败：' + ((e as Error).message || e)
  } finally {
    voidBusy.value = false
  }
}

async function onRefresh(done: () => void) {
  await Promise.all([refreshLogs(), refreshSummary()])
  await load()
  done()
}

// ===== 无限滚动 =====
const sentinelEl = ref<HTMLElement | null>(null)
let io: IntersectionObserver | null = null

onMounted(() => {
  load()
  io = new IntersectionObserver(es => {
    if (es.some(e => e.isIntersecting)) loadMore()
  }, { rootMargin: '600px 0px' })
  if (sentinelEl.value) io.observe(sentinelEl.value)
})
onBeforeUnmount(() => {
  io?.disconnect()
  if (timer) clearTimeout(timer)
})
</script>

<style scoped>
.mpage {
  display: flex;
  flex-direction: column;
  min-height: 100%;
}

/* ===== 吸顶 ===== */
.topbar {
  position: sticky;
  top: 0;
  z-index: 10;
  margin: 0 -16px;
  padding: 0 16px 10px;
  background: var(--c-bg);
  border-bottom: 1px solid var(--c-border-hairline);
}

.search {
  display: flex;
  align-items: center;
  gap: 8px;
  background: var(--c-surface);
  border: 1px solid var(--c-border);
  border-radius: var(--r-md);
  padding: 0 10px;
  height: 34px;
}

.search:focus-within {
  border-color: var(--c-primary);
}

.search input {
  flex: 1;
  min-width: 0;
  border: none;
  background: transparent;
  height: 100%;
  padding: 0;
  font-size: var(--fs-sm);
}

.search input:focus {
  outline: none;
  box-shadow: none;
}

.s-ico {
  color: var(--c-text-3);
  flex-shrink: 0;
}

.chip-row {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 8px;
  overflow-x: auto;
  scrollbar-width: none;
}

.chip-row::-webkit-scrollbar {
  display: none;
}

.chip {
  flex-shrink: 0;
  height: 28px;
  padding: 0 12px;
  border: 1px solid var(--c-border);
  border-radius: 999px;
  background: var(--c-surface);
  color: var(--c-text-2);
  font-family: inherit;
  font-size: var(--fs-xs);
  font-weight: 500;
  white-space: nowrap;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  transition: background var(--motion-fast), color var(--motion-fast), border-color var(--motion-fast);
}

.chip.on {
  border-color: var(--c-primary);
  background: var(--c-primary-soft);
  color: var(--c-primary);
  font-weight: 600;
}

.chip-sep {
  width: 1px;
  height: 16px;
  flex-shrink: 0;
  background: var(--c-border);
}

/* ===== 列表 ===== */
.list-wrap {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding-top: 12px;
}

.day-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  padding: 0 2px 6px;
}

.day-label {
  font-size: var(--fs-sm);
  font-weight: 700;
  color: var(--c-text);
}

.day-count {
  font-size: var(--fs-xs);
  color: var(--c-text-3);
}

.ocard {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  background: var(--c-surface);
  border: 1px solid var(--c-border);
  border-radius: var(--r-lg);
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  transition: background var(--motion-fast);
}

.ocard+.ocard {
  margin-top: 8px;
}

.ocard:active {
  background: var(--c-surface-hover);
}

.ocard.void {
  opacity: 0.55;
}

.ocard.void .o-main h3 {
  text-decoration: line-through;
}

.o-tag {
  flex-shrink: 0;
  width: 26px;
  height: 26px;
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
  background: rgba(255, 92, 114, 0.12);
  color: var(--c-danger);
}

.o-main {
  flex: 1;
  min-width: 0;
}

.o-main h3 {
  margin: 0;
  font-size: var(--fs-md);
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.o-sub {
  margin: 2px 0 0;
  font-size: var(--fs-xs);
  color: var(--c-text-3);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.o-void {
  margin: 3px 0 0;
  font-size: var(--fs-xs);
  color: var(--c-danger);
}

.o-right {
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 2px;
}

.o-qty {
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

.o-time {
  font-size: var(--fs-xs);
  color: var(--c-text-3);
}

/* ===== 明细弹层 ===== */
.d-body {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.d-meta {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px 12px;
}

.d-kv {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: var(--fs-xs);
  color: var(--c-text-2);
  min-width: 0;
}

.d-kv.wide {
  grid-column: 1 / -1;
}

.d-kv b {
  flex-shrink: 0;
  font-weight: 500;
  color: var(--c-text-3);
}

.d-tag {
  padding: 1px 7px;
  border-radius: 999px;
  font-size: var(--fs-xs);
  font-style: normal;
  font-weight: 600;
}

.d-tag.in {
  background: var(--c-primary-soft);
  color: var(--c-primary);
}

.d-tag.out {
  background: rgba(255, 92, 114, 0.12);
  color: var(--c-danger);
}

.d-title {
  margin: 4px 0 0;
  font-size: var(--fs-sm);
  font-weight: 600;
  color: var(--c-text-2);
}

.d-list {
  list-style: none;
  margin: 0;
  padding: 0;
}

.d-list li {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 38px;
  padding: 4px 0;
  border-bottom: 1px solid var(--c-border-hairline);
}

.d-list li:last-child {
  border-bottom: none;
}

.d-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.d-name {
  min-width: 0;
  font-size: var(--fs-sm);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.d-model {
  font-size: var(--fs-xs);
  color: var(--c-text-3);
}

.d-qty {
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}

.d-qty.in {
  color: var(--c-primary);
}

.d-qty.out {
  color: var(--c-danger);
}

.d-empty {
  justify-content: center;
  color: var(--c-text-3);
  font-size: var(--fs-sm);
}

/* ===== 撤销 ===== */
.v-tip {
  margin: 0 0 10px;
  font-size: var(--fs-xs);
  color: var(--c-text-3);
  line-height: 1.6;
}

.v-input {
  width: 100%;
  padding: 10px;
  border: 1px solid var(--c-border);
  border-radius: var(--r-md);
  background: var(--c-surface);
  color: var(--c-text);
  font-family: inherit;
  font-size: var(--fs-sm);
  resize: none;
}

.v-input:focus {
  outline: none;
  border-color: var(--c-primary);
}

.v-err {
  margin: 8px 0 0;
  font-size: var(--fs-xs);
  color: var(--c-danger);
}

.btn-danger,
.btn-ghost {
  flex: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  height: 44px;
  border-radius: var(--r-md);
  font-family: inherit;
  font-size: var(--fs-md);
  font-weight: 600;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}

.btn-danger {
  border: none;
  background: var(--c-danger);
  color: #fff;
}

.btn-danger:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.btn-ghost {
  border: 1px solid var(--c-border);
  background: var(--c-surface);
  color: var(--c-text-2);
}

/* ===== 状态 ===== */
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
  to {
    transform: rotate(360deg);
  }
}
</style>
