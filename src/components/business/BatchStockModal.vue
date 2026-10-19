<script setup lang="ts">
// 批量出入库弹窗：选料交互与「标签打印」一致 ——
//   左：分类树（CategoryTree 多选），复选框 = 整类全选 / 取消；点分类名 = 打开
//       MaterialPickDialog 按物料逐个勾选；
//   右：已选物料列表，逐个填写数量，可单个移除 / 清空；
//   底部：供应商（入库）/ 用途（出库）+ 备注。
// 一次提交 = 一张出入库单（stockInOrder，source=manual），任一明细库存不足整单失败。
import { ref, computed, watch } from 'vue'
import { Inbox, ArrowUpFromDot, Package, Tags, X } from 'lucide-vue-next'
import Segmented from '../form/Segmented.vue'
import AppSelect from '../form/AppSelect.vue'
import CategoryTree from './CategoryTree.vue'
import MaterialPickDialog from '../label/MaterialPickDialog.vue'
import EmptyState from '../EmptyState.vue'
import {
  stockInOrder, listSuppliers, listDictItems, listMaterials, listCategories, buildCategoryTree,
} from '../../lib/db'
import type { CategoryNode } from '../../lib/db'
import type { MaterialRow, SupplierRow, Category } from '../../lib/types'
import { materialSpecLine } from '../../lib/paramFields'
import { useToast } from '../../composables/toast'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{
  /** 提交成功：父页面刷新当前 tab 与共享物料列表 */
  done: []
  close: []
}>()

const toast = useToast()

const type = ref<'in' | 'out'>('in')
const note = ref('')
const supplierId = ref<string | null>(null)
const purpose = ref<string | null>(null)
const busy = ref(false)

// 供应商 / 出库用途字典（设置 → 基础数据维护），首次打开时加载
const suppliers = ref<SupplierRow[]>([])
let suppliersLoaded = false
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

/* ===== 基础数据（物料 + 分类），首次打开加载一次 ===== */
const allMaterials = ref<MaterialRow[]>([])
const categories = ref<Category[]>([])
const dataLoading = ref(false)
let dataLoaded = false

async function loadData() {
  if (dataLoaded) return
  dataLoading.value = true
  try {
    const [ms, cs] = await Promise.all([listMaterials({}), listCategories()])
    allMaterials.value = ms
    categories.value = cs
    dataLoaded = true
  } catch (e: unknown) {
    toast.error('加载物料失败：' + ((e as Error).message || e))
  } finally { dataLoading.value = false }
}

/** 打开即重置表单，并惰性加载字典与基础数据 */
watch(() => props.open, async (v) => {
  if (!v) return
  type.value = 'in'
  note.value = ''
  supplierId.value = null
  purpose.value = null
  selectedIds.value = []
  pickerNode.value = null
  loadData()
  if (!suppliersLoaded) {
    try { suppliers.value = await listSuppliers(); suppliersLoaded = true } catch { /* 静默 */ }
  }
  if (!purposesLoaded) {
    try { purposes.value = (await listDictItems('out_purpose')).map(i => i.label); purposesLoaded = true } catch { /* 静默 */ }
  }
})

/* ===== 选料（与标签打印同一套交互） ===== */
/** 已选物料 id（按选中先后排序） */
const selectedIds = ref<string[]>([])
/** 物料 id → 数量（随选中增删同步，新选默认 1） */
const qtyMap = ref<Record<string, number>>({})

const tree = computed<CategoryNode[]>(() => buildCategoryTree(categories.value))

/** 分类 id → 名称（小类显示「大类 · 小类」） */
const catPathMap = computed<Record<string, string>>(() => {
  const m: Record<string, string> = {}
  for (const n of tree.value) {
    m[n.cat.id] = n.cat.name
    for (const c of n.children) m[c.cat.id] = `${n.cat.name} · ${c.cat.name}`
  }
  return m
})

/** 分类 id → 物料 id 列表 */
const materialsByCat = computed<Map<string, string[]>>(() => {
  const m = new Map<string, string[]>()
  for (const mat of allMaterials.value) {
    if (!mat.category_id) continue
    const arr = m.get(mat.category_id) ?? []
    arr.push(mat.id)
    m.set(mat.category_id, arr)
  }
  return m
})

/** 分类 id → 该分类自身物料数（大类由树组件自动累加子级） */
const catCounts = computed<Record<string, number>>(() => {
  const out: Record<string, number> = {}
  for (const [id, ids] of materialsByCat.value) out[id] = ids.length
  return out
})

/** 节点（含子级）下所有物料 id */
function descendantIds(node: CategoryNode): string[] {
  const ids = [node.cat.id, ...node.children.map(c => c.cat.id)]
  return ids.flatMap(id => materialsByCat.value.get(id) ?? [])
}

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
  const s = new Set(selectedIds.value)
  if (on) ids.forEach(id => s.add(id))
  else ids.forEach(id => s.delete(id))
  selectedIds.value = [...s]
}

/* ===== 分类物料弹框：点树上分类名打开，可搜索并逐项勾选 ===== */
const pickerNode = ref<CategoryNode | null>(null)
const pickerCatIds = computed(() =>
  pickerNode.value ? [pickerNode.value.cat.id, ...pickerNode.value.children.map(c => c.cat.id)] : [])
function openPicker(node: CategoryNode) { pickerNode.value = node }
function closePicker() { pickerNode.value = null }

/** 已选物料行（按选中先后排序），随勾选联动数量 */
const rows = computed<MaterialRow[]>(() => {
  const idx = new Map(selectedIds.value.map((id, i) => [id, i]))
  const set = new Set(selectedIds.value)
  return allMaterials.value
    .filter(m => set.has(m.id))
    .sort((a, b) => (idx.get(a.id) ?? 0) - (idx.get(b.id) ?? 0))
})

/** 选中集合变化时同步数量表：新选默认 1，移除即清理 */
watch(selectedIds, ids => {
  const next: Record<string, number> = {}
  for (const id of ids) next[id] = Math.floor(Number(qtyMap.value[id])) || 1
  qtyMap.value = next
})

const totalQty = computed(() =>
  rows.value.reduce((s, m) => s + (Math.floor(Number(qtyMap.value[m.id])) || 0), 0))

/** 副行小字：当前库存 + 扩展参数摘要（与标签打印共用文案） */
function itemSub(m: MaterialRow): string {
  const spec = materialSpecLine(m)
  return spec ? `库存 ${m.qty} · ${spec}` : `库存 ${m.qty}`
}

function removeSelected(id: string) {
  selectedIds.value = selectedIds.value.filter(x => x !== id)
}
function clearSelected() { selectedIds.value = [] }

/** 出库时把用途并入备注（用途优先，手动备注跟在后面），与 QuickStockModal 一致 */
const finalNote = computed(() => type.value === 'out'
  ? [purpose.value, note.value.trim()].filter(Boolean).join('：') || null
  : (note.value.trim() || null))

async function submit() {
  if (!rows.value.length) { toast.error('请先选择物料'); return }
  const items = rows.value.map(m => ({
    material_id: m.id,
    qty: Math.floor(Number(qtyMap.value[m.id])) || 0,
    note: finalNote.value,
  }))
  for (let i = 0; i < items.length; i++) {
    if (items[i].qty <= 0) { toast.error(`「${rows.value[i].name}」数量需为正整数`); return }
  }
  busy.value = true
  try {
    await stockInOrder({
      type: type.value, source: 'manual', source_id: null,
      title: `批量${type.value === 'in' ? '入库' : '出库'} · ${items.length} 项`,
      supplier_id: type.value === 'in' ? supplierId.value : null,
      note: finalNote.value,
      items,
    })
    toast.success(`批量${type.value === 'in' ? '入库' : '出库'} ${items.length} 项物料，共 ${totalQty.value}`)
    emit('done')
    emit('close')
  } catch (e: unknown) {
    toast.error('操作失败：' + ((e as Error).message || e))
  } finally { busy.value = false }
}
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="modal-mask" @click.self="emit('close')">
      <div class="modal" style="max-width: 1040px; width: 94vw; height: min(720px, 88vh)">
        <div class="modal-head">
          <h3>批量出入库</h3>
          <p class="bs-sub">勾选分类整类加入，或点分类名逐个挑选；右侧填写数量后一次提交（生成一张出入库单）</p>
        </div>
        <div class="modal-body bs-body">
          <Segmented v-model="type" full
            :options="[
              { value: 'in', label: '入库', icon: Inbox },
              { value: 'out', label: '出库', icon: ArrowUpFromDot },
            ]" />
          <div class="bs-split">
            <!-- 左：分类树（复选框整类全选 / 点名称打开物料弹框） -->
            <section class="pane">
              <div class="pane-head">
                <span class="pane-title"><Tags :size="14" style="display: inline-flex" />分类</span>
                <span class="pane-count">{{ tree.length }}</span>
              </div>
              <div v-if="dataLoading" class="bs-loading"><span class="spinner-sm" />加载中…</div>
              <CategoryTree v-else :nodes="tree" :counts="catCounts" checkable searchable
                :is-checked="catChecked" :is-indeterminate="catIndeterminate"
                :name-title="(n) => `选择「${n.cat.name}」下的物料`"
                @pick="openPicker" @check="toggleCat">
                <template #empty>暂无分类</template>
              </CategoryTree>
            </section>

            <!-- 右：已选物料 + 数量 -->
            <section class="pane">
              <div class="pane-head">
                <span class="pane-title"><Package :size="14" style="display: inline-flex" />已选物料</span>
                <span class="pane-count">{{ selectedIds.length }} 项 · 合计 {{ totalQty }}</span>
                <button class="btn btn-ghost btn-sm btn-clear" :disabled="!selectedIds.length"
                  @click="clearSelected">清空</button>
              </div>
              <div class="items">
                <div v-for="m in rows" :key="m.id" class="item">
                  <div class="item-main">
                    <div class="item-line1">
                      <span class="item-name">{{ m.name }}</span>
                      <span v-if="m.model" class="item-model">{{ m.model }}</span>
                    </div>
                    <span class="item-sub" :title="itemSub(m)">{{ itemSub(m) }}</span>
                  </div>
                  <input v-model.number="qtyMap[m.id]" class="bs-qty" type="number" min="1"
                    :title="type === 'out' ? '出库数量' : '入库数量'" />
                  <button class="btn btn-icon mini danger" title="移除" @click="removeSelected(m.id)">
                    <X :size="13" style="display: inline-flex; flex-shrink: 0" />
                  </button>
                </div>
                <EmptyState v-if="!rows.length" :icon="Package" title="还没有选中物料"
                  description="在左侧勾选分类即可批量加入" />
              </div>
            </section>
          </div>
          <!-- 底部：供应商（入库）/ 用途（出库）+ 备注 -->
          <div class="bs-fields">
            <!-- AppSelect 不用 label 包裹（避免二次点击触发下拉反复弹出） -->
            <div class="field" v-if="type === 'in'">
              <label>供应商</label>
              <AppSelect v-model="supplierId" :options="supplierOptions" :min-width="0" />
            </div>
            <div class="field" v-else>
              <label>用途</label>
              <AppSelect v-model="purpose" :options="purposeOptions" :min-width="0" />
            </div>
            <label class="field">
              <label>备注</label>
              <input v-model="note" :placeholder="type === 'in' ? '如 采购到货' : '如 焊接消耗'"
                @keyup.enter="submit" />
            </label>
          </div>
        </div>
        <div class="modal-foot">
          <button class="btn btn-ghost" @click="emit('close')">取消</button>
          <button class="btn" :class="type === 'in' ? 'btn-primary' : 'btn-danger'" :disabled="busy" @click="submit">
            <span v-if="busy" class="spinner-sm" />
            {{ busy ? '处理中…' : `确认${type === 'in' ? '入库' : '出库'} · ${selectedIds.length} 项` }}
          </button>
        </div>
      </div>

      <!-- 分类物料弹框：点树上分类名打开（与标签打印共用组件） -->
      <MaterialPickDialog v-if="pickerNode" :cat-name="pickerNode.cat.name" :cat-ids="pickerCatIds"
        :materials="allMaterials" :cat-labels="catPathMap" v-model:selected-ids="selectedIds"
        @close="closePicker" />
    </div>
  </Teleport>
</template>

<style scoped>
.bs-sub {
  margin: 4px 0 0;
  font-size: var(--fs-sm);
  color: var(--c-text-2);
}

.bs-body {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

/* 左树 / 右已选 两栏（行高锁定，防内容撑开） */
.bs-split {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: 250px minmax(0, 1fr);
  grid-template-rows: minmax(0, 1fr);
  border: 1px solid var(--c-border-hairline);
  border-radius: var(--r-md);
  overflow: hidden;
}

.pane {
  display: flex;
  flex-direction: column;
  min-height: 0;
  min-width: 0;
}

.pane + .pane {
  border-left: 1px solid var(--c-border-hairline);
}

.pane-head {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 9px 12px;
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

.bs-loading {
  padding: 24px 0;
  text-align: center;
  font-size: var(--fs-xs);
  color: var(--c-text-3);
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
}

/* ===== 右：已选物料 ===== */
.items {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 8px 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.item {
  display: flex;
  align-items: center;
  gap: 10px;
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
  gap: 2px;
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

/* 型号：与标签打印一致的高亮胶囊（等宽字体，便于核对） */
.item-model {
  flex-shrink: 0;
  font-family: var(--font-mono);
  font-size: var(--fs-xs);
  color: var(--c-primary);
  background: var(--c-primary-soft);
  padding: 1px 6px;
  border-radius: var(--r-sm);
  max-width: 160px;
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

.bs-qty {
  width: 84px;
  height: var(--ctrl-h-sm);
  padding: 0 8px;
  font-size: var(--fs-sm);
  background: var(--c-surface);
  border: 1px solid var(--c-border);
  border-radius: var(--r-sm);
  color: var(--c-text);
  text-align: right;
  font-family: inherit;
  transition: border-color var(--motion);
  flex-shrink: 0;
}

.bs-qty:focus {
  outline: none;
  border-color: var(--c-primary);
  box-shadow: 0 0 0 3px var(--c-primary-glow);
}

/* 图标按钮（与标签打印一致的紧凑尺寸） */
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

/* ===== 底部：供应商 / 用途 + 备注 ===== */
.bs-fields {
  flex-shrink: 0;
  display: grid;
  grid-template-columns: minmax(0, 2fr) minmax(0, 3fr);
  gap: 10px;
}

.bs-fields .field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}

.bs-fields .field > label {
  font-size: var(--fs-xs);
  color: var(--c-text-2);
  font-weight: 500;
}

.bs-fields .field input {
  height: var(--ctrl-h);
  padding: 0 var(--ctrl-px);
  font-size: var(--fs-sm);
  background: var(--c-surface);
  border: 1px solid var(--c-border);
  border-radius: var(--r-md);
  color: var(--c-text);
  font-family: inherit;
  transition: border-color var(--motion);
}

.bs-fields .field input:focus {
  outline: none;
  border-color: var(--c-primary);
  box-shadow: 0 0 0 3px var(--c-primary-glow);
}
</style>
