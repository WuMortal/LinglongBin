<template>
  <section class="tab">
    <!-- 筛选条 -->
    <div class="filters">
      <div class="f-search">
        <Search :size="15" class="s-ico" style="display: inline-flex; flex-shrink: 0" />
        <input v-model="search" placeholder="搜索名称 / 型号 / 品牌" />
      </div>
      <div class="filters-right">
        <AppSelect v-model="location" :options="locationOptions" :width="100" searchable search-placeholder="搜索库位"
          placeholder="全部库位" class="cat" />
        <AppSelect v-model="majorId" :options="majorOptions" :width="120" searchable search-placeholder="搜索大类"
          placeholder="全部大类" class="cat" />
        <AppSelect v-model="minorId" :options="minorOptions" :width="120" searchable search-placeholder="搜索小类"
          placeholder="全部小类" :disabled="!majorId" class="cat" />
        <!-- 参数筛选：未选小类时禁用；悬浮展开，点击可固定 -->
        <div ref="paramAnchorEl" class="pf-anchor" @mouseenter="openParam" @mouseleave="closeParam">
          <button class="param-btn" :class="{ on: paramVisible }" :disabled="!minorId"
            :title="minorId ? '展开参数筛选' : '请先选择小类'" @click="toggleParamPin">
            <Tag :size="13" style="display: inline-flex; flex-shrink: 0" />展开参数
            <span v-if="selectedParamTags.length" class="pcnt">{{ selectedParamTags.length }}</span>
          </button>
          <div v-if="paramVisible" class="pf-pop-wrap">
            <ParamFilterBar v-if="activeCatParams.length" :params="activeCatParams" :model-value="paramSel"
              :options-of="paramOptions" :collapse="false" @update:model-value="onParamsChange" @clear="clearParams" />
            <p v-else class="pf-empty">该小类未配置参数模板</p>
          </div>
        </div>
        <label class="f-low">
          <input type="checkbox" v-model="lowStockOnly" />
          <span>仅低库存</span>
        </label>
        <button type="button" class="btn-refresh" :disabled="listLoading" :title="listLoading ? '刷新中…' : '刷新'"
          @click="onRefresh">
          <RefreshCw :size="15" :class="{ 'icon-spin': listLoading }" />
        </button>
      </div>
    </div>

    <!-- 已选参数：小 tag，可单独移除 -->
    <div v-if="selectedParamTags.length" class="param-tags">
      <span v-for="t in selectedParamTags" :key="t.key" class="ptag">
        <span class="pk">{{ t.name }}：</span><span class="pv">{{ t.value }}</span>
        <button class="px" title="移除该条件" @click="removeParam(t.key)">
          <X :size="10" style="display: inline-flex; flex-shrink: 0" />
        </button>
      </span>
    </div>

    <DataTable :columns="matCols" :rows="tableRows" row-key="id" :sort-key="sortKey"
      :sort-dir="sortDir === 1 ? 'asc' : 'desc'" @sort="sortBy" @row-click="openDetail">
      <template #cell-name="{ row }">
        <div class="mat-name">
          <strong>{{ row.name }}</strong>
        </div>
        <small class="mono mat-sub">{{ [row.model, row.brand].filter(Boolean).join(' · ') || '—' }}</small>
      </template>
      <template #cell-category="{ row }">
        <span class="cat-tag">{{ row.categories?.name || '未分类' }}</span>
      </template>
      <template #cell-qty="{ row }">
        <span class="qty-main" :class="{ low: isLow(row) }">{{ row.qty }}</span>
      </template>
      <template #cell-in30="{ row }">
        <span class="num-in" :class="{ zero: !in30(row.id) }">+{{ in30(row.id) }}</span>
      </template>
      <template #cell-out30="{ row }">
        <span class="num-out" :class="{ zero: !out30(row.id) }">-{{ out30(row.id) }}</span>
      </template>
      <template #cell-op="{ row }">
        <button class="btn btn-icon mini" title="出入库" @click.stop="openQuick(row)">
          <ArrowLeftRight :size="14" style="display: inline-flex; flex-shrink: 0" />
        </button>
      </template>
      <template #empty>
        <EmptyState :icon="Inbox" :title="hasListFilter ? '无匹配物料' : '暂无物料'" />
      </template>
    </DataTable>

    <Pager v-if="matTotal > 0" :page="matPage" :page-size="matPageSize" :total="matTotal"
      @change="(p: number) => { matPage = p; void loadMaterials() }"
      @update:page-size="(s: number) => { matPageSize = s; matPage = 1; void loadMaterials() }" />

    <!-- 出入库弹窗 -->
    <Teleport to="body">
      <div v-if="quick" class="modal-mask" @click.self="quick = null">
        <div class="modal" style="max-width: 440px">
          <div class="modal-head">
            <h3>出入库 · {{ quick.mat.name }}</h3>
            <p class="qk-sub">当前库存 ×{{ quick.mat.qty }}<template v-if="quick.mat.model || quick.mat.brand"> · {{
              [quick.mat.model, quick.mat.brand].filter(Boolean).join(' ') }}</template></p>
          </div>
          <div class="modal-body">
            <Segmented v-model="quick.type" full class="qk-seg" :options="[
              { value: 'in', label: '入库', icon: Inbox },
              { value: 'out', label: '出库', icon: ArrowUpFromDot },
            ]" />
            <div class="qk-grid">
              <label class="field">
                <label>数量</label>
                <input v-model.number="quick.qty" type="number" min="1" @keyup.enter="submitQuick" />
              </label>
              <label class="field" v-if="quick.type === 'in'">
                <label>供应商</label>
                <AppSelect v-model="quick.supplier_id" :options="supplierOptions" :min-width="0" />
              </label>
              <label class="field" v-else>
                <label>用途</label>
                <AppSelect v-model="quick.purpose" :options="purposeOptions" :min-width="0" />
              </label>
              <label class="field qk-note-field">
                <label>备注</label>
                <input v-model="quick.note" :placeholder="quick.type === 'in' ? '如 采购到货' : '如 焊接消耗'"
                  @keyup.enter="submitQuick" />
              </label>
            </div>
          </div>
          <div class="modal-foot">
            <button class="btn btn-ghost" @click="quick = null">取消</button>
            <button class="btn" :class="quick.type === 'in' ? 'btn-primary' : 'btn-danger'" :disabled="quickBusy"
              @click="submitQuick">
              <span v-if="quickBusy" class="spinner-sm" />{{ quickBusy ? '处理中…' : (quick.type === 'in' ? '确认入库' :
                '确认出库') }}
            </button>
          </div>
        </div>
      </div>
    </Teleport>

    <!-- 物料详情抽屉：点行打开，替代原行内手风琴；从库存进来默认直看出入库记录 -->
    <MaterialDetailDrawer :material="detailMat" initial-tab="logs" @close="detailMat = null" />
  </section>
</template>

<script setup lang="ts">
import { ref, reactive, computed, watch, onMounted, onBeforeUnmount, onActivated } from 'vue'
import {
  Inbox, ArrowLeftRight, ArrowUpFromDot, Search, RefreshCw, Tag, X,
} from 'lucide-vue-next'
import {
  applyStock, listSuppliers, listDictItems, listMaterialsPage,
  descendantCategoryIds, getCategoryParams, buildCategoryTree,
  type CategoryNode, type MaterialPageOpts,
} from '../../lib/db'
import type { Category, CategoryParam, MaterialRow } from '../../lib/types'
import AppSelect from '../../components/form/AppSelect.vue'
import ParamFilterBar from '../../components/form/ParamFilterBar.vue'
import Segmented from '../../components/form/Segmented.vue'
import DataTable from '../../components/DataTable.vue'
import type { DtColumn } from '../../components/DataTable.vue'
import EmptyState from '../../components/EmptyState.vue'
import Pager from '../../components/Pager.vue'
import MaterialDetailDrawer from '../../components/business/MaterialDetailDrawer.vue'
import { useToast } from '../../composables/toast'
import { useStockData } from '../../composables/useStockData'

const toast = useToast()
const { comps, categories, suppliers, suppliersLoaded, summaryMap, sumOf, refreshLogs, refreshList, listLoading } = useStockData()

// ===== 筛选 / 排序 =====
const search = ref('')
/** 库位筛选：沿用字典下拉（与物料表单一致，取自 listDictItems('location')），null = 全部 */
const location = ref<string | null>(null)
const locationOptions = ref<Array<{ value: string; label: string }>>([])
listDictItems('location')
  .then(items => { locationOptions.value = items.map(i => ({ value: i.label, label: i.label })) })
  .catch(() => { locationOptions.value = [] })
// 分类：拆成「大类 + 小类」两级联动（仅大类=含其下所有小类，选中小类=精确匹配）
const majorId = ref<string | null>(null)
const minorId = ref<string | null>(null)
const lowStockOnly = ref(false)
const sortKey = ref<'name' | 'qty' | 'in30' | 'out30'>('qty')
const sortDir = ref<1 | -1>(-1)

// ===== 列表分页（服务端 limit/offset，避免云端一次拉全表） =====
// 注：筛选条件（搜索/分类/参数/库位）已在服务端完成，低库存仅在当前页做客户端过滤。
const matPage = ref(1)
const matPageSize = ref(20)
const matTotal = ref(0)
const pageRows = ref<MaterialRow[]>([])

async function loadMaterials() {
  listLoading.value = true
  try {
    const opts: MaterialPageOpts = { page: matPage.value - 1, pageSize: matPageSize.value }
    const kw = search.value.trim()
    if (kw) opts.search = kw
    if (minorId.value) opts.categoryId = minorId.value
    else if (majorId.value) opts.categoryIds = descendantCategoryIds(categories.value, majorId.value)
    const pkeys = activeCatParams.value.map(p => p.key).filter(k => paramSel[k])
    if (pkeys.length) opts.params = Object.fromEntries(pkeys.map(k => [k, paramSel[k] as string]))
    if (location.value) opts.location = location.value
    const res = await listMaterialsPage(opts)
    pageRows.value = res.rows
    matTotal.value = res.total
  } catch { /* 静默 */ }
  finally { listLoading.value = false }
}

/** 筛选条件变化 → 回到第 1 页并重新查询 */
function reload() { matPage.value = 1; void loadMaterials() }

let kwTimer: ReturnType<typeof setTimeout> | null = null

/** 刷新：回到第 1 页重查，并同步后端缓存（供 KPI / 导入 / 采购读取） */
async function onRefresh() {
  matPage.value = 1
  await Promise.all([refreshList(), loadMaterials()])
}

// 切到本 tab 时自动重拉（keep-alive 不会重新挂载，故用 onActivated 而非 onMounted）
onActivated(() => { matPage.value = 1; void loadMaterials() })

// 供父级「刷新」按钮调用
defineExpose({ refresh: onRefresh })

// ===== 物料详情抽屉 =====
const detailMat = ref<MaterialRow | null>(null)
function openDetail(r: MaterialRow) { detailMat.value = r }

// ===== 出入库弹窗 =====
const quick = ref<{ mat: MaterialRow; type: 'in' | 'out'; qty: number; note: string; supplier_id: string | null; purpose: string | null } | null>(null)
const quickBusy = ref(false)
// 出库用途字典（设置 → 基础数据维护）
const purposes = ref<string[]>([])
let purposesLoaded = false
const purposeOptions = computed(() => [
  { value: null as string | null, label: '不记录用途' },
  ...purposes.value.map(p => ({ value: p, label: p })),
])

const supplierOptions = computed(() => suppliers.value.map(s => ({ value: s.id, label: s.name })))

// ===== 汇总取值 =====
const in30 = (id: string) => sumOf(id).last30_in
const out30 = (id: string) => sumOf(id).last30_out

/** 生效阈值：物料自身（>0）→ 分类（>0）→ 默认 5 */
function isLow(m: MaterialRow): boolean {
  const t = (m.threshold || 0) > 0 ? m.threshold : ((m.categories?.threshold || 0) > 0 ? m.categories!.threshold! : 5)
  return m.qty <= t
}

// ===== 分类：大类 / 小类两级联动 =====
const tree = computed(() => buildCategoryTree(categories.value))

/** 大类：一级分类（parent 为空） */
const majorOptions = computed(() => [
  { value: null as string | null, label: '全部大类' },
  ...tree.value.map(n => ({ value: n.cat.id as string | null, label: n.cat.name })),
])

/** 小类：所选大类下的子分类 */
const minorOptions = computed(() => {
  const rows: Array<{ value: string | null; label: string }> = [{ value: null, label: '全部小类' }]
  const node = tree.value.find(n => n.cat.id === majorId.value)
  for (const c of node?.children ?? []) rows.push({ value: c.cat.id as string | null, label: c.cat.name })
  return rows
})

/** 生效分类：小类优先，其次大类（用于加载参数模板与筛选范围） */
const effectiveCategoryId = computed(() => minorId.value || majorId.value)

// ===== 参数筛选（复用在 ParamFilterBar） =====
const activeCatParams = ref<CategoryParam[]>([])
const paramSel = reactive<Record<string, string>>({})

/** 当前分类筛选范围：选中小类=精确匹配，仅选大类=含其下所有小类 */
function categoryScopeIds(): Set<string> | null {
  const minor = minorId.value
  const major = majorId.value
  if (minor) return new Set([minor])
  if (major) return new Set(descendantCategoryIds(categories.value, major))
  return null
}

// 切换大类：清空已选小类，避免残留上一个大类的子类
watch(majorId, () => { minorId.value = null })
// 生效分类变化：重置参数筛选，并加载该分类的参数模板
watch(effectiveCategoryId, async (id) => {
  for (const k of Object.keys(paramSel)) delete paramSel[k]
  activeCatParams.value = []
  if (id) {
    try { activeCatParams.value = await getCategoryParams(id) } catch { /* 静默 */ }
  }
})

/** 某参数的可选值：模板预设 ∪ 当前分类范围内物料实际出现的值 */
function paramOptions(p: CategoryParam): string[] {
  const set = new Set<string>()
  for (const v of p.values || []) if (v != null && String(v) !== '') set.add(String(v))
  const ids = categoryScopeIds()
  for (const m of comps.value) {
    if (ids && m.category_id && !ids.has(m.category_id)) continue
    const v = m.params?.[p.key]
    if (v != null && String(v).trim() !== '') set.add(String(v).trim())
  }
  return [...set]
}

function onParamsChange(v: Record<string, string>) {
  for (const k of Object.keys(paramSel)) delete paramSel[k]
  Object.assign(paramSel, v)
}
function clearParams() { for (const k of Object.keys(paramSel)) delete paramSel[k] }

// ===== 参数面板：悬浮展开 + 点击固定（仅选中小类后可用） =====
const paramAnchorEl = ref<HTMLElement | null>(null)
const paramHover = ref(false)
const paramPinned = ref(false)
const paramVisible = computed(() => !!minorId.value && (paramHover.value || paramPinned.value))

function openParam() { if (minorId.value) paramHover.value = true }
function closeParam() { paramHover.value = false }
function toggleParamPin() {
  if (!minorId.value) return
  paramPinned.value = !paramPinned.value
  paramHover.value = paramPinned.value
}
function closeParamAll() { paramHover.value = false; paramPinned.value = false }

/** 已选参数（小 tag 展示用，名称取参数模板） */
const selectedParamTags = computed(() =>
  activeCatParams.value
    .filter(p => paramSel[p.key])
    .map(p => ({ key: p.key, name: p.name || p.key, value: paramSel[p.key] as string })),
)
function removeParam(key: string) { delete paramSel[key] }

function onDocClickParam(e: MouseEvent) {
  if (!paramVisible.value) return
  const t = e.target as Node
  if (paramAnchorEl.value?.contains(t)) return
  const pop = document.querySelector('.pop-float')
  if (pop && pop.contains(t)) return
  closeParamAll()
}
function onEscParam(e: KeyboardEvent) { if (e.key === 'Escape') closeParamAll() }

onMounted(() => {
  document.addEventListener('click', onDocClickParam)
  document.addEventListener('keydown', onEscParam)
})
onBeforeUnmount(() => {
  document.removeEventListener('click', onDocClickParam)
  document.removeEventListener('keydown', onEscParam)
})

/** 是否有任何筛选条件（用于空态文案） */
const hasListFilter = computed(() =>
  !!search.value.trim() || !!location.value || !!majorId.value || !!minorId.value || lowStockOnly.value || Object.values(paramSel).some(Boolean))

// 筛选条件变化 → 回到首页重新查询（搜索做 300ms 防抖）
watch([majorId, minorId, lowStockOnly, location], () => reload())
watch(paramSel, () => reload(), { deep: true })
watch(search, () => {
  if (kwTimer) clearTimeout(kwTimer)
  kwTimer = setTimeout(() => reload(), 300)
})

// ===== 列表过滤 + 排序（数据已分页查询，这里仅做当前页的低库存二次过滤 + 排序） =====
const tableRows = computed<MaterialRow[]>(() => {
  let list = pageRows.value
  // 仅低库存（客户端，作用在当前页；总数以服务端 matTotal 为准）
  if (lowStockOnly.value) {
    list = list.filter(c => isLow(c))
  }
  const key = sortKey.value, dir = sortDir.value
  return [...list].sort((a, b) => {
    let d = 0
    if (key === 'name') d = a.name.localeCompare(b.name, 'zh')
    else if (key === 'qty') d = a.qty - b.qty
    else if (key === 'in30') d = in30(a.id) - in30(b.id)
    else d = out30(a.id) - out30(b.id)
    return d * dir
  })
})

function sortBy(k: 'name' | 'qty' | 'in30' | 'out30' | string) {
  const key = k as 'name' | 'qty' | 'in30' | 'out30'
  if (sortKey.value === key) sortDir.value = sortDir.value === 1 ? -1 : 1
  else { sortKey.value = key; sortDir.value = key === 'name' ? 1 : -1 }
}

// ===== 库存列表列定义 =====
const matCols: DtColumn[] = [
  { key: 'name', label: '物料', sortable: true, cls: 'mat-cell', minWidth: '200px' },
  { key: 'category', label: '分类' },
  { key: 'qty', label: '库存', sortable: true },
  { key: 'in30', label: '近30天入', sortable: true },
  { key: 'out30', label: '近30天出', sortable: true },
  { key: 'op', label: '', cls: 'op-col', width: '48px', align: 'center' },
]

// ===== 出入库弹窗 =====
async function openQuick(m: MaterialRow) {
  quick.value = { mat: m, type: 'in', qty: 1, note: '', supplier_id: null, purpose: null }
  if (!suppliersLoaded.value) {
    try { suppliers.value = await listSuppliers(); suppliersLoaded.value = true } catch { /* 静默 */ }
  }
  if (!purposesLoaded) {
    try { purposes.value = (await listDictItems('out_purpose')).map(i => i.label); purposesLoaded = true } catch { /* 静默 */ }
  }
}

async function submitQuick() {
  const q = quick.value
  if (!q) return
  const qty = Math.floor(Number(q.qty) || 0)
  if (qty <= 0) { toast.error('数量需为正整数'); return }
  if (q.type === 'out' && qty > q.mat.qty) { toast.error(`出库数量 ${qty} 超过当前库存 ${q.mat.qty}`); return }
  quickBusy.value = true
  try {
    const fresh = await applyStock({
      material_id: q.mat.id, type: q.type, qty,
      currentQty: q.mat.qty,
      supplier_id: q.type === 'in' ? q.supplier_id : null,
      // 出库时把用途并入备注（用途优先，手动备注跟在后面）
      note: q.type === 'out'
        ? [q.purpose, q.note.trim()].filter(Boolean).join('：') || null
        : (q.note.trim() || null),
    })
    // 同步列表库存与汇总
    const idx = comps.value.findIndex(c => c.id === q.mat.id)
    if (idx >= 0) comps.value[idx] = { ...comps.value[idx], qty: fresh.qty }
    const pidx = pageRows.value.findIndex(c => c.id === q.mat.id)
    if (pidx >= 0) pageRows.value[pidx] = { ...pageRows.value[pidx], qty: fresh.qty }
    q.mat = { ...q.mat, qty: fresh.qty }
    const s = sumOf(q.mat.id)
    if (q.type === 'in') { s.total_in += qty; s.last30_in += qty }
    else { s.total_out += qty; s.last30_out += qty }
    summaryMap.value.set(q.mat.id, s)
    refreshLogs()
    // 若详情抽屉正打开该物料，刷新其数据（新引用触发 watch 重新加载）
    if (detailMat.value?.id === q.mat.id) detailMat.value = { ...q.mat }
    q.note = ''
    q.qty = 1
    q.purpose = null
    toast.success(q.type === 'in' ? `入库 +${qty}` : `出库 -${qty}`)
    quick.value = null
  }
  catch (e: unknown) { toast.error('操作失败：' + ((e as Error).message || e)) }
  finally { quickBusy.value = false }
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

.f-search {
  position: relative;
  display: flex;
  align-items: center;
}

/* 右侧控件组：分类 / 展开参数 / 仅低库存 / 刷新，整体靠右对齐 */
.filters-right {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
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

/* 分类下拉固定宽度，不被搜索框挤压 */
.cat {
  flex-shrink: 0;
}

/* ===== 参数筛选按钮 + 悬浮面板 ===== */
.pf-anchor {
  position: relative;
  flex-shrink: 0;
}

.param-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: var(--ctrl-h);
  padding: 0 10px;
  border: 1px solid var(--c-border);
  border-radius: var(--r-md);
  background: var(--c-surface);
  color: var(--c-text-2);
  font-family: inherit;
  font-size: var(--fs-xs);
  font-weight: 500;
  cursor: pointer;
  white-space: nowrap;
  transition: background-color var(--motion-fast), color var(--motion-fast), border-color var(--motion-fast);
}

.param-btn:hover:not(:disabled) {
  color: var(--c-text);
  background: var(--c-surface-hover);
  border-color: var(--c-border-strong);
}

.param-btn.on {
  border-color: var(--c-primary);
  color: var(--c-primary);
  background: var(--c-primary-soft);
}

.param-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

/* 已选参数个数小圆标 */
.pcnt {
  min-width: 15px;
  height: 15px;
  padding: 0 4px;
  border-radius: 999px;
  background: var(--c-primary);
  color: #fff;
  font-size: 10px;
  font-weight: 700;
  line-height: 15px;
  text-align: center;
}

/* 悬浮面板：与按钮右对齐，避免超出视口右侧 */
.pf-pop-wrap {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  z-index: 60;
  min-width: 520px;
  max-width: min(900px, calc(100vw - 32px));
  max-height: min(520px, 70vh);
  overflow: auto;
  padding: 10px;
  background: var(--c-elevated);
  border: 1px solid var(--c-border);
  border-radius: var(--r-md);
  box-shadow: var(--shadow-md);
}

.pf-empty {
  margin: 0;
  padding: 4px 2px;
  font-size: var(--fs-xs);
  color: var(--c-text-3);
}

/* ===== 已选参数：小 tag，可单独移除 ===== */
.param-tags {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  padding: 0 16px 4px;
  margin-top: 3px;
}

.ptag {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 20px;
  max-width: 260px;
  padding: 0 4px 0 7px;
  border-radius: 999px;
  background: var(--c-primary-soft);
  color: var(--c-primary);
  font-size: 10px;
  font-weight: 600;
}

.ptag .pk {
  color: var(--c-text-3);
  font-weight: 500;
  flex-shrink: 0;
}

.ptag .pv {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.px {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 14px;
  height: 14px;
  padding: 0;
  border: none;
  border-radius: 50%;
  background: transparent;
  color: inherit;
  opacity: 0.6;
  cursor: pointer;
  flex-shrink: 0;
  transition: all var(--motion-fast);
}

.px:hover {
  opacity: 1;
  background: var(--c-danger);
  color: #fff;
}

/* 低库存筛选复选框 */
.f-low {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: var(--ctrl-h);
  padding: 0 6px;
  font-size: var(--fs-sm);
  color: var(--c-text);
  background: var(--c-glass);
  /* border: 1px solid var(--c-border); */
  border-radius: var(--r-md);
  cursor: pointer;
  user-select: none;
  white-space: nowrap;
  transition: all var(--motion);
}

.f-low input {
  width: 14px;
  height: 14px;
  accent-color: var(--c-primary);
  cursor: pointer;
}

.f-low:has(input:checked) {
  border-color: var(--c-primary);
  color: var(--c-primary);
  background: var(--c-primary-soft);
}

/* 右侧刷新按钮 */
.btn-refresh {
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

@keyframes spin {
  from {
    transform: rotate(0deg);
  }

  to {
    transform: rotate(360deg);
  }
}

/* ===== 库存表（结构样式见 DataTable 组件） ===== */
.mat-name {
  display: flex;
  align-items: center;
  gap: 6px;
}

.mat-name strong {
  font-weight: 600;
  font-size: var(--fs-sm);
}

.mono {
  font-family: ui-monospace, 'SF Mono', Menlo, Consolas, monospace;
}

.mat-sub {
  display: block;
  margin-left: 0;
  color: var(--c-text-2);
  font-size: var(--fs-xs);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 300px;
}

.cat-tag {
  display: inline-block;
  padding: 3px 10px;
  border-radius: 999px;
  font-size: var(--fs-xs);
  background: var(--c-bg-2);
  color: var(--c-text-2);
  white-space: nowrap;
}

.qty-main {
  font-size: var(--fs-md);
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}

.qty-main.low {
  color: var(--c-danger);
}

.num-in,
.num-out {
  font-weight: 600;
  font-size: var(--fs-sm);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.num-in {
  color: var(--c-accent);
}

.num-out {
  color: var(--c-danger);
}

.num-in.zero,
.num-out.zero {
  color: var(--c-text-3);
  font-weight: 500;
}

.op-col {
  width: 48px;
  text-align: center;
}

.mini {
  width: 28px;
  height: 28px;
  min-width: 28px;
  padding: 0;
}





/* ===== 出入库弹窗（与 Home 一致） ===== */
.qk-sub {
  margin: 4px 0 0;
  color: var(--c-text-2);
  font-size: var(--fs-xs);
}

.qk-seg {
  margin-bottom: 14px;
}

.qk-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 14px;
}

.qk-grid .field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: 0;
  min-width: 0;
}

.qk-grid .field>label {
  font-size: var(--fs-xs);
  color: var(--c-text-2);
  font-weight: 500;
}

.qk-grid .field input {
  height: var(--ctrl-h);
  padding: 0 var(--ctrl-px);
  font-size: var(--fs-sm);
  background: var(--c-surface);
  border: 1px solid var(--c-border);
  border-radius: var(--r-md);
  color: var(--c-text);
  transition: border-color var(--motion);
}

.qk-grid .field input:focus {
  outline: none;
  border-color: var(--c-primary);
  box-shadow: 0 0 0 3px var(--c-primary-glow);
}

.qk-note-field {
  grid-column: 1 / -1;
}

@media (max-width: 820px) {
  .filters {
    flex-direction: column;
    align-items: stretch;
  }

  .filters-right {
    margin-left: 0;
    flex-direction: column;
    align-items: stretch;
  }

  .f-search {
    flex: 1;
  }

  .f-search input {
    width: 100%;
  }

  .cat {
    flex: 1;
  }

  .btn-refresh {
    align-self: flex-end;
    margin-left: 0;
  }
}
</style>
