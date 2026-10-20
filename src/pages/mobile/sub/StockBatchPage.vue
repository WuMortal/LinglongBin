<template>
  <SubPage title="批量出入库">
    <div class="mpage">
      <!-- 入 / 出：触屏大号分段（与 QuickStockSheet 同一套） -->
      <div class="seg">
        <button type="button" :class="{ on: type === 'in' }" @click="type = 'in'">
          <ArrowDownToLine :size="16" style="display: inline-flex; flex-shrink: 0" />入库
        </button>
        <button type="button" :class="{ on: type === 'out' }" @click="type = 'out'">
          <ArrowUpFromLine :size="16" style="display: inline-flex; flex-shrink: 0" />出库
        </button>
      </div>

      <!-- 吸顶：分类 chip（点一下整类全选，替代桌面 250px 分类树）+ 搜索 -->
      <div class="topbar">
        <div class="search">
          <Search :size="14" class="s-ico" style="display: inline-flex; flex-shrink: 0" />
          <input v-model="kw" type="search" placeholder="搜索名称 / 型号" />
        </div>
        <div class="chip-row">
          <button class="chip" :class="{ on: !catId }" @click="catId = null">全部</button>
          <button v-for="n in tree" :key="n.cat.id" class="chip" :class="{ on: catId === n.cat.id }"
            @click="catId = n.cat.id">{{ n.cat.name }}</button>
        </div>
      </div>

      <p v-if="error" class="error">{{ error }}</p>
      <div v-if="loading" class="hint"><div class="spinner-lg" /></div>

      <template v-else>
        <!-- 候选物料：点击加入，已加入的显示数量步进器 -->
        <article v-for="m in visible" :key="m.id" class="mrow" :class="{ on: picked(m.id) }"
          @click="toggle(m)">
          <div class="m-main">
            <h3>{{ m.name }}</h3>
            <p class="m-sub">{{ [m.model, m.brand].filter(Boolean).join(' · ') || '—' }}</p>
          </div>
          <span class="m-qty">×{{ m.qty }}</span>
          <div v-if="picked(m.id)" class="m-step" @click.stop>
            <button type="button" class="st-btn" :disabled="qtyOf(m.id) <= 1"
              @click="setQty(m.id, qtyOf(m.id) - 1)">
              <Minus :size="15" style="display: inline-flex; flex-shrink: 0" />
            </button>
            <input :value="qtyOf(m.id)" type="number" inputmode="numeric" min="1"
              @change="onQtyInput(m.id, $event)" />
            <button type="button" class="st-btn" @click="setQty(m.id, qtyOf(m.id) + 1)">
              <Plus :size="15" style="display: inline-flex; flex-shrink: 0" />
            </button>
          </div>
          <span v-else class="m-add">加入</span>
        </article>

        <div v-if="!visible.length" class="empty">
          <p>没有匹配的物料</p>
        </div>
      </template>
    </div>

    <!-- 底部固定栏：已选统计 + 供应商/用途 + 备注 + 提交 -->
    <div class="footbar">
      <div class="fb-fields">
        <button class="pick-row" @click="picker = type === 'in' ? 'supplier' : 'purpose'">
          <span class="lbl">{{ type === 'in' ? '供应商' : '用途' }}</span>
          <span class="pick-val" :class="{ ph: !pickLabel }">
            {{ pickLabel || '不记录' }}
            <ChevronRight :size="14" style="display: inline-flex; flex-shrink: 0" />
          </span>
        </button>
        <input v-model="note" class="fb-note" enterkeyhint="done"
          :placeholder="type === 'in' ? '备注（如 采购到货）' : '备注（如 焊接消耗）'" />
      </div>
      <div class="fb-actions">
        <span class="sum">已选 <b>{{ rows.length }}</b> 项 · 合计 <b>{{ totalQty }}</b></span>
        <button class="submit" :class="type" :disabled="busy || !rows.length" @click="submit">
          <span v-if="busy" class="spinner-sm" />{{ busy ? '处理中…' : (type === 'in' ? '确认入库' : '确认出库') }}
        </button>
      </div>
    </div>

    <!-- 供应商 / 用途选择（底部弹层） -->
    <BottomSheet :open="!!picker" :title="picker === 'supplier' ? '选择供应商' : '选择用途'"
      @close="picker = null">
      <button v-for="o in pickerOptions" :key="String(o.value)" type="button" class="pk-item"
        :class="{ on: isPicked(o.value) }" @click="pickOption(o.value)">
        <span>{{ o.label }}</span>
        <Check v-if="isPicked(o.value)" :size="16" style="display: inline-flex; flex-shrink: 0" />
      </button>
    </BottomSheet>
  </SubPage>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import {
  Search, Minus, Plus, ChevronRight, Check, ArrowDownToLine, ArrowUpFromLine,
} from 'lucide-vue-next'
import SubPage from '../../../components/mobile/SubPage.vue'
import BottomSheet from '../../../components/mobile/BottomSheet.vue'
import {
  listMaterials, listCategories, listSuppliers, listDictItems, stockInOrder,
  buildCategoryTree, descendantCategoryIds,
} from '../../../lib/db'
import { withAuthRetry } from '../../../lib/authRetry'
import { useToast } from '../../../composables/toast'
import { useStockData } from '../../../composables/useStockData'
import type { Category, MaterialRow, SupplierRow } from '../../../lib/types'
import type { CategoryNode } from '../../../lib/db'
import type { ListMaterialsOpts } from '../../../lib/storage/types'

/**
 * 移动端批量出入库（独立路由页，替代桌面 1040px BatchStockModal）：
 * 分类 chip 过滤 → 点物料加入 → 逐个填数量 → 一张单提交。
 * 与桌面的差异（见 demo/MOBILE_STOCK_PLAN.md）：
 * - 250px 分类树 + 双栏 → 单列 + 横滑分类 chip
 * - 提交链路完全一致（stockInOrder，source=manual）
 */
const router = useRouter()
const toast = useToast()
const { comps, refreshList, refreshSummary, refreshLogs } = useStockData()

const type = ref<'in' | 'out'>('in')
const note = ref('')
const busy = ref(false)
const error = ref('')
const loading = ref(false)

const kw = ref('')
const cats = ref<Category[]>([])
const catId = ref<string | null>(null)
const tree = computed<CategoryNode[]>(() => buildCategoryTree(cats.value))
const mats = ref<MaterialRow[]>([])

/** 已选：materialId → 数量（保持选择顺序） */
const selected = ref<Array<{ id: string; qty: number }>>([])
const qtyMap = computed(() => new Map(selected.value.map(s => [s.id, s.qty])))
const picked = (id: string) => qtyMap.value.has(id)
const qtyOf = (id: string) => qtyMap.value.get(id) ?? 1
const totalQty = computed(() => selected.value.reduce((s, x) => s + x.qty, 0))

/** 已选行（按选择顺序，取物料快照） */
const rows = computed(() => selected.value
  .map(s => ({ mat: mats.value.find(m => m.id === s.id), qty: s.qty }))
  .filter((x): x is { mat: MaterialRow; qty: number } => !!x.mat))

const visible = computed(() => {
  const k = kw.value.trim().toLowerCase()
  return mats.value.filter(m => {
    if (k && !(`${m.name} ${m.model ?? ''} ${m.brand ?? ''}`.toLowerCase().includes(k))) return false
    return true
  })
})

function toggle(m: MaterialRow) {
  if (picked(m.id)) selected.value = selected.value.filter(s => s.id !== m.id)
  else selected.value.push({ id: m.id, qty: 1 })
}
function setQty(id: string, q: number) {
  const s = selected.value.find(x => x.id === id)
  if (s) s.qty = Math.max(1, Math.floor(q) || 1)
}
function onQtyInput(id: string, e: Event) {
  setQty(id, Number((e.target as HTMLInputElement).value))
}

// ===== 供应商 / 用途 =====
const picker = ref<'supplier' | 'purpose' | null>(null)
const suppliers = ref<SupplierRow[]>([])
const purposes = ref<string[]>([])
const supplierId = ref<string | null>(null)
const purpose = ref<string | null>(null)

const pickerOptions = computed(() => picker.value === 'supplier'
  ? [{ value: null as string | null, label: '不记录供应商' }, ...suppliers.value.map(s => ({ value: s.id, label: s.name }))]
  : [{ value: null as string | null, label: '不记录用途' }, ...purposes.value.map(p => ({ value: p, label: p }))])

const pickLabel = computed(() => type.value === 'in'
  ? (suppliers.value.find(s => s.id === supplierId.value)?.name || '')
  : (purpose.value || ''))

function isPicked(v: string | null) {
  return type.value === 'in' ? supplierId.value === v : purpose.value === v
}
function pickOption(v: string | null) {
  if (picker.value === 'supplier') supplierId.value = v
  else purpose.value = v
  picker.value = null
}

async function submit() {
  if (!rows.value.length) return
  busy.value = true
  error.value = ''
  try {
    // 出库时用途并入备注（与桌面/QuickStockSheet 同口径）
    const finalNote = type.value === 'out'
      ? [purpose.value, note.value.trim()].filter(Boolean).join('：') || null
      : (note.value.trim() || null)
    await withAuthRetry(() => stockInOrder({
      type: type.value, source: 'manual', source_id: null,
      title: `批量${type.value === 'in' ? '入库' : '出库'} · ${rows.value.length} 项`,
      supplier_id: type.value === 'in' ? supplierId.value : null,
      note: finalNote,
      items: rows.value.map(r => ({ material_id: r.mat.id, qty: r.qty, note: finalNote })),
    }))
    await Promise.all([refreshList(), refreshSummary(), refreshLogs()])
    toast.success(`已${type.value === 'in' ? '入库' : '出库'} ${rows.value.length} 项，共 ${totalQty.value} 件`)
    router.back()
  } catch (e: unknown) {
    error.value = '操作失败：' + ((e as Error).message || e)
  } finally {
    busy.value = false
  }
}

async function load() {
  loading.value = true
  error.value = ''
  try {
    const opts: ListMaterialsOpts = { limit: 500 }
    if (catId.value) opts.categoryIds = descendantCategoryIds(cats.value, catId.value)
    mats.value = await withAuthRetry(() => listMaterials(opts))
  } catch (e: unknown) {
    error.value = '加载失败：' + ((e as Error).message || e)
  } finally {
    loading.value = false
  }
}

onMounted(async () => {
  try { cats.value = await listCategories() } catch { /* 静默 */ }
  try { suppliers.value = await listSuppliers() } catch { /* 静默 */ }
  try { purposes.value = (await listDictItems('out_purpose')).map(i => i.label) } catch { /* 静默 */ }
  if (!comps.value.length) void refreshList()
  await load()
})
</script>

<style scoped>
.mpage {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-height: 100%;
  padding-bottom: calc(150px + env(safe-area-inset-bottom));
}

/* 入 / 出 分段 */
.seg {
  display: flex;
  gap: 6px;
  padding: 4px;
  background: var(--c-glass);
  border: 1px solid var(--c-border);
  border-radius: var(--r-md);
}

.seg button {
  flex: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  height: 42px;
  border: none;
  border-radius: var(--r-sm);
  background: transparent;
  color: var(--c-text-2);
  font-family: inherit;
  font-size: var(--fs-md);
  font-weight: 600;
  cursor: pointer;
  transition: background-color 120ms ease-out, color 120ms ease-out;
}

.seg button.on {
  background: var(--c-primary);
  color: #fff;
  box-shadow: var(--shadow-glow);
}

/* 吸顶 */
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

/* 物料行 */
.mrow {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  background: var(--c-surface);
  border: 1px solid var(--c-border);
  border-radius: var(--r-lg);
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  transition: border-color var(--motion-fast), background var(--motion-fast);
}

.mrow.on {
  border-color: var(--c-primary);
  background: var(--c-primary-soft);
}

.m-main {
  flex: 1;
  min-width: 0;
}

.m-main h3 {
  margin: 0;
  font-size: var(--fs-sm);
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.m-sub {
  margin: 2px 0 0;
  font-size: var(--fs-xs);
  color: var(--c-text-3);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.m-qty {
  flex-shrink: 0;
  font-size: var(--fs-xs);
  color: var(--c-text-3);
  font-variant-numeric: tabular-nums;
}

.m-add {
  flex-shrink: 0;
  font-size: var(--fs-xs);
  font-weight: 600;
  color: var(--c-primary);
}

.m-step {
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

.st-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.m-step input {
  width: 54px;
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

.m-step input:focus {
  outline: none;
  border-color: var(--c-primary);
}

.m-step input::-webkit-outer-spin-button,
.m-step input::-webkit-inner-spin-button {
  -webkit-appearance: none;
  margin: 0;
}

.m-step input[type="number"] {
  -moz-appearance: textfield;
  appearance: textfield;
}

/* 底部栏 */
.footbar {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 90;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px 16px calc(10px + env(safe-area-inset-bottom));
  background: var(--c-glass-strong);
  backdrop-filter: blur(24px) saturate(160%);
  -webkit-backdrop-filter: blur(24px) saturate(160%);
  border-top: 1px solid var(--c-border-hairline);
}

.fb-fields {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.pick-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 40px;
  padding: 0 2px;
  border: none;
  border-bottom: 1px solid var(--c-border-hairline);
  background: transparent;
  font-family: inherit;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}

.lbl {
  font-size: var(--fs-sm);
  color: var(--c-text-2);
}

.pick-val {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: var(--fs-sm);
  color: var(--c-text);
  max-width: 70%;
}

.pick-val.ph {
  color: var(--c-text-3);
}

.fb-note {
  height: 38px;
  padding: 0 10px;
  border: 1px solid var(--c-border);
  border-radius: var(--r-md);
  background: var(--c-surface);
  color: var(--c-text);
  font-family: inherit;
  font-size: var(--fs-sm);
}

.fb-note:focus {
  outline: none;
  border-color: var(--c-primary);
}

.fb-actions {
  display: flex;
  align-items: center;
  gap: 12px;
}

.sum {
  flex: 1;
  min-width: 0;
  font-size: var(--fs-xs);
  color: var(--c-text-3);
}

.sum b {
  color: var(--c-text);
  font-variant-numeric: tabular-nums;
}

.submit {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  height: 44px;
  padding: 0 20px;
  border: none;
  border-radius: var(--r-md);
  color: #fff;
  font-family: inherit;
  font-size: var(--fs-md);
  font-weight: 700;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}

.submit.in {
  background: var(--c-primary);
}

.submit.out {
  background: var(--c-danger);
}

.submit:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

/* picker 项 */
.pk-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  min-height: 46px;
  padding: 0 4px;
  border: none;
  border-radius: var(--r-sm);
  background: transparent;
  color: var(--c-text);
  font-family: inherit;
  font-size: var(--fs-md);
  text-align: left;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}

.pk-item.on {
  background: var(--c-primary-soft);
  color: var(--c-primary);
  font-weight: 600;
}

/* 状态 */
.hint {
  display: flex;
  justify-content: center;
  padding: 24px 0;
}

.empty {
  padding: 24px 0;
  text-align: center;
  color: var(--c-text-3);
  font-size: var(--fs-sm);
}

.error {
  margin: 0;
  padding: 4px 2px;
  font-size: var(--fs-sm);
  color: var(--c-danger);
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
