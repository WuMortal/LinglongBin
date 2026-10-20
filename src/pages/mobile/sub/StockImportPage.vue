<template>
  <SubPage :title="step === 0 ? '导入入库' : '匹配确认'">
    <div class="mpage">
      <!-- ===== Step 1：选文件 + 列映射 ===== -->
      <template v-if="step === 0">
        <div class="card">
          <h3 class="c-title">订单文件</h3>
          <!-- WebView 不支持拖拽上传，只走原生文件选择 -->
          <label class="file-pick">
            <input type="file" accept=".csv,.txt,.xls,.xlsx,.xlsm" @change="onFile" />
            <Upload :size="22" style="display: inline-flex; flex-shrink: 0" />
            <span>{{ files.length ? '重新选择文件' : '选择订单文件' }}</span>
            <small>支持 CSV / TXT / Excel</small>
          </label>
          <div v-if="files.length" class="file-chips">
            <span v-for="f in files" :key="f" class="fchip">
              {{ f }}
              <button title="移除" @click="clearFile"><X :size="11" style="display: inline-flex; flex-shrink: 0" /></button>
            </span>
          </div>
        </div>

        <div v-if="rows.length" class="card">
          <h3 class="c-title">列映射</h3>
          <p class="c-sub">已按「{{ presetName }}」方案自动识别，识别不准可手动改</p>
          <button v-for="f in fieldOpts" :key="f.key" class="map-row" @click="pickField(f.key)">
            <span class="mr-label">{{ f.label }}</span>
            <span class="mr-val" :class="{ ph: !mapLabel(f.key) }">
              {{ mapLabel(f.key) || '未识别' }}
              <ChevronRight :size="14" style="display: inline-flex; flex-shrink: 0" />
            </span>
          </button>
          <p class="c-sub mt">共解析 {{ rows.length }} 行</p>
        </div>

        <p v-if="err" class="error">{{ err }}</p>
        <div v-if="parsing" class="hint"><div class="spinner-lg" /></div>

        <div class="footbar">
          <button class="submit" :disabled="!rows.length" @click="goMatch">下一步（{{ rows.length }} 行）</button>
        </div>
      </template>

      <!-- ===== Step 2：匹配确认 ===== -->
      <template v-else>
        <div class="chip-row">
          <button class="chip" :class="{ on: filter === 'all' }" @click="filter = 'all'">全部 {{ rows.length }}</button>
          <button class="chip" :class="{ on: filter === 'matched' }" @click="filter = 'matched'">已匹配 {{ matchedCount }}</button>
          <button class="chip" :class="{ on: filter === 'unmatched' }" @click="filter = 'unmatched'">未匹配 {{ unmatchedCount }}</button>
        </div>

        <p v-if="err" class="error">{{ err }}</p>
        <div v-if="matching" class="hint"><div class="spinner-lg" /><span>匹配中…</span></div>

        <article v-for="r in visibleRows" :key="r.key" class="irow" :class="{ ok: !!r.material_id }">
          <div class="i-main">
            <h3>{{ r.name || r.model || '（无名称）' }}</h3>
            <p class="i-sub">{{ [r.model, r.partNo].filter(Boolean).join(' · ') || '—' }}</p>
            <div class="i-meta">
              <span class="qty">×{{ r.qty }}</span>
              <span v-if="r.price" class="price">¥{{ fmtPrice(r.price) }}</span>
              <span v-if="r.supplierName" class="sup">{{ r.supplierName }}</span>
            </div>
          </div>
          <div class="i-right">
            <span class="mstate" :class="r.material_id ? 'ok' : 'no'">
              {{ r.material_id ? (r.matchedName || '已匹配') : '未匹配' }}
            </span>
            <div class="i-ops">
              <button class="op" @click="openPicker(r.key)">{{ r.material_id ? '改' : '选' }}</button>
              <button v-if="r.material_id" class="op" @click="clearMatch(r.key)">撤</button>
            </div>
          </div>
        </article>

        <div v-if="!visibleRows.length" class="empty"><p>没有该状态的行</p></div>

        <div class="footbar">
          <button class="fb-btn ghost" @click="step = 0">上一步</button>
          <button class="fb-btn primary" :disabled="busy || !matchedCount" @click="doImport">
            <span v-if="busy" class="spinner-sm" />{{ busy ? '入库中…' : `批量入库 ${matchedCount}` }}
          </button>
        </div>
      </template>
    </div>

    <!-- 列选择 / 供应商等：底部 picker -->
    <BottomSheet :open="!!picker" :title="pickerTitle" @close="picker = null">
      <button v-for="o in pickerOptions" :key="String(o.value)" type="button" class="pk-item"
        :class="{ on: o.value === currentMapValue }" @click="applyPick(o.value)">
        <span>{{ o.label }}</span>
        <Check v-if="o.value === currentMapValue" :size="16" style="display: inline-flex; flex-shrink: 0" />
      </button>
    </BottomSheet>

    <!-- 手动绑定物料（移动端不走立创，allow-lcsc 必须显式关掉） -->
    <MaterialBindDialog v-model="pickerMatOpen" desc="绑定到已有物料" :allow-lcsc="false"
      :categories="cats" @select="onPickMaterial" />
  </SubPage>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { Upload, X, ChevronRight, Check } from 'lucide-vue-next'
import SubPage from '../../../components/mobile/SubPage.vue'
import BottomSheet from '../../../components/mobile/BottomSheet.vue'
import MaterialBindDialog from '../../../components/business/MaterialBindDialog.vue'
import {
  matchMaterialsByKeys, stockInOrder, listCategories, listSuppliers,
} from '../../../lib/db'
import {
  parseSheet, pickPreset, detectColumnsPrecise,
  type ParsedSheet, type ImportPreset, type ColDetectMap,
} from '../../../lib/importParser'
import { withAuthRetry } from '../../../lib/authRetry'
import { useToast } from '../../../composables/toast'
import { useStockData } from '../../../composables/useStockData'
import type { Category, MaterialRow } from '../../../lib/types'

/**
 * 移动端导入入库（两步向导拆成同一页的两个 step，不再塞进桌面式弹窗）：
 * Step1 选文件 + 列映射（自动识别 + 手动改）→ Step2 匹配确认（卡片流）→ 批量入库。
 * 与桌面 StockImport 的差异（见 demo/MOBILE_STOCK_PLAN.md）：
 * - 拖拽上传 → 只走 <input type="file">（WebView 不支持拖拽）
 * - 13 个 AppSelect → 5 个关键列的底部 picker；DataTable → 卡片流
 * - 不含「立创匹配 / 新建物料草稿 / 金额校验」，未匹配行需先手动绑定，否则跳过
 */
const router = useRouter()
const toast = useToast()
const { refreshList, refreshSummary, refreshLogs } = useStockData()

/** 导入行（与桌面 ImpRow 同构，去掉草稿/立创相关字段） */
interface ImpRow {
  key: string
  model: string
  name: string
  qty: number
  price: number | null
  partNo: string
  supplierName: string
  material_id: string | null
  matchedName: string | null
  manual: boolean
}

const step = ref(0)
const files = ref<string[]>([])
const parsing = ref(false)
const matching = ref(false)
const busy = ref(false)
const err = ref('')

const headers = ref<string[]>([])
const dataRows = ref<string[][]>([])
const preset = ref<ImportPreset | null>(null)
const autoMap = ref<ColDetectMap>({})
/** 手动覆盖：字段 → 列索引 */
const manualMap = ref<Record<string, number | null>>({})
const rows = ref<ImpRow[]>([])
const filter = ref<'all' | 'matched' | 'unmatched'>('all')

const cats = ref<Category[]>([])

/** 可映射的关键字段 */
const fieldOpts = [
  { key: 'model', label: '型号列' },
  { key: 'name', label: '名称列' },
  { key: 'part_no', label: '商品编号列' },
  { key: 'qty', label: '数量列' },
  { key: 'price', label: '单价列' },
]
const presetName = computed(() => preset.value?.name || '通用')

/** 生效映射：手动优先 */
function colOf(field: string): number | null {
  const m = manualMap.value[field]
  if (m != null && m >= 0) return m
  const a = autoMap.value[field]
  return a == null ? null : a
}
function mapLabel(field: string) {
  const i = colOf(field)
  return i == null ? '' : (headers.value[i] || `第 ${i + 1} 列`)
}

// ===== 列 picker =====
const picker = ref<string | null>(null)
const pickerTitle = computed(() => fieldOpts.find(f => f.key === picker.value)?.label || '选择列')
const pickerOptions = computed(() => [
  { value: null as number | null, label: '不使用' },
  ...headers.value.map((h, i) => ({ value: i as number | null, label: `${i + 1}. ${h || '(空)'}` })),
])
const currentMapValue = computed<number | null>(() => (picker.value ? colOf(picker.value) : null))
function pickField(field: string) { picker.value = field }
function applyPick(v: number | null) {
  if (picker.value) manualMap.value[picker.value] = v
  picker.value = null
  rebuildRows()
}

// ===== 解析 =====
async function onFile(e: Event) {
  const input = e.target as HTMLInputElement
  const list = Array.from(input.files || [])
  input.value = ''
  if (!list.length) return
  parsing.value = true
  err.value = ''
  try {
    // 移动端一次处理一份（多文件反而易选错表头）
    const f = list[0]
    const sheet: ParsedSheet = parseSheet(await f.arrayBuffer())
    headers.value = sheet.headers
    dataRows.value = sheet.rows
    preset.value = pickPreset(sheet.headers)
    autoMap.value = detectColumnsPrecise(sheet.headers, preset.value.rules)
    manualMap.value = {}
    files.value = [f.name]
    rebuildRows()
  } catch {
    err.value = '无法解析该文件，请检查格式'
  } finally {
    parsing.value = false
  }
}

function clearFile() {
  files.value = []
  headers.value = []
  dataRows.value = []
  rows.value = []
  err.value = ''
}

function cell(r: string[], field: string): string {
  const i = colOf(field)
  return i == null ? '' : (r[i] ?? '').trim()
}

let seed = 0
function rebuildRows() {
  rows.value = dataRows.value
    .filter(r => r.some(c => (c ?? '').trim() !== ''))
    .map(r => ({
      key: `i${seed++}`,
      model: cell(r, 'model'),
      name: cell(r, 'name'),
      qty: Number(cell(r, 'qty').replace(/[^\d.-]/g, '')) || 0,
      price: Number(cell(r, 'price').replace(/[^\d.-]/g, '')) || null,
      partNo: cell(r, 'part_no'),
      supplierName: cell(r, 'supplier'),
      material_id: null,
      matchedName: null,
      manual: false,
    }))
}

function normKey(v?: string | null) { return (v ?? '').trim().toLowerCase() }

/** 一键匹配：批量查候选 → 精确优先、子串兜底（与桌面 matchAllImp 同口径） */
async function matchAll() {
  if (!rows.value.length) return
  matching.value = true
  err.value = ''
  try {
    const keys: string[] = []
    for (const r of rows.value) {
      if (r.manual) continue
      if (r.model) keys.push(r.model)
      if (r.partNo) keys.push(r.partNo)
    }
    const pool = await withAuthRetry(() => matchMaterialsByKeys(keys))
    const exact = new Map<string, MaterialRow>()
    for (const m of pool) {
      for (const k of [m.model, m.part_no, m.name]) {
        const nk = normKey(k)
        if (nk && !exact.has(nk)) exact.set(nk, m)
      }
    }
    for (const r of rows.value) {
      if (r.manual) continue
      let hit: MaterialRow | null = null
      for (const k of [r.model, r.partNo]) {
        const nk = normKey(k)
        if (!nk) continue
        hit = exact.get(nk) ?? null
        if (!hit) {
          hit = pool.find(m =>
            normKey(m.model).includes(nk) || normKey(m.part_no).includes(nk) || normKey(m.name).includes(nk),
          ) ?? null
        }
        if (hit) break
      }
      if (hit) { r.material_id = hit.id; r.matchedName = hit.name }
    }
  } catch (e: unknown) {
    err.value = '匹配失败：' + ((e as Error).message || e)
  } finally {
    matching.value = false
  }
}

function goMatch() {
  if (!rows.value.length) { err.value = '请先导入文件'; return }
  step.value = 1
  void matchAll()
}

const matchedCount = computed(() => rows.value.filter(r => r.material_id).length)
const unmatchedCount = computed(() => rows.value.filter(r => !r.material_id).length)
const visibleRows = computed(() => {
  if (filter.value === 'matched') return rows.value.filter(r => r.material_id)
  if (filter.value === 'unmatched') return rows.value.filter(r => !r.material_id)
  return rows.value
})

// ===== 手动绑定 =====
const pickerMatOpen = ref(false)
const pickKey = ref<string | null>(null)
function openPicker(key: string) { pickKey.value = key; pickerMatOpen.value = true }
function onPickMaterial(p: { kind: string; item?: unknown }) {
  const r = rows.value.find(x => x.key === pickKey.value)
  const m = p.item as MaterialRow
  if (r && m?.id) {
    r.material_id = m.id
    r.matchedName = m.name
    r.manual = true
  }
  pickerMatOpen.value = false
  pickKey.value = null
}
function clearMatch(key: string) {
  const r = rows.value.find(x => x.key === key)
  if (r) { r.material_id = null; r.matchedName = null; r.manual = true }
}

function fmtPrice(v: number) {
  return Number.isInteger(v) ? String(v) : v.toFixed(2)
}

/** 批量入库：只入已匹配且数量 > 0 的行，合成一张入库单（source=import） */
async function doImport() {
  const picked = rows.value.filter(r => r.material_id && r.qty > 0)
  if (!picked.length) { err.value = '没有可入库的行'; return }
  busy.value = true
  err.value = ''
  try {
    // 供应商按名称匹配一次字典，取第一个命中挂在明细上
    let suppliers: Array<{ id: string; name: string }> = []
    try { suppliers = await listSuppliers() } catch { /* 静默 */ }
    const note = files.value[0] ? `订单导入：${files.value[0]}` : '订单导入'
    await withAuthRetry(() => stockInOrder({
      type: 'in', source: 'import', source_id: null,
      title: note, note,
      items: picked.map(r => ({
        material_id: r.material_id as string,
        qty: r.qty,
        note: [r.model, r.partNo].filter(Boolean).join(' ') || null,
        supplier_id: suppliers.find(s => r.supplierName && (s.name === r.supplierName || s.name.includes(r.supplierName)))?.id ?? null,
      })),
    }))
    await Promise.all([refreshList(), refreshSummary(), refreshLogs()])
    toast.success(`入库完成 ${picked.length} 项`)
    router.back()
  } catch (e: unknown) {
    err.value = '入库失败：' + ((e as Error).message || e)
  } finally {
    busy.value = false
  }
}

onMounted(async () => {
  try { cats.value = await listCategories() } catch { /* 静默 */ }
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

.c-title {
  margin: 0;
  font-size: var(--fs-sm);
  font-weight: 600;
}

.c-sub {
  margin: 4px 0 0;
  font-size: var(--fs-xs);
  color: var(--c-text-3);
}

.c-sub.mt {
  margin-top: 10px;
}

/* 文件选择 */
.file-pick {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  margin-top: 10px;
  padding: 20px 12px;
  border: 1px dashed var(--c-border-strong);
  border-radius: var(--r-md);
  background: var(--c-glass);
  color: var(--c-primary);
  cursor: pointer;
}

.file-pick input {
  display: none;
}

.file-pick span {
  font-size: var(--fs-sm);
  font-weight: 600;
}

.file-pick small {
  font-size: var(--fs-xs);
  color: var(--c-text-3);
}

.file-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 10px;
}

.fchip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 24px;
  padding: 0 6px 0 9px;
  border-radius: var(--r-sm);
  background: var(--c-primary-soft);
  color: var(--c-primary);
  font-size: var(--fs-xs);
  font-weight: 600;
  max-width: 100%;
}

.fchip button {
  border: none;
  background: transparent;
  color: inherit;
  display: inline-flex;
  cursor: pointer;
  padding: 0;
}

/* 列映射行 */
.map-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  height: 44px;
  padding: 0 2px;
  border: none;
  border-bottom: 1px solid var(--c-border-hairline);
  background: transparent;
  font-family: inherit;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}

.mr-label {
  font-size: var(--fs-sm);
  color: var(--c-text-2);
}

.mr-val {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: var(--fs-sm);
  color: var(--c-text);
  max-width: 60%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mr-val.ph {
  color: var(--c-text-3);
}

/* 匹配卡片 */
.chip-row {
  display: flex;
  gap: 6px;
  overflow-x: auto;
  scrollbar-width: none;
}

.chip-row::-webkit-scrollbar {
  display: none;
}

.chip {
  flex-shrink: 0;
  height: 30px;
  padding: 0 12px;
  border: 1px solid var(--c-border);
  border-radius: 999px;
  background: var(--c-surface);
  color: var(--c-text-2);
  font-family: inherit;
  font-size: var(--fs-xs);
  font-weight: 500;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}

.chip.on {
  border-color: var(--c-primary);
  background: var(--c-primary-soft);
  color: var(--c-primary);
  font-weight: 600;
}

.irow {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  background: var(--c-surface);
  border: 1px solid var(--c-border);
  border-radius: var(--r-lg);
}

.irow.ok {
  border-color: rgba(52, 218, 191, 0.35);
}

.i-main {
  flex: 1;
  min-width: 0;
}

.i-main h3 {
  margin: 0;
  font-size: var(--fs-sm);
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.i-sub {
  margin: 2px 0 0;
  font-size: var(--fs-xs);
  color: var(--c-text-3);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.i-meta {
  display: flex;
  gap: 8px;
  margin-top: 4px;
  font-size: var(--fs-xs);
  color: var(--c-text-2);
  flex-wrap: wrap;
}

.i-meta .qty {
  font-weight: 700;
  color: var(--c-text);
  font-variant-numeric: tabular-nums;
}

.i-right {
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 6px;
  max-width: 42%;
}

.mstate {
  font-size: var(--fs-xs);
  font-weight: 600;
  color: var(--c-text-3);
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mstate.ok {
  color: var(--c-accent);
}

.mstate.no {
  color: var(--c-danger);
}

.i-ops {
  display: flex;
  gap: 6px;
}

.op {
  min-width: 32px;
  height: 28px;
  padding: 0 8px;
  border: 1px solid var(--c-border);
  border-radius: var(--r-sm);
  background: var(--c-glass);
  color: var(--c-text-2);
  font-family: inherit;
  font-size: var(--fs-xs);
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}

/* 底部栏 */
.footbar {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 90;
  display: flex;
  gap: 8px;
  padding: 10px 16px calc(10px + env(safe-area-inset-bottom));
  background: var(--c-glass-strong);
  backdrop-filter: blur(24px) saturate(160%);
  -webkit-backdrop-filter: blur(24px) saturate(160%);
  border-top: 1px solid var(--c-border-hairline);
}

.submit,
.fb-btn {
  flex: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  height: 44px;
  border-radius: var(--r-md);
  font-family: inherit;
  font-size: var(--fs-md);
  font-weight: 700;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}

.submit {
  border: none;
  background: var(--c-primary);
  color: #fff;
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

.submit:disabled,
.fb-btn:disabled {
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
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 24px 0;
  color: var(--c-text-3);
  font-size: var(--fs-sm);
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
