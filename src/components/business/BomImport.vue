<script setup lang="ts">
// BOM 导入：文件/文本导入 → 列映射 → 库存匹配 → 缺料补建立创取数 → 保存
// 自持全部导入态，父组件只需 v-model 控制开关并监听 saved 刷新列表。
// 步骤条复用通用组件 WizardSteps，此处只负责容器布局。
import { ref, computed, watch } from 'vue'
import { useToast } from '../../composables/toast'
import MaterialPickerDialog from './MaterialBindDialog.vue'
import MaterialFormDialog from './MaterialFormDialog.vue'
import MaterialMatchPill from './MaterialMatchPill.vue'
import MaterialSourceOps from './MaterialSourceOps.vue'
import {
  Upload, Settings, RefreshCw, Save, FileText, ChevronLeft, CircleAlert, Wand,
} from 'lucide-vue-next'
import {
  matchMaterialByModel, createBomProject, createBomItems, createMaterial,
  getMaterialsByIds,
  createMaterialFiles, listCategories,
} from '../../lib/db'
import type { MaterialRow, MaterialDraft, Category, MaterialFormResult } from '../../lib/types'
import { lcscLookup, isLcscCode, type LcscComponent, type LcscHit } from '../../lib/lcscApi'
import { matchLcscBatch } from '../../lib/lcscAutoMatch'
import { parseSheet, detectColumns } from '../../lib/importParser'
import AppSelect from '../form/AppSelect.vue'
import WizardSteps from '../WizardSteps.vue'
import DataTable from '../DataTable.vue'
import type { DtColumn } from '../DataTable.vue'
import ProgressOverlay from '../ProgressOverlay.vue'

const props = defineProps<{
  /** 是否显示向导 */
  modelValue: boolean
}>()
const emit = defineEmits<{
  'update:modelValue': [v: boolean]
  /** 保存成功后触发，父组件应刷新 BOM 项目列表 */
  saved: []
}>()

const toast = useToast()

const visible = computed({
  get: () => props.modelValue,
  set: (v: boolean) => emit('update:modelValue', v),
})

// ===== 步骤 =====
const step = ref(0)
const wizardSteps = [
  { title: '导入配置', desc: '选择文件 / 粘贴文本，自动识别列' },
  { title: '匹配结果', desc: '核对库存、缺料与补建物料' },
]

/** 列映射 / 数据完整性校验：通过返回 null，否则返回错误提示 */
function validateImport(): string | null {
  if (!rows.value.length) return '请先导入文件并完成解析'
  if (colMap.value.qty == null) return '请先在「列映射」中指定「数量」列'
  if (colMap.value.model == null && colMap.value.value == null && colMap.value.partNo == null)
    return '请至少指定「型号 / 值 / 商品编码」之一用于识别物料'
  return null
}

function goStep(i: number) {
  if (busy.value || saving.value) return
  // 进入「匹配结果 / 保存」步骤前，项目名称与列映射必填
  if (i >= 1) {
    if (!projectName.value.trim()) { nameErr.value = '请填写项目名称'; return }
    const ve = validateImport()
    if (ve) { err.value = ve; return }
  }
  step.value = i
}

/** 点击弹窗外部是否关闭向导（导入过程中误触会丢失已解析数据，默认不关闭） */
const wizardCloseOnMask = false

function onMaskClick() {
  if (wizardCloseOnMask) visible.value = false
}

// ===== 导入数据 =====
interface BomRow {
  /** 本地行键 */
  key: string
  desig: string
  /** 厂家型号（商品型号 / Manufacturer Part），优先匹配键 */
  model: string
  /** 原始值（参数 / Name），次级匹配键 */
  value: string
  /** 商品编码（C 码），最精确匹配键 */
  partNo: string
  pkg: string
  qty: number
  material_id: string | null
  matchedName: string
  confidence: number
  stockQty: number | null
  short: boolean
  alternates: string[]
  altIdx: number
  origId: string | null
  origName: string
  origQty: number | null
  origConf: number
  /** 勾选加入待采购单（未匹配 / 缺料的行，保存时生成待采明细） */
  buy: boolean
  /** 待创建的物料（暂存，未落库）：有值即行处于「待创建」态，点保存时才建料 + 入库 + 附件 */
  pending: MaterialDraft | null
  /** 一键匹配命中的立创详情：存下来供「编辑」直接回填表单，无需重新联网查询 */
  lcsc: LcscComponent | null
  lcscPrice: number | null
  /** 正在联网取立创详情（打开新增物料表单前） */
  formBusy: boolean
}
interface Candidate extends MaterialRow { score: number }

const raw = ref('')
const projectName = ref('')
const headers = ref<string[]>([])
/** 最近一次解析出的数据行（不含表头），供调整列映射后重建 */
const lastData = ref<string[][]>([])
/** 解析后写入预览框的文本，用于判断用户是否改动了文本 */
const previewText = ref('')
const rows = ref<BomRow[]>([])
const err = ref('')
/** 项目名称专属错误，显示在输入框下方（与底部通用 err 分开） */
const nameErr = ref('')
// 用户开始填写项目名称后，自动清除其错误提示
watch(projectName, () => { if (projectName.value.trim()) nameErr.value = '' })
const busy = ref(false)
const saving = ref(false)
const dragging = ref(false)
const fileName = ref('')

/** 打开向导时重置全部导入态 */
function resetAll() {
  raw.value = ''
  projectName.value = ''
  headers.value = []
  lastData.value = []
  previewText.value = ''
  rows.value = []
  err.value = ''
  fileName.value = ''
  colMap.value = emptyColMap()
  step.value = 0
  matchFilter.value = 'all'
  pickerFor.value = null
}
watch(() => props.modelValue, v => { if (v) resetAll() })

// ===== 列映射 =====
interface ColMap { partNo: number | null; model: number | null; value: number | null; qty: number | null; desig: number | null; pkg: number | null }
const emptyColMap = (): ColMap => ({ partNo: null, model: null, value: null, qty: null, desig: null, pkg: null })
const colMap = ref<ColMap>(emptyColMap())

/** 各逻辑列的关键词（header 小写后做 includes 匹配） */
const COL_RULES: Array<[keyof ColMap, string[]]> = [
  ['partNo', ['商品编码', '商品编号', 'supplier part', '物料编码']],
  ['model', ['商品型号', '型号', 'manufacturer part', 'part number', 'mpn', '规格型号']],
  ['value', ['参数', 'name', 'value', 'comment', '规格', '物料', '名称']],
  ['qty', ['数量', 'quantity', 'qty']],
  ['desig', ['位号', 'designator', 'identifier', '标识']],
  ['pkg', ['封装', 'footprint', 'package']],
]

function autoDetect(h: string[]): ColMap {
  const m = detectColumns(h, COL_RULES) as unknown as ColMap
  // 型号列缺失时退回值列
  if (m.model == null) m.model = m.value
  return m
}

function opts(ph: string) {
  return [{ value: null, label: ph }, ...headers.value.map((h, i) => ({ value: i, label: h }))]
}

// ===== 解析（统一走 importParser，支持 GBK 编码 CSV / 表头定位） =====

function pick(r: string[], idx: number | null): string {
  return idx != null ? (r[idx] || '').trim() : ''
}

/** 按当前列映射将原始行构建为 BomRow */
function buildRows(d: string[][]) {
  const m = colMap.value
  rows.value = d.map((r, i) => {
    const model = pick(r, m.model)
    const value = pick(r, m.value)
    const pkg = pick(r, m.pkg)
    return {
      key: `r${i}`,
      desig: pick(r, m.desig),
      model, value, pkg,
      partNo: pick(r, m.partNo),
      qty: Math.max(1, parseInt((pick(r, m.qty) || '1').replace(/[^0-9]/g, '')) || 1),
      material_id: null, matchedName: '', confidence: 0, stockQty: null, short: false,
      alternates: [], altIdx: 0,
      origId: null, origName: '', origQty: null, origConf: 0,
      buy: false,
      pending: null,
      lcsc: null,
      lcscPrice: null,
      formBusy: false,
    }
  }).filter(r => r.model || r.value || r.desig)
}

/** 应用解析结果：识别列 → 建行 → 匹配 */
function applyParsed(h: string[], d: string[][], src: string) {
  headers.value = h
  lastData.value = d
  colMap.value = autoDetect(h)
  previewText.value = [h.join('\t'), ...d.slice(0, 50).map(r => r.join('\t'))].join('\n')
  raw.value = previewText.value
  buildRows(d)
  if (!rows.value.length) {
    const cols = h.filter(Boolean).slice(0, 8).join(' / ')
    err.value = `「${src}」未识别到数据行（表头：${cols || '无'}），请展开「手动指定列映射」检查`
    return
  }
  err.value = ''
  matchAll()
}

async function onFile(e: Event) {
  const input = e.target as HTMLInputElement
  const f = input.files?.[0]
  if (!f) return
  input.value = '' // 允许重复选择同一文件
  fileName.value = f.name
  await loadFile(await f.arrayBuffer(), f.name)
}

async function onDrop(e: DragEvent) {
  dragging.value = false
  const f = e.dataTransfer?.files?.[0]
  if (!f) return
  fileName.value = f.name
  await loadFile(await f.arrayBuffer(), f.name)
}

async function loadFile(buf: ArrayBuffer, fname: string) {
  err.value = ''
  const { headers: h, rows: d } = parseSheet(buf)
  if (!h.length) { rows.value = []; err.value = `无法解析「${fname}」，请检查文件格式`; return }
  applyParsed(h, d, fname)
}

/** 映射改动后自动重新应用（防抖，与 Stock 导入一致：改映射即时重算并重新匹配库存） */
let rebuildTimer: ReturnType<typeof setTimeout> | undefined
function scheduleRebuild() {
  if (rebuildTimer) clearTimeout(rebuildTimer)
  rebuildTimer = setTimeout(() => {
    if (!lastData.value.length) return
    buildRows(lastData.value)
    if (!rows.value.length) { err.value = '未识别到有效数据行，请检查列映射'; return }
    err.value = ''
    matchAll()
  }, 250)
}

watch(colMap, scheduleRebuild, { deep: true })

// ===== 匹配 =====
async function matchAll() {
  busy.value = true
  try {
    for (const r of rows.value) {
      const best = await matchRow(r)
      if (best) {
        r.material_id = best.id; r.matchedName = best.name; r.confidence = best.score
        r.stockQty = best.qty; r.alternates = best.alternates || []; r.altIdx = 0
        r.short = best.qty < r.qty
        r.origId = best.id; r.origName = best.name; r.origQty = best.qty; r.origConf = best.score
      }
      // 未匹配 / 缺料的行默认加入待采单，用户可自行取消
      r.buy = !r.material_id || r.short
    }
  } catch (e: unknown) { err.value = '匹配失败：' + ((e as Error).message || e) }
  finally { busy.value = false }
}

/** 依次以 商品编码 → 厂家型号 → 原始值 匹配库存 */
async function matchRow(r: BomRow): Promise<Candidate | null> {
  for (const k of [r.partNo, r.model, r.value]) {
    if (!k) continue
    const best = scoreBest(r, await matchMaterialByModel(k))
    if (best) return best
  }
  return null
}

function scoreBest(r: BomRow, cands: MaterialRow[]): Candidate | null {
  if (!cands.length) return null
  let best: Candidate | null = null
  for (const c of cands) {
    let score = 50
    const cm = (c.model || '').toLowerCase(), rm = (r.model || '').toLowerCase()
    if (r.partNo && c.part_no && c.part_no.toLowerCase() === r.partNo.toLowerCase()) score = 100
    else if (cm && rm && cm === rm) score = 100
    else if (cm && rm && (cm.includes(rm) || rm.includes(cm))) score = 80
    if (r.pkg && c.package && c.package.toLowerCase() === r.pkg.toLowerCase()) score = Math.min(100, score + 15)
    if (!best || score > best.score) best = { ...c, score }
  }
  return best
}

// ===== 替代料 / 手动选择 =====
/** 当前等待手动选择的目标行（自身库 + 立创查 共用同一弹窗） */
const pickerFor = ref<BomRow | null>(null)

const altCache = ref<Map<string, MaterialRow>>(new Map())
async function ensureAlts(r: BomRow) {
  const missing = r.alternates.filter(id => !altCache.value.has(id))
  if (!missing.length) return
  const rows = await getMaterialsByIds(missing)
  for (const row of rows) altCache.value.set(row.id, row)
}

async function cycleAlt(r: BomRow) {
  if (!r.alternates.length) return
  err.value = ''
  r.altIdx = (r.altIdx + 1) % (r.alternates.length + 1)
  if (r.altIdx === 0) {
    r.material_id = r.origId; r.matchedName = r.origName; r.stockQty = r.origQty
    r.confidence = r.origConf; r.short = (r.origQty ?? 0) < r.qty
    return
  }
  await ensureAlts(r)
  const alt = altCache.value.get(r.alternates[r.altIdx - 1])
  if (alt) applyAlt(r, alt)
}

function applyAlt(r: BomRow, alt: MaterialRow) {
  r.material_id = alt.id; r.matchedName = alt.name; r.stockQty = alt.qty
  r.confidence = 85; r.short = alt.qty < r.qty
}

/**
 * 打开「选择物料」弹窗：新建物料 / 自身库 / 立创商城 三个来源共用这一个入口，
 * 行上不再单独放「新建」按钮（新建并入弹窗的「新建物料」tab）。
 */
async function pickManual(r: BomRow) {
  await ensureCategories()
  pickerFor.value = r
}

/**
 * 选择弹窗统一回调：
 *   - 自身库命中：直接绑定到目标行
 *   - 立创命中：取详情后打开「新增物料」表单（立创预填、暂存不落库），确认后行进入「待创建」
 *   - 弹窗内新建：直接拿到草稿，行进入「待创建」
 */
function choosePicked(
  p: { kind: 'material' | 'lcsc'; item: MaterialRow | LcscHit } | { kind: 'draft'; draft: MaterialDraft },
) {
  const r = pickerFor.value
  if (!r) return
  pickerFor.value = null
  if (p.kind === 'material') {
    const c = p.item as MaterialRow
    r.pending = null
    r.material_id = c.id; r.matchedName = c.name; r.confidence = 90
    r.stockQty = c.qty; r.short = c.qty < r.qty; r.alternates = []; r.altIdx = 0
    r.origId = c.id; r.origName = c.name; r.origQty = c.qty; r.origConf = 90
  } else if (p.kind === 'draft') {
    applyPendingDraft(r, p.draft)
  } else {
    void openLcscForm(r, p.item as LcscHit)
  }
}

// ===== 立创 → 新增物料表单（预填 + 暂存） =====
/** 分类数据（新增物料表单需要大类 / 小类 / 参数模板） */
const categories = ref<Category[]>([])

/** 确保分类数据已加载（打开向导即预取；打开「新增物料」表单的各入口也共用此兜底） */
async function ensureCategories() {
  if (categories.value.length) return
  try { categories.value = await listCategories() } catch { categories.value = [] }
}

/** 「新增物料」表单（立创预填）当前目标行 */
const formRow = ref<BomRow | null>(null)
const showMaterialForm = ref(false)
/** 待预填的立创详情 */
const formLcsc = ref<LcscComponent | null>(null)
const formLcscPrice = ref<number | null>(null)
/** 普通预填（非编辑 / 非立创）：用导入行数据直接新建物料 */
const formPrefill = ref<Partial<MaterialDraft> | null>(null)
/** 新增物料表单标题：编辑草稿 / 立创预填 / 按行新建 三种场景区分 */
const formTitle = computed(() => {
  const r = formRow.value
  if (!r) return undefined
  if (r.pending) return '编辑待创建物料'
  return r.lcsc ? '新增物料（来自立创）' : '新增物料'
})
/** 用 BOM 行数据生成新增物料表单的预填 */
function rowPrefill(r: BomRow): Partial<MaterialDraft> {
  return {
    name: r.value || r.model || r.desig,
    model: r.model,
    brand: '',
    package: r.pkg ?? '',
    part_no: r.partNo ?? '',
    link: '',
  }
}
/** 「选择物料」弹窗「新建物料」tab 的预填：已有草稿就接着草稿改，否则用本行数据 */
const pickerPrefill = computed<Partial<MaterialDraft> | null>(() => {
  const r = pickerFor.value
  if (!r) return null
  return r.pending ?? rowPrefill(r)
})

watch(() => props.modelValue, (v) => {
  if (v) void ensureCategories()
}, { immediate: true })

/** 选中立创商品：取详情 → 打开新增物料表单（deferPersist：保存不落库，草稿绑定行） */
async function openLcscForm(r: BomRow, h: LcscHit) {
  if (r.formBusy) return
  r.formBusy = true
  try {
    const d = await lcscLookup(h.part_no)
    // 表单按立创分类编码自动匹配分类，分类数据未就绪则现取
    await ensureCategories()
    formRow.value = r
    formLcsc.value = d
    formLcscPrice.value = h.price ?? null
    showMaterialForm.value = true
  } catch (e: unknown) {
    toast.error('查立创详情失败：' + ((e as Error).message || e))
  } finally {
    r.formBusy = false
  }
}

/** 草稿落到行上进入「待创建」（不落库，保存 BOM 时统一建料入库） */
function applyPendingDraft(r: BomRow, draft: MaterialDraft) {
  r.material_id = null; r.matchedName = ''; r.confidence = 0
  r.stockQty = null; r.short = false; r.alternates = []; r.altIdx = 0
  r.pending = draft
  r.buy = true // 未入库的待创建物料默认加入待采，用户可自行取消
  toast.success(`「${draft.name}」已加入待创建，保存 BOM 时一并建料入库`)
}

/** 新增物料表单保存：把「待创建」草稿绑定到行（不落库，随 BOM 保存统一建料入库） */
function onMaterialFormSaved(res: MaterialFormResult) {
  const r = formRow.value
  formRow.value = null
  formLcsc.value = null
  formLcscPrice.value = null
  if (!r) return
  applyPendingDraft(r, res.draft)
}

/** 新增物料表单开关：关闭（取消）时丢弃本次选择 */
function onFormDialogToggle(v: boolean) {
  showMaterialForm.value = v
  if (!v) {
    formRow.value = null
    formLcsc.value = null
    formLcscPrice.value = null
    formPrefill.value = null
  }
}

// ===== 一键匹配立创 =====
const lcscMatching = ref(false)
const lcscProg = ref({ done: 0, total: 0, kw: '' })
/** 可参与一键匹配的行：未绑定（无物料、无待创建草稿）且有可搜索的型号 / 名称 */
const matchableRows = computed(() =>
  rows.value.filter(r => !r.material_id && !r.pending && (r.model || r.value || r.partNo)),
)

/** 为所有未绑定行自动查立创，命中即生成「待创建」草稿（不落库，保存时统一建料） */
async function autoMatchLcsc() {
  const targets = matchableRows.value
  if (!targets.length || lcscMatching.value) return
  // 分类用于按立创分类编码定位本地分类，未就绪则现取
  await ensureCategories()
  lcscMatching.value = true
  try {
    const res = await matchLcscBatch(
      targets.map(r => ({ keyword: r.model || r.value || r.partNo, partNo: r.partNo })),
      categories.value,
      p => { lcscProg.value = { done: p.done, total: p.total, kw: p.keyword } },
    )
    let ok = 0, noHit = 0, fail = 0
    res.forEach((o, i) => {
      const r = targets[i]
      if (o.status === 'ok' && o.draft && o.lcsc) {
        r.material_id = null; r.matchedName = ''; r.confidence = 0
        r.stockQty = null; r.short = false; r.alternates = []; r.altIdx = 0
        r.pending = o.draft
        r.lcsc = o.lcsc
        r.lcscPrice = o.price ?? null
        r.buy = true // 与手工新增一致：待创建默认加入待采，用户可自行取消
        ok++
      } else if (o.status === 'no-hit') noHit++
      else fail++
    })
    const parts = [`匹配成功 ${ok}`]
    if (noHit) parts.push(`立创无结果 ${noHit}`)
    if (fail) parts.push(`失败 ${fail}`)
    const msg = `立创匹配完成：${parts.join('，')}`
    if (ok) toast.success(msg)
    else toast.warning(msg)
  } catch (e: unknown) {
    toast.error('匹配立创失败：' + ((e as Error).message || e))
  } finally {
    lcscMatching.value = false
    // 稍延迟清除进度，让用户看到 100%
    setTimeout(() => { lcscProg.value = { done: 0, total: 0, kw: '' } }, 600)
  }
}

/**
 * 编辑「待创建」草稿：始终打开新增物料表单并以草稿内容回填（分类 / 参数 / 图片 / 附件一并带回），
 * 不再跳「选择物料」弹窗 —— 想改绑已有物料走行上的「改选」。
 */
async function editPending(r: BomRow) {
  await ensureCategories()
  formRow.value = r
  formLcsc.value = null
  formLcscPrice.value = null
  formPrefill.value = r.pending
  showMaterialForm.value = true
}

/** 撤销：回到「未匹配」，未匹配 / 缺料的行仍默认加入待采 */
function clearMatch(r: BomRow) {
  r.material_id = null; r.matchedName = ''; r.confidence = 0
  r.stockQty = null; r.short = false
  r.pending = null; r.lcsc = null; r.lcscPrice = null
  r.alternates = []; r.altIdx = 0
  r.origId = null; r.origName = ''; r.origQty = null; r.origConf = 0
  r.buy = true
}

// ===== 匹配结果统计与筛选 =====
const matchFilter = ref<'all' | 'matched' | 'unmatched'>('all')
const filteredRows = computed(() => {
  if (matchFilter.value === 'matched') return rows.value.filter(r => r.material_id)
  if (matchFilter.value === 'unmatched') return rows.value.filter(r => !r.material_id && !r.pending)
  return rows.value
})
/** 筛选后无数据时的空态文案 */
const emptyHint = computed(() => {
  if (!rows.value.length) return { title: '导入 BOM 开始匹配', desc: '导入后自动匹配库存、识别缺料' }
  if (matchFilter.value === 'matched') return { title: '暂无已匹配的物料', desc: '切换「全部」查看其它行' }
  return { title: '暂无未匹配的物料', desc: '切换「全部」查看其它行' }
})

const matchedCount = computed(() => rows.value.filter(r => r.material_id).length)
/** 待创建：已确认新增但尚未落库（随保存统一建料入库） */
const pendingCount = computed(() => rows.value.filter(r => r.pending).length)
const unmatchedCount = computed(() => rows.value.filter(r => !r.material_id && !r.pending).length)
const shortCount = computed(() => rows.value.filter(r => r.short).length)

// ===== 待采购勾选（暂时注释：待采功能下线） =====
// /** 需要采购的行：未匹配（无此物料）或库存不足 */
// const buyableRows = computed(() => rows.value.filter(r => !r.material_id || r.short))
// const buyCount = computed(() => rows.value.filter(r => r.buy).length)
// const allBuyChecked = computed(() =>
//   buyableRows.value.length > 0 && buyableRows.value.every(r => r.buy))
//
// function setBuy(r: BomRow, on: boolean) {
//   r.buy = on
// }
//
// /** 一键勾选/取消全部需采购行的待采 */
// function toggleBuyAll() {
//   const on = !allBuyChecked.value
//   for (const r of buyableRows.value) r.buy = on
// }

// ===== 保存 =====
async function saveBom() {
  err.value = ''
  if (!projectName.value.trim()) { nameErr.value = '请填写项目名称'; return }
  // 列映射 / 数据完整性校验：缺失则跳回「列映射」步骤并提示
  const ve = validateImport()
  if (ve) { err.value = ve; step.value = 0; return }
  // 待创建的行无需额外校验（新增物料表单已强制名称 / 大类 / 小类）
  saving.value = true
  try {
    // 1) 暂存的待创建物料统一落库（createMaterial 对 qty>0 自动记一条「初始入库」流水）
    let created = 0
    for (const r of rows.value) {
      const d = r.pending
      if (!d) continue
      const mat = await createMaterial({
        name: d.name, model: d.model, brand: d.brand, package: d.package,
        part_no: d.part_no, category_id: d.category_id, params: d.params,
        location: d.location, price: d.price, threshold: d.threshold,
        image_path: d.image_path, datasheet_path: d.datasheet_path,
        link: d.link, qty: d.qty,
      })
      // 立创附件（数据手册 / 认证资料 / 行业资讯）全部落库
      if (d.files?.length) await createMaterialFiles(mat.id, d.files)
      r.pending = null
      r.material_id = mat.id
      r.matchedName = mat.name
      r.stockQty = mat.qty
      r.short = mat.qty < r.qty
      created++
    }
    // 2) 保存 BOM 项目与明细
    const pname = projectName.value.trim()
    const proj = await createBomProject(pname)
    await createBomItems(proj.id, rows.value.map(r => ({
      material_id: r.material_id || null,
      raw: [r.desig, r.value, r.model, r.pkg].filter(Boolean).join(' | '),
      qty: r.qty, matched: !!r.material_id
    })))
    // 3) 待采购单生成（暂时注释：待采功能下线）
    // const buyRows = rows.value.filter(r => r.buy)
    // let bought = 0
    // if (buyRows.length) {
    //   const po = await createPurchaseOrder({
    //     name: `${pname} 待采`,
    //     source: 'bom',
    //     source_id: proj.id,
    //     note: `来源 BOM 项目「${pname}」`,
    //   })
    //   const items = await createPurchaseItems(po.id, buyRows.map(r => ({
    //     material_id: r.material_id,
    //     name: r.material_id
    //       ? (r.matchedName || r.model || r.value)
    //       : (r.model || r.value || r.desig),
    //     model: r.model || null,
    //     brand: null,
    //     package: r.pkg || null,
    //     part_no: r.partNo || null,
    //     qty: r.qty,
    //     stock_qty: r.stockQty,
    //     // 未匹配 = 全部要买；已匹配但缺料 = 买差额
    //     lack_qty: r.material_id ? Math.max(0, r.qty - (r.stockQty ?? 0)) : r.qty,
    //     note: [r.desig, r.pkg].filter(Boolean).join(' | ') || null,
    //   })))
    //   bought = items.length
    // }
    toast.success(`已保存项目「${pname}」${created ? `，新建物料 ${created} 项` : ''}`)
    resetAll()
    visible.value = false
    emit('saved')
  } catch (e: unknown) { err.value = '保存失败：' + ((e as Error).message || e) }
  finally { saving.value = false }
}

// ===== 表格列 =====
// 表格用 table-layout: fixed，故全部给确定 width（总宽约 820px）
// 单元格内容超长时省略号截断，整体放不下则由表格自身横向滚动
const bomCols: DtColumn[] = [
  // 待采勾选列（暂时注释：待采功能下线）
  // { key: 'buy', label: '', width: '40px', cls: 'ck-col' },
  { key: 'desig', label: '位号', width: '80px' },
  { key: 'value', label: '值 / 型号', width: '80px' },
  { key: 'pkg', label: '封装', width: '80px' },
  { key: 'qty', label: '需求', align: 'right', width: '40px' },
  { key: 'stockQty', label: '库存', align: 'right', width: '40px' },
  { key: 'match', label: '匹配结果', width: '90px' },
  { key: 'ops', label: '操作', width: '90px', cls: 'ops' },
]
</script>

<template>
  <template v-if="visible">
    <!-- ===== 向导主弹框 ===== -->
    <div class="modal-mask" @click.self="onMaskClick">
      <div class="modal bom-import-modal">
        <div class="modal-head">
          <h3>导入 BOM</h3>
        </div>
        <div class="wizard-steps">
          <WizardSteps :steps="wizardSteps" :current="step" :disabled="busy || saving" @update:current="goStep" />
        </div>
        <div class="modal-body">
          <!-- 步骤 1：导入配置 -->
          <div v-show="step === 0" class="cfg">
            <div class="field">
              <label class="req">项目名称<span class="req-mark">*</span></label>
              <input v-model="projectName" placeholder="如：电源板 V1" class="pname"
                :class="{ 'req-empty': !projectName.trim() }" />
              <small v-if="nameErr" class="field-err">
                <CircleAlert :size="12" style="display: inline-flex; flex-shrink: 0" />{{ nameErr }}
              </small>
            </div>

            <div class="imp-row">
              <!-- 左：BOM 文件 -->
              <div class="imp-card">
                <div class="imp-card-head">
                  <Upload :size="16" style="display: inline-flex; flex-shrink: 0" />BOM 文件
                </div>
                <label class="file-drop" :class="{ drag: dragging }" @dragover.prevent="dragging = true"
                  @dragleave.prevent="dragging = false" @drop.prevent="onDrop">
                  <div class="drop-ico">
                    <Upload :size="22" style="display: inline-flex; flex-shrink: 0" />
                  </div>
                  <span v-if="fileName" class="file-name">{{ fileName }}</span>
                  <span v-else>选择文件或拖入 Excel / CSV</span>
                  <small v-if="!fileName">支持 xls / xlsx / csv，立创 EDA、报价单等</small>
                  <input type="file" accept=".csv,.txt,.xls,.xlsx,.xlsm" @change="onFile" />
                </label>
              </div>
              <!-- 右：手动指定列映射 -->
              <div class="imp-card">
                <div class="imp-card-head">
                  <Settings :size="16" style="display: inline-flex; flex-shrink: 0" />手动指定列映射
                </div>
                <div class="adv-cols">
                  <div class="adv-field">
                    <span>商品编码</span>
                    <AppSelect v-model="colMap.partNo" :options="opts('自动')" :min-width="0" />
                  </div>
                  <div class="adv-field">
                    <span>型号</span>
                    <AppSelect v-model="colMap.model" :options="opts('自动')" :min-width="0" />
                  </div>
                  <div class="adv-field">
                    <span>值 / 参数</span>
                    <AppSelect v-model="colMap.value" :options="opts('自动')" :min-width="0" />
                  </div>
                  <div class="adv-field">
                    <span>数量</span>
                    <AppSelect v-model="colMap.qty" :options="opts('自动')" :min-width="0" />
                  </div>
                  <div class="adv-field">
                    <span>位号</span>
                    <AppSelect v-model="colMap.desig" :options="opts('自动')" :min-width="0" />
                  </div>
                  <div class="adv-field">
                    <span>封装</span>
                    <AppSelect v-model="colMap.pkg" :options="opts('自动')" :min-width="0" />
                  </div>
                </div>
                <p class="adv-tip">调整映射后自动重新解析</p>
              </div>
            </div>

            <p v-if="err" class="error">
              <CircleAlert :size="14" style="display: inline-flex; flex-shrink: 0" />{{ err }}
            </p>

            <div v-if="busy" class="busy"><span class="spinner-sm" />正在匹配库存…</div>
          </div>

          <!-- 步骤 2：匹配结果 -->
          <div v-show="step === 1" class="wiz-result">
            <div v-if="rows.length" class="wiz-ops">
              <div class="stats">
                <button class="stat-chip" :class="{ on: matchFilter === 'all' }" @click="matchFilter = 'all'">
                  <span class="dot all" />全部 {{ rows.length }}
                </button>
                <button class="stat-chip" :class="{ on: matchFilter === 'matched' }" @click="matchFilter = 'matched'">
                  <span class="dot ok" />已匹配 {{ matchedCount }}
                </button>
                <button class="stat-chip" :class="{ on: matchFilter === 'unmatched' }"
                  @click="matchFilter = 'unmatched'">
                  <span class="dot warn" />未匹配 {{ unmatchedCount }}
                </button>
                <span class="stat bad"><span class="dot" />缺料 {{ shortCount }}</span>
                <span v-if="pendingCount" class="stat new"><span class="dot" />待创建 {{ pendingCount }}</span>
                <!-- 待采统计（暂时注释：待采功能下线）
                <span v-if="buyCount" class="stat buy"><span class="dot" />待采 {{ buyCount }}</span>
                -->
              </div>
              <div class="wiz-acts">
                <button v-if="matchableRows.length" class="btn btn-ghost lcsc-btn" :disabled="lcscMatching"
                  :title="`为 ${matchableRows.length} 行未绑定型号自动查立创并生成待创建物料`"
                  @click="autoMatchLcsc">
                  <Wand :size="14" style="display: inline-flex; flex-shrink: 0" />{{
                    lcscMatching ? '匹配中…' : `匹配立创 ${matchableRows.length}` }}
                </button>
                <!-- 加入待采按钮（暂时注释：待采功能下线）
                <button v-if="buyableRows.length" class="btn btn-ghost buy-btn" @click="toggleBuyAll">
                  <ShoppingCart :size="14" style="display: inline-flex; flex-shrink: 0" />{{ allBuyChecked ? '取消待采' :
                    '加入待采' }}
                </button>
                -->
              </div>
            </div>
            <DataTable v-if="filteredRows.length" :columns="bomCols" :rows="filteredRows" row-key="key"
              :clickable="false">
              <!-- 待采勾选列（暂时注释：待采功能下线）
              <template #header-buy>
                <label class="ck" title="一键勾选 / 取消全部待采行加入待采单">
                  <input type="checkbox" :checked="allBuyChecked" :disabled="!buyableRows.length"
                    @change="toggleBuyAll" />
                </label>
              </template>
              <template #cell-buy="{ row }">
                <label v-if="!row.material_id || row.short" class="ck"
                  :title="row.buy ? '取消加入待采单' : '加入待采单（保存时生成）'">
                  <input type="checkbox" :checked="row.buy"
                    @change="setBuy(row, ($event.target as HTMLInputElement).checked)" />
                </label>
              </template>
              -->
              <template #cell-desig="{ row }">
                <span class="mono" :title="row.desig">{{ row.desig || '—' }}</span>
              </template>
              <template #cell-value="{ row }">
                <div class="val-cell">
                  <span class="mono" :title="[row.value, row.model].filter(Boolean).join(' / ')">{{ row.model ||
                    row.value || '—' }}</span>
                  <small v-if="row.model && row.value && row.model !== row.value" class="sub">{{ row.value }}</small>
                </div>
              </template>
              <template #cell-pkg="{ row }">
                <span class="mono" :title="row.pkg">{{ row.pkg || '—' }}</span>
              </template>
              <template #cell-qty="{ row }">
                <span class="qty-cell">{{ row.qty }}</span>
              </template>
              <template #cell-stockQty="{ row }">
                <span v-if="row.stockQty == null" class="qty-cell dim">—</span>
                <span v-else class="qty-cell" :class="row.stockQty >= row.qty ? 'ok' : 'bad'">{{ row.stockQty }}</span>
              </template>
              <template #cell-match="{ row }">
                <template v-if="row.material_id">
                  <MaterialMatchPill
                    has-material
                    :matched-name="row.matchedName"
                    @pick="pickManual(row)"
                  />
                  <small class="cf">{{ row.confidence }}%</small>
                </template>
                <!-- 待创建 / 未匹配：统一状态标签 -->
                <template v-else>
                  <MaterialMatchPill
                    :has-pending="!!row.pending"
                    :pending-name="row.pending?.name"
                    pending-hint="保存 BOM 时建料入库"
                    @pick="pickManual(row)"
                  />
                </template>
              </template>
              <template #cell-ops="{ row }">
                <MaterialSourceOps
                  :has-material="!!row.material_id"
                  :has-pending="!!row.pending"
                  :busy="row.formBusy"
                  @edit="editPending(row)"
                  @pick="pickManual(row)"
                  @undo="clearMatch(row)"
                >
                  <button v-if="row.alternates && row.alternates.length" class="btn btn-icon mini"
                    :title="row.altIdx === 0 ? '切替代料' : '回主料'" @click.stop="cycleAlt(row)">
                    <RefreshCw :size="14" style="display: inline-flex; flex-shrink: 0" />
                  </button>
                </MaterialSourceOps>
              </template>
            </DataTable>
            <div v-else class="empty">
              <div class="empty-ico">
                <FileText :size="40" style="display: inline-flex; flex-shrink: 0" />
              </div>
              <h3>{{ emptyHint.title }}</h3>
              <p>{{ emptyHint.desc }}</p>
            </div>
          </div>
        </div>
        <div class="modal-foot">
          <button v-if="step === 1" class="btn btn-ghost" :disabled="busy || saving" @click="goStep(0)"
            style="margin-right: auto">
            <ChevronLeft :size="16" style="display: inline-flex; flex-shrink: 0" />上一步
          </button>
          <button class="btn btn-ghost" :disabled="busy || saving" @click="visible = false">取消</button>
          <template v-if="step === 0">
            <button class="btn btn-primary" :disabled="busy || !rows.length" @click="goStep(1)">下一步</button>
          </template>
          <button v-else class="btn btn-primary" :disabled="busy || !rows.length || saving" @click="saveBom">
            <Save :size="16" style="display: inline-flex; flex-shrink: 0" />{{ saving ? '保存中…' : '保存' }}
          </button>
        </div>
      </div>
    </div>

    <!-- ===== 物料来源：新建物料 + 自身库 + 嘉立创查，统一一个入口 ===== -->
    <MaterialPickerDialog
      :model-value="!!pickerFor"
      :keyword="pickerFor?.model || pickerFor?.value || pickerFor?.partNo || ''"
      :desc="pickerFor ? `为「${pickerFor.model || pickerFor.value || pickerFor.partNo || pickerFor.desig}」新建或挑选物料` : ''"
      :default-kind="pickerFor && isLcscCode(pickerFor.partNo || '') ? 'lcsc' : 'material'"
      allow-new
      :categories="categories"
      :prefill="pickerPrefill"
      @update:model-value="pickerFor = $event ? pickerFor : null"
      @select="choosePicked"
    />

    <!-- ===== 新增物料表单：立创选中 → 预填（暂存不落库，随 BOM 保存统一建料入库） ===== -->
    <MaterialFormDialog
      :model-value="showMaterialForm"
      :categories="categories"
      :lcsc="formLcsc"
      :lcsc-price="formLcscPrice"
      :prefill="formPrefill"
      :title="formTitle"
      defer-persist
      @update:model-value="onFormDialogToggle"
      @saved="onMaterialFormSaved"
    />

    <!-- ===== 一键匹配立创：进度浮层 ===== -->
    <ProgressOverlay
      :visible="lcscMatching"
      title="正在匹配立创"
      :message="lcscProg.kw ? `正在查询：${lcscProg.kw}` : '准备中…'"
      :progress="lcscProg.total ? (lcscProg.done / lcscProg.total) * 100 : 0"
    >
      <div class="lcsc-meta">已处理 {{ lcscProg.done }}/{{ lcscProg.total }}</div>
    </ProgressOverlay>
  </template>
</template>

<style scoped>
/* ===== 导入弹框 ===== */
.modal.bom-import-modal {
  max-width: 900px;
  min-width: 900px;
}

.wizard-steps {
  flex-shrink: 0;
  padding: 14px 18px 0;
}

/* 覆盖全局 .modal-body 的 overflow-y:auto，改为不滚动，
   由内部 .cfg / DataTable 各自滚动（表格头 sticky 才有效，横向滚动落在表格内） */
.modal.bom-import-modal>.modal-body {
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

/* ===== 步骤 1：导入配置 ===== */
.cfg {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 16px 18px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.field label {
  font-size: var(--fs-xs);
  font-weight: 600;
  color: var(--c-text-2);
}

/* 必填标记 */
.req-mark {
  margin-left: 2px;
  color: var(--c-danger, #e5484d);
  font-weight: 700;
}

/* 步骤：左 BOM 文件 / 右列映射，两张等高卡片，超出滚动 */
.imp-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
  height: 320px;
}

.imp-card {
  display: flex;
  flex-direction: column;
  min-height: 0;
  height: 100%;
  border: 1px solid var(--c-border);
  border-radius: var(--r-lg);
  background: var(--c-glass);
  overflow: hidden;
}

.imp-card-head {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
  padding: 10px 14px;
  border-bottom: 1px solid var(--c-border-hairline);
  font-size: var(--fs-sm);
  font-weight: 600;
  color: var(--c-text-2);
}

.pname {
  height: var(--ctrl-h);
  padding: 0 var(--ctrl-px);
  font-size: var(--fs-sm);
  background: var(--c-glass);
  border: 1px solid var(--c-border);
  border-radius: var(--r-md);
  color: var(--c-text);
  font-family: inherit;
  transition: all var(--motion);
}

.pname:focus {
  border-color: var(--c-primary);
  background: var(--c-surface);
  box-shadow: 0 0 0 3px var(--c-primary-glow);
}

/* 项目名称未填写：红色必填提示 */
.pname.req-empty {
  border-color: var(--c-danger, #e5484d);
}

/* 项目名称下方的错误提示 */
.field-err {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin-top: 4px;
  font-size: var(--fs-xs);
  color: var(--c-danger, #e5484d);
}

.field-err svg {
  flex-shrink: 0;
}

.file-drop {
  flex: 1;
  min-height: 0;
  margin: 12px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  border: 2px dashed var(--c-border);
  border-radius: var(--r-md);
  color: var(--c-text-2);
  cursor: pointer;
  text-align: center;
  transition: all var(--motion);
}

.file-drop:hover,
.file-drop.drag {
  border-color: var(--c-primary);
  color: var(--c-primary);
  background: var(--c-glass);
}

.file-drop.drag {
  transform: scale(1.01);
}

.file-drop input {
  display: none;
}

.drop-ico {
  color: inherit;
  margin-bottom: 4px;
}

.file-drop span {
  font-size: var(--fs-sm);
  font-weight: 600;
  color: inherit;
}

.file-name {
  color: var(--c-primary);
  word-break: break-all;
  max-width: 100%;
}

.file-drop small {
  font-size: var(--fs-xs);
  color: var(--c-text-3);
}

.adv-cols {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
  align-content: start;
  padding: 12px;
}

.adv-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.adv-field span {
  font-size: var(--fs-xs);
  color: var(--c-text-3);
}

/* 选择框撑满卡片栅格，避免溢出 / 错位 */
.adv-field .app-select {
  display: block;
  width: 100%;
}

.adv-tip {
  flex-shrink: 0;
  margin: 0;
  padding: 10px 14px;
  border-top: 1px solid var(--c-border-hairline);
  font-size: var(--fs-xs);
  color: var(--c-text-3);
}

.error {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  color: var(--c-danger);
  font-size: var(--fs-sm);
  margin: 0;
  line-height: 1.5;
}

.error svg {
  flex-shrink: 0;
  margin-top: 2px;
}

.busy {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--c-text-2);
  font-size: var(--fs-sm);
}

.spinner-sm {
  width: 14px;
  height: 14px;
  border: 2px solid var(--c-border);
  border-top-color: var(--c-primary);
  border-radius: 50%;
  animation: spin 0.6s linear infinite;
  display: inline-block;
}

.spinner-xs {
  width: 11px;
  height: 11px;
  border: 2px solid var(--c-border);
  border-top-color: var(--c-primary);
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
}

/* ===== 步骤 2：匹配结果 ===== */
/* min-width:0 必需：否则 flex 子项会被表格内容撑开，滚动条跑到外层被裁剪 */
.wiz-result {
  flex: 1;
  min-height: 0;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.wiz-result :deep(.dt-wrap) {
  min-width: 0;
}

/* 固定布局：列宽由表头 width 决定，内容不撑宽表格；
   min-width 保证窄屏下表列不被继续压缩，改由表格自身横向滚动 */
.wiz-result :deep(table) {
  table-layout: fixed;
  min-width: 0;
}

.wiz-ops {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  padding: 10px 14px;
  border-bottom: 1px solid var(--c-border-hairline);
  background: var(--c-glass);
  flex-shrink: 0;
}

.stats {
  display: flex;
  gap: 14px;
  align-items: center;
  flex-wrap: wrap;
}

.stat {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: var(--fs-xs);
  font-weight: 500;
}

.stat .dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
}

.stat.ok {
  color: var(--c-accent);
}

.stat.ok .dot {
  background: var(--c-accent);
}

.stat.bad {
  color: var(--c-danger);
}

.stat.bad .dot {
  background: var(--c-danger);
}

.stat.warn {
  color: var(--c-warning);
}

.stat.warn .dot {
  background: var(--c-warning);
}

.stat.new {
  color: var(--c-primary);
}

.stat.new .dot {
  background: var(--c-primary);
}

.stat.buy {
  color: var(--c-warning);
}

.stat.buy .dot {
  background: var(--c-warning);
}

/* 可点击的匹配结果筛选 chip */
.stat-chip {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 3px 10px;
  border-radius: 999px;
  font-size: var(--fs-xs);
  font-weight: 600;
  background: var(--c-surface);
  border: 1px solid var(--c-border-hairline);
  color: var(--c-text-2);
  cursor: pointer;
  transition: all var(--motion);
}

.stat-chip:hover {
  border-color: var(--c-primary);
  color: var(--c-text);
}

.stat-chip.on {
  background: var(--c-primary-soft);
  border-color: var(--c-primary);
  color: var(--c-primary);
}

.stat-chip .dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}

.stat-chip .dot.all {
  background: var(--c-text-3);
}

.stat-chip .dot.ok {
  background: var(--c-accent);
}

.stat-chip .dot.warn {
  background: var(--c-warning);
}

/* ===== 行内单元格 ===== */
/* 文本超长一律省略号截断，避免撑宽单元格 */
.mono {
  font-family: ui-monospace, 'SF Mono', Menlo, Consolas, monospace;
  font-size: var(--fs-xs);
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.val-cell {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  max-width: 100%;
}

.val-cell .sub {
  color: var(--c-text-3);
  font-size: 10px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.qty-cell {
  font-weight: 700;
  font-size: var(--fs-md);
}

.qty-cell.ok {
  color: var(--c-accent);
}

.qty-cell.bad {
  color: var(--c-danger);
}

.qty-cell.dim {
  color: var(--c-text-3);
  font-weight: 500;
}

.cf {
  display: block;
  color: var(--c-text-3);
  font-size: 10px;
  margin-top: 2px;
  font-weight: 500;
}

.mini {
  width: 28px;
  height: 28px;
  min-width: 28px;
  padding: 0;
}

/* 批量操作按钮组 */
.wiz-acts {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

/* 一键匹配立创 */
.lcsc-btn {
  height: var(--ctrl-h-sm);
  padding: 0 12px;
  font-size: var(--fs-xs);
}

/* 进度浮层内的计数信息 */
.lcsc-meta {
  font-size: var(--fs-xs);
  color: var(--c-text-2);
  margin-bottom: 10px;
}

.buy-btn {
  height: var(--ctrl-h-sm);
  padding: 0 12px;
  font-size: var(--fs-xs);
}

.btn-icon.mini {
  width: 24px;
  height: 24px;
  min-width: 24px;
  padding: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.ck {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}

.ck input {
  width: 15px;
  height: 15px;
  accent-color: var(--c-primary);
  cursor: pointer;
}

.draft {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 2px 0;
}

.draft-row {
  display: flex;
  align-items: center;
  gap: 6px;
}

.draft-lb {
  flex-shrink: 0;
  width: 28px;
  font-size: 10px;
  color: var(--c-text-3);
  font-weight: 500;
}

.draft-inp {
  width: 100%;
  min-width: 0;
  height: 24px;
  padding: 0 8px;
  font-size: var(--fs-xs);
  background: var(--c-surface);
  border: 1px solid var(--c-border);
  border-radius: var(--r-sm);
  color: var(--c-text);
  transition: border-color var(--motion);
}

.draft-inp:focus {
  outline: none;
  border-color: var(--c-primary);
}

/* 立创数据预览 */
.lcsc-meta {
  align-items: flex-start;
  gap: 8px;
}

.lcsc-thumb {
  width: 46px;
  height: 46px;
  object-fit: contain;
  border: 1px solid var(--c-border);
  border-radius: 6px;
  background: #fff;
  flex-shrink: 0;
}

.lcsc-meta-info {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  padding: 2px 0;
}

.lcsc-link {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: var(--c-primary);
  font-size: var(--fs-xs);
  text-decoration: none;
}

.lcsc-link:hover {
  text-decoration: underline;
}

.empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  color: var(--c-text-2);
  text-align: center;
  padding: 24px;
}

.empty-ico {
  width: 72px;
  height: 72px;
  border-radius: var(--r-xl);
  background: var(--c-glass);
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

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

@media (max-width: 900px) {
  .imp-row {
    grid-template-columns: 1fr;
    height: auto;
  }

  .imp-card {
    height: auto;
  }

  .file-drop {
    min-height: 160px;
  }

  .adv-cols {
    overflow: visible;
  }
}
</style>
