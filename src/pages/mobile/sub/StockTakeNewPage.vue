<template>
  <SubPage title="新建盘点">
    <div class="mpage">
      <!-- 名称 -->
      <div class="field-card">
        <label class="f-label">盘点单名称</label>
        <input v-model="name" class="f-input" placeholder="如：2026-10 全库盘点" />
      </div>

      <!-- 吸顶：分类二级 chip + 搜索（桌面是两个 AppSelect + 搜索框） -->
      <div class="topbar">
        <div class="search">
          <Search :size="14" class="s-ico" style="display: inline-flex; flex-shrink: 0" />
          <input v-model="kw" type="search" placeholder="搜索名称 / 型号" />
        </div>
        <div class="chip-row">
          <button class="chip" :class="{ on: !majorId }" @click="pickMajor(null)">全部</button>
          <button v-for="n in tree" :key="n.cat.id" class="chip" :class="{ on: majorId === n.cat.id }"
            @click="pickMajor(n.cat.id)">{{ n.cat.name }}</button>
        </div>
        <div v-if="majorId && children.length" class="chip-row sub">
          <button class="chip" :class="{ on: !minorId }" @click="pickMinor(null)">全部小类</button>
          <button v-for="c in children" :key="c.cat.id" class="chip" :class="{ on: minorId === c.cat.id }"
            @click="pickMinor(c.cat.id)">{{ c.cat.name }}</button>
        </div>
      </div>

      <p v-if="err" class="error">{{ err }}</p>

      <div v-if="loading" class="hint"><div class="spinner-lg" /></div>
      <div v-else-if="!mats.length" class="empty">
        <div class="empty-ico"><ClipboardCheck :size="40" style="display: inline-flex; flex-shrink: 0" /></div>
        <h3>{{ hasFilter ? '没有匹配的物料' : '该范围暂无物料' }}</h3>
        <p>{{ hasFilter ? '换个关键词或分类试试' : '先去物料页添加物料' }}</p>
      </div>

      <template v-else>
        <!-- 盘点行：账面 → 实盘输入（步进器 + 直输） -->
        <article v-for="m in mats" :key="m.id" class="prow" :class="{ changed: diffOf(m) !== 0 }">
          <div class="p-main">
            <h3>{{ m.name }}</h3>
            <p class="p-sub">{{ m.model || '—' }}<span v-if="m.location"> · {{ m.location }}</span></p>
          </div>
          <span class="p-book">账面 {{ m.qty }}</span>
          <div class="p-step">
            <button type="button" class="st-btn" @click="step(m.id, -1)">
              <Minus :size="16" style="display: inline-flex; flex-shrink: 0" />
            </button>
            <input v-model.number="actualMap[m.id]" type="number" inputmode="numeric" min="0"
              @keyup.enter="submit" />
            <button type="button" class="st-btn" @click="step(m.id, 1)">
              <Plus :size="16" style="display: inline-flex; flex-shrink: 0" />
            </button>
          </div>
          <span class="p-diff" :class="{ plus: diffOf(m) > 0, minus: diffOf(m) < 0 }">
            {{ diffOf(m) > 0 ? '+' : '' }}{{ diffOf(m) }}
          </span>
        </article>

        <div v-if="hasMore" class="load-more">
          <div v-if="loadingMore" class="spinner-sm" />
          <span v-else>上拉加载更多物料</span>
        </div>
        <div v-else class="load-end">已加载全部 {{ mats.length }} 项</div>
        <div ref="sentinelEl" class="sentinel" />
      </template>
    </div>

    <!-- 底部固定提交栏 -->
    <div class="footbar">
      <div class="sum">
        <span>已盘 <b>{{ mats.length }}</b> 项</span>
        <span class="diff-sum">差异 <b :class="{ plus: diffCount > 0, minus: diffCount < 0 }">{{ diffCount }}</b> 项</span>
      </div>
      <button class="submit" :disabled="submitting" @click="submit">
        <span v-if="submitting" class="spinner-sm" />{{ submitting ? '提交中…' : '提交盘点' }}
      </button>
    </div>
  </SubPage>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import { useRouter } from 'vue-router'
import { Search, ClipboardCheck, Minus, Plus } from 'lucide-vue-next'
import SubPage from '../../../components/mobile/SubPage.vue'
import {
  createStocktake, listMaterials, listCategories, getOwnerId,
  buildCategoryTree, descendantCategoryIds,
} from '../../../lib/db'
import { withAuthRetry } from '../../../lib/authRetry'
import { useToast } from '../../../composables/toast'
import { useStockData } from '../../../composables/useStockData'
import type { Category, MaterialRow } from '../../../lib/types'
import type { CategoryNode } from '../../../lib/db'
import type { StockTakeItem } from '../../../lib/types'
import type { ListMaterialsOpts } from '../../../lib/storage/types'

/**
 * 移动端新建盘点：分类 chip 选范围 → 逐项录入实盘 → 提交（差异在 db 层自动入账为盘盈/盘亏单）。
 * 与桌面 StockTake 的差异（见 demo/MOBILE_STOCK_PLAN.md）：
 * - 桌面 640px 居中弹窗 → 独立路由页 + 底部固定提交栏
 * - AppSelect 二级联动 → 横滑 chip
 * - 物料不再循环翻页到 50000，改成分批（50/批）+ 无限滚动
 * - 提交后补 refreshList/refreshSummary/refreshLogs（桌面没做，KPI 会滞后）
 */
const router = useRouter()
const toast = useToast()
const { refreshList, refreshSummary, refreshLogs } = useStockData()

const pad = (n: number) => String(n).padStart(2, '0')
const today = new Date()
const name = ref(`盘点 ${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`)

const kw = ref('')
const cats = ref<Category[]>([])
const majorId = ref<string | null>(null)
const minorId = ref<string | null>(null)
const tree = computed<CategoryNode[]>(() => buildCategoryTree(cats.value))
const children = computed(() => tree.value.find(n => n.cat.id === majorId.value)?.children ?? [])
const hasFilter = computed(() => !!kw.value.trim() || !!majorId.value)

const mats = ref<MaterialRow[]>([])
/** 实盘数量：默认回填账面数（可直接改） */
const actualMap = ref<Record<string, number>>({})
const loading = ref(false)
const loadingMore = ref(false)
const submitting = ref(false)
const err = ref('')
const PAGE = 50
const offset = ref(0)
/** 本批是否拉满（用于判断是否还有下一批） */
const hasMore = ref(false)

function pickMajor(id: string | null) {
  majorId.value = id
  minorId.value = null
  reload()
}
function pickMinor(id: string | null) {
  minorId.value = id
  reload()
}
function step(id: string, d: number) {
  const v = (actualMap.value[id] ?? 0) + d
  actualMap.value[id] = Math.max(0, v)
}
function diffOf(m: MaterialRow) {
  const actual = actualMap.value[m.id] ?? m.qty
  return actual - m.qty
}
const diffCount = computed(() => mats.value.filter(m => diffOf(m) !== 0).length)

function buildOpts(): ListMaterialsOpts {
  const opts: ListMaterialsOpts = { limit: PAGE, offset: offset.value }
  const k = kw.value.trim()
  if (k) opts.search = k
  if (minorId.value) opts.categoryId = minorId.value
  else if (majorId.value) opts.categoryIds = descendantCategoryIds(cats.value, majorId.value)
  return opts
}

async function load() {
  loading.value = true
  err.value = ''
  offset.value = 0
  try {
    const rows = await withAuthRetry(() => listMaterials(buildOpts()))
    mats.value = rows
    // 新拉到的物料回填账面数（已改过的保留用户输入）
    for (const m of rows) if (actualMap.value[m.id] == null) actualMap.value[m.id] = m.qty
    hasMore.value = rows.length >= PAGE
  } catch (e: unknown) {
    err.value = '加载失败：' + ((e as Error).message || e)
  } finally {
    loading.value = false
  }
}

async function loadMore() {
  if (loading.value || loadingMore.value || !hasMore.value || err.value) return
  loadingMore.value = true
  try {
    offset.value += PAGE
    const rows = await withAuthRetry(() => listMaterials(buildOpts()))
    mats.value.push(...rows)
    for (const m of rows) if (actualMap.value[m.id] == null) actualMap.value[m.id] = m.qty
    hasMore.value = rows.length >= PAGE
  } catch (e: unknown) {
    err.value = '加载更多失败：' + ((e as Error).message || e)
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

async function submit() {
  if (!name.value.trim()) { err.value = '请填写盘点单名称'; return }
  if (!mats.value.length) { err.value = '没有可盘点的物料'; return }
  submitting.value = true
  err.value = ''
  try {
    const owner = await getOwnerId()
    const now = new Date().toISOString()
    const takeId = crypto.randomUUID()
    const items: StockTakeItem[] = mats.value.map(m => {
      const raw = actualMap.value[m.id]
      const actual = raw == null || Number.isNaN(raw) ? m.qty : Number(raw)
      return {
        id: crypto.randomUUID(),
        take_id: takeId,
        material_id: m.id,
        material_name: m.name,
        book_qty: m.qty,
        actual_qty: actual,
        diff: actual - m.qty,
        created_at: now,
      }
    })
    await withAuthRetry(() => createStocktake({
      id: takeId, owner, name: name.value.trim(), note: null, status: 'done', created_at: now,
    }, items))
    // db 层已把差异拆成盘盈/盘亏两张单，这里必须刷共享数据，否则首页 KPI 是旧值
    await Promise.all([refreshList(), refreshSummary(), refreshLogs()])
    toast.success(`盘点已提交，差异 ${diffCount.value} 项`)
    router.back()
  } catch (e: unknown) {
    err.value = '提交失败：' + ((e as Error).message || e)
  } finally {
    submitting.value = false
  }
}

const sentinelEl = ref<HTMLElement | null>(null)
let io: IntersectionObserver | null = null

onMounted(async () => {
  try { cats.value = await listCategories() } catch { /* 静默 */ }
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
  gap: 10px;
  min-height: 100%;
  padding-bottom: calc(84px + env(safe-area-inset-bottom));
}

/* ===== 名称 ===== */
.field-card {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 12px 14px;
  background: var(--c-surface);
  border: 1px solid var(--c-border);
  border-radius: var(--r-xl);
}

.f-label {
  font-size: var(--fs-xs);
  color: var(--c-text-2);
  font-weight: 500;
}

.f-input {
  height: 38px;
  padding: 0 10px;
  border: 1px solid var(--c-border);
  border-radius: var(--r-md);
  background: var(--c-glass);
  color: var(--c-text);
  font-family: inherit;
  font-size: var(--fs-sm);
}

.f-input:focus {
  outline: none;
  border-color: var(--c-primary);
}

/* ===== 吸顶筛选 ===== */
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
}

.chip.on {
  border-color: var(--c-primary);
  background: var(--c-primary-soft);
  color: var(--c-primary);
  font-weight: 600;
}

/* ===== 盘点行 ===== */
.prow {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  background: var(--c-surface);
  border: 1px solid var(--c-border);
  border-radius: var(--r-lg);
  transition: border-color var(--motion-fast);
}

.prow.changed {
  border-color: var(--c-primary);
}

.p-main {
  flex: 1;
  min-width: 0;
}

.p-main h3 {
  margin: 0;
  font-size: var(--fs-sm);
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.p-sub {
  margin: 2px 0 0;
  font-size: var(--fs-xs);
  color: var(--c-text-3);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.p-book {
  flex-shrink: 0;
  font-size: var(--fs-xs);
  color: var(--c-text-3);
  font-variant-numeric: tabular-nums;
}

.p-step {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 4px;
}

.st-btn {
  width: 30px;
  height: 30px;
  display: grid;
  place-items: center;
  border: 1px solid var(--c-border);
  border-radius: var(--r-sm);
  background: var(--c-glass);
  color: var(--c-text);
  cursor: pointer;
  padding: 0;
  -webkit-tap-highlight-color: transparent;
}

.st-btn:active {
  background: var(--c-primary-soft);
  border-color: var(--c-primary);
}

.p-step input {
  width: 56px;
  height: 30px;
  text-align: center;
  font-size: var(--fs-sm);
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  background: var(--c-surface);
  border: 1px solid var(--c-border);
  border-radius: var(--r-sm);
  color: var(--c-text);
}

.p-step input:focus {
  outline: none;
  border-color: var(--c-primary);
}

.p-step input::-webkit-outer-spin-button,
.p-step input::-webkit-inner-spin-button {
  -webkit-appearance: none;
  margin: 0;
}

.p-step input[type="number"] {
  -moz-appearance: textfield;
  appearance: textfield;
}

.p-diff {
  flex-shrink: 0;
  min-width: 34px;
  text-align: right;
  font-size: var(--fs-sm);
  font-weight: 800;
  color: var(--c-text-3);
  font-variant-numeric: tabular-nums;
}

.p-diff.plus {
  color: var(--c-accent);
}

.p-diff.minus {
  color: var(--c-danger);
}

/* ===== 底部提交栏 ===== */
.footbar {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 90;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 16px calc(10px + env(safe-area-inset-bottom));
  background: var(--c-glass-strong);
  backdrop-filter: blur(24px) saturate(160%);
  -webkit-backdrop-filter: blur(24px) saturate(160%);
  border-top: 1px solid var(--c-border-hairline);
}

.sum {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-size: var(--fs-xs);
  color: var(--c-text-2);
}

.sum b {
  color: var(--c-text);
  font-variant-numeric: tabular-nums;
}

.sum .diff-sum b.plus {
  color: var(--c-accent);
}

.sum .diff-sum b.minus {
  color: var(--c-danger);
}

.submit {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  height: 44px;
  padding: 0 22px;
  border: none;
  border-radius: var(--r-md);
  background: var(--c-primary);
  color: #fff;
  font-family: inherit;
  font-size: var(--fs-md);
  font-weight: 700;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}

.submit:active:not(:disabled) {
  transform: scale(0.98);
}

.submit:disabled {
  opacity: 0.6;
  cursor: not-allowed;
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
  padding: 4px 2px;
  font-size: var(--fs-sm);
  color: var(--c-danger);
}

.load-more,
.load-end {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 14px 0;
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
