<template>
  <SubPage title="库存列表">
    <PullRefresh @refresh="onRefresh">
      <div class="mpage">
        <!-- 吸顶：搜索 + 筛选（与物料页同一套交互） -->
        <div class="topbar">
          <div class="search-row">
            <div class="search">
              <Search :size="14" class="s-ico" style="display: inline-flex; flex-shrink: 0" />
              <!-- 服务端检索字段：name / model / brand / package / part_no，多个词用空格或逗号分隔 -->
              <input v-model="search" type="search" placeholder="搜索名称 / 型号 / 商品编号" />
            </div>
            <button class="icon-btn" :class="{ on: filterCount > 0 }" @click="panelOpen = true">
              <SlidersHorizontal :size="15" style="display: inline-flex; flex-shrink: 0" />
              <i v-if="filterCount" class="f-badge">{{ filterCount }}</i>
            </button>
          </div>

          <!-- 排序 + 仅低库存（横滑 chip，替代 DataTable 的表头排序） -->
          <div class="chip-row">
            <button class="chip" :class="{ on: lowOnly }" @click="toggleLow">仅低库存</button>
            <button v-for="s in sorts" :key="s.key" class="chip" :class="{ on: sortKey === s.key }"
              @click="setSort(s.key)">
              {{ s.label }}
              <component :is="sortKey === s.key && sortDir === 1 ? ChevronUp : ChevronDown" :size="12"
                style="display: inline-flex; flex-shrink: 0" />
            </button>
          </div>

          <!-- 已选条件（可单个清除） -->
          <div v-if="selectedTags.length" class="sel-tags">
            <button v-for="t in selectedTags" :key="t.key" class="sel-tag" @click="removeTag(t.key)">
              {{ t.label }}<X :size="11" style="display: inline-flex; flex-shrink: 0" />
            </button>
            <button class="sel-tag clear" @click="clearFilter">清空</button>
          </div>
        </div>

        <!-- 列表 -->
        <div class="list-wrap">
          <p v-if="error" class="error">
            {{ error }}
            <button class="retry-link" @click="reload">重试</button>
          </p>

          <div v-if="loading" class="hint"><div class="spinner-lg" /></div>

          <div v-else-if="!rows.length" class="empty">
            <div class="empty-ico"><Boxes :size="40" style="display: inline-flex; flex-shrink: 0" /></div>
            <h3>{{ hasFilter ? '没有匹配的物料' : '还没有物料' }}</h3>
            <p>{{ hasFilter ? '换个关键词或分类试试' : '去物料页添加物料后再来看库存' }}</p>
          </div>

          <template v-else>
            <article v-for="m in rows" :key="m.id" class="mcard" @click="openDetail(m)">
              <div class="mc-main">
                <h3>{{ m.name }}</h3>
                <p class="mc-sub">{{ [m.model, m.brand].filter(Boolean).join(' · ') || '—' }}</p>
                <div class="mc-tags">
                  <span v-if="m.part_no" class="tag code">{{ m.part_no }}</span>
                  <span v-if="m.categories?.name" class="tag">{{ m.categories.name }}</span>
                  <span v-if="m.location" class="tag loc">
                    <MapPin :size="11" style="display: inline-flex; flex-shrink: 0" />{{ m.location }}
                  </span>
                  <span v-if="lowThresholds[m.id]" class="tag low-tag">阈值 {{ lowThresholds[m.id] }}</span>
                </div>
              </div>
              <div class="mc-right">
                <div class="mc-num">
                  <span class="qty" :class="{ low: isLow(m) }">{{ m.qty }}</span>
                  <span class="io">
                    <b class="in">+{{ in30(m.id) }}</b>
                    <b class="out">-{{ out30(m.id) }}</b>
                  </span>
                </div>
                <button class="mc-act" title="出入库" @click.stop="openQuick(m)">
                  <ArrowLeftRight :size="15" style="display: inline-flex; flex-shrink: 0" />
                </button>
              </div>
            </article>

            <div v-if="hasMore" class="load-more">
              <div v-if="loadingMore" class="spinner-sm" />
              <span v-else>上拉加载更多</span>
            </div>
            <div v-else class="load-end">没有更多了</div>
          </template>

          <!-- 无限滚动哨兵 -->
          <div ref="sentinelEl" class="sentinel" />
        </div>

        <!-- 筛选面板（库位 → 大类 → 小类 → 扩展参数），复用物料页那套 -->
        <MaterialFilterPanel :open="panelOpen" :tree="tree" :cat-id="catId" :params="paramSel"
          :location="location" @apply="onFilterApply" @close="panelOpen = false" />

        <!-- 快捷出入库（底部 sheet，与物料详情页同一个组件） -->
        <QuickStockSheet :material="quickMat" @close="quickMat = null" @done="onQuickDone" />
      </div>
    </PullRefresh>
  </SubPage>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import { useRouter } from 'vue-router'
import {
  Search, SlidersHorizontal, X, Boxes, MapPin, ArrowLeftRight, ChevronUp, ChevronDown,
} from 'lucide-vue-next'
import SubPage from '../../../components/mobile/SubPage.vue'
import PullRefresh from '../../../components/mobile/PullRefresh.vue'
import MaterialFilterPanel from '../../../components/mobile/MaterialFilterPanel.vue'
import QuickStockSheet from '../../../components/mobile/QuickStockSheet.vue'
import {
  listMaterialsPage, lowStockMaterials, listCategories, buildCategoryTree, descendantCategoryIds,
} from '../../../lib/db'
import { withAuthRetry } from '../../../lib/authRetry'
import { useStockData } from '../../../composables/useStockData'
import type { Category, MaterialRow } from '../../../lib/types'
import type { CategoryNode, MaterialPageOpts } from '../../../lib/db'

/**
 * 移动端库存列表：按物料聚合的进出汇总。
 * 与桌面 StockList 的差异（见 demo/MOBILE_STOCK_PLAN.md）：
 * - DataTable → 卡片流（库存大字 + 近30天入/出 + 行内出入库按钮）
 * - Pager → 无限滚动；「仅低库存」走 lowStockMaterials()（量小，一次性）
 * - 点行进移动端商详页 /m/material/:id，不再开桌面抽屉
 * - 排序在客户端做（口径与 PC 一致：当前页/当前结果集内排序）
 */
const router = useRouter()
const { comps, summaryMap, sumOf, refreshList, refreshSummary, refreshLogs } = useStockData()

/** 分类单独维护：筛选面板要的是完整树，useStockData 那份可能尚未加载 */
const cats = ref<Category[]>([])
async function loadCategories() {
  try { cats.value = await listCategories() } catch { /* 静默 */ }
}

// ===== 筛选 =====
const search = ref('')
const catId = ref<string | null>(null)
const location = ref<string | null>(null)
const paramSel = ref<Record<string, string>>({})
const lowOnly = ref(false)
const panelOpen = ref(false)

// ===== 排序（客户端，与 PC 同一组 key）=====
type SortKey = 'qty' | 'in30' | 'out30' | 'name'
const sorts: Array<{ key: SortKey; label: string }> = [
  { key: 'qty', label: '库存' },
  { key: 'in30', label: '近30天入' },
  { key: 'out30', label: '近30天出' },
  { key: 'name', label: '名称' },
]
const sortKey = ref<SortKey>('qty')
const sortDir = ref<1 | -1>(-1)

function setSort(k: SortKey) {
  if (sortKey.value === k) sortDir.value = sortDir.value === 1 ? -1 : 1
  else { sortKey.value = k; sortDir.value = k === 'name' ? 1 : -1 }
}

function toggleLow() {
  lowOnly.value = !lowOnly.value
  reload()
}

// ===== 数据 =====
const rows = ref<MaterialRow[]>([])
const loading = ref(false)
const loadingMore = ref(false)
const error = ref('')
const page = ref(0)
const PAGE_SIZE = 20
const total = ref(0)
/** 仅低库存模式下的生效阈值（用于标记，不在卡片上重复展示） */
const lowThresholds = ref<Record<string, number>>({})

const hasMore = computed(() => !lowOnly.value && rows.value.length < total.value)
const hasFilter = computed(() =>
  !!search.value.trim() || !!catId.value || !!location.value
  || Object.values(paramSel.value).some(Boolean) || lowOnly.value)

const tree = computed<CategoryNode[]>(() => buildCategoryTree(cats.value))
const filterCount = computed(() =>
  (catId.value ? 1 : 0) + (location.value ? 1 : 0) + Object.values(paramSel.value).filter(Boolean).length)

/** 已选条件回显（分类名 / 库位 / 参数条数） */
const selectedTags = computed<Array<{ key: string; label: string }>>(() => {
  const out: Array<{ key: string; label: string }> = []
  if (catId.value) {
    const flat = cats.value.find(c => c.id === catId.value)
    out.push({ key: 'cat', label: flat?.name || '分类' })
  }
  if (location.value) out.push({ key: 'loc', label: location.value })
  const pc = Object.values(paramSel.value).filter(Boolean).length
  if (pc) out.push({ key: 'param', label: `参数 ${pc}` })
  return out
})

function removeTag(key: string) {
  if (key === 'cat') catId.value = null
  else if (key === 'loc') location.value = null
  else paramSel.value = {}
  reload()
}
function clearFilter() {
  catId.value = null
  location.value = null
  paramSel.value = {}
  lowOnly.value = false
  reload()
}

const in30 = (id: string) => sumOf(id).last30_in
const out30 = (id: string) => sumOf(id).last30_out

/** 生效阈值：物料自身（>0）→ 分类（>0）→ 默认 5（与桌面 isLow 同口径） */
function isLow(m: MaterialRow): boolean {
  const t = (m.threshold || 0) > 0
    ? m.threshold
    : (((m.categories?.threshold || 0) > 0 ? m.categories!.threshold! : 5))
  return m.qty <= t
}

/** 客户端排序（与 PC tableRows 同口径） */
function sorted(list: MaterialRow[]): MaterialRow[] {
  const k = sortKey.value, d = sortDir.value
  return [...list].sort((a, b) => {
    let diff = 0
    if (k === 'name') diff = a.name.localeCompare(b.name, 'zh')
    else if (k === 'qty') diff = a.qty - b.qty
    else if (k === 'in30') diff = in30(a.id) - in30(b.id)
    else diff = out30(a.id) - out30(b.id)
    return diff * d
  })
}

function buildOpts(): MaterialPageOpts {
  const opts: MaterialPageOpts = {}
  const kw = search.value.trim()
  if (kw) opts.search = kw
  if (location.value) opts.location = location.value
  const isTop = tree.value.some(n => n.cat.id === catId.value)
  if (catId.value && !isTop) opts.categoryId = catId.value
  else if (catId.value) opts.categoryIds = descendantCategoryIds(cats.value, catId.value)
  const p = Object.fromEntries(Object.entries(paramSel.value).filter(([, v]) => !!v))
  if (Object.keys(p).length) opts.params = p
  return opts
}

async function load() {
  loading.value = true
  error.value = ''
  page.value = 0
  try {
    if (lowOnly.value) {
      // 低库存量小，一次性取完（阈值由后端按「物料 > 分类 > 全局」算出）
      const lows = await withAuthRetry(() => lowStockMaterials())
      lowThresholds.value = Object.fromEntries(lows.map(l => [l.id, l.threshold]))
      const map = new Map(comps.value.map(c => [c.id, c]))
      rows.value = sorted(lows.map(l => map.get(l.id) ?? ({
        id: l.id, name: l.name, model: l.model, qty: l.qty,
      } as MaterialRow)))
      total.value = rows.value.length
      return
    }
    lowThresholds.value = {}
    const res = await withAuthRetry(() =>
      listMaterialsPage({ ...buildOpts(), page: 0, pageSize: PAGE_SIZE }))
    rows.value = sorted(res.rows)
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
    page.value += 1
    const res = await withAuthRetry(() =>
      listMaterialsPage({ ...buildOpts(), page: page.value, pageSize: PAGE_SIZE }))
    rows.value = sorted([...rows.value, ...res.rows])
  } catch (e: unknown) {
    error.value = '加载更多失败：' + ((e as Error).message || e)
  } finally {
    loadingMore.value = false
  }
}

/** 筛选/搜索变化 → 重新查询（搜索 300ms 防抖） */
let timer: ReturnType<typeof setTimeout> | null = null
function reload() {
  if (timer) clearTimeout(timer)
  timer = setTimeout(load, 300)
}

watch([catId, location], reload)
watch(paramSel, reload, { deep: true })
watch(search, reload)
// 排序只影响展示，不重新查询
watch([sortKey, sortDir], () => { rows.value = sorted(rows.value) })

function onFilterApply(p: { catId: string | null; params: Record<string, string>; location: string | null }) {
  catId.value = p.catId
  paramSel.value = { ...p.params }
  location.value = p.location
  panelOpen.value = false
  reload()
}

// ===== 操作 =====
const quickMat = ref<MaterialRow | null>(null)
function openQuick(m: MaterialRow) { quickMat.value = m }
function openDetail(m: MaterialRow) { router.push(`/m/material/${m.id}`) }

/** 出入库成功：同步共享数据，避免回首页 KPI 是旧值 */
async function onQuickDone() {
  quickMat.value = null
  await Promise.all([refreshList(), refreshSummary(), refreshLogs()])
  await load()
}

/** 下拉刷新：物料 + 汇总一起刷 */
async function onRefresh(done: () => void) {
  await Promise.all([refreshList(), refreshSummary()])
  await load()
  done()
}

// ===== 无限滚动哨兵 =====
const sentinelEl = ref<HTMLElement | null>(null)
let io: IntersectionObserver | null = null

onMounted(() => {
  if (!comps.value.length) void refreshList()
  if (!cats.value.length) void loadCategories()
  if (!summaryMap.value.size) void refreshSummary()
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

/* ===== 吸顶工具区 ===== */
.topbar {
  position: sticky;
  top: 0;
  z-index: 10;
  margin: 0 -16px;
  padding: 0 16px 10px;
  background: var(--c-bg);
  border-bottom: 1px solid var(--c-border-hairline);
}

.search-row {
  display: flex;
  gap: 8px;
  align-items: center;
}

.search {
  flex: 1;
  min-width: 0;
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
  border: none;
  background: transparent;
  flex: 1;
  height: 100%;
  padding: 0;
  font-size: var(--fs-sm);
}

.search input:focus {
  box-shadow: none;
  outline: none;
}

.s-ico {
  color: var(--c-text-3);
  flex-shrink: 0;
}

.icon-btn {
  position: relative;
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  height: 34px;
  padding: 0 12px;
  border: 1px solid var(--c-border);
  border-radius: var(--r-md);
  background: var(--c-surface);
  color: var(--c-text-2);
  font-family: inherit;
  font-size: var(--fs-sm);
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  transition: background var(--motion), color var(--motion), border-color var(--motion);
}

.icon-btn.on {
  border-color: var(--c-primary);
  background: var(--c-primary-soft);
  color: var(--c-primary);
}

.f-badge {
  min-width: 15px;
  height: 15px;
  padding: 0 4px;
  border-radius: 999px;
  background: var(--c-primary);
  color: #fff;
  font-size: 10px;
  font-weight: 700;
  font-style: normal;
  line-height: 15px;
  text-align: center;
}

/* 排序 / 低库存 chip */
.chip-row {
  display: flex;
  gap: 6px;
  margin-top: 8px;
  overflow-x: auto;
  scrollbar-width: none;
}

.chip-row::-webkit-scrollbar {
  display: none;
}

.chip {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  flex-shrink: 0;
  height: 28px;
  padding: 0 10px;
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

/* 已选条件 */
.sel-tags {
  display: flex;
  gap: 6px;
  margin-top: 8px;
  overflow-x: auto;
  scrollbar-width: none;
}

.sel-tags::-webkit-scrollbar {
  display: none;
}

.sel-tag {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
  height: 24px;
  padding: 0 8px;
  border: none;
  border-radius: var(--r-sm);
  background: var(--c-primary-soft);
  color: var(--c-primary);
  font-family: inherit;
  font-size: var(--fs-xs);
  font-weight: 600;
  white-space: nowrap;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}

.sel-tag.clear {
  background: transparent;
  color: var(--c-text-3);
}

/* ===== 列表 ===== */
.list-wrap {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding-top: 12px;
}

.mcard {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 14px;
  background: var(--c-surface);
  border: 1px solid var(--c-border);
  border-radius: var(--r-xl);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  transition: background var(--motion-fast), transform var(--motion-fast);
}

.mcard:active {
  background: var(--c-surface-hover);
  transform: scale(0.995);
}

.mc-main {
  flex: 1;
  min-width: 0;
}

.mc-main h3 {
  margin: 0;
  font-size: var(--fs-md);
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.mc-sub {
  margin: 2px 0 0;
  font-size: var(--fs-xs);
  color: var(--c-text-3);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.mc-tags {
  display: flex;
  gap: 6px;
  margin-top: 6px;
  flex-wrap: wrap;
}

.tag {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--c-bg-2);
  color: var(--c-text-2);
  font-size: var(--fs-xs);
  white-space: nowrap;
}

/* 商品编号：等宽 + 描边，和分类 / 库位那种实心底区分开 */
.tag.code {
  background: transparent;
  border: 1px solid var(--c-border);
  color: var(--c-text-3);
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 11px;
}

.tag.low-tag {
  background: rgba(255, 92, 114, 0.12);
  color: var(--c-danger);
  font-weight: 600;
}

.mc-right {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-shrink: 0;
}

.mc-num {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 2px;
}

.qty {
  font-size: var(--fs-xl);
  font-weight: 800;
  line-height: 1.1;
  color: var(--c-text);
  font-variant-numeric: tabular-nums;
}

.qty.low {
  color: var(--c-danger);
}

.io {
  display: inline-flex;
  gap: 6px;
  font-size: var(--fs-xs);
  font-variant-numeric: tabular-nums;
}

.io .in {
  color: var(--c-accent);
  font-weight: 600;
}

.io .out {
  color: var(--c-danger);
  font-weight: 600;
}

.mc-act {
  width: 34px;
  height: 34px;
  display: grid;
  place-items: center;
  border: 1px solid var(--c-border);
  border-radius: var(--r-md);
  background: var(--c-glass);
  color: var(--c-text-2);
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  transition: background var(--motion-fast), color var(--motion-fast), border-color var(--motion-fast);
}

.mc-act:active {
  background: var(--c-primary-soft);
  border-color: var(--c-primary);
  color: var(--c-primary);
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
  gap: 6px;
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
