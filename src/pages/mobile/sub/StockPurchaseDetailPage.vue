<template>
  <SubPage :title="mode === 'new' ? '新建待采单' : (readonly ? '待采单详情' : '编辑待采单')">
    <div class="mpage">
      <p v-if="error" class="error">{{ error }}</p>

      <!-- 基本信息 -->
      <div class="card">
        <label class="f-label">名称 <i class="req">*</i></label>
        <input v-model="name" class="f-input" :readonly="readonly" placeholder="如：10 月补货" />
        <label class="f-label mt">采购原因</label>
        <textarea v-model="note" class="f-area" rows="2" :readonly="readonly"
          placeholder="备注这批采购的用途 / 来源" />
      </div>

      <!-- 明细 -->
      <div class="sec-head">
        <h3>采购明细（{{ rows.length }}）</h3>
        <button v-if="!readonly" class="add-btn" @click="addRow">
          <Plus :size="14" style="display: inline-flex; flex-shrink: 0" />添加一行
        </button>
      </div>

      <div v-if="loading" class="hint"><div class="spinner-lg" /></div>

      <template v-else>
        <article v-for="r in rows" :key="r.key" class="icard">
          <div class="i-head">
            <div class="i-name">
              <h4>{{ r.name || '未选择物料' }}</h4>
              <p v-if="r.model">{{ r.model }}</p>
            </div>
            <button class="i-done" :class="{ on: r.done }" :disabled="readonly" @click="toggleDone(r)">
              {{ r.done ? '已采购' : '待采购' }}
            </button>
          </div>

          <div class="i-grid">
            <label class="i-field">
              <span>需求数量</span>
              <input v-model.number="r.qty" type="number" inputmode="numeric" min="1" :readonly="readonly" />
            </label>
            <label class="i-field">
              <span>缺料</span>
              <input :value="lackOf(r)" readonly class="ro" />
            </label>
            <label class="i-field wide">
              <span>备注</span>
              <input v-model="r.note" :readonly="readonly" placeholder="位号 / 来源" />
            </label>
          </div>

          <div class="i-foot">
            <button v-if="!readonly" class="i-pick" @click="openPicker(r.key)">
              <Search :size="13" style="display: inline-flex; flex-shrink: 0" />
              {{ r.material_id ? '更换物料' : '选择物料' }}
            </button>
            <button v-if="!readonly" class="i-del" @click="removeRow(r)">
              <Trash2 :size="14" style="display: inline-flex; flex-shrink: 0" />删除
            </button>
          </div>
        </article>

        <div v-if="!rows.length" class="empty">
          <p>还没有明细，点「添加一行」开始</p>
        </div>
      </template>
    </div>

    <!-- 底部操作栏 -->
    <div class="footbar">
      <button v-if="!readonly" class="fb-btn ghost" :disabled="saving" @click="save">
        <span v-if="saving" class="spinner-sm" />{{ saving ? '保存中…' : '保存' }}
      </button>
      <button v-if="mode !== 'new' && !readonly" class="fb-btn primary" :disabled="completing" @click="complete">
        <span v-if="completing" class="spinner-sm" />{{ completing ? '入库中…' : '完成采购' }}
      </button>
      <button v-if="mode !== 'new' && !readonly" class="fb-btn danger" @click="askDelete">删除</button>
    </div>

    <!-- 选择物料（复用桌面三源选择器，移动端禁掉立创） -->
    <MaterialBindDialog v-model="pickerOpen" desc="选择要采购的物料" :allow-lcsc="false" :categories="cats"
      @select="onPick" />
  </SubPage>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Plus, Search, Trash2 } from 'lucide-vue-next'
import SubPage from '../../../components/mobile/SubPage.vue'
import MaterialBindDialog from '../../../components/business/MaterialBindDialog.vue'
import {
  createPurchaseOrder, updatePurchaseOrder, deletePurchaseOrder,
  createPurchaseItems, listPurchaseItems, updatePurchaseItem, deletePurchaseItem,
  listCategories, getOwnerId, stockInOrder,
} from '../../../lib/db'
import { withAuthRetry } from '../../../lib/authRetry'
import { confirm } from '../../../composables/confirm'
import { useToast } from '../../../composables/toast'
import { useStockData } from '../../../composables/useStockData'
import type { Category, MaterialRow, PurchaseItem } from '../../../lib/types'

/**
 * 移动端待采单详情 / 新建 / 查看（三态由路由决定）：
 * - /m/stock/purchase/new → 新建草稿，保存时才建单
 * - /m/stock/purchase/:id → 编辑（pending）/ 只读（done）
 * 与桌面 StockPurchase 的差异（见 demo/MOBILE_STOCK_PLAN.md）：
 * - 三态抽屉 + 6 列明细表 → 独立路由页 + 明细卡片流
 * - 状态 pill 点击即落库（桌面同款 toggleRowDone 语义）
 */
const route = useRoute()
const router = useRouter()
const toast = useToast()
const { comps, summaryMap, sumOf, refreshList, refreshSummary, refreshLogs } = useStockData()

/** 明细草稿行 */
interface DraftRow {
  key: string
  id?: string
  material_id: string | null
  name: string
  model: string | null
  qty: number
  note: string
  done: boolean
  stock_qty: number | null
}

const orderId = computed(() => (route.params.id === 'new' ? null : String(route.params.id || '')))
const mode = computed<'new' | 'edit'>(() => (orderId.value ? 'edit' : 'new'))
const readonly = ref(false)

const name = ref('')
const note = ref('')
const rows = ref<DraftRow[]>([])
const cats = ref<Category[]>([])
const loading = ref(false)
const saving = ref(false)
const completing = ref(false)
const error = ref('')

const pickerOpen = ref(false)
const pickKey = ref<string | null>(null)

let seed = 0
function newRow(): DraftRow {
  return {
    key: `r${Date.now()}_${seed++}`,
    material_id: null, name: '', model: null, qty: 1, note: '', done: false, stock_qty: null,
  }
}
function addRow() { rows.value.push(newRow()) }

function lackOf(r: DraftRow) {
  const stock = r.stock_qty ?? 0
  return Math.max(0, (Number(r.qty) || 0) - stock)
}

function fromItem(it: PurchaseItem): DraftRow {
  return {
    key: it.id,
    id: it.id,
    material_id: it.material_id,
    name: it.name,
    model: it.model,
    qty: it.qty,
    note: it.note || '',
    done: !!it.done,
    stock_qty: it.stock_qty,
  }
}

async function load() {
  const id = orderId.value
  if (!id) { rows.value = [newRow()]; return }
  loading.value = true
  error.value = ''
  try {
    const items = await withAuthRetry(() => listPurchaseItems(id))
    rows.value = items.map(fromItem)
    if (!rows.value.length) rows.value = [newRow()]
  } catch (e: unknown) {
    error.value = '加载失败：' + ((e as Error).message || e)
  } finally {
    loading.value = false
  }
}

/**
 * 单据本体：db 层没有「按 id 取单张待采单」的接口，名称/原因/状态由列表页通过 query 带入
 * （列表已经拉过整页数据，不必为此再加一个后端查询）。
 */
function loadOrder() {
  if (!orderId.value) return
  const qName = route.query.name
  const qNote = route.query.note
  const qStatus = route.query.status
  if (typeof qName === 'string') name.value = qName
  if (typeof qNote === 'string') note.value = qNote
  readonly.value = qStatus === 'done'
}

async function toggleDone(r: DraftRow) {
  if (readonly.value) return
  r.done = !r.done
  if (r.id && orderId.value) {
    try { await withAuthRetry(() => updatePurchaseItem(r.id as string, { done: r.done })) }
    catch (e: unknown) { toast.error('更新失败：' + ((e as Error).message || e)); r.done = !r.done }
  }
}

async function removeRow(r: DraftRow) {
  if (r.id) {
    const ok = await confirm({ content: `删除明细「${r.name || '未命名'}」？`, confirmText: '删除', danger: true })
    if (!ok) return
    try { await withAuthRetry(() => deletePurchaseItem(r.id as string)) }
    catch (e: unknown) { toast.error('删除失败：' + ((e as Error).message || e)); return }
  }
  rows.value = rows.value.filter(x => x.key !== r.key)
}

function openPicker(key: string) {
  pickKey.value = key
  pickerOpen.value = true
}

function onPick(p: { kind: 'material' | 'lcsc' | 'draft'; item?: MaterialRow | unknown; draft?: unknown }) {
  const m = p.item as MaterialRow
  const r = rows.value.find(x => x.key === pickKey.value)
  if (r && m?.id) {
    r.material_id = m.id
    r.name = m.name
    r.model = m.model ?? null
    r.stock_qty = m.qty
  }
  pickerOpen.value = false
  pickKey.value = null
}

async function save() {
  if (!name.value.trim()) { error.value = '请填写名称'; return }
  const filled = rows.value.filter(r => r.material_id || r.name.trim())
  if (!filled.length) { error.value = '至少填写一条明细'; return }
  saving.value = true
  error.value = ''
  try {
    if (mode.value === 'new') {
      const owner = await getOwnerId()
      const id = crypto.randomUUID()
      const created = await withAuthRetry(() => createPurchaseOrder({
        id, owner, name: name.value.trim(), note: note.value.trim() || null,
        source: 'manual', source_id: null, status: 'pending', created_at: new Date().toISOString(),
      }))
      await withAuthRetry(() => createPurchaseItems(created.id, filled.map(r => ({
        material_id: r.material_id, name: r.name, model: r.model,
        qty: Number(r.qty) || 0, stock_qty: r.stock_qty, lack_qty: lackOf(r),
        note: r.note || null, done: r.done,
      }))))
      toast.success('已创建待采单')
      router.replace(`/m/stock/purchase/${created.id}`)
      return
    }
    const id = orderId.value as string
    await withAuthRetry(() => updatePurchaseOrder(id, {
      name: name.value.trim(), note: note.value.trim() || null,
    }))
    // 已存在的行逐条更新；新增行批量创建
    const exist = filled.filter(r => r.id)
    for (const r of exist) {
      await withAuthRetry(() => updatePurchaseItem(r.id as string, {
        material_id: r.material_id, name: r.name, model: r.model,
        qty: Number(r.qty) || 0, lack_qty: lackOf(r), note: r.note || null, done: r.done,
      }))
    }
    const fresh = filled.filter(r => !r.id)
    if (fresh.length) {
      await withAuthRetry(() => createPurchaseItems(id, fresh.map(r => ({
        material_id: r.material_id, name: r.name, model: r.model,
        qty: Number(r.qty) || 0, stock_qty: r.stock_qty, lack_qty: lackOf(r),
        note: r.note || null, done: r.done,
      }))))
    }
    toast.success('已保存')
    await load()
  } catch (e: unknown) {
    error.value = '保存失败：' + ((e as Error).message || e)
  } finally {
    saving.value = false
  }
}

/** 完成采购：一张入库单（source=purchase）+ 明细置为已采 + 单据转已完成 */
async function complete() {
  const id = orderId.value
  if (!id) return
  const ok = await confirm({
    content: `完成「${name.value}」的采购？将按明细缺料数量入库，完成后本单不可再编辑。`,
    confirmText: '完成采购',
  })
  if (!ok) return
  completing.value = true
  try {
    const stockable = rows.value.filter(r => r.material_id && !r.done)
    const rowsIn = stockable
      .map(r => ({ r, qty: lackOf(r) > 0 ? lackOf(r) : (Number(r.qty) || 0) }))
      .filter(x => x.qty > 0)
    const poNote = `待采入库（${name.value}）`
    if (rowsIn.length) {
      const { finals } = await withAuthRetry(() => stockInOrder({
        type: 'in', source: 'purchase', source_id: id,
        title: `待采入库：${name.value}`, note: poNote,
        items: rowsIn.map(x => ({ material_id: x.r.material_id as string, qty: x.qty, note: poNote })),
      }))
      for (const x of rowsIn) {
        const mid = x.r.material_id as string
        const fresh = finals.get(mid) ?? 0
        const idx = comps.value.findIndex(c => c.id === mid)
        if (idx >= 0) comps.value[idx] = { ...comps.value[idx], qty: fresh }
        const s = sumOf(mid)
        s.total_in += x.qty
        s.last30_in += x.qty
        summaryMap.value.set(mid, s)
        if (x.r.id) {
          await withAuthRetry(() => updatePurchaseItem(x.r.id as string, {
            done: true, stock_qty: fresh, lack_qty: 0,
          }))
        }
      }
    }
    await withAuthRetry(() => updatePurchaseOrder(id, { status: 'done' }))
    await Promise.all([refreshList(), refreshSummary(), refreshLogs()])
    toast.success('已完成采购，库存已更新')
    router.back()
  } catch (e: unknown) {
    error.value = '完成采购失败：' + ((e as Error).message || e)
  } finally {
    completing.value = false
  }
}

async function askDelete() {
  const id = orderId.value
  if (!id) return
  const ok = await confirm({
    content: `删除待采单「${name.value}」及其全部明细？`, confirmText: '删除', danger: true,
  })
  if (!ok) return
  try {
    await withAuthRetry(() => deletePurchaseOrder(id))
    toast.success('已删除')
    router.back()
  } catch (e: unknown) {
    toast.error('删除失败：' + ((e as Error).message || e))
  }
}

onMounted(async () => {
  try { cats.value = await listCategories() } catch { /* 静默 */ }
  loadOrder()
  await load()
})
</script>

<style scoped>
.mpage {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-height: 100%;
  padding-bottom: calc(84px + env(safe-area-inset-bottom));
}

.card {
  padding: 12px 14px;
  background: var(--c-surface);
  border: 1px solid var(--c-border);
  border-radius: var(--r-xl);
}

.f-label {
  display: block;
  font-size: var(--fs-xs);
  color: var(--c-text-2);
  font-weight: 500;
}

.f-label.mt {
  margin-top: 12px;
}

.req {
  color: var(--c-danger);
  font-style: normal;
}

.f-input,
.f-area {
  width: 100%;
  margin-top: 6px;
  padding: 9px 10px;
  border: 1px solid var(--c-border);
  border-radius: var(--r-md);
  background: var(--c-glass);
  color: var(--c-text);
  font-family: inherit;
  font-size: var(--fs-sm);
}

.f-input:focus,
.f-area:focus {
  outline: none;
  border-color: var(--c-primary);
}

.f-area {
  resize: none;
}

.sec-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.sec-head h3 {
  margin: 0;
  font-size: var(--fs-sm);
  font-weight: 600;
  color: var(--c-text-2);
}

.add-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 30px;
  padding: 0 12px;
  border: 1px solid var(--c-border);
  border-radius: var(--r-md);
  background: var(--c-surface);
  color: var(--c-primary);
  font-family: inherit;
  font-size: var(--fs-xs);
  font-weight: 600;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}

/* 明细卡 */
.icard {
  padding: 12px 14px;
  background: var(--c-surface);
  border: 1px solid var(--c-border);
  border-radius: var(--r-xl);
}

.i-head {
  display: flex;
  align-items: flex-start;
  gap: 10px;
}

.i-name {
  flex: 1;
  min-width: 0;
}

.i-name h4 {
  margin: 0;
  font-size: var(--fs-md);
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.i-name p {
  margin: 2px 0 0;
  font-size: var(--fs-xs);
  color: var(--c-text-3);
}

.i-done {
  flex-shrink: 0;
  height: 28px;
  padding: 0 12px;
  border: 1px solid var(--c-border);
  border-radius: 999px;
  background: transparent;
  color: var(--c-text-3);
  font-family: inherit;
  font-size: var(--fs-xs);
  font-weight: 600;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}

.i-done.on {
  border-color: var(--c-accent);
  background: rgba(52, 218, 191, 0.12);
  color: var(--c-accent);
}

.i-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
  margin-top: 10px;
}

.i-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.i-field.wide {
  grid-column: 1 / -1;
}

.i-field span {
  font-size: var(--fs-xs);
  color: var(--c-text-3);
}

.i-field input {
  height: 34px;
  padding: 0 10px;
  border: 1px solid var(--c-border);
  border-radius: var(--r-md);
  background: var(--c-glass);
  color: var(--c-text);
  font-family: inherit;
  font-size: var(--fs-sm);
}

.i-field input:focus {
  outline: none;
  border-color: var(--c-primary);
}

.i-field input.ro {
  background: var(--c-bg-2);
  color: var(--c-text-3);
}

.i-foot {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 10px;
}

.i-pick,
.i-del {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 32px;
  padding: 0 12px;
  border: 1px solid var(--c-border);
  border-radius: var(--r-md);
  background: var(--c-surface);
  color: var(--c-text-2);
  font-family: inherit;
  font-size: var(--fs-xs);
  font-weight: 500;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}

.i-del {
  margin-left: auto;
  color: var(--c-danger);
}

/* 底部操作栏 */
.footbar {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 90;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 16px calc(10px + env(safe-area-inset-bottom));
  background: var(--c-glass-strong);
  backdrop-filter: blur(24px) saturate(160%);
  -webkit-backdrop-filter: blur(24px) saturate(160%);
  border-top: 1px solid var(--c-border-hairline);
}

.fb-btn {
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

.fb-btn.primary {
  border: none;
  background: var(--c-primary);
  color: #fff;
}

.fb-btn.ghost {
  border: 1px solid var(--c-border);
  background: var(--c-surface);
  color: var(--c-text);
}

.fb-btn.danger {
  flex: 0 0 auto;
  padding: 0 16px;
  border: 1px solid var(--c-danger);
  background: transparent;
  color: var(--c-danger);
}

.fb-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
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
