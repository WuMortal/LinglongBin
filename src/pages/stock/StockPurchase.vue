<template>
  <section class="tab po-wrap">
    <!-- 顶部工具条 -->
    <div class="po-bar">
      <button class="btn btn-primary po-btn" @click="openCreate">
        <Plus :size="14" style="display: inline-flex; flex-shrink: 0" />新建待采单
      </button>
      <Segmented v-model="poStatus" :options="[
        { value: 'all', label: '全部' },
        { value: 'pending', label: '采购中' },
        { value: 'done', label: '已完成' },
      ]" />
      <div class="po-bar-right">
        <span class="stat"><span class="dot warn" />采购中 {{ pendingOrders }}</span>
        <span class="stat ok"><span class="dot" />已完成 {{ doneOrders }}</span>
      </div>
    </div>

    <div v-if="poLoading" class="hint">
      <span class="spinner-sm" />加载中…
    </div>

    <!-- 待采单列表 -->
    <DataTable v-else-if="poRows.length" :columns="poCols" :rows="poRows" row-key="id" @row-click="openPo">
      <template #cell-name="{ row }">
        <div class="po-name">
          <strong>{{ row.name }}</strong>
          <small v-if="row.note" class="po-reason" :title="row.note">{{ row.note }}</small>
        </div>
      </template>
      <template #cell-status="{ row }">
        <span class="pill" :class="row.status === 'done' ? 'ok' : 'warn'">
          {{ row.status === 'done' ? '已完成' : '采购中' }}
        </span>
      </template>
      <template #cell-progress="{ row }">
        <div class="po-prog">
          <span class="pill warn">待采购 {{ row.pending }}</span>
          <span class="pill ok">已采购 {{ row.done }}</span>
        </div>
      </template>
      <template #cell-total="{ row }">
        <span class="qty-cell">{{ row.total }}</span>
      </template>
      <template #cell-created="{ row }">
        <span class="po-time">{{ fmt(row.created_at) }}</span>
      </template>
      <template #cell-ops="{ row }">
        <div class="ops">
          <button v-if="row.status !== 'done'" class="btn btn-ghost mini ok" title="入库并结束本单"
            @click.stop="completeOrder(row)">完成采购</button>
          <button class="btn btn-ghost mini" @click.stop="openPo(row)">{{ row.status === 'done' ? '查看' : '编辑' }}</button>
          <button v-if="row.status !== 'done'" class="btn btn-ghost mini danger" @click.stop="deletePo(row)">删除</button>
        </div>
      </template>
    </DataTable>

    <EmptyState v-else-if="!poLoading" :icon="ClipboardList" title="暂无待采单"
      description="点「新建待采单」创建；导入 BOM 时勾选缺料行也会自动生成" />

    <Pager v-if="poTotal > 0" :page="poPage" :page-size="poPageSize" :total="poTotal"
      @change="onPoPage" @update:page-size="onPoSize" />

    <!-- 新建 / 编辑 / 详情：同一个抽屉 -->
    <Teleport to="body">
      <Transition name="po-fade">
        <div v-if="drawerOpen" class="po-mask" @click.self="closeDrawer">
          <aside class="po-drawer">
            <header class="pd-head">
              <h3>{{ drawerTitle }}</h3>
              <button class="pd-close" title="关闭" @click="closeDrawer">
                <X :size="16" style="display: inline-flex; flex-shrink: 0" />
              </button>
            </header>

            <div class="pd-body">
              <!-- 采购基本信息 -->
              <div class="pd-section">
                <span class="pd-label">采购基本信息</span>
                <div class="pd-field">
                  <label>名称<span class="req">*</span></label>
                  <input v-model="form.name" :class="{ bad: nameErr }" :disabled="readonly"
                    placeholder="待采单名称（必填）" />
                </div>
                <div class="pd-field">
                  <label>采购原因</label>
                  <textarea v-model="form.reason" :disabled="readonly" rows="2" placeholder="为什么采购（选填）" />
                </div>
              </div>

              <!-- 采购明细 -->
              <div class="pd-section">
                <div class="pd-sec-head">
                  <span class="pd-label">采购明细</span>
                  <button v-if="!readonly" class="btn btn-ghost mini" @click="addRow">
                    <Plus :size="13" style="display: inline-flex; flex-shrink: 0" />添加物料
                  </button>
                </div>

                <table v-if="rows.length" class="pd-table">
                  <thead>
                    <tr>
                      <th class="c-item">待采商品</th>
                      <th class="c-qty">数量</th>
                      <th class="c-stock">库存</th>
                      <th class="c-note">备注</th>
                      <th class="c-status">状态</th>
                      <th v-if="!readonly" class="c-ops"></th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="(r, i) in rows" :key="r.key" :class="{ 'is-bad': !!errMsg(r) }">
                      <td class="c-item">
                        <button v-if="!readonly" class="pick-btn"
                          :class="{ empty: !r.material_id, bad: !!itemErr(r) }" :title="itemErr(r)"
                          @click="pickRow(r)">
                          <Search v-if="!r.material_id" :size="13" style="display: inline-flex; flex-shrink: 0" />
                          <span class="pick-txt">{{ r.material_id ? r.name : '选择商品' }}</span>
                        </button>
                        <span v-else class="ro-item">{{ r.name || '—' }}</span>
                        <small v-if="r.model" class="row-sub mono">{{ r.model }}</small>
                      </td>
                      <td class="c-qty">
                        <input v-if="!readonly" class="qty-in" :class="{ bad: !!qtyErr(r) }" :title="qtyErr(r)"
                          type="number" min="1" step="1" :value="r.qty ?? ''" @input="onQty(r, $event)" />
                        <span v-else>{{ r.qty ?? '—' }}</span>
                      </td>
                      <td class="c-stock"><span class="qty-cell">{{ r.stock_qty ?? '—' }}</span></td>
                      <td class="c-note">
                        <input v-if="!readonly" class="note-in" v-model="r.note" placeholder="选填" />
                        <span v-else>{{ r.note || '—' }}</span>
                      </td>
                      <td class="c-status">
                        <button v-if="!readonly" class="pill mini-pill" :class="r.done ? 'ok' : 'warn'"
                          @click="toggleRowDone(r)">
                          {{ r.done ? '已采购' : '待采购' }}
                        </button>
                        <span v-else class="pill" :class="r.done ? 'ok' : 'warn'">
                          {{ r.done ? '已采购' : '待采购' }}
                        </span>
                      </td>
                      <td v-if="!readonly" class="c-ops">
                        <button class="btn btn-icon mini" title="移除" @click="removeRow(r)">
                          <Trash2 :size="13" style="display: inline-flex; flex-shrink: 0" />
                        </button>
                      </td>
                    </tr>
                  </tbody>
                </table>
                <p v-else class="pd-empty">还没有明细，点「添加物料」加入需要采购的商品</p>
                <p v-if="errText" class="pd-err">{{ errText }}</p>
              </div>
            </div>

            <footer class="pd-foot">
              <button class="btn btn-ghost" @click="closeDrawer">{{ readonly ? '关闭' : '取消' }}</button>
              <button v-if="mode === 'edit'" class="btn btn-primary" :disabled="busy || dirty"
                :title="dirty ? '有未保存的修改，请先保存' : '入库并结束本单'" @click="onCompleteFromDrawer">
                完成采购
              </button>
              <button v-if="!readonly" class="btn btn-primary" :disabled="saving" @click="saveOrder">
                {{ saving ? '保存中…' : '保存' }}
              </button>
            </footer>
          </aside>
        </div>
      </Transition>
    </Teleport>

    <!-- 选择待采商品（与「添加物料」同一套选择器） -->
    <MaterialPickerDialog v-model="pickerOpen" :desc="pickDesc" :allow-lcsc="false" @select="onPick" />
  </section>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted, watch, onActivated } from 'vue'
import {
  Plus, Trash2, ClipboardList, X, Search,
} from 'lucide-vue-next'
import {
  applyStock, updatePurchaseItem, createPurchaseOrder, listPurchaseOrders, updatePurchaseOrder,
  deletePurchaseOrder, createPurchaseItems, listPurchaseItems, deletePurchaseItem,
  listPurchaseOrdersPage, countPurchaseOrders,
} from '../../lib/db'
import type { MaterialRow, PurchaseOrder, PurchaseItem } from '../../lib/types'
import type { LcscHit } from '../../lib/lcscApi'
import DataTable from '../../components/DataTable.vue'
import type { DtColumn } from '../../components/DataTable.vue'
import Segmented from '../../components/form/Segmented.vue'
import Pager from '../../components/Pager.vue'
import MaterialPickerDialog from '../../components/business/MaterialBindDialog.vue'
import EmptyState from '../../components/EmptyState.vue'
import { useToast } from '../../composables/toast'
import { confirm } from '../../composables/confirm'
import { useStockData } from '../../composables/useStockData'

const toast = useToast()
const { comps, summaryMap, refreshLogs, sumOf } = useStockData()

/** 列表行：订单 + 明细统计 */
interface PoRow extends PurchaseOrder {
  pending: number
  done: number
  total: number
}

/** 抽屉内的明细草稿行 */
interface DraftRow {
  key: string
  /** 已有明细 id；新增行为 null */
  id: string | null
  material_id: string | null
  name: string
  model: string | null
  brand: string | null
  package: string | null
  part_no: string | null
  qty: number | null
  stock_qty: number | null
  note: string
  done: boolean
}

// ===== 列表 =====
const poList = ref<PurchaseOrder[]>([])
/** order_id -> 明细 */
const itemsMap = ref<Map<string, PurchaseItem[]>>(new Map())
const poLoading = ref(false)
const busy = ref(false)
const saving = ref(false)

// 分页 + 状态筛选（避免云端一次性拉全表）
const poPage = ref(1)
const poPageSize = ref(20)
const poTotal = ref(0)
const poStatus = ref<'all' | 'pending' | 'done'>('all')
const poPendingCount = ref(0)
const poDoneCount = ref(0)

const poCols: DtColumn[] = [
  { key: 'name', label: '待采单 / 采购原因', minWidth: '200px' },
  { key: 'status', label: '状态', width: '96px' },
  { key: 'progress', label: '采购进度', width: '210px' },
  { key: 'total', label: '明细数', align: 'right', width: '80px' },
  { key: 'created', label: '创建时间', width: '120px' },
  { key: 'ops', label: '操作', width: '180px', cls: 'ops' },
]

const poRows = computed<PoRow[]>(() => poList.value.map(o => {
  const items = itemsMap.value.get(o.id) || []
  return {
    ...o,
    pending: items.filter(i => !i.done).length,
    done: items.filter(i => i.done).length,
    total: items.length,
  }
}))
const pendingOrders = computed(() => poPendingCount.value)
const doneOrders = computed(() => poDoneCount.value)

function fmt(t: string) {
  if (!t) return '—'
  const d = new Date(t)
  return isNaN(d.getTime()) ? '—' : d.toLocaleDateString('zh-CN')
}

async function loadAll() {
  poLoading.value = true
  try {
    const [page, pending, done] = await Promise.all([
      listPurchaseOrdersPage({
        status: poStatus.value === 'all' ? null : poStatus.value,
        limit: poPageSize.value,
        offset: (poPage.value - 1) * poPageSize.value,
      }),
      countPurchaseOrders('pending'),
      countPurchaseOrders('done'),
    ])
    poList.value = page.rows
    poTotal.value = page.total
    poPendingCount.value = pending
    poDoneCount.value = done
    // 仅加载当前页订单的明细，避免一次性拉全表
    const pairs: Array<[string, PurchaseItem[]]> = await Promise.all(page.rows.map(async o => {
      try { return [o.id, await listPurchaseItems(o.id)] as [string, PurchaseItem[]] }
      catch { return [o.id, []] as [string, PurchaseItem[]] }
    }))
    itemsMap.value = new Map(pairs)
  } catch (e: unknown) { toast.error('待采单加载失败：' + ((e as Error).message || e)) }
  finally { poLoading.value = false }
}

// 状态筛选变化 → 回到第 1 页并重新查询
watch(poStatus, () => { poPage.value = 1; void loadAll() })
function onPoPage(p: number) { poPage.value = p; void loadAll() }
function onPoSize(s: number) { poPageSize.value = s; poPage.value = 1; void loadAll() }

/** 仅刷新某一单的明细（用于切换「已采购」后同步统计） */
async function refreshItems(id: string) {
  try { itemsMap.value.set(id, await listPurchaseItems(id)) }
  catch { /* 静默 */ }
}

// ===== 抽屉：新建 / 编辑 / 详情 =====
type Mode = 'create' | 'edit' | 'detail'
const drawerOpen = ref(false)
const mode = ref<Mode>('create')
const current = ref<PurchaseOrder | null>(null)
const form = reactive({ name: '', reason: '' })
const rows = ref<DraftRow[]>([])
/** 打开时已有的明细 id，保存时用于求差集删除 */
const originalIds = ref<Set<string>>(new Set())
const errText = ref('')
/** 用户碰过的行 key：只有碰过的行才提前报错，避免新增空行一上来就标红 */
const touched = ref<Set<string>>(new Set())
/** 点过「保存」后，所有行的错误无条件展示 */
const submitAll = ref(false)
/** 抽屉打开 / 上次保存时的内容快照，用于判断是否有未保存修改 */
const snapshot = ref('')

const readonly = computed(() => mode.value === 'detail')
const drawerTitle = computed(() =>
  mode.value === 'create' ? '新建待采单' : mode.value === 'edit' ? '编辑待采单' : '待采单详情')

let rowSeq = 0
function blankRow(): DraftRow {
  return {
    key: `r${++rowSeq}`, id: null, material_id: null, name: '', model: null,
    brand: null, package: null, part_no: null, qty: 1, stock_qty: null, note: '', done: false,
  }
}
function toDraft(it: PurchaseItem): DraftRow {
  return {
    key: `r${++rowSeq}`, id: it.id, material_id: it.material_id, name: it.name, model: it.model,
    brand: it.brand, package: it.package, part_no: it.part_no,
    qty: it.qty, stock_qty: it.stock_qty, note: it.note || '', done: it.done,
  }
}

/** 抽屉当前内容的快照签名（不含行内临时 key） */
function snapshotOf() {
  return JSON.stringify({
    name: form.name,
    reason: form.reason,
    rows: rows.value.map(r => ({
      id: r.id, material_id: r.material_id, qty: r.qty, stock_qty: r.stock_qty,
      note: r.note, done: r.done, name: r.name, model: r.model,
    })),
  })
}
/** 存在未保存改动（抽屉里的「完成采购」据此拦截） */
const dirty = computed(() => snapshot.value !== snapshotOf())

function resetCheck() {
  touched.value = new Set()
  submitAll.value = false
  errText.value = ''
}

function openCreate() {
  mode.value = 'create'
  current.value = null
  form.name = `待采单 ${new Date().toLocaleDateString('zh-CN')}`
  form.reason = ''
  rows.value = [blankRow()]
  originalIds.value = new Set()
  resetCheck()
  snapshot.value = snapshotOf()
  drawerOpen.value = true
}

async function openPo(o: PoRow) {
  const target = poList.value.find(p => p.id === o.id)
  if (!target) return
  mode.value = target.status === 'done' ? 'detail' : 'edit'
  current.value = target
  form.name = target.name
  form.reason = target.note || ''
  const items = itemsMap.value.get(target.id) || await listPurchaseItems(target.id)
  rows.value = items.map(toDraft)
  originalIds.value = new Set(items.map(i => i.id))
  resetCheck()
  snapshot.value = snapshotOf()
  drawerOpen.value = true
}

function closeDrawer() { drawerOpen.value = false }

function addRow() { rows.value.push(blankRow()) }
function removeRow(r: DraftRow) { rows.value = rows.value.filter(x => x.key !== r.key) }

/** 标记该行已被编辑，之后的校验结果对该行可见 */
function touch(r: DraftRow) {
  touched.value.add(r.key)
  errText.value = ''
}

function onQty(r: DraftRow, e: Event) {
  const v = (e.target as HTMLInputElement).value
  r.qty = v === '' ? null : Number(v)
  touch(r)
}

// ===== 选择待采商品 =====
const pickerOpen = ref(false)
const pickKey = ref<string | null>(null)
const pickDesc = computed(() => '选择需要采购的库存物料')

function pickRow(r: DraftRow) { pickKey.value = r.key; pickerOpen.value = true; touch(r) }

// allowLcsc=false、未开启新建，实际只会收到 kind='material'
function onPick(p: { kind: 'material' | 'lcsc' | 'draft'; item?: MaterialRow | LcscHit; draft?: unknown }) {
  const m = p.item as MaterialRow
  const r = rows.value.find(x => x.key === pickKey.value)
  if (r) {
    r.material_id = m.id
    r.name = m.name
    r.model = m.model ?? null
    r.brand = m.brand ?? null
    r.package = m.package ?? null
    r.part_no = m.part_no ?? null
    r.stock_qty = m.qty
  }
  pickerOpen.value = false
  pickKey.value = null
  errText.value = ''
}

/** 切换某物料为「已采购」：仅改状态，不入库 */
async function toggleRowDone(r: DraftRow) {
  r.done = !r.done
  if (r.id && current.value) {
    try {
      await updatePurchaseItem(r.id, { done: r.done })
      await refreshItems(current.value.id)
      // 状态已即时落库，同步基线，避免被判成「未保存修改」
      snapshot.value = snapshotOf()
    } catch (e: unknown) { toast.error('更新失败：' + ((e as Error).message || e)) }
  }
}

// ===== 校验与保存 =====
/** 该行的错误是否应该展示给用户：碰过该行，或已点过保存 */
function showErr(r: DraftRow) { return submitAll.value || touched.value.has(r.key) }

/** 待采商品必填 */
function itemErr(r: DraftRow): string {
  return !r.material_id && showErr(r) ? '请选择待采商品' : ''
}

/** 数量必填且为正整数 */
function qtyErr(r: DraftRow): string {
  if (!showErr(r)) return ''
  if (r.qty == null) return '请填写数量'
  if (!Number.isInteger(r.qty) || r.qty <= 0) return '数量需为正整数'
  return ''
}

/** 该行整体校验信息（保存时汇总用） */
function errMsg(r: DraftRow): string { return itemErr(r) || qtyErr(r) }

/** 名称必填（同样在点过保存后才标红） */
const nameErr = computed(() => submitAll.value && !form.name.trim())

function toPayload(r: DraftRow): Partial<PurchaseItem> {
  const qty = r.qty as number
  return {
    material_id: r.material_id, name: r.name, model: r.model, brand: r.brand,
    package: r.package, part_no: r.part_no, qty,
    stock_qty: r.stock_qty,
    lack_qty: Math.max(0, qty - (r.stock_qty ?? 0)),
    note: r.note || null,
    done: r.done,
  }
}

async function saveOrder() {
  // 点保存后所有行的错误无条件展示，便于一次性看到全部待修正项
  submitAll.value = true
  const problems: string[] = []
  const name = form.name.trim()
  if (!name) problems.push('请填写待采单名称')
  if (!rows.value.length) problems.push('请至少添加一条采购明细')
  rows.value.forEach((r, i) => {
    const m = errMsg(r)
    if (m) problems.push(`第 ${i + 1} 行：${m}`)
  })
  if (problems.length) {
    errText.value = problems.length > 3
      ? `${problems.slice(0, 3).join('；')} 等 ${problems.length} 处待修正`
      : problems.join('；')
    return
  }
  errText.value = ''
  saving.value = true
  try {
    const note = form.reason.trim() || null
    if (mode.value === 'create') {
      const po = await createPurchaseOrder({ name, note, source: 'manual', status: 'pending' })
      await createPurchaseItems(po.id, rows.value.map(toPayload))
      toast.success('已创建待采单')
    } else if (current.value) {
      const id = current.value.id
      await updatePurchaseOrder(id, { name, note })
      const news = rows.value.filter(r => !r.id)
      if (news.length) await createPurchaseItems(id, news.map(toPayload))
      for (const r of rows.value.filter(r => r.id)) {
        await updatePurchaseItem(r.id as string, toPayload(r))
      }
      for (const oldId of originalIds.value) {
        if (!rows.value.some(r => r.id === oldId)) await deletePurchaseItem(oldId)
      }
      toast.success('已保存')
    }
    // 保存成功：重置校验态并把当前内容记为新基线
    resetCheck()
    snapshot.value = snapshotOf()
    drawerOpen.value = false
    await loadAll()
  } catch (e: unknown) { toast.error('保存失败：' + ((e as Error).message || e)) }
  finally { saving.value = false }
}

/** 抽屉里的「完成采购」：有未保存改动时不可用，避免改动被静默丢弃 */
function onCompleteFromDrawer() {
  if (!current.value || dirty.value) return
  void completeOrder(current.value)
}

// ===== 完成采购：入库 + 写流水 + 置为已完成 =====
async function completeOrder(o: PoRow | PurchaseOrder) {
  const target = poList.value.find(p => p.id === o.id)
  if (!target) return
  if (target.status === 'done') { toast.error('该待采单已完成'); return }
  const items = itemsMap.value.get(target.id) || await listPurchaseItems(target.id)
  const stockable = items.filter(i => i.material_id)
  const skipped = items.length - stockable.length
  const totalQty = stockable.reduce((s, i) => s + (i.lack_qty > 0 ? i.lack_qty : i.qty), 0)
  const ok = await confirm({
    content: `完成「${target.name}」的采购？将对 ${stockable.length} 项物料入库共 ${totalQty} 件并生成库存记录`
      + (skipped ? `；另有 ${skipped} 项未关联库存物料将被跳过` : '')
      + '。完成后本单变为「已完成」，不可再编辑或删除。',
    confirmText: '完成采购',
  })
  if (!ok) return
  busy.value = true
  try {
    for (const it of stockable) {
      const qty = it.lack_qty > 0 ? it.lack_qty : it.qty
      if (qty <= 0) continue
      const mid = it.material_id as string
      const cur = comps.value.find(c => c.id === mid)?.qty ?? 0
      const fresh = await applyStock({
        material_id: mid, type: 'in', qty, currentQty: cur,
        note: `待采入库（${target.name}）`,
      })
      const idx = comps.value.findIndex(c => c.id === mid)
      if (idx >= 0) comps.value[idx] = { ...comps.value[idx], qty: fresh.qty }
      const s = sumOf(mid)
      s.total_in += qty; s.last30_in += qty
      summaryMap.value.set(mid, s)
      await updatePurchaseItem(it.id, { done: true, stock_qty: fresh.qty, lack_qty: 0 })
    }
    await updatePurchaseOrder(target.id, { status: 'done' })
    refreshLogs()
    toast.success('已完成采购，库存已更新')
    drawerOpen.value = false
    await loadAll()
  } catch (e: unknown) { toast.error('完成采购失败：' + ((e as Error).message || e)) }
  finally { busy.value = false }
}

// ===== 删除（仅采购中可删） =====
async function deletePo(o: PurchaseOrder) {
  if (o.status === 'done') { toast.error('已完成的待采单不可删除'); return }
  const ok = await confirm({
    content: `删除待采单「${o.name}」及其全部明细？`, confirmText: '删除', danger: true,
  })
  if (!ok) return
  try {
    await deletePurchaseOrder(o.id)
    toast.success('已删除待采单')
    await loadAll()
  } catch (e: unknown) { toast.error('删除失败：' + ((e as Error).message || e)) }
}

// 切到本 tab 时自动重拉（keep-alive 不会重新挂载，故用 onActivated 而非 onMounted）
onActivated(() => { poPage.value = 1; void loadAll() })

// 供父级「刷新」按钮调用：回到第 1 页重查
defineExpose({ refresh: () => { poPage.value = 1; return loadAll() } })
</script>

<style scoped>
.tab {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.po-wrap {
  min-width: 0;
}

/* ===== 工具条 ===== */
.po-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  padding: 10px 14px;
  border-bottom: 1px solid var(--c-border-hairline);
  background: var(--c-glass);
  flex-shrink: 0;
}

.po-btn {
  height: var(--ctrl-h-sm);
  padding: 0 12px;
  font-size: var(--fs-xs);
}

.po-bar-right {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 14px;
}

.stat {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: var(--fs-xs);
  font-weight: 500;
}

.dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
  background: var(--c-accent);
}

.dot.warn {
  background: var(--c-warning);
}

.stat.ok {
  color: var(--c-accent);
}

/* ===== 列表单元格 ===== */
.po-name {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.po-reason {
  font-size: var(--fs-xs);
  color: var(--c-text-2);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 260px;
}

.po-prog {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

/* 操作列：与 BOM 列表同一套 mini 按钮尺寸 */
.ops {
  display: flex;
  gap: 4px;
}

.btn.mini {
  height: 26px;
  padding: 0 8px;
  font-size: var(--fs-xs);
  gap: 4px;
}

.btn-icon.mini {
  width: 26px;
  min-width: 26px;
  height: 26px;
  padding: 0;
}

/* 必填标记 */
.req {
  margin-left: 3px;
  color: var(--c-danger);
}

.po-time {
  font-size: var(--fs-xs);
  color: var(--c-text-2);
}

.pill {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  border-radius: 999px;
  font-size: var(--fs-xs);
  font-weight: 500;
  background: var(--c-glass);
  border: 1px solid var(--c-border);
  color: var(--c-text-2);
  white-space: nowrap;
}

.pill.ok {
  color: var(--c-accent);
  border-color: color-mix(in srgb, var(--c-accent) 35%, transparent);
}

.pill.warn {
  color: var(--c-warning);
  border-color: color-mix(in srgb, var(--c-warning) 35%, transparent);
}

.mini-pill {
  cursor: pointer;
}

.mini-pill:hover {
  filter: brightness(1.06);
}

/* ===== 抽屉（视觉令牌与 MaterialDetailDrawer 的 .dw-mask / .dw 一致） =====
   z-index 必须低于全局 .modal-mask(100) 之上的业务弹窗（选择商品 = 200），
   否则在抽屉里点「选择商品」会被抽屉本体盖住。 */
.po-mask {
  position: fixed;
  inset: 0;
  z-index: 120;
  background: rgba(0, 0, 0, 0.5);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  display: flex;
  justify-content: flex-end;
}

/* 不透明实体面：--c-surface 是半透明玻璃，直接用作抽屉底会透出背后的列表 */
.po-drawer {
  width: min(620px, 100vw);
  height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--c-elevated);
  border-left: 1px solid var(--c-border);
  box-shadow: var(--shadow-lg);
}

.pd-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 20px 22px 16px;
  border-bottom: 1px solid var(--c-border);
  flex-shrink: 0;
}

.pd-head h3 {
  margin: 0;
  font-size: var(--fs-lg);
  font-weight: 600;
}

/* 关闭按钮：与 .dw-close 同款 */
.pd-close {
  width: 30px;
  height: 30px;
  border: none;
  border-radius: 50%;
  background: var(--c-surface);
  color: var(--c-text-2);
  display: grid;
  place-items: center;
  cursor: pointer;
  flex-shrink: 0;
  transition: all var(--motion);
}

.pd-close:hover {
  background: var(--c-surface-hover);
  color: var(--c-text);
}

.pd-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 16px 18px;
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.pd-section {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

/* 分节标题：与 .dw-sec h3 同款 */
.pd-label {
  font-size: var(--fs-sm);
  font-weight: 600;
  color: var(--c-text-2);
}

.pd-sec-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.pd-field {
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.pd-field label {
  font-size: var(--fs-xs);
  color: var(--c-text-2);
}

.pd-field input,
.pd-field textarea {
  width: 100%;
  padding: 7px 10px;
  font-size: var(--fs-sm);
  background: var(--c-glass);
  border: 1px solid var(--c-border);
  border-radius: var(--r-md);
  color: var(--c-text);
  font-family: inherit;
  resize: vertical;
}

.pd-field input:focus,
.pd-field textarea:focus {
  outline: none;
  border-color: var(--c-primary);
  background: var(--c-surface);
  box-shadow: 0 0 0 3px var(--c-primary-glow);
}

.pd-field input:disabled,
.pd-field textarea:disabled {
  opacity: 0.75;
  cursor: default;
}

/* 明细表（表头 / 单元格沿用 DataTable 的视觉令牌） */
.pd-table {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--fs-sm);
}

.pd-table th {
  text-align: left;
  font-weight: 500;
  font-size: var(--fs-xs);
  color: var(--c-text-3);
  padding: 8px 10px;
  border-bottom: 1px solid var(--c-border-hairline);
  background: var(--c-glass-strong);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  position: sticky;
  top: 0;
  z-index: 1;
  white-space: nowrap;
}

.pd-table td {
  padding: 8px 10px;
  border-bottom: 1px solid var(--c-border-hairline);
  vertical-align: middle;
}

.pd-table tr.is-bad td {
  background: color-mix(in srgb, var(--c-danger) 8%, transparent);
}

.c-item {
  min-width: 140px;
}

.c-qty {
  width: 70px;
}

.c-stock {
  width: 50px;
  text-align: right;
}

.c-note {
  min-width: 76px;
}

.c-status {
  width: 78px;
}

.c-ops {
  width: 34px;
}

.pick-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  max-width: 100%;
  height: var(--ctrl-h-sm);
  padding: 0 8px;
  font-size: var(--fs-xs);
  background: var(--c-glass);
  border: 1px dashed var(--c-border);
  border-radius: var(--r-sm);
  color: var(--c-text);
  cursor: pointer;
}

.pick-btn.empty {
  color: var(--c-text-3);
}

.pick-btn:hover {
  border-color: var(--c-primary);
  color: var(--c-primary);
}

/* 校验不通过：红框 + 具体原因走 title */
.pick-btn.bad,
.qty-in.bad,
.pd-field input.bad {
  border-color: var(--c-danger);
}

.pick-btn.bad {
  color: var(--c-danger);
}

.pick-txt {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ro-item {
  font-size: var(--fs-xs);
}

.row-sub {
  display: block;
  font-size: var(--fs-xs);
  color: var(--c-text-3);
}

.qty-in,
.note-in {
  width: 100%;
  height: var(--ctrl-h-sm);
  padding: 0 6px;
  font-size: var(--fs-xs);
  background: var(--c-glass);
  border: 1px solid var(--c-border);
  border-radius: var(--r-sm);
  color: var(--c-text);
}

.qty-in {
  text-align: right;
}

.qty-in:focus,
.note-in:focus {
  outline: none;
  border-color: var(--c-primary);
  background: var(--c-surface);
  box-shadow: 0 0 0 3px var(--c-primary-glow);
}

.pd-empty {
  margin: 0;
  padding: 18px;
  text-align: center;
  font-size: var(--fs-xs);
  color: var(--c-text-3);
  border: 1px dashed var(--c-border);
  border-radius: var(--r-md);
}

.pd-err {
  margin: 0;
  font-size: var(--fs-xs);
  color: var(--c-danger);
}

.pd-foot {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  padding: 12px 18px;
  border-top: 1px solid var(--c-border-hairline);
  flex-shrink: 0;
}

.btn.mini.ok {
  color: var(--c-accent);
}

.btn.mini.ok:hover {
  border-color: var(--c-accent);
}

.btn.mini.danger {
  color: var(--c-danger);
}

.btn.mini.danger:hover {
  border-color: var(--c-danger);
}

/* 抽屉动画（与 .drawer-* 同一组时长曲线） */
.po-fade-enter-active,
.po-fade-leave-active {
  transition: opacity 220ms ease;
}

.po-fade-enter-from,
.po-fade-leave-to {
  opacity: 0;
}

.po-fade-enter-active .po-drawer,
.po-fade-leave-active .po-drawer {
  transition: transform 260ms cubic-bezier(0.22, 1, 0.36, 1);
}

.po-fade-enter-from .po-drawer,
.po-fade-leave-to .po-drawer {
  transform: translateX(40px);
}

.hint {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 24px;
  justify-content: center;
  font-size: var(--fs-xs);
  color: var(--c-text-2);
}
</style>
