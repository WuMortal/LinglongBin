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
        <div class="pane-search">
          <div class="inp-wrap">
            <Search :size="13" class="inp-ico" style="display: inline-flex" />
            <input v-model="treeSearch" placeholder="搜索分类…" />
          </div>
          <button class="btn btn-icon mini" title="全部展开" @click="expandAll">
            <ChevronsUpDown :size="13" style="display: inline-flex; flex-shrink: 0" />
          </button>
          <button class="btn btn-icon mini" title="全部折叠" @click="collapseAll">
            <ChevronsDownUp :size="13" style="display: inline-flex; flex-shrink: 0" />
          </button>
        </div>
        <div class="tree">
          <div v-for="node in filteredTree" :key="node.cat.id" class="tn">
            <div class="tn-row">
              <button v-if="node.children.length" class="tn-caret" :title="isOpen(node.cat.id) ? '折叠' : '展开'"
                @click="toggleNode(node.cat.id)">
                <ChevronRight :size="12" class="caret" :class="{ open: isOpen(node.cat.id) }"
                  style="display: inline-flex" />
              </button>
              <span v-else class="tn-caret tn-caret--empty"></span>
              <input class="tn-check" type="checkbox" :checked="catChecked(node)"
                :indeterminate="catIndeterminate(node)" title="全选 / 取消该分类"
                @change="toggleCat(node, ($event.target as HTMLInputElement).checked)" />
              <button class="tn-name" :title="`查看并勾选「${node.cat.name}」下的物料`" @click="openPicker(node)">{{ node.cat.name
                }}</button>
              <span class="tn-count" :class="{ zero: matCount(node) === 0 }" :title="`${matCount(node)} 个物料`">{{ matCount(node) }}</span>
            </div>
            <div v-if="node.children.length && isOpen(node.cat.id)" class="tn-kids">
              <div v-for="c in node.children" :key="c.cat.id" class="tn-row child">
                <input class="tn-check" type="checkbox" :checked="catChecked(c)" :indeterminate="catIndeterminate(c)"
                  title="全选 / 取消该分类" @change="toggleCat(c, ($event.target as HTMLInputElement).checked)" />
                <button class="tn-name" :title="`查看并勾选「${c.cat.name}」下的物料`" @click="openPicker(c)">{{ c.cat.name
                  }}</button>
                <span class="tn-count" :class="{ zero: matCount(c) === 0 }" :title="`${matCount(c)} 个物料`">{{ matCount(c) }}</span>
              </div>
            </div>
          </div>
          <p v-if="!filteredTree.length" class="pane-empty">该模板没有可用分类</p>
        </div>
      </section>

      <!-- 中：已选物料 -->
      <section class="pane">
        <div class="pane-head">
          <span class="pane-title">
            <Package :size="14" style="display: inline-flex" />已选物料
          </span>
          <span class="pane-count">{{ selectedIds.length }}</span>
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
import {
  ChevronLeft, ChevronRight, ChevronsDownUp, ChevronsUpDown, Package, Printer, Search, Tags, X, ZoomIn, ZoomOut,
} from 'lucide-vue-next'
import {
  listLabelTemplates, listMaterials, listCategories, getMaterialsByIds, buildCategoryTree,
} from '../../lib/db'
import type { Category, LabelBlock, LabelTemplate, MaterialRow } from '../../lib/types'
import type { CategoryNode } from '../../lib/db'
import { materialSpecLine } from '../../lib/paramFields'
import LabelSheet from '../../components/label/LabelSheet.vue'
import MaterialPickDialog from '../../components/label/MaterialPickDialog.vue'
import AppSelect from '../../components/form/AppSelect.vue'
import PageBackButton from '../../components/PageBackButton.vue'
import EmptyState from '../../components/EmptyState.vue'

const templates = ref<LabelTemplate[]>([])
const allMaterials = ref<MaterialRow[]>([])
const categories = ref<Category[]>([])
const tplId = ref<string>('')
const selectedIds = ref<string[]>([])
const treeSearch = ref('')
const listSearch = ref('')
const pageIdx = ref(0)
/** 进入页面时拉取模板/物料/分类，初始即遮罩，避免一片空白 */
const loading = ref(true)

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
    .map(n => ({ ...n, children: n.children.filter(c => usableCatIds.value.has(c.cat.id)) }))
    .filter(n => n.children.length)
})

const filteredTree = computed(() => {
  const q = treeSearch.value.trim().toLowerCase()
  if (!q) return tree.value
  return tree.value.map(n => {
    const kids = n.children.filter(c => c.cat.name.toLowerCase().includes(q))
    if (n.cat.name.toLowerCase().includes(q)) return n
    return { ...n, children: kids }
  }).filter(n => n.children.length || n.cat.name.toLowerCase().includes(q))
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

/** 该分类子树下的物料数量（与复选框整类勾选范围一致），用于树上的数量徽标 */
function matCount(node: CategoryNode): number {
  return descendantIds(node).length
}

/** 折叠的大类 id；默认全部折叠（分类数据到位后按树初始化，见下方 watch） */
const collapsedIds = ref<Set<string>>(new Set())

/** 搜索时强制展开，否则命中的小类会被折叠住看不见 */
function isOpen(id: string): boolean {
  if (treeSearch.value.trim()) return true
  return !collapsedIds.value.has(id)
}
function toggleNode(id: string) {
  const s = new Set(collapsedIds.value)
  if (s.has(id)) s.delete(id)
  else s.add(id)
  collapsedIds.value = s
}

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

function expandAll() {
  collapsedIds.value = new Set()
}
function collapseAll() {
  // 搜索时 isOpen 会强制展开，不清空搜索词的话「全部折叠」看不出效果
  treeSearch.value = ''
  collapsedIds.value = new Set(tree.value.filter(n => n.children.length).map(n => n.cat.id))
}

/*
 * 默认全部折叠：分类是异步加载的，所以等 tree 有数据了再按「有子级的大类」初始化折叠集合；
 * 切换模板时重新折叠一次，换模板后仍是从折叠态开始。
 */
let pendingCollapse = true
watch(() => curTpl.value?.id, () => { pendingCollapse = true })
watch(tree, (t) => {
  if (!pendingCollapse || !t.length) return
  pendingCollapse = false
  collapsedIds.value = new Set(t.filter(n => n.children.length).map(n => n.cat.id))
}, { immediate: true })

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
}

/** 副行：品牌 + 前 3 个扩展字段（与选择物料弹框共用同一套文案），不再显示库存 */
function itemSub(m: MaterialRow): string { return materialSpecLine(m) }
function clearSelected() {
  selectedIds.value = []
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

/** 分类序号：按树顺序给每个分类一个排序权重（大类→小类）
 * 【已停用】现在按「选中的先后顺序」排，不再按分类分组；保留备查，
 * 需要恢复时把这个定义和 cmp 里注掉的那两行一起放开即可。
 */
// const catOrder = computed(() => {
//   const order: string[] = []
//   for (const n of buildCategoryTree(categories.value)) {
//     order.push(n.cat.id)
//     for (const c of n.children) order.push(c.cat.id)
//   }
//   return new Map(order.map((id, i) => [id, i]))
// })

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
 * 排序基准是「选中的先后顺序」：cmp 返回 0 时由稳定排序保持原顺序
 * （selectedRows 已按 selectedIds 排好，Array.sort 自 ES2019 起稳定）。
 * 只有同一分类、且该分类配了参数排序时，才按参数值排。
 * 【已注释】原来「先按分类序号（大类→小类）分组」的三行：
 *   const ca = catOrder.value.get(a.category_id ?? '') ?? 0
 *   const cb = catOrder.value.get(b.category_id ?? '') ?? 0
 *   if (ca !== cb) return ca - cb
 */
function cmp(a: MaterialRow, b: MaterialRow): number {
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
  // （原来按名称兜底：return (a.name ?? '').localeCompare(b.name ?? '', 'zh')）
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
  const arr = sortedRows.value.map(m => ({ data: materialToData(m), blocks: blocksFor(m.category_id) }))
  const n = perPage.value
  const out: Array<Array<{ data: Record<string, string>; blocks: LabelBlock[] }>> = []
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n))
  if (!out.length) out.push([])
  return out
})

const totalLabels = computed(() => sortedRows.value.length)
const currentPageItems = computed(() => pages.value[Math.min(pageIdx.value, pages.value.length - 1)] ?? [])

watch(pages, () => { pageIdx.value = 0 })

const canPrint = computed(() => !!curTpl.value && selectedIds.value.length > 0)

function doPrint() { window.print() }

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

async function load() {
  loading.value = true
  try {
    ;[templates.value, allMaterials.value, categories.value] = await Promise.all([
      listLabelTemplates(),
      listMaterials({}),
      listCategories(),
    ])
    if (!tplId.value && templates.value.length) tplId.value = templates.value[0].id
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
  grid-template-columns: 220px 260px 1fr;
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

/* ===== 左：分类树 ===== */
.tree {
  flex: 1;
  overflow: auto;
  padding: 8px 10px 12px;
}

.tn-row {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 3px 6px;
  border-radius: var(--r-sm);
  font-size: var(--fs-sm);
  transition: background var(--motion);
}

.tn-row:hover {
  background: var(--c-surface-hover);
}

/* 折叠箭头；无子级时用占位保持缩进对齐 */
.tn-caret {
  width: 18px;
  height: 18px;
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--r-xs);
  color: var(--c-text-3);
  transition: background var(--motion), color var(--motion);
}

.tn-caret:hover {
  background: var(--c-surface-active);
  color: var(--c-text);
}

.tn-caret--empty {
  visibility: hidden;
}

.caret {
  transition: transform var(--motion);
}

.caret.open {
  transform: rotate(90deg);
}

/* 复选框只管「整类全选 / 取消」 */
.tn-check {
  width: 14px;
  height: 14px;
  accent-color: var(--c-primary);
  cursor: pointer;
  flex-shrink: 0;
}

/* 点分类名 = 打开该分类的物料选择弹框 */
.tn-name {
  flex: 1;
  min-width: 0;
  text-align: left;
  font-size: var(--fs-sm);
  padding: 2px 3px;
  border-radius: var(--r-xs);
  background: transparent;
  color: inherit;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  cursor: pointer;
  transition: color var(--motion-fast), background var(--motion-fast);
}

.tn-name:hover {
  color: var(--c-primary);
  background: var(--c-surface);
}

/* 分类行尾的物料数量徽标：0 个（无物料）时高亮，便于一眼看出哪些分类是空的 */
.tn-count {
  flex-shrink: 0;
  margin-left: auto;
  padding: 0 7px;
  height: 18px;
  display: inline-flex;
  align-items: center;
  font-size: var(--fs-xs);
  font-variant-numeric: tabular-nums;
  color: var(--c-text-2);
  background: var(--c-surface);
  border-radius: var(--r-pill);
}

.tn-count.zero {
  color: var(--c-danger);
  background: color-mix(in srgb, var(--c-danger) 12%, transparent);
}

.tn-kids {
  margin-left: 15px;
  padding-left: 6px;
  border-left: 1px dashed var(--c-border);
}

.tn-row.child {
  color: var(--c-text-2);
  padding-left: 2px;
}

.tn-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pane-empty {
  margin: 20px 0;
  text-align: center;
  color: var(--c-text-3);
  font-size: var(--fs-sm);
}

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
</style>
