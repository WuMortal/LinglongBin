<template>
  <section class="page">
    <header class="head">
      <div class="head-left">
        <h1>物料库存</h1>
        <p>管理你的电子物料库</p>
      </div>
      <div class="head-actions">
        <button class="btn btn-primary add" @click="openAdd">
          <Plus :size="16" style="display: inline-flex; flex-shrink: 0" />添加物料
        </button>
        <button class="btn btn-ghost add" @click="searchLcsc">
          <Search :size="16" style="display: inline-flex; flex-shrink: 0" />导入立创
        </button>
        <button class="btn btn-ghost add" :class="{ on: selectMode }" @click="toggleSelectMode">
          <Trash2 :size="16" style="display: inline-flex; flex-shrink: 0" />{{ selectMode ? '退出批量' : '批量删除' }}
        </button>
      </div>
    </header>

    <!-- [首页统计] 与库存中心 KPI 重复，待重新设计口径后再启用。启用时需同步放开：
         KpiCards 导入、statsOverview / lowStockMaterials 导入、stats / loadStats / ringPct / kpiItems，
         以及各处的 void loadStats() 调用。
    <KpiCards :items="kpiItems" compact /> -->

    <div class="toolbar">
      <div class="search">
        <Search :size="16" class="s-ico" style="display: inline-flex; flex-shrink: 0" />
        <input v-model="search" type="search" placeholder="搜索名称、型号、品牌、封装..." />
      </div>
      <AppSelect v-model="majorId" :options="majorOptions" :width="132" searchable search-placeholder="搜索大类"
        placeholder="全部大类" class="cat" />
      <AppSelect v-model="minorId" :options="minorOptions" :width="132" searchable search-placeholder="搜索小类"
        placeholder="全部小类" class="cat" />
      <!-- 参数筛选：未选小类时禁用；悬浮展开，点击可固定 -->
      <div ref="paramAnchorEl" class="pf-anchor" @mouseenter="openParam" @mouseleave="closeParam">
        <button class="param-btn" :class="{ on: paramVisible }" :disabled="!minorId"
          :title="minorId ? '展开参数筛选' : '请先选择小类'" @click="toggleParamPin">
          <Tag :size="13" style="display: inline-flex; flex-shrink: 0" />展开参数
          <span v-if="selectedParamTags.length" class="pcnt">{{ selectedParamTags.length }}</span>
        </button>
        <div v-if="paramVisible" class="pf-pop-wrap">
          <ParamFilterBar
            v-if="activeCatParams.length"
            :params="activeCatParams"
            :model-value="paramSel"
            :options-of="paramOptions"
            :collapse="false"
            @update:model-value="onParamsChange"
            @clear="clearParams"
          />
          <p v-else class="pf-empty">该小类未配置参数模板</p>
        </div>
      </div>
      <!-- 重置：清空搜索 / 分类 / 参数等全部筛选条件；无筛选时作为手动刷新 -->
      <button class="reset-btn" :class="{ busy: loading }" :title="hasFilters ? '重置全部筛选' : '刷新'" @click="resetAll">
        <RotateCcw :size="14" style="display: inline-flex; flex-shrink: 0" />
      </button>
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

    <!-- 批量操作条：进入多选模式后出现，贴着网格，作用于已选卡片 -->
    <div v-if="selectMode" class="selbar">
      <span class="sel-count">已选 {{ selectedCount }} 项</span>
      <button class="sel-link" :disabled="!items.length" @click="toggleSelectAllLoaded">
        {{ allLoadedSelected ? '取消全选' : `全选（已加载 ${items.length}）` }}
      </button>
      <button class="sel-link" :disabled="!selectedCount" @click="clearSelection">清空选择</button>
      <span class="sel-spacer" />
      <button class="btn btn-danger" :disabled="!selectedCount" @click="removeSelected">
        <Trash2 :size="14" style="display: inline-flex; flex-shrink: 0" />删除所选
      </button>
      <button class="btn btn-ghost" @click="toggleSelectMode">退出</button>
    </div>

    <p v-if="error" class="error">{{ error }}</p>
    <div v-if="loading" class="hint">
      <div class="spinner-lg" />
    </div>
    <div v-else-if="!items.length" class="empty">
      <div class="empty-ico">
        <Box :size="40" style="display: inline-flex; flex-shrink: 0" />
      </div>
      <h3>还没有物料</h3>
      <p>点击「添加物料」开始建档</p>
    </div>

    <div v-else class="grid" ref="gridEl" :class="{ selecting: selectMode }" @scroll="onGridScroll">
      <article v-for="it in items" :key="it.id" class="item" :class="{ picked: selected.has(it.id) }"
        @click="selectMode ? toggleSelect(it.id) : openDetail(it)">
        <div class="thumb">
          <img v-if="imagePublicUrl(it.image_path)" :src="imagePublicUrl(it.image_path)" alt="" />
          <div v-else class="thumb-ph">
            <ImageIcon :size="24" style="display: inline-flex; flex-shrink: 0" />
          </div>
          <div class="del-wrap">
            <button class="del edit" title="编辑" @click.stop="openEdit(it)">
              <Pencil :size="14" style="display: inline-flex; flex-shrink: 0" />
            </button>
            <button class="del" title="删除" @click.stop="remove(it)">
              <Trash2 :size="14" style="display: inline-flex; flex-shrink: 0" />
            </button>
          </div>
          <!-- 悬浮快捷出入库 -->
          <button class="qk" title="出入库" @click.stop="openQuick(it)">
            <ArrowLeftRight :size="14" style="display: inline-flex; flex-shrink: 0" />
          </button>
          <!-- 多选模式：右上角复选框（此时编辑 / 删除 / 出入库按钮由 CSS 隐藏） -->
          <button v-if="selectMode" class="pick" :class="{ on: selected.has(it.id) }" title="选择"
            @click.stop="toggleSelect(it.id)">
            <Check v-if="selected.has(it.id)" :size="13" style="display: inline-flex; flex-shrink: 0" />
          </button>
          <!-- 低库存角标 -->
          <span v-if="isLow(it)" class="low-tag">低库存</span>
        </div>
        <div class="body">
          <h3>
            <span class="name">{{ it.name }}</span>
            <span class="part-no" v-if="it.part_no">{{ it.part_no }}</span>
          </h3>
          <p class="meta">{{ it.brand || '—' }} · {{ it.model || '—' }}</p>
          <p v-if="specLine(it)" class="specs" :title="specLine(it)">{{ specLine(it) }}</p>
          <div class="tags">
            <span class="tag" v-if="it.categories?.name">{{ it.categories.name }}</span>
            <span class="tag" v-if="it.package">{{ it.package }}</span>
          </div>
          <div class="row">
            <span class="qty" :class="{ low: isLow(it) }">×{{ it.qty }}</span>
            <span class="price">¥{{ formatPrice(it.price) }}</span>
          </div>
        </div>
      </article>
      <div v-if="hasMore" class="load-more">
        <div v-if="loadingMore" class="spinner-sm" />
        <span v-else class="hint-text">下拉加载更多</span>
      </div>
      <div v-else-if="items.length" class="load-end">没有更多了</div>
    </div>

    <!-- 物料详情抽屉 -->
    <MaterialDetailDrawer :material="detailing" @close="detailing = null" />

    <!-- 出入库弹窗 -->
    <Teleport to="body">
      <div v-if="quick" class="modal-mask" @click.self="quick = null">
        <div class="modal" style="max-width: 440px">
          <div class="modal-head">
            <h3>出入库 · {{ quick.mat.name }}</h3>
            <p class="qk-sub">当前库存 ×{{ quick.mat.qty }}<template v-if="quick.mat.model || quick.mat.brand"> · {{ [quick.mat.model, quick.mat.brand].filter(Boolean).join(' ') }}</template></p>
          </div>
          <div class="modal-body">
            <Segmented v-model="quick.type" full class="qk-seg"
              :options="[
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
                <input v-model="quick.note" :placeholder="quick.type === 'in' ? '如 采购到货' : '如 焊接消耗'" @keyup.enter="submitQuick" />
              </label>
            </div>
          </div>
          <div class="modal-foot">
            <button class="btn btn-ghost" @click="quick = null">取消</button>
            <button class="btn" :class="quick.type === 'in' ? 'btn-primary' : 'btn-danger'" :disabled="quickBusy" @click="submitQuick">
              <span v-if="quickBusy" class="spinner-sm" />{{ quickBusy ? '处理中…' : (quick.type === 'in' ? '确认入库' : '确认出库') }}
            </button>
          </div>
        </div>
      </div>
    </Teleport>

    <MaterialFormDialog v-model="showAdd" :categories="categories" :material="editing"
      :lcsc="formLcsc" :lcsc-price="formLcscPrice" @saved="onSaved" />

    <!-- 搜立创弹窗：选中后回填到「添加物料」表单，由用户确认保存（与导入 / BOM 绑定互不影响） -->
    <Teleport to="body">
      <div v-if="showLcsc" class="modal-mask" @click.self="showLcsc = false">
        <div class="modal lcsc-modal" style="max-width: 720px; height: min(620px, 86vh)">
          <div class="modal-head">
            <h3>搜索嘉立创</h3>
          </div>
          <div class="modal-body">
            <LcscPickerPanel ref="lcscPanel" v-model:selected="homeLcscSel" :footer-pick="true" @pick="onLcscPick" />
          </div>
          <div class="modal-foot">
            <span v-if="homeLcscSel" class="foot-hint">已选 {{ homeLcscSel.part_no }}：{{ homeLcscSel.model || homeLcscSel.name }}</span>
            <button class="btn btn-ghost" @click="showLcsc = false">取消</button>
            <button class="btn btn-primary" :disabled="!homeLcscSel" @click="lcscPanel?.confirmPick()">下一步</button>
          </div>
        </div>
      </div>
    </Teleport>
  </section>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, watch, reactive } from 'vue'
import { Plus, Inbox, Search, Box, Image as ImageIcon, Trash2, Pencil, ArrowLeftRight, ArrowUpFromDot, Tag, X, RotateCcw, Check } from 'lucide-vue-next'
import { listMaterials, countMaterials, listCategories, deleteMaterial, deleteMaterials, applyStock, listSuppliers, imagePublicUrl, buildCategoryTree, descendantCategoryIds, listDictItems, getCategoryParams /* , statsOverview, lowStockMaterials —— 首页统计暂停用 */ } from '../lib/db'
import type { Category, MaterialRow, SupplierRow, CategoryParam } from '../lib/types'
import type { CategoryNode } from '../lib/db'
import type { ListMaterialsOpts } from '../lib/storage'
import { filterFieldParams } from '../lib/paramFields'
import { withAuthRetry } from '../lib/authRetry'
import AppSelect from '../components/form/AppSelect.vue'
import ParamFilterBar from '../components/form/ParamFilterBar.vue'
import MaterialFormDialog from '../components/business/MaterialFormDialog.vue'
import LcscPickerPanel from '../components/business/LcscPickerPanel.vue'
import { lcscLookup, type LcscComponent, type LcscHit } from '../lib/lcscApi'
import MaterialDetailDrawer from '../components/business/MaterialDetailDrawer.vue'
import Segmented from '../components/form/Segmented.vue'
// [首页统计暂停用]
// import KpiCards from '../components/KpiCards.vue'
// import type { KpiEntry } from '../components/KpiCards.vue'
import { useToast } from '../composables/toast'
import { confirm } from '../composables/confirm'

const toast = useToast()

const items = ref<MaterialRow[]>([])
const categories = ref<Category[]>([])
const search = ref('')
// 分类：拆成「大类 + 小类」两级联动（仅大类=含其下所有小类，选中小类=精确匹配）
const majorId = ref<string | null>(null)
const minorId = ref<string | null>(null)
// 参数过滤（复用在 MaterialPickerPanel 的 ParamFilterBar）
const activeCatParams = ref<CategoryParam[]>([])
const paramSel = reactive<Record<string, string>>({})
/** 当前分类下全部物料：仅用于枚举参数可选值，不参与分页结果 */
const catAllMats = ref<MaterialRow[]>([])
const loading = ref(false)
const error = ref('')
// 分页状态
const limit = ref(24)
const offset = ref(0)
const total = ref(0)
const hasMore = ref(false)
const loadingMore = ref(false)
const gridEl = ref<HTMLElement | null>(null)

const showAdd = ref(false)
const editing = ref<MaterialRow | null>(null)
const detailing = ref<MaterialRow | null>(null)

// 搜立创 → 回填新增物料（独立调用链，不影响导入 / BOM 绑定）
const showLcsc = ref(false)
const formLcsc = ref<LcscComponent | null>(null)
const formLcscPrice = ref<number | null>(null)
/** 搜立创面板引用与选中态（footer 渲染「下一步」） */
const lcscPanel = ref<InstanceType<typeof LcscPickerPanel> | null>(null)
const homeLcscSel = ref<LcscHit | null>(null)

// 出入库弹窗
const quick = ref<{ mat: MaterialRow; type: 'in' | 'out'; qty: number; note: string; supplier_id: string | null; purpose: string | null } | null>(null)
const quickBusy = ref(false)
const suppliers = ref<SupplierRow[]>([])
let suppliersLoaded = false
// 出库用途字典（设置 → 基础数据维护）
const purposes = ref<string[]>([])
let purposesLoaded = false

const supplierOptions = computed(() => [
  { value: null as string | null, label: '不记录供应商' },
  ...suppliers.value.map(s => ({ value: s.id, label: s.name })),
])

const purposeOptions = computed(() => [
  { value: null as string | null, label: '不记录用途' },
  ...purposes.value.map(p => ({ value: p, label: p })),
])

const tree = ref<CategoryNode[]>([])

/** 大类：一级分类（parent 为空） */
const majorOptions = computed(() => [
  { value: null as string | null, label: '全部大类' },
  ...tree.value.map(n => ({ value: n.cat.id as string | null, label: n.cat.name })),
])

/**
 * 小类：未选大类时列出全部小类（按所属大类分组）；选中大类后只过滤出该大类下的小类。
 * 小类不依赖大类也能单独选（categoryScope 会按 categoryId 精确匹配）。
 */
const minorOptions = computed(() => {
  const rows: Array<{ value: string | null; label: string; group?: string }> = [{ value: null, label: '全部小类' }]
  const node = tree.value.find(n => n.cat.id === majorId.value)
  if (node) {
    for (const c of node.children) rows.push({ value: c.cat.id as string | null, label: c.cat.name })
    return rows
  }
  // 未选大类：全部小类都可选，用所属大类分组便于查找
  for (const n of tree.value) {
    for (const c of n.children) rows.push({ value: c.cat.id as string | null, label: c.cat.name, group: n.cat.name })
  }
  return rows
})

/** 生效分类：小类优先，其次大类（用于加载参数模板与可选值） */
const effectiveCategoryId = computed(() => minorId.value || majorId.value)

/* ===== [首页统计暂停用] 原 KPI 数据链路，与库存中心重复，待重新设计口径后再放开 =====
 * 全库统计：独立于下方列表，不受筛选条件与分页影响。
 * 列表的 items / total 是"筛选 + 分页"的结果，不能拿来当统计口径。
 *
const stats = ref({ totalMaterials: 0, totalQty: 0, lowStock: 0 })

async function loadStats() {
  try {
    const [ov, low] = await Promise.all([statsOverview(), lowStockMaterials()])
    stats.value = {
      totalMaterials: ov.totalMaterials,
      totalQty: ov.totalQty,
      // lowStockMaterials 的阈值口径与首页 isLow 一致：物料自身 → 分类 → 默认 5
      lowStock: low.length,
    }
  } catch {   }
}

const ringPct = computed(() => {
  if (!stats.value.totalMaterials) return 0
  return Math.min(100, Math.round((stats.value.totalQty / Math.max(stats.value.totalMaterials * 50, 1)) * 100))
})

const kpiItems = computed<KpiEntry[]>(() => [
  { kind: 'ring', value: stats.value.totalMaterials, pct: ringPct.value, label: '物料种类', sub: `共 ${stats.value.totalQty} 件` },
  { icon: 'Inbox', tone: 'blue', value: stats.value.totalQty, label: '库存总量' },
  { icon: 'TriangleAlert', tone: 'red', value: stats.value.lowStock, label: '低库存预警' },
  { icon: 'Folder', tone: 'teal', value: categories.value.length, label: '分类数' },
])
*/

function isLow(it: MaterialRow) {
  // 生效阈值：物料自身（>0）→ 分类（>0）→ 默认 5
  const t = it.threshold || it.categories?.threshold || 5
  return it.qty <= t
}

function formatPrice(v: number) { return Number(v || 0).toFixed(2) }

/**
 * 卡片规格行：取前 3 个非空参数值，单行展示（过长由 CSS 截断，title 看完整）。
 * 过滤掉「型号 / 品牌 / 封装」参数——它们已作为主表字段单独展示（.meta / .tags），不重复。
 */
function specLine(it: MaterialRow): string {
  return filterFieldParams(it.params, { fieldValues: [it.model, it.brand, it.package] })
    .map(([, v]) => v)
    .slice(0, 3)
    .join(' · ')
}

let debounce: ReturnType<typeof setTimeout> | undefined
function scheduleLoad() {
  // 筛选条件变了就清空选择，避免跨范围误删（多选只在当前结果集内有效）
  selected.value.clear()
  clearTimeout(debounce); debounce = setTimeout(load, 200)
}
// 搜索 / 参数筛选变化 → 重新拉取
watch(search, scheduleLoad)
watch(paramSel, scheduleLoad, { deep: true })
// 切换大类：已选小类若不属于该大类则清空，避免残留上一个大类的子类
watch(majorId, (id) => {
  if (!minorId.value) return
  const node = tree.value.find(n => n.cat.id === id)
  if (!node?.children.some(c => c.cat.id === minorId.value)) minorId.value = null
})
// 生效分类变化：重置参数筛选，并加载该分类的参数模板与可选值
watch(effectiveCategoryId, async (id) => {
  for (const k of Object.keys(paramSel)) delete paramSel[k]
  activeCatParams.value = []
  catAllMats.value = []
  if (id) {
    try {
      activeCatParams.value = await getCategoryParams(id)
      catAllMats.value = await listMaterials(categoryScope())
    } catch { /* 静默 */ }
  }
  scheduleLoad()
})

/** 当前分类筛选范围：选中小类=精确匹配，仅选大类=含其下所有小类 */
function categoryScope(): Pick<ListMaterialsOpts, 'categoryId' | 'categoryIds'> {
  if (minorId.value) return { categoryId: minorId.value }
  if (majorId.value) return { categoryIds: descendantCategoryIds(categories.value, majorId.value) }
  return {}
}

function buildOpts() {
  const opts: ListMaterialsOpts = { search: search.value, ...categoryScope() }
  const p: Record<string, string> = {}
  for (const [k, v] of Object.entries(paramSel)) if (v) p[k] = v
  if (Object.keys(p).length) opts.params = p
  return opts
}

/** 某参数的可选值：模板预设 ∪ 该分类下物料实际出现的值 */
function paramOptions(p: CategoryParam): string[] {
  const set = new Set<string>()
  for (const v of p.values || []) if (v != null && String(v) !== '') set.add(String(v))
  for (const m of catAllMats.value) {
    const v = m.params?.[p.key]
    if (v != null && String(v).trim() !== '') set.add(String(v).trim())
  }
  return [...set]
}

function onParamsChange(v: Record<string, string>) {
  for (const k of Object.keys(paramSel)) delete paramSel[k]
  Object.assign(paramSel, v)
}

function clearParams() {
  for (const k of Object.keys(paramSel)) delete paramSel[k]
}

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

/** 是否存在任一生效的筛选条件（控制重置按钮可用性） */
const hasFilters = computed(() =>
  !!search.value || !!majorId.value || !!minorId.value || Object.values(paramSel).some(Boolean),
)

/** 重置：清空搜索、大类/小类与全部参数条件；没有条件可清时按刷新处理 */
function resetAll() {
  const had = hasFilters.value
  search.value = ''
  majorId.value = null
  minorId.value = null
  for (const k of Object.keys(paramSel)) delete paramSel[k]
  closeParamAll()
  // 无条件可清时，watch 不会触发，需主动重拉一次
  if (!had) load()
}

function onDocClickParam(e: MouseEvent) {
  if (!paramVisible.value) return
  const t = e.target as Node
  if (paramAnchorEl.value?.contains(t)) return
  // 下拉浮层被 teleport 到 body，点它不算外部（否则选完一个值面板就关了）
  const pop = document.querySelector('.pop-float')
  if (pop && pop.contains(t)) return
  closeParamAll()
}
function onEscParam(e: KeyboardEvent) { if (e.key === 'Escape') closeParamAll() }

// ===== 批量删除：多选模式 =====
const selectMode = ref(false)
const selected = ref(new Set<string>())
const selectedCount = computed(() => selected.value.size)
/** 已加载的卡片是否已全部选中（用于「全选 / 取消全选」切换） */
const allLoadedSelected = computed(() =>
  items.value.length > 0 && items.value.every(i => selected.value.has(i.id)))

function toggleSelectMode() {
  selectMode.value = !selectMode.value
  selected.value.clear()
}
function toggleSelect(id: string) {
  if (selected.value.has(id)) selected.value.delete(id)
  else selected.value.add(id)
}
/** 全选 / 取消全选：范围仅限当前已加载的卡片（无限滚动，未加载的不在内） */
function toggleSelectAllLoaded() {
  if (allLoadedSelected.value) selected.value.clear()
  else for (const i of items.value) selected.value.add(i.id)
}
function clearSelection() { selected.value.clear() }

async function removeSelected() {
  const ids = [...selected.value]
  if (!ids.length) return
  if (!await confirm({
    title: '批量删除物料',
    content: `确定删除选中的 ${ids.length} 个物料？此操作不可恢复。`,
    danger: true,
    confirmText: '删除',
  })) return
  try {
    await deleteMaterials(ids)
    // 详情抽屉若正开着被删的物料，一并关掉
    if (detailing.value && ids.includes(detailing.value.id)) detailing.value = null
    selectMode.value = false
    selected.value.clear()
    await load()
    // void loadStats() // [首页统计暂停用]
    toast.success(`已删除 ${ids.length} 个物料`)
  } catch (e: unknown) {
    toast.error('批量删除失败：' + ((e as Error).message || e))
  }
}

async function load() {
  loading.value = true; error.value = ''
  offset.value = 0
  try {
    const opts = buildOpts()
    // 会话过期 / 时钟偏移这类鉴权瞬时错误自动重试一次，不用手动再点一次
    const [page, count] = await withAuthRetry(() => Promise.all([
      listMaterials({ ...opts, limit: limit.value, offset: 0 }),
      countMaterials(opts),
    ]))
    items.value = page
    total.value = count
    hasMore.value = page.length < count
  }
  catch (e: unknown) { error.value = '加载失败：' + ((e as Error).message || e) }
  finally { loading.value = false }
}

async function loadMore() {
  if (loading.value || loadingMore.value || !hasMore.value) return
  loadingMore.value = true
  try {
    offset.value += limit.value
    const page = await withAuthRetry(() => listMaterials({ ...buildOpts(), limit: limit.value, offset: offset.value }))
    items.value.push(...page)
    hasMore.value = items.value.length < total.value
  }
  catch (e: unknown) { error.value = '加载更多失败：' + ((e as Error).message || e) }
  finally { loadingMore.value = false }
}

function onGridScroll(e: Event) {
  const el = e.target as HTMLElement
  if (el.scrollTop + el.clientHeight >= el.scrollHeight - 120) loadMore()
}
async function loadCategories() {
  try { categories.value = await listCategories(); tree.value = buildCategoryTree(categories.value) } catch { /* ignore */ }
}
function openAdd() { editing.value = null; formLcsc.value = null; formLcscPrice.value = null; showAdd.value = true }
function openEdit(it: MaterialRow) { editing.value = it; formLcsc.value = null; formLcscPrice.value = null; showAdd.value = true }
function openDetail(it: MaterialRow) { detailing.value = it }

// ===== 搜立创：选中后取完整详情，回填到「添加物料」表单，由用户确认保存 =====
function searchLcsc() {
  formLcsc.value = null
  formLcscPrice.value = null
  showLcsc.value = true
}
async function onLcscPick(h: LcscHit) {
  try {
    const d = await lcscLookup(h.part_no)
    formLcsc.value = d
    formLcscPrice.value = h.price ?? null
    showLcsc.value = false
    editing.value = null
    showAdd.value = true
  } catch (e: unknown) {
    toast.error('获取立创详情失败：' + ((e as Error).message || e))
  }
}

async function openQuick(it: MaterialRow) {
  quick.value = { mat: it, type: 'in', qty: 1, note: '', supplier_id: null, purpose: null }
  if (!suppliersLoaded) {
    try { suppliers.value = await listSuppliers(); suppliersLoaded = true } catch { /* 静默 */ }
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
    // 同步卡片与弹窗内的库存数
    const idx = items.value.findIndex(i => i.id === q.mat.id)
    if (idx >= 0) items.value[idx] = { ...items.value[idx], qty: fresh.qty }
    q.mat = { ...q.mat, qty: fresh.qty }
    q.note = ''
    q.qty = 1
    q.purpose = null
    toast.success(q.type === 'in' ? `入库 +${qty}` : `出库 -${qty}`)
    quick.value = null
    // void loadStats() // [首页统计暂停用] 库存 / 低库存数变了
  }
  catch (e: unknown) { toast.error('操作失败：' + ((e as Error).message || e)) }
  finally { quickBusy.value = false }
}

/** 编辑保存后：刷新列表；若抽屉开着同步最新数据 */
async function onSaved() {
  await load()
  // void loadStats() // [首页统计暂停用]
  if (detailing.value) {
    const fresh = items.value.find(i => i.id === detailing.value!.id)
    if (fresh) detailing.value = fresh
  }
}

async function remove(it: MaterialRow) {
  if (!await confirm({
    title: '删除物料',
    content: `确定删除「${it.name}」？此操作不可恢复。`,
    danger: true,
    confirmText: '删除',
  })) return
  try {
    await deleteMaterial(it.id)
    if (detailing.value?.id === it.id) detailing.value = null
    await load()
    // void loadStats() // [首页统计暂停用]
    toast.success('删除成功')
  }
  catch (e: unknown) { toast.error('删除失败：' + ((e as Error).message || e)) }
}
onMounted(() => {
  loadCategories(); load() // ; void loadStats() —— [首页统计暂停用]
  document.addEventListener('click', onDocClickParam)
  document.addEventListener('keydown', onEscParam)
})
onBeforeUnmount(() => {
  document.removeEventListener('click', onDocClickParam)
  document.removeEventListener('keydown', onEscParam)
})
</script>

<style scoped>
.page {
  height: 100%;
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.head {
  display: flex;
  justify-content: space-between;
  align-items: flex-end;
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

.toolbar {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
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

/* 重置 / 刷新：图标按钮，始终可点（无条件时用作手动刷新） */
.reset-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: var(--ctrl-h);
  height: var(--ctrl-h);
  padding: 0;
  border: 1px solid var(--c-border);
  border-radius: var(--r-md);
  background: var(--c-surface);
  color: var(--c-text-2);
  cursor: pointer;
  flex-shrink: 0;
  transition: background-color var(--motion-fast), color var(--motion-fast), border-color var(--motion-fast);
}

.reset-btn:hover:not(:disabled) {
  color: var(--c-danger);
  background: var(--c-surface-hover);
  border-color: var(--c-danger);
}

/* 刷新中：图标旋转 */
.reset-btn.busy {
  color: var(--c-primary);
  border-color: var(--c-primary);
}

.reset-btn.busy svg {
  animation: spin 0.7s linear infinite;
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
  /* 参数项很多时面板内部滚动，不无限撑高 */
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



.search {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 8px;
  background: var(--c-surface);
  border: 1px solid var(--c-border);
  border-radius: var(--r-md);
  padding: 0 var(--btn-px);
  height: var(--ctrl-h);
  backdrop-filter: blur(20px);
}

.search:focus-within {
  border-color: var(--c-primary);
  background: var(--c-surface-hover);
}

.search input {
  border: none;
  background: transparent;
  flex: 1;
  height: 100%;
  padding: 0 0 0 4px;
}

.search input:focus {
  box-shadow: none;
  background: transparent;
}

.s-ico {
  color: var(--c-text-3);
  flex-shrink: 0;
}

.add {
  flex-shrink: 0;
}

/* 批量删除：进入多选态时高亮入口 */
.add.on {
  border-color: var(--c-primary);
  color: var(--c-primary);
  background: var(--c-primary-soft);
}

/* ===== 批量操作条（紧凑高度） ===== */
.selbar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 3px 8px;
  border: 1px solid var(--c-border);
  border-radius: var(--r-md);
  background: var(--c-elevated);
}

/* 条内按钮压到小号，整条高度才降得下来 */
.selbar .btn {
  height: var(--ctrl-h-sm);
  padding: 0 10px;
  gap: 4px;
  font-size: var(--fs-xs);
}

.sel-count {
  font-size: var(--fs-xs);
  font-weight: 600;
}

.sel-spacer {
  margin-left: auto;
}

.sel-link {
  padding: 0;
  border: none;
  background: transparent;
  color: var(--c-primary);
  font-family: inherit;
  font-size: var(--fs-xs);
  cursor: pointer;
}

.sel-link:hover:not(:disabled) {
  text-decoration: underline;
}

.sel-link:disabled {
  color: var(--c-text-3);
  cursor: not-allowed;
}

.head-actions {
  display: flex;
  gap: 10px;
  flex-shrink: 0;
}

.foot-hint {
  margin-right: auto;
  font-size: var(--fs-xs);
  color: var(--c-text-3);
}

.error {
  color: var(--c-danger);
  font-size: var(--fs-sm);
  margin: 0;
}

.hint {
  display: grid;
  place-items: center;
  flex: 1;
}

.spinner-lg {
  width: 32px;
  height: 32px;
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

.empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  color: var(--c-text-2);
  text-align: center;
}

.empty-ico {
  width: 72px;
  height: 72px;
  border-radius: var(--r-xl);
  background: var(--c-surface);
  display: grid;
  place-items: center;
  color: var(--c-text-3);
  margin-bottom: 8px;
}

.empty h3 {
  margin: 0;
  font-size: var(--fs-lg);
  color: var(--c-text);
}

.empty p {
  margin: 0;
  font-size: var(--fs-sm);
}

.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: 12px;
  overflow: auto;
  padding-bottom: 8px;
  flex: 1;
  align-content: start;
}

/* 分页加载：占位行横跨整行 */
.load-more,
.load-end {
  grid-column: 1 / -1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 14px 0 6px;
  font-size: var(--fs-xs);
  color: var(--c-text-3);
}
.spinner-sm {
  width: 14px;
  height: 14px;
  border: 2px solid var(--c-border);
  border-top-color: var(--c-primary);
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
}

.item {
  position: relative;
  background: var(--c-surface);
  border: 1px solid var(--c-border);
  border-radius: var(--r-lg);
  transition: all var(--motion);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  cursor: pointer;
  display: flex;
  flex-direction: column;
}

.item:hover {
  transform: translateY(-2px);
  border-color: var(--c-border-strong);
  box-shadow: var(--shadow-md);
}

/* 多选模式：隐藏卡片 hover 操作，避免与"点卡片即选中"冲突 */
.grid.selecting .del-wrap,
.grid.selecting .qk {
  display: none;
}

/* 已选中的卡片：主色描边 */
.item.picked {
  border-color: var(--c-primary);
  box-shadow: 0 0 0 2px var(--c-primary-soft);
}

/* ===== 多选复选框（缩略图右上角，常驻显示） ===== */
.pick {
  position: absolute;
  top: 8px;
  right: 8px;
  z-index: 2;
  width: 24px;
  height: 24px;
  border-radius: 6px;
  border: 1.5px solid rgba(255, 255, 255, 0.9);
  background: rgba(0, 0, 0, 0.28);
  color: transparent;
  display: grid;
  place-items: center;
  cursor: pointer;
  transition: background-color var(--motion-fast), border-color var(--motion-fast);
}

.pick.on {
  background: var(--c-primary);
  border-color: var(--c-primary);
  color: #fff;
}

.thumb {
  height: 120px;
  background: var(--c-glass);
  display: grid;
  place-items: center;
  position: relative;
  overflow: hidden;
  border-radius: var(--r-lg) var(--r-lg) 0 0;
  flex-shrink: 0;
}

.thumb img {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.thumb-ph {
  color: var(--c-text-3);
}

/* 操作按钮定位容器：右上角横排（编辑 | 删除） */
.del-wrap {
  position: absolute;
  top: 8px;
  right: 8px;
  z-index: 1;
  display: flex;
  gap: 4px;
}

.del {
  width: 28px;
  height: 28px;
  border: none;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.5);
  color: #fff;
  display: grid;
  place-items: center;
  opacity: 0;
  transition: opacity var(--motion), background var(--motion);
  cursor: pointer;
}

/* 编辑按钮：hover 主题蓝 */
.del.edit:hover {
  background: var(--c-primary);
}

.del:not(.edit):hover {
  background: var(--c-danger);
}

.item:hover .del {
  opacity: 1;
}

/* ===== 悬浮快捷出入库（缩略图右下角） ===== */
.qk {
  position: absolute;
  right: 8px;
  bottom: 8px;
  width: 26px;
  height: 26px;
  border: none;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.5);
  color: #fff;
  display: grid;
  place-items: center;
  cursor: pointer;
  opacity: 0;
  z-index: 1;
  transition: opacity var(--motion), background var(--motion), transform var(--motion);
}

.item:hover .qk {
  opacity: 1;
}

.qk:hover {
  background: var(--c-primary);
  transform: scale(1.08);
}

/* ===== 出入库弹窗（结构用全局 .modal-mask/.modal/.seg，此处只做布局微调） ===== */
.qk-sub {
  margin: 4px 0 0;
  font-size: var(--fs-sm);
  color: var(--c-text-2);
}

.qk-seg {
  margin-bottom: 14px;
}

.qk-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 14px;
}

/* 字段样式与 MaterialFormDialog 一致 */
.qk-grid .field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.qk-grid .field > label {
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

/* 备注整行 */
.qk-grid .qk-note-field {
  grid-column: 1 / -1;
}

.body {
  padding: 10px 12px;
  flex: 1;
  display: flex;
  flex-direction: column;
}

.body h3 {
  margin: 0 0 2px;
  font-size: var(--fs-md);
  font-weight: 600;
  display: flex;
  align-items: baseline;
  gap: 8px;
  min-width: 0;
}

.body h3 .name {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  flex: 1 1 auto;
  min-width: 0;
}

/* 商品编号：跟随名称，弱化样式 */
.body h3 .part-no {
  flex: 0 0 auto;
  font-size: var(--fs-xs);
  font-weight: 400;
  color: var(--c-text-3);
  white-space: nowrap;
}

.meta {
  margin: 0;
  font-size: var(--fs-xs);
  color: var(--c-text-2);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* 规格行：前 3 个参数值，固定一行截断（避免参数数量不同导致卡片高度参差） */
.specs {
  margin: 4px 0 0;
  font-size: var(--fs-xs);
  color: var(--c-text);
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* 信息 tag：与 Stock 流水 .badge 同款半透明底 */
.tags {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin: 4px 0 0;
  min-height: 0;
}

.tag {
  display: inline-flex;
  align-items: center;
  max-width: 100%;
  padding: 1px 7px;
  border-radius: 999px;
  background: var(--c-bg-2);
  color: var(--c-text-2);
  font-size: var(--fs-xs);
  font-weight: 500;
  line-height: 1.4;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* 弱化 tag：编号/库位 */
.tag.ghost {
  background: transparent;
  color: var(--c-text-3);
}

/* 低库存角标（缩略图左上角，红色实底与 danger 按钮一致） */
.low-tag {
  position: absolute;
  top: 8px;
  left: 8px;
  z-index: 1;
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--c-danger);
  color: #fff;
  font-size: var(--fs-xs);
  font-weight: 600;
  pointer-events: none;
}

.row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  /* 贴底：参数 / 标签行数不同时，数量与价格仍对齐卡片底部 */
  margin-top: auto;
  padding-top: 10px;
}

.qty {
  font-weight: 700;
  color: var(--c-accent);
  font-size: var(--fs-md);
}

.qty.low {
  color: var(--c-danger);
}

.price {
  font-size: var(--fs-xs);
  color: var(--c-text-3);
}

/* 搜立创弹窗：让面板撑满高度，列表 / 详情各自滚动，弹窗本身不再出现多余滚动条 */
.lcsc-modal {
  display: flex;
  flex-direction: column;
}
.lcsc-modal .modal-body {
  flex: 1;
  min-height: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}
.lcsc-modal .modal-body :deep(.lcsc-pane) {
  flex: 1;
  min-height: 0;
  height: 100%;
}

</style>
