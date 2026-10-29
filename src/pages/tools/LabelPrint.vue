<template>
  <section class="page">
    <header class="head">
      <div class="head-left">
        <PageBackButton :hide-when-none="false" />
        <div>
          <h1>标签打印</h1>
          <p>选择标签模板与物料，确认整页排版后打印</p>
        </div>
      </div>
      <div class="head-actions">
        <span class="tpl-field">
          <span class="tpl-lbl">模板</span>
          <AppSelect v-model="tplId" :options="tplOptions" :width="220" searchable search-placeholder="搜索模板"
            placeholder="选择模板" />
        </span>
        <span class="sel-count">已选 {{ selectedIds.length }} 个</span>
        <button class="btn btn-ghost" @click="openOrderImport">
          <ArrowDownToLine :size="14" style="display: inline-flex; flex-shrink: 0" />入库单
        </button>
        <button class="btn btn-primary" :disabled="!canPrint" @click="doPrint">
          <Printer :size="14" style="display: inline-flex; flex-shrink: 0" />打印
        </button>
      </div>
    </header>

    <div class="lp card">
      <!-- 左：模板已配置的分类（多选，一次加入该分类下全部物料） -->
      <section class="pane">
        <div class="pane-head">
          <span class="pane-title">
            <Tags :size="14" style="display: inline-flex" />分类
          </span>
          <span class="pane-count">{{ hasDefaultCfg ? '全部' : usableCatIds.size }}</span>
        </div>
        <!-- 分类树：与首页共用 CategoryTree（多选模式，数量 = 各分类物料数） -->
        <CategoryTree
          :nodes="tree"
          :counts="catCounts"
          checkable
          searchable
          :is-checked="catChecked"
          :is-indeterminate="catIndeterminate"
          :name-title="(n) => `查看并勾选「${n.cat.name}」下的物料`"
          @pick="openPicker"
          @check="(n, on) => toggleCat(n, on)"
        >
          <template #empty>该模板没有可用分类</template>
        </CategoryTree>
      </section>

      <!-- 中：已选物料 -->
      <section class="pane">
        <div class="pane-head">
          <span class="pane-title">
            <Package :size="14" style="display: inline-flex" />已选物料
          </span>
          <span class="pane-count">{{ selectedIds.length }}</span>
          <button class="btn btn-ghost btn-sm btn-sort" :class="{ on: sortMode === 'cat' }"
            :title="sortMode === 'cat' ? '当前：按分类排序（大类→小类）' : '当前：按选择顺序'"
            @click="sortMode = sortMode === 'cat' ? 'order' : 'cat'">
            <ArrowUpDown :size="13" style="display: inline-flex; flex-shrink: 0" />{{ sortMode === 'cat' ? '分类' : '顺序' }}
          </button>
          <button class="btn btn-ghost btn-sm btn-clear" :disabled="!selectedIds.length"
            @click="clearSelected">清空</button>
        </div>
        <div class="pane-search">
          <div class="inp-wrap">
            <Search :size="13" class="inp-ico" style="display: inline-flex" />
            <input v-model="listSearch" placeholder="筛选已选物料…" />
          </div>
        </div>
        <div class="items">
          <div v-for="m in filteredSelected" :key="m.id" class="item">
            <div class="item-main">
              <div class="item-line1">
                <span class="item-name">{{ m.name }}</span>
              </div>
              <span v-if="m.model" class="item-model">{{ m.model }}</span>
              <span class="item-sub" :title="itemSub(m)">{{ itemSub(m) }}</span>
            </div>
            <span class="item-qty" title="打印张数">
              <input type="number" min="1" :value="printCount(m.id)" @input="setPrintCount(m.id, $event)" />
              <span class="item-qty-unit">张</span>
            </span>
            <button class="btn btn-icon mini danger" title="移除" @click="removeSelected(m.id)">
              <X :size="13" style="display: inline-flex; flex-shrink: 0" />
            </button>
          </div>
          <EmptyState v-if="!filteredSelected.length" :icon="Package" title="还没有选中物料" description="在左侧勾选分类即可批量加入" />
        </div>
      </section>

      <!-- 右：整页预览（自适应宽度 + 手动缩放） -->
      <section class="pane preview">
        <div class="pane-head">
          <span class="pane-title">预览</span>
          <div class="pv-tools">
            <button class="btn btn-icon mini" title="上一页" :disabled="pageIdx <= 0" @click="pageIdx--">
              <ChevronLeft :size="13" style="display: inline-flex; flex-shrink: 0" />
            </button>
            <span class="pv-page">{{ pageIdx + 1 }} / {{ pages.length }}</span>
            <button class="btn btn-icon mini" title="下一页" :disabled="pageIdx >= pages.length - 1" @click="pageIdx++">
              <ChevronRight :size="13" style="display: inline-flex; flex-shrink: 0" />
            </button>
            <span class="pv-div"></span>
            <span class="pv-meta">每页 {{ perPage }} 张 · 共 {{ totalLabels }} 张</span>
            <span class="pv-div"></span>
            <button class="btn btn-icon mini" title="缩小" :disabled="effZoom <= ZOOM_MIN" @click="zoomBy(-ZOOM_STEP)">
              <ZoomOut :size="13" style="display: inline-flex; flex-shrink: 0" />
            </button>
            <button class="btn btn-ghost btn-sm fit" :class="{ active: zoomMode === 'fit' }" title="按预览区宽度自适应"
              @click="resetFit">适应宽度</button>
            <button class="btn btn-icon mini" title="放大" :disabled="effZoom >= ZOOM_MAX" @click="zoomBy(ZOOM_STEP)">
              <ZoomIn :size="13" style="display: inline-flex; flex-shrink: 0" />
            </button>
            <span class="pv-zoom">{{ zoomPct }}%</span>
          </div>
        </div>
        <div ref="viewEl" class="pv-view">
          <div v-if="curTpl" class="pv-stage" :style="stageStyle">
            <div class="pv-scaler" :style="{ transform: `scale(${effZoom})` }">
              <LabelSheet :template="curTpl" :items="currentPageItems" />
            </div>
          </div>
          <EmptyState v-else :icon="Printer" title="还没有选择模板" description="在右上角选一个标签模板" />
        </div>
      </section>
      <!-- 进入页面加载数据：与「物料库」一致的居中旋转图标，盖住空白三栏 -->
      <div v-if="loading" class="lp-loading">
        <div class="spinner-lg" />
      </div>
    </div>

    <!-- 分类物料：点树上分类名打开，可搜索并逐项勾选 -->
    <MaterialPickDialog v-if="pickerNode" :cat-name="pickerNode.cat.name" :cat-ids="pickerCatIds"
      :materials="allMaterials" :cat-labels="catPathMap" v-model:selected-ids="selectedIds" @close="closePicker" />

    <!-- 导入入库单：选一张入库单，将其明细物料加入已选（按分类排序） -->
    <Teleport to="body">
      <div v-if="showOrderImport" class="oi-mask" @click.self="!orderImporting && (showOrderImport = false)">
        <div class="oi-card" role="dialog" aria-modal="true" aria-label="导入入库单物料">
          <button class="oi-x" aria-label="关闭" :disabled="orderImporting" @click="showOrderImport = false">
            <X :size="16" style="display: inline-flex; flex-shrink: 0" />
          </button>
          <div class="oi-head">
            <span class="oi-ico"><ArrowDownToLine :size="18" style="display: inline-flex; flex-shrink: 0" /></span>
            <div class="oi-head-txt">
              <h3>导入入库单物料</h3>
              <p>可多选入库单，将其明细物料合并加入已选（自动按分类排序）</p>
            </div>
          </div>
          <div class="oi-search">
            <div class="inp-wrap">
              <Search :size="13" class="inp-ico" style="display: inline-flex" />
              <input v-model="orderKeyword" placeholder="搜索单号 / 标题…" @input="onOrderKw" />
            </div>
          </div>
          <div class="oi-list">
            <div v-for="o in orderList" :key="o.id" class="oi-item" :class="{ on: orderPicked.includes(o.id) }"
              @click="toggleOrderPick(o.id)">
              <div class="oi-main">
                <div class="oi-line">
                  <span class="oi-no mono">{{ o.order_no || '—' }}</span>
                  <span class="oi-title">{{ o.title || '入库单' }}</span>
                </div>
                <div class="oi-sub">{{ fmtOrderDate(o.created_at) }} · {{ o.item_count }} 项 · {{ o.total_qty }} 件</div>
              </div>
              <span class="oi-check" :class="{ on: orderPicked.includes(o.id) }">
                <Check :size="12" style="display: inline-flex; flex-shrink: 0" v-show="orderPicked.includes(o.id)" />
              </span>
            </div>
            <div v-if="orderLoading" class="oi-busy"><span class="spinner-sm" />加载中…</div>
            <EmptyState v-else-if="!orderList.length" :icon="Package" title="没有入库单"
              description="暂无有效入库单，或换个关键词搜索" />
          </div>
          <div class="oi-foot">
            <span v-if="orderPicked.length" class="oi-meta">已选 {{ orderPicked.length }} 张</span>
            <span v-else-if="orderTotal" class="oi-meta">共 {{ orderTotal }} 单</span>
            <span class="oi-grow" />
            <button class="btn btn-sm btn-ghost" :disabled="orderImporting" @click="showOrderImport = false">取消</button>
            <button class="btn btn-sm btn-primary" :disabled="!orderPicked.length || orderLoading || orderImporting"
              @click="confirmOrderImport">
              {{ orderImporting ? '导入中…' : `导入${orderPicked.length ? `（${orderPicked.length}）` : ''}` }}
            </button>
          </div>
        </div>
      </div>
    </Teleport>

    <!-- 打印用：未缩放的真实尺寸整页，仅打印时显示 -->
    <Teleport to="body">
      <div v-if="curTpl" class="pv-print">
        <LabelSheet v-for="(pg, i) in pages" :key="i" :template="curTpl" :items="pg" />
      </div>
    </Teleport>
  </section>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import {
  ArrowDownToLine, ArrowUpDown, Check, ChevronLeft, ChevronRight, Package, Printer, Search, Tags, X, ZoomIn, ZoomOut,
} from 'lucide-vue-next'
import {
  listLabelTemplates, listMaterials, listCategories, getMaterialsByIds, buildCategoryTree,
  pageStockOrders, listStockLogsByOrder,
} from '../../lib/db'
import type { Category, LabelBlock, LabelTemplate, MaterialRow, StockOrder } from '../../lib/types'
import type { CategoryNode } from '../../lib/db'
import { materialSpecLine } from '../../lib/paramFields'
import LabelSheet from '../../components/label/LabelSheet.vue'
import MaterialPickDialog from '../../components/label/MaterialPickDialog.vue'
import AppSelect from '../../components/form/AppSelect.vue'
import PageBackButton from '../../components/PageBackButton.vue'
import EmptyState from '../../components/EmptyState.vue'
import CategoryTree from '../../components/business/CategoryTree.vue'
import { useToast } from '../../composables/toast'

const toast = useToast()

const templates = ref<LabelTemplate[]>([])
const allMaterials = ref<MaterialRow[]>([])
const categories = ref<Category[]>([])
const tplId = ref<string>('')
const selectedIds = ref<string[]>([])
const listSearch = ref('')
const pageIdx = ref(0)
/** 进入页面时拉取模板/物料/分类，初始即遮罩，避免一片空白 */
const loading = ref(true)

const route = useRoute()

const tplOptions = computed(() => templates.value.map(t => ({ value: t.id, label: t.name })))
const curTpl = computed(() => templates.value.find(t => t.id === tplId.value) ?? null)

/** 模板已配置的分类（cats 列表）；空 category_id 是「默认格式」，不算具体分类 */
const usableCatIds = computed(() => new Set((curTpl.value?.cats ?? []).map(c => c.category_id).filter(Boolean)))

/** 模板已配置的分类（cats 列表） */
const hasDefaultCfg = computed(() => (curTpl.value?.cats ?? []).some(c => !c.category_id))

/**
 * 该物料用哪套 blocks：按其分类取模板里对应的分类配置。
 * 没有匹配到时用「默认格式」（category_id 为空的那份配置）。
 */
function blocksFor(catId: string | null): LabelBlock[] {
  const cats = curTpl.value?.cats ?? []
  const c = cats.find(x => x.category_id === catId) ?? cats.find(x => !x.category_id)
  return c?.blocks ?? []
}

const tree = computed<CategoryNode[]>(() => {
  const all = buildCategoryTree(categories.value)
  // 没有任何分类配置、或存在「默认格式」时，全部分类都可选
  if (!usableCatIds.value.size || hasDefaultCfg.value) return all
  return all
    .map(n => {
      // 大类本身配了格式 → 整棵保留（子类没有自己的配置时会回落到大类/默认格式）；
      // 只按子类 id 过滤的话，给大类配格式会让该大类整棵消失，树直接空掉。
      if (usableCatIds.value.has(n.cat.id)) return n
      return { ...n, children: n.children.filter(c => usableCatIds.value.has(c.cat.id)) }
    })
    .filter(n => n.children.length)
})

/** 分类 id → 「大类 · 小类」展示名（大类本身就是一级，只有大类没有小类时只显示大类） */
const catPathMap = computed(() => {
  const m: Record<string, string> = {}
  for (const n of buildCategoryTree(categories.value)) {
    m[n.cat.id] = n.cat.name
    for (const c of n.children) m[c.cat.id] = `${n.cat.name} · ${c.cat.name}`
  }
  return m
})

/** 分类 id → 名称（仅该分类自身的名字，物料的 category_id 指向小类，即为「小类名称」） */
const catNameById = computed(() => {
  const m = new Map<string, string>()
  for (const c of categories.value) m.set(c.id, c.name)
  return m
})

/** 分类 → 物料 id 列表 */
const materialsByCat = computed(() => {
  const m = new Map<string, string[]>()
  for (const mat of allMaterials.value) {
    if (!mat.category_id) continue
    const arr = m.get(mat.category_id) ?? []
    arr.push(mat.id)
    m.set(mat.category_id, arr)
  }
  return m
})

/** 节点（含子级）下所有物料 id */
function descendantIds(node: CategoryNode): string[] {
  const ids = [node.cat.id, ...node.children.map(c => c.cat.id)]
  return ids.flatMap(id => materialsByCat.value.get(id) ?? [])
}

/** 分类 id → 该分类自身物料数；树组件会自动把子级累加到大类上 */
const catCounts = computed<Record<string, number>>(() => {
  const out: Record<string, number> = {}
  for (const [id, ids] of materialsByCat.value) out[id] = ids.length
  return out
})

/* ===== 分类物料弹框：点分类名打开，可搜索并逐项勾选 =====
 * 与树上复选框的分工：复选框 = 整类全选/取消；点名称 = 打开弹框按物料挑。
 * 弹框本体抽成 MaterialPickDialog，这里只负责算出「当前分类 + 其子分类」的 id。
 */
const pickerNode = ref<CategoryNode | null>(null)

/** 当前分类及其子分类的 id（大类打开时含全部小类） */
const pickerCatIds = computed(() =>
  pickerNode.value ? [pickerNode.value.cat.id, ...pickerNode.value.children.map(c => c.cat.id)] : [])

function openPicker(node: CategoryNode) { pickerNode.value = node }
function closePicker() { pickerNode.value = null }

function catChecked(node: CategoryNode): boolean {
  const ids = descendantIds(node)
  return ids.length > 0 && ids.every(id => selectedIds.value.includes(id))
}
function catIndeterminate(node: CategoryNode): boolean {
  const ids = descendantIds(node)
  const n = ids.filter(id => selectedIds.value.includes(id)).length
  return n > 0 && n < ids.length
}
function toggleCat(node: CategoryNode, on: boolean) {
  const ids = descendantIds(node)
  const set = new Set(selectedIds.value)
  if (on) ids.forEach(id => set.add(id))
  else ids.forEach(id => set.delete(id))
  selectedIds.value = [...set]
}
function removeSelected(id: string) {
  selectedIds.value = selectedIds.value.filter(x => x !== id)
  delete printCounts.value[id]
  printCounts.value = { ...printCounts.value }
}

/** 每种物料的打印张数（按物料 id），缺省 = 1 */
const printCounts = ref<Record<string, number>>({})

/** 物料打印张数（最小 1） */
function printCount(id: string): number {
  return Math.max(1, Math.floor(printCounts.value[id] ?? 1))
}
/** 修改打印张数：非法/清空一律回落为 1 */
function setPrintCount(id: string, e: Event) {
  const raw = Number((e.target as HTMLInputElement).value)
  const v = Math.max(1, Math.floor(isNaN(raw) ? 1 : raw))
  printCounts.value = { ...printCounts.value, [id]: v }
}

/** 副行：品牌 + 前 3 个扩展字段（与选择物料弹框共用同一套文案），不再显示库存 */
function itemSub(m: MaterialRow): string { return materialSpecLine(m) }
function clearSelected() {
  selectedIds.value = []
  printCounts.value = {}
}

const filteredSelected = computed(() => {
  const q = listSearch.value.trim().toLowerCase()
  const set = new Set(selectedIds.value)
  let arr = allMaterials.value.filter(m => set.has(m.id))
  if (q) arr = arr.filter(m => `${m.name} ${m.model ?? ''}`.toLowerCase().includes(q))
  return arr
})

/** 全量物料（含 params），供预览/打印取值 */
const selectedRows = ref<MaterialRow[]>([])
watch(selectedIds, async (ids) => {
  const rows = ids.length ? await getMaterialsByIds(ids) : []
  // 批量查询（in 条件）不保证返回顺序与传入 id 一致，按 selectedIds 重排 →「选中的先后顺序」
  const idx = new Map(ids.map((id, i) => [id, i]))
  selectedRows.value = [...rows].sort((a, b) => (idx.get(a.id) ?? 0) - (idx.get(b.id) ?? 0))
}, { immediate: true })

/** 分类序号：按树顺序给每个分类一个排序权重（大类→小类），供「按分类排序」使用 */
const catOrder = computed(() => {
  const order: string[] = []
  for (const n of buildCategoryTree(categories.value)) {
    order.push(n.cat.id)
    for (const c of n.children) order.push(c.cat.id)
  }
  return new Map(order.map((id, i) => [id, i]))
})

/** 已选物料排序方式：order = 按选择/导入先后顺序；cat = 按分类（大类→小类）分组 */
const sortMode = ref<'order' | 'cat'>('order')

function materialToData(m: MaterialRow): Record<string, string> {
  const d: Record<string, string> = {
    name: m.name ?? '', model: m.model ?? '', brand: m.brand ?? '',
    package: m.package ?? '', part_no: m.part_no ?? '', location: m.location ?? '',
    category_minor: m.category_id ? (catNameById.value.get(m.category_id) ?? '') : '',
    qty: String(m.qty ?? 0), price: String(m.price ?? 0), id: m.id,
  }
  for (const [k, v] of Object.entries(m.params ?? {})) d[`param:${k}`] = v == null ? '' : String(v)
  return d
}

/**
 * 排序基准：
 * - sortMode = 'order'：选中/导入的先后顺序（cmp 返回 0，稳定排序保持原顺序）；
 * - sortMode = 'cat'：先按分类序号（大类→小类）分组，再在同分类内保持先后顺序
 *   （便于把同一分类的物料排在相邻标签，打印后按分类整理）。
 * 两种模式下，同一分类且配了参数排序时，仍按参数值排。
 */
function cmp(a: MaterialRow, b: MaterialRow): number {
  if (sortMode.value === 'cat') {
    const ca = catOrder.value.get(a.category_id ?? '') ?? Number.MAX_SAFE_INTEGER
    const cb = catOrder.value.get(b.category_id ?? '') ?? Number.MAX_SAFE_INTEGER
    if (ca !== cb) return ca - cb
  }
  // 不同分类（或无分类）：不按分类分组，保持选中顺序
  if (!a.category_id || a.category_id !== b.category_id) return 0
  const cfg = curTpl.value?.cats.find(c => c.category_id === a.category_id)
  if (cfg?.sort_mode === 'field' && cfg.sort_field) {
    const va = a.params?.[cfg.sort_field] ?? ''
    const vb = b.params?.[cfg.sort_field] ?? ''
    const na = Number(va), nb = Number(vb)
    let r: number
    if (!isNaN(na) && !isNaN(nb) && va !== '' && vb !== '') r = na - nb
    else r = String(va).localeCompare(String(vb), 'zh')
    return cfg.sort_dir === 'desc' ? -r : r
  }
  // 同类但未配参数排序：保持选中顺序
  return 0
}

const sortedRows = computed(() => [...selectedRows.value].sort(cmp))

const perPage = computed(() => {
  const L = curTpl.value?.layout
  if (!L) return 1
  return Math.max(1, Math.round(L.cols)) * Math.max(1, Math.round(L.rows))
})

/** 按每页张数切片，每页渲染为一张纸；不足一页的格子由 LabelSheet 留空 */
const pages = computed<Array<Array<{ data: Record<string, string>; blocks: LabelBlock[] }>>>(() => {
  // 每种物料按其「打印张数」展开为对应数量的标签
  const arr: Array<{ data: Record<string, string>; blocks: LabelBlock[] }> = []
  for (const m of sortedRows.value) {
    const item = { data: materialToData(m), blocks: blocksFor(m.category_id) }
    const cnt = printCount(m.id)
    for (let k = 0; k < cnt; k++) arr.push(item)
  }
  const n = perPage.value
  const out: Array<Array<{ data: Record<string, string>; blocks: LabelBlock[] }>> = []
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n))
  if (!out.length) out.push([])
  return out
})

const totalLabels = computed(() => pages.value.reduce((s, pg) => s + pg.length, 0))
const currentPageItems = computed(() => pages.value[Math.min(pageIdx.value, pages.value.length - 1)] ?? [])

watch(pages, () => { pageIdx.value = 0 })

const canPrint = computed(() => !!curTpl.value && selectedIds.value.length > 0)

function doPrint() { window.print() }

/* ===== 导入入库单物料：选一张入库单，将其明细物料一键加入已选 =====
 * 入库单明细（stock_log）按时间正序，可能含同一物料多条；去重后按出现顺序加入，
 * 并自动切到「按分类排序」，方便把同分类物料排在相邻标签。
 */
const showOrderImport = ref(false)
const orderList = ref<StockOrder[]>([])
const orderTotal = ref(0)
const orderLoading = ref(false)
const orderKeyword = ref('')
/** 可多选：勾选多个入库单，导入时合并其明细物料 */
const orderPicked = ref<string[]>([])
/** 导入入库单进行中：按钮显示「导入中…」并禁用，防止重复触发 */
const orderImporting = ref(false)

/** 日期友好显示：YYYY-MM-DD HH:mm */
function fmtOrderDate(s?: string | null): string {
  if (!s) return ''
  const d = new Date(s)
  if (isNaN(d.getTime())) return s
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

let orderKwTimer: number | undefined
function onOrderKw() {
  window.clearTimeout(orderKwTimer)
  orderKwTimer = window.setTimeout(loadOrders, 250)
}

async function loadOrders() {
  orderLoading.value = true
  try {
    const res = await pageStockOrders({
      type: 'in', status: 'normal',
      keyword: orderKeyword.value.trim() || undefined,
      limit: 100, offset: 0,
    })
    orderList.value = res.rows
    orderTotal.value = res.total
  } catch {
    orderList.value = []
    orderTotal.value = 0
  } finally {
    orderLoading.value = false
  }
}

function openOrderImport() {
  showOrderImport.value = true
  orderKeyword.value = ''
  orderPicked.value = []
  orderList.value = []
  orderTotal.value = 0
  void loadOrders()
}

/** 多选切换：勾选 / 取消某张入库单 */
function toggleOrderPick(id: string) {
  const arr = orderPicked.value
  orderPicked.value = arr.includes(id) ? arr.filter(x => x !== id) : [...arr, id]
}

async function confirmOrderImport() {
  const picked = orderPicked.value
  if (!picked.length || orderImporting.value) return
  orderImporting.value = true
  try {
    // 跨多单累积明细，全局去重（同一物料在多个单里只取一次），保留出现顺序
    const ids: string[] = []
    for (const oid of picked) {
      const logs = await listStockLogsByOrder(oid)
      for (const l of logs) {
        const id = l.material_id
        if (id && !ids.includes(id)) ids.push(id)
      }
    }
    const set = new Set(selectedIds.value)
    let added = 0
    for (const id of ids) {
      if (!set.has(id)) { set.add(id); added++ }
    }
    selectedIds.value = [...set]
    sortMode.value = 'cat'
    showOrderImport.value = false
    // 若明细里混入了已删除物料，selectedIds 在 filteredSelected 中会自动过滤显示，
    // 这里只提示成功即可
    toast.success(`已导入 ${added} 个物料（来自 ${picked.length} 张入库单，共 ${ids.length} 项明细）`)
  } finally {
    orderImporting.value = false
  }
}

/* ===== 预览缩放：默认按预览区宽度自适应，可手动放大缩小 =====
 * LabelSheet 用 mm 单位渲染（A4 = 210mm），屏幕上 1mm ≈ 3.78px，
 * 直接显示通常超出面板，故用 transform: scale() 等比缩放；
 * stage 再按缩放后的尺寸撑开，滚动条与留白才正确。
 */
const PX_PER_MM = 96 / 25.4
const PAPER_SIZES: Record<string, [number, number]> = { A4: [210, 297], A5: [148, 210], LETTER: [216, 279] }
const ZOOM_MIN = 0.2
const ZOOM_MAX = 3
const ZOOM_STEP = 0.1
/** 预览区内边距，计算可用宽度时要扣掉 */
const VIEW_PAD = 32

const viewEl = ref<HTMLElement | null>(null)
const viewW = ref(0)
let observer: ResizeObserver | null = null

/** 纸张原始尺寸（mm） */
const paperMm = computed(() => {
  const l = curTpl.value?.layout
  if (!l) return { w: 210, h: 297 }
  if (l.paper === 'CUSTOM') return { w: l.paper_w || 210, h: l.paper_h || 297 }
  const s = PAPER_SIZES[l.paper]
  return s ? { w: s[0], h: s[1] } : { w: l.paper_w || 210, h: l.paper_h || 297 }
})
/** 纸张在屏幕上的原始像素尺寸（缩放前） */
const baseW = computed(() => paperMm.value.w * PX_PER_MM)
const baseH = computed(() => paperMm.value.h * PX_PER_MM)

const zoomMode = ref<'fit' | 'manual'>('fit')
const zoomManual = ref(1)

function clampZoom(v: number) { return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, v)) }

/** 适应宽度：按预览区可用宽度等比缩放，不产生横向滚动 */
const fitZoom = computed(() => {
  const avail = viewW.value - VIEW_PAD
  if (!(avail > 0) || !baseW.value) return 1
  return clampZoom(avail / baseW.value)
})
const effZoom = computed(() => (zoomMode.value === 'fit' ? fitZoom.value : zoomManual.value))
const zoomPct = computed(() => Math.round(effZoom.value * 100))
const stageStyle = computed(() => ({
  width: `${baseW.value * effZoom.value}px`,
  height: `${baseH.value * effZoom.value}px`,
}))

function zoomBy(d: number) {
  zoomMode.value = 'manual'
  zoomManual.value = clampZoom(Number((effZoom.value + d).toFixed(2)))
}
function resetFit() { zoomMode.value = 'fit' }

/**
 * 单项加载容错：失败时只降级这一项，返回兜底空值。
 * 直接用 Promise.all + 解构赋值的话，任一请求抛错会导致整体赋值不执行，
 * 结果是「模板 / 物料 / 分类三者一起变空」——分类凭空消失。
 */
async function settle<T>(p: Promise<T>, fallback: T, label: string): Promise<T> {
  try { return await p }
  catch (e: unknown) {
    toast.error(`${label}加载失败：${(e as Error).message || e}`)
    return fallback
  }
}

async function load() {
  loading.value = true
  try {
    const [t, m, c] = await Promise.all([
      settle(listLabelTemplates(), [] as LabelTemplate[], '标签模板'),
      settle(listMaterials({}), [] as MaterialRow[], '物料'),
      settle(listCategories(), [] as Category[], '分类'),
    ])
    templates.value = t
    allMaterials.value = m
    categories.value = c
    if (!tplId.value && templates.value.length) tplId.value = templates.value[0].id
    // 从出入库单跳转而来：?ids=id1,id2 预选该单物料（过滤已删除的）
    const pre = (route.query.ids as string) || ''
    if (pre && !selectedIds.value.length) {
      const valid = new Set(allMaterials.value.map(m => m.id))
      selectedIds.value = pre.split(',').filter(id => valid.has(id))
    }
  } finally { loading.value = false }
}

onMounted(() => {
  load()
  if (!viewEl.value) return
  // 用 border-box 宽度（不受滚动条占用影响）再扣掉内边距，得到「无滚动条时」的
  // 稳定可用宽度。否则整页按宽度缩放后高度溢出会出现竖向滚动条，滚动条吃掉内容
  // 宽度又让 fit 缩放变小、滚动条消失……如此反复，导致预览闪烁、百分数一直跳。
  observer = new ResizeObserver(entries => {
    const w = entries[0]?.target.getBoundingClientRect().width
    viewW.value = w ? w - VIEW_PAD : 0
  })
  observer.observe(viewEl.value)
})
onBeforeUnmount(() => { observer?.disconnect(); observer = null })
</script>

<style scoped>
.page {
  height: 100%;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.head {
  display: flex;
  justify-content: space-between;
  align-items: flex-end;
  gap: 16px;
  flex-wrap: wrap;
}

.head-left {
  display: flex;
  align-items: center;
  gap: 14px;
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

.head-actions {
  display: flex;
  align-items: center;
  gap: 10px;
}

.tpl-field {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.tpl-lbl,
.sel-count {
  font-size: var(--fs-sm);
  color: var(--c-text-2);
  white-space: nowrap;
}

/* ===== 主体：三栏玻璃卡片 ===== */
.lp {
  position: relative;
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: 220px 263px 1fr;
  overflow: hidden;
}

/* 进入页面加载时的居中旋转图标（与「物料库」.hint + .spinner-lg 一致），盖住空白三栏 */
.lp-loading {
  position: absolute;
  inset: 0;
  z-index: 5;
  display: grid;
  place-items: center;
  background: var(--c-bg);
}

.pane {
  display: flex;
  flex-direction: column;
  min-height: 0;
  min-width: 0;
  overflow: hidden;
  border-right: 1px solid var(--c-border-hairline);
}

.pane:last-child {
  border-right: none;
}

/* 类匹配的第一个元素 */
.pane-head:first-child {
  height: 45px;
}

.pane-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 9px 14px;
  border-bottom: 1px solid var(--c-border-hairline);
  background: var(--c-glass);
}

.pane-title {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: var(--fs-sm);
  font-weight: 600;
  color: var(--c-text);
}

.pane-count {
  font-size: var(--fs-xs);
  font-weight: 600;
  color: var(--c-text-2);
  background: var(--c-surface);
  padding: 2px 8px;
  border-radius: var(--r-pill);
}

.btn-clear {
  margin-left: auto;
}

/* 搜索框（面板内） */
.pane-search {
  padding: 10px 12px;
  border-bottom: 1px solid var(--c-border-hairline);
  display: flex;
  align-items: center;
  gap: 6px;
}

.inp-wrap {
  position: relative;
  display: flex;
}

/* 只在横向的搜索行里撑满剩余宽度；弹框内是纵向 flex，撑满会变成垂直方向的空白 */
.pane-search .inp-wrap {
  flex: 1;
  min-width: 0;
}

.inp-wrap input {
  width: 100%;
  height: var(--ctrl-h-sm);
  padding: 0 10px 0 28px;
  font-size: var(--fs-xs);
  background: var(--c-surface);
  border: 1px solid var(--c-border);
  border-radius: var(--r-sm);
}

.inp-wrap input:focus {
  border-color: var(--c-primary);
  background: var(--c-surface-hover);
}

.inp-ico {
  position: absolute;
  left: 8px;
  top: 50%;
  transform: translateY(-50%);
  color: var(--c-text-3);
  pointer-events: none;
}

/* ===== 左：分类树（已抽成公共组件 CategoryTree，样式随组件） ===== */

/* ===== 中：已选物料 ===== */
.items {
  flex: 1;
  overflow: auto;
  padding: 8px 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border: 1px solid var(--c-border-hairline);
  border-radius: var(--r-md);
  background: var(--c-glass);
}

.item-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.item-line1 {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.item-name {
  font-size: var(--fs-sm);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 型号：与选择物料弹框一致的高亮胶囊（等宽字体，便于核对） */
.item-model {
  flex-shrink: 0;
  font-family: var(--font-mono);
  font-size: var(--fs-xs);
  color: var(--c-primary);
  background: var(--c-primary-soft);
  padding: 1px 6px;
  border-radius: var(--r-sm);
  max-width: 125px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.item-sub {
  font-size: var(--fs-xs);
  color: var(--c-text-3);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 已选物料行的「打印张数」小输入框 */
.item-qty {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  gap: 3px;
}

.item-qty input {
  width: 24px;
  height: 24px;
  padding: 0 4px;
  font-size: var(--fs-xs);
  font-variant-numeric: tabular-nums;
  text-align: center;
  background: var(--c-surface);
  border: 1px solid var(--c-border);
  border-radius: var(--r-sm);
}

.item-qty input:focus {
  border-color: var(--c-primary);
  outline: none;
  background: var(--c-surface-hover);
}

/* 隐藏 number 输入的上下箭头，保持紧凑 */
.item-qty input::-webkit-outer-spin-button,
.item-qty input::-webkit-inner-spin-button {
  -webkit-appearance: none;
  margin: 0;
}

.item-qty input[type="number"] {
  -moz-appearance: textfield;
  appearance: textfield;
}

.item-qty-unit {
  font-size: var(--fs-xs);
  color: var(--c-text-3);
}

/* ===== 右：预览 ===== */
.preview {
  min-width: 0;
}

.pv-tools {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 6px;
}

.pv-page {
  min-width: 44px;
  text-align: center;
  font-size: var(--fs-xs);
  color: var(--c-text-2);
  white-space: nowrap;
}

.pv-meta,
.pv-zoom {
  font-size: var(--fs-xs);
  color: var(--c-text-2);
  white-space: nowrap;
}

.pv-zoom {
  min-width: 42px;
  text-align: right;
  font-variant-numeric: tabular-nums;
}

.pv-div {
  width: 1px;
  height: 14px;
  background: var(--c-border);
}

.fit.active {
  border-color: var(--c-primary);
  color: var(--c-primary);
}

.pv-view {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 16px;
  display: flex;
  justify-content: center;
  background: var(--c-bg-2);
}

.pv-stage {
  flex: 0 0 auto;
}

.pv-scaler {
  transform-origin: top left;
}

.pv-view :deep(.pv-paper) {
  box-shadow: var(--shadow-md);
}

/* 图标按钮（与其它页面一致的紧凑尺寸） */
.btn-icon.mini {
  width: 26px;
  height: 26px;
  min-width: 26px;
  padding: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.btn-icon.mini.danger:hover {
  color: var(--c-danger);
}

/* 已选物料面板的排序切换按钮 */
.btn-sort {
  margin-left: auto;
}

.btn-sort.on {
  border-color: var(--c-primary);
  color: var(--c-primary);
  background: var(--c-primary-soft);
}

/* 等宽字体（单号等） */
.mono {
  font-family: ui-monospace, 'SF Mono', Menlo, Consolas, monospace;
}

/* 小号旋转图标（弹框加载） */
.spinner-sm {
  width: 14px;
  height: 14px;
  border: 2px solid var(--c-border);
  border-top-color: var(--c-primary);
  border-radius: 50%;
  animation: spin 0.6s linear infinite;
  display: inline-block;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

/* ===== 导入入库单弹框 ===== */
.oi-mask {
  position: fixed;
  inset: 0;
  z-index: 120;
  background: rgba(0, 0, 0, 0.55);
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}

.oi-card {
  position: relative;
  width: min(520px, 94vw);
  max-height: min(76vh, 680px);
  background: var(--c-elevated);
  border: 1px solid var(--c-border);
  border-radius: var(--r-2xl);
  box-shadow: var(--shadow-lg);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  animation: oi-in 220ms cubic-bezier(0.34, 1.56, 0.64, 1);
}

@keyframes oi-in {
  from { opacity: 0; transform: translateY(12px) scale(0.98); }
  to { opacity: 1; transform: none; }
}

.oi-x {
  position: absolute;
  top: 12px;
  right: 12px;
  width: 26px;
  height: 26px;
  border: none;
  background: transparent;
  color: var(--c-text-3);
  cursor: pointer;
  border-radius: var(--r-sm);
  display: grid;
  place-items: center;
  transition: all var(--motion);
  z-index: 1;
}

.oi-x:hover {
  background: var(--c-glass);
  color: var(--c-text);
}

.oi-head {
  display: flex;
  gap: 10px;
  align-items: flex-start;
  padding: 16px 48px 4px 16px;
}

.oi-ico {
  width: 36px;
  height: 36px;
  flex-shrink: 0;
  display: grid;
  place-items: center;
  border-radius: var(--r-md);
  background: var(--c-primary-soft);
  color: var(--c-primary);
}

.oi-head-txt { min-width: 0; }

.oi-head-txt h3 {
  margin: 0 0 3px;
  font-size: var(--fs-md);
  font-weight: 600;
  line-height: 1.4;
}

.oi-head-txt p {
  margin: 0;
  font-size: var(--fs-sm);
  color: var(--c-text-2);
  line-height: 1.5;
}

.oi-search {
  padding: 8px 16px 10px;
}

.oi-search .inp-wrap {
  position: relative;
  display: flex;
}

.oi-search input {
  width: 100%;
  height: var(--ctrl-h-sm);
  padding: 0 10px 0 28px;
  font-size: var(--fs-xs);
  background: var(--c-surface);
  border: 1px solid var(--c-border);
  border-radius: var(--r-sm);
}

.oi-search input:focus {
  border-color: var(--c-primary);
  background: var(--c-surface-hover);
}

.oi-search .inp-ico {
  position: absolute;
  left: 8px;
  top: 50%;
  transform: translateY(-50%);
  color: var(--c-text-3);
  pointer-events: none;
}

.oi-list {
  margin-top: 4px;
  padding: 0 16px 4px;
  overflow: auto;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.oi-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 12px;
  border: 1px solid var(--c-border);
  border-radius: var(--r-md);
  background: var(--c-glass);
  cursor: pointer;
  transition: all var(--motion);
}

.oi-item:hover { border-color: var(--c-primary); }

.oi-item.on {
  border-color: var(--c-primary);
  background: var(--c-primary-soft);
}

.oi-main {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.oi-line {
  display: flex;
  align-items: baseline;
  gap: 8px;
  min-width: 0;
}

.oi-no {
  flex-shrink: 0;
  font-size: 11px;
  color: var(--c-text-3);
}

.oi-title {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 500;
}

.oi-sub {
  font-size: 11px;
  line-height: 1.4;
  color: var(--c-text-2);
}

.oi-check {
  flex-shrink: 0;
  width: 18px;
  height: 18px;
  display: grid;
  place-items: center;
  border-radius: var(--r-sm);
  border: 2px solid var(--c-border-strong);
  color: #fff;
  background: var(--c-surface);
  transition: all var(--motion);
}

.oi-check.on {
  border-color: var(--c-primary);
  background: var(--c-primary);
}

.oi-busy {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--c-text-2);
  font-size: var(--fs-sm);
  padding: 8px 4px;
}

.oi-foot {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 16px 14px;
  border-top: 1px solid var(--c-border);
  margin-top: 8px;
}

.oi-grow { flex: 1; }

.oi-meta {
  font-size: var(--fs-xs);
  color: var(--c-text-3);
}
</style>
