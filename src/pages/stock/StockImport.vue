<template>
  <section class="tab import-wrap">
    <div class="wizard-steps">
      <WizardSteps :steps="impSteps" :current="impStep" :disabled="importing" @update:current="impStep = $event" />
    </div>

    <!-- 步骤 0：导入配置（与 BOM 导入同一套 .cfg 结构） -->
    <div v-if="impStep === 0" class="cfg">
      <div class="imp-row">
        <!-- 左：订单文件 -->
        <div class="imp-card">
          <div class="imp-card-head">
            <Upload :size="16" style="display: inline-flex; flex-shrink: 0" />订单文件
          </div>
          <label class="file-drop" :class="{ drag: impDragging }" @dragover.prevent="impDragging = true"
            @dragleave.prevent="impDragging = false" @drop.prevent="onDrop">
            <div class="drop-ico">
              <Upload :size="22" style="display: inline-flex; flex-shrink: 0" />
            </div>
            <div v-if="impFileNames.length" class="file-names">
              <span v-for="n in impFileNames" :key="n" class="fn-chip" :title="n">
                <span class="fn-txt">{{ n }}</span>
                <!-- label 会转发点击给 input，须阻止冒泡与默认行为，否则会弹出文件选择框 -->
                <button class="fn-x" title="移除该文件" @click.stop.prevent="removeImpFile(n)">
                  <X :size="11" style="display: inline-flex; flex-shrink: 0" />
                </button>
              </span>
            </div>
            <span v-else>选择文件或拖入 Excel / CSV</span>
            <small v-if="!impFileNames.length">支持 xls / xlsx / csv / tsv，淘宝 / 立创 等订单，可一次选多个</small>
            <small v-else>已选 {{ impFileNames.length }} 个文件，继续拖入可追加</small>
            <input type="file" multiple accept=".csv,.txt,.xls,.xlsx,.xlsm" @change="onFile" />
          </label>
        </div>
        <!-- 右：列映射与导入方案 -->
        <div class="imp-card">
          <div class="imp-card-head">
            <Settings :size="16" style="display: inline-flex; flex-shrink: 0" />列映射与导入方案
          </div>
          <div class="adv-cols">
            <div class="adv-field wide">
              <span>导入方案</span>
              <AppSelect :model-value="presetId" :options="presetOpts" :min-width="0"
                @update:model-value="onPresetChange" />
            </div>
            <div v-if="headerRowOpts.length" class="adv-field wide">
              <span>表头所在行</span>
              <AppSelect :model-value="String(headerIndex)" :options="headerRowOpts" :min-width="0"
                @update:model-value="onHeaderRowChange" />
            </div>
            <div class="adv-field">
              <span>型号 / 名称</span>
              <AppSelect :model-value="colMap.model" :options="colOpts('model')" :min-width="0"
                @update:model-value="onColChange('model', $event)" />
            </div>
            <div class="adv-field">
              <span>名称（品名 / 标题）</span>
              <AppSelect :model-value="colMap.name" :options="colOpts('name')" :min-width="0"
                @update:model-value="onColChange('name', $event)" />
            </div>
            <div class="adv-field">
              <span>数量</span>
              <AppSelect :model-value="colMap.qty" :options="colOpts('qty')" :min-width="0"
                @update:model-value="onColChange('qty', $event)" />
            </div>
            <div class="adv-field">
              <span>单价</span>
              <AppSelect :model-value="colMap.price" :options="colOpts('price')" :min-width="0"
                @update:model-value="onColChange('price', $event)" />
            </div>
            <div class="adv-field">
              <span>金额 / 总价（缺单价时 ÷ 数量）</span>
              <AppSelect :model-value="colMap.amount" :options="colOpts('amount')" :min-width="0"
                @update:model-value="onColChange('amount', $event)" />
            </div>
            <div class="adv-field">
              <span>商品编号 / 商家编码</span>
              <AppSelect :model-value="colMap.part_no" :options="colOpts('part_no')" :min-width="0"
                @update:model-value="onColChange('part_no', $event)" />
            </div>
            <div class="adv-field">
              <span>品牌</span>
              <AppSelect :model-value="colMap.brand" :options="colOpts('brand')" :min-width="0"
                @update:model-value="onColChange('brand', $event)" />
            </div>
            <div class="adv-field">
              <span>封装 / 规格</span>
              <AppSelect :model-value="colMap.package" :options="colOpts('package')" :min-width="0"
                @update:model-value="onColChange('package', $event)" />
            </div>
            <div class="adv-field">
              <span>供应商</span>
              <AppSelect :model-value="colMap.supplier" :options="colOpts('supplier')" :min-width="0"
                @update:model-value="onColChange('supplier', $event)" />
            </div>
            <div class="adv-field">
              <span>备注 / 订单号</span>
              <AppSelect :model-value="colMap.note" :options="colOpts('note')" :min-width="0"
                @update:model-value="onColChange('note', $event)" />
            </div>
            <div class="adv-field">
              <span>物料链接 / 商品地址</span>
              <AppSelect :model-value="colMap.link" :options="colOpts('link')" :min-width="0"
                @update:model-value="onColChange('link', $event)" />
            </div>
          </div>
          <p class="adv-tip">
            <template v-if="headers.length">
              已识别为「{{ activePreset.name }}」— {{ activePreset.desc }}；切换方案或调整列后自动重新解析
            </template>
            <template v-else>先导入文件，再按来源选择方案、微调列映射</template>
          </p>
        </div>
      </div>

      <p v-if="impErr" class="error">
        <CircleAlert :size="14" style="display: inline-flex; flex-shrink: 0" />{{ impErr }}
      </p>

      <div v-if="impBusy" class="busy"><span class="spinner-sm" />正在匹配库存…</div>

      <div class="imp-actions">
        <button class="btn btn-primary" :disabled="impBusy || !impRows.length" @click="goMatch">
          下一步<span v-if="impRows.length">（{{ impRows.length }} 行）</span>
        </button>
      </div>
    </div>

    <div v-else class="wiz-result">
      <div v-if="impBusy" class="busy"><span class="spinner-sm" />正在匹配库存…</div>
      <template v-else-if="impRows.length">
        <div class="wiz-ops">
          <div class="stats">
            <button class="stat-chip" :class="{ on: impFilter === 'all' }" @click="impFilter = 'all'">
              <span class="dot all" />全部 {{ impRows.length }}
            </button>
            <button class="stat-chip" :class="{ on: impFilter === 'matched' }" @click="impFilter = 'matched'">
              <span class="dot ok" />已匹配 {{ impMatched }}
            </button>
            <button class="stat-chip" :class="{ on: impFilter === 'unmatched' }" @click="impFilter = 'unmatched'">
              <span class="dot warn" />未匹配 {{ impUnmatched }}
            </button>
            <span v-if="impPending" class="imp-pend"><span class="dot" />待创建 {{ impPending }}</span>
          </div>
          <div class="wiz-acts">
            <button v-if="impMatchable.length" class="btn btn-ghost lcsc-btn" :disabled="impLcscMatching"
              :title="`为 ${impMatchable.length} 行未绑定型号自动查立创并生成待创建物料`" @click="autoMatchImpLcsc">
              <Wand :size="14" style="display: inline-flex; flex-shrink: 0" />{{
                impLcscMatching ? '匹配中…' : `匹配立创 ${impMatchable.length}` }}
            </button>
          </div>
        </div>
        <DataTable :columns="impCols" :rows="filteredImpRows" row-key="key" :clickable="false">
          <template #cell-model="{ row }">
            <span class="mono" :title="row.model">{{ row.model || '—' }}</span>
            <small v-if="row.partNo" class="row-sub mono" :title="row.partNo">#{{ row.partNo }}</small>
          </template>
          <template #cell-name="{ row }">
            <span class="mono" :title="row.name || undefined">{{ row.name || '—' }}</span>
          </template>
          <template #cell-qty="{ row }">
            <span class="qty-cell">{{ row.qty }}</span>
          </template>
          <template #cell-price="{ row }">
            <span v-if="row.price != null" class="price-cell">{{ fmtPrice(row.price) }}</span>
            <span v-else class="dim">—</span>
          </template>
          <template #cell-amount="{ row }">
            <span v-if="row.amount != null" class="price-cell">{{ fmtPrice(row.amount) }}</span>
            <span v-else class="dim">—</span>
          </template>
          <template #cell-supplier="{ row }">
            <span :title="row.supplierName ?? undefined">{{ row.supplierName || '—' }}</span>
          </template>
          <template #cell-note="{ row }">
            <span class="mono" :title="row.note ?? undefined">{{ row.note || '—' }}</span>
          </template>
          <template #cell-match="{ row }">
            <div class="match-cell">
              <MaterialMatchPill
                :has-material="!!row.material_id"
                :has-pending="!!row.pending"
                :matched-name="row.matchedName"
                :pending-name="row.pending?.name"
                pending-hint="入库时统一建料"
                @pick="pickManualImp(row)"
              />
              <!-- 批量入库校验失败原因（整批阻止后定位问题行） -->
              <small v-if="row.issue" class="row-issue" :title="row.issue">{{ row.issue }}</small>
            </div>
          </template>
          <template #cell-ops="{ row }">
            <MaterialSourceOps
              :has-material="!!row.material_id"
              :has-pending="!!row.pending"
              :busy="row.formBusy"
              @edit="editPendingImp(row)"
              @pick="pickManualImp(row)"
              @undo="clearMatch(row)"
            />
          </template>
        </DataTable>
      </template>
      <EmptyState v-else :icon="FileText" title="导入订单开始"
        description="导入文件后将自动解析，未匹配型号可查立创 / 搜立创 / 手动指定" />

      <div class="imp-foot">
        <button class="btn btn-ghost" :disabled="importing" @click="impStep = 0">
          <ChevronLeft :size="16" style="display: inline-flex; flex-shrink: 0" />上一步
        </button>
        <button class="btn btn-primary" :disabled="importing" @click="doImport">
          <Save :size="16" style="display: inline-flex; flex-shrink: 0" />{{ importing ? '入库中…' : `批量入库 ${impRows.length}` }}
        </button>
      </div>
    </div>

    <!-- 批量入库问题清单：整批阻止时逐行说明原因并给处理入口 -->
    <Teleport to="body">
      <div v-if="impBlock.length" class="ib-mask" @click.self="closeImpBlock">
        <div class="ib-card" role="dialog" aria-modal="true" aria-label="入库前需处理">
          <button class="ib-x" aria-label="关闭" @click="closeImpBlock"><X :size="16" style="display: inline-flex; flex-shrink: 0" /></button>
          <div class="ib-head">
            <span class="ib-ico"><CircleAlert :size="18" style="display: inline-flex; flex-shrink: 0" /></span>
            <div class="ib-head-txt">
              <h3>还有 {{ impBlock.length }} 行没准备好，本次未入库</h3>
              <p>处理完后，再点一次「批量入库」即可继续。</p>
            </div>
          </div>
          <div class="ib-list">
            <div v-for="it in impBlock" :key="it.key" class="ib-item">
              <div class="ib-main">
                <div class="ib-line">
                  <span class="ib-no mono">#{{ it.no }}</span>
                  <span v-if="it.label" class="ib-label mono" :title="it.label">{{ it.label }}</span>
                  <span class="ib-reason">{{ it.reason }}</span>
                </div>
                <div v-if="it.kind === 'incomplete' && it.missing.length" class="ib-tags">
                  <span v-for="m in it.missing" :key="m" class="ib-tag">缺：{{ m }}</span>
                </div>
              </div>
              <div class="ib-actions">
                <template v-if="it.kind === 'incomplete'">
                  <button class="btn btn-sm btn-primary" @click="fixImpIssue(it)">补全信息</button>
                </template>
                <template v-else>
                  <button class="btn btn-sm btn-ghost" @click="bindImpIssue(it)">绑定已有物料</button>
                  <button class="btn btn-sm btn-primary" @click="newImpIssue(it)">按本行新建</button>
                </template>
              </div>
            </div>
          </div>
          <div class="ib-foot">
            <button class="btn btn-sm btn-ghost" @click="closeImpBlock">知道了，稍后处理</button>
          </div>
        </div>
      </div>
    </Teleport>

    <!-- 物料来源（新建物料 + 自身库 + 嘉立创查 合并为一个入口） -->
    <MaterialPickerDialog
      :model-value="!!pickerImpFor"
      :keyword="pickerImpFor?.model || ''"
      :desc="pickerImpFor ? `为「${pickerImpFor.model}」新建或挑选物料` : ''"
      :default-kind="pickerImpFor && isLcscCode(pickerImpFor.model || '') ? 'lcsc' : 'material'"
      allow-new
      :categories="impCategories"
      :prefill="impPickerPrefill"
      :initial-stock="impPickerStock"
      @update:model-value="pickerImpFor = $event ? pickerImpFor : null"
      @select="choosePickedImp"
    />

    <!-- 新增物料表单（立创选中 → 预填，暂存不落库，入库时统一建料） -->
    <MaterialFormDialog
      :model-value="showImpForm"
      :categories="impCategories"
      :lcsc="impFormLcsc"
      :lcsc-price="impFormLcscPrice"
      :prefill="impFormPrefill"
      :initial-stock="impInitialStock"
      :title="impFormTitle"
      defer-persist
      @update:model-value="onImpFormToggle"
      @saved="onImpFormSaved"
    />

    <!-- 一键匹配立创进度浮层 -->
    <ProgressOverlay
      :visible="impLcscMatching"
      title="正在匹配立创"
      :message="impLcscProg.kw ? `正在查询：${impLcscProg.kw}` : '准备中…'"
      :progress="impLcscProg.total ? (impLcscProg.done / impLcscProg.total) * 100 : 0"
    >
      <div class="lcsc-meta">已处理 {{ impLcscProg.done }}/{{ impLcscProg.total }}</div>
    </ProgressOverlay>

    <!-- 批量入库进度蒙版 -->
    <ProgressOverlay
      :visible="importing"
      title="正在入库"
      message="正在将订单写入库存，请稍候…"
      :progress="impRows.length ? (impDone / impRows.length) * 100 : 0"
    >
      <div class="lcsc-meta">已处理 {{ impDone }}/{{ impRows.length }} 行</div>
    </ProgressOverlay>
  </section>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import {
  Upload, Settings, Save, X, FileText, ChevronLeft, CircleAlert, Wand,
} from 'lucide-vue-next'
import {
  listSuppliers, listCategories, matchMaterialByModel, createMaterial, updateMaterial,
  createMaterialFiles, applyStock,
} from '../../lib/db'
import {
  parseSheet, detectColumnsPrecise, pickPreset, sliceAt, IMPORT_PRESETS,
  type ImportPreset,
} from '../../lib/importParser'
import type { Category, MaterialRow, MaterialDraft, StockLog } from '../../lib/types'
import { lcscLookup, isLcscCode, type LcscHit, type LcscComponent } from '../../lib/lcscApi'
import { matchLcscBatch } from '../../lib/lcscAutoMatch'
import AppSelect from '../../components/form/AppSelect.vue'
import DataTable from '../../components/DataTable.vue'
import type { DtColumn } from '../../components/DataTable.vue'
import WizardSteps from '../../components/WizardSteps.vue'
import type { WizardStep } from '../../components/WizardSteps.vue'
import MaterialPickerDialog from '../../components/business/MaterialBindDialog.vue'
import MaterialFormDialog from '../../components/business/MaterialFormDialog.vue'
import MaterialMatchPill from '../../components/business/MaterialMatchPill.vue'
import MaterialSourceOps from '../../components/business/MaterialSourceOps.vue'
import ProgressOverlay from '../../components/ProgressOverlay.vue'
import EmptyState from '../../components/EmptyState.vue'
import { useToast } from '../../composables/toast'
import { useStockData } from '../../composables/useStockData'

const toast = useToast()
const { comps, suppliers, suppliersLoaded, summaryMap, refreshLogs, sumOf } = useStockData()

// ===== 导入入库 =====
/** 已解析的订单文件：支持一次导入多个，每行按来源文件区分入库备注 */
interface ParsedFile {
  name: string
  headers: string[]
  data: string[][]
  matrix: string[][]
  headerIndex: number
}

interface ImpRow {
  /** 行主键（DataTable row-key）：含来源文件名，多文件时保证唯一 */
  key: string
  /** 来源文件名：入库记录的备注按此区分（如「xxx订单.xls 导入」） */
  src: string
  model: string; qty: number; supplierName: string | null
  /** 订单表里的名称列（如淘宝「宝贝标题」、立创「商品名称」），独立于型号展示 */
  name: string
  supplier_id: string | null; note: string | null
  /** 订单表里带过来的补充资料：新建物料时写入，已有物料仅补全空字段 */
  partNo: string | null; brand: string | null; package: string | null
  /** 单价：优先取单价列，无单价但有金额时按「金额 ÷ 数量」折算 */
  price: number | null; link: string | null
  /** 订单行的总金额（仅展示，未映射到金额列时为 null） */
  amount: number | null
  material_id: string | null; matchedName: string; stockQty: number | null
  /** 待创建的物料（新增物料表单产出，暂存不落库）：入库时才建料 + 附件 + 入库 */
  pending: import('../../lib/types').MaterialDraft | null
  /** 一键匹配命中的立创详情：存下来供「编辑」直接回填表单，无需重新联网查询 */
  lcsc: LcscComponent | null
  lcscPrice: number | null
  /** 正在联网取立创详情（打开新增物料表单前） */
  formBusy: boolean
  /** 用户手动指定了物料：重建/重新匹配时不覆盖 */
  manual: boolean
  /** 批量入库前置校验失败原因（整批阻止后行内标红，用于定位） */
  issue?: string | null
}

/** 批量入库前置校验未通过的行（弹窗清单逐行给处理入口 + 行内标红定位） */
interface ImpIssue {
  key: string
  /** 行号（从 1 起，便于在表格中定位） */
  no: number
  /** 行的展示名（型号 / 名称），用于清单里识别是哪一行 */
  label: string
  /** 问题类型：决定清单里给出的处理入口 */
  kind: 'unmatched' | 'incomplete'
  /** incomplete 类缺的必填项：名称 / 商品编号 / 分类（大类·小类） */
  missing: string[]
  /** 给用户看的友好说明 */
  reason: string
}
/** 订单表列 → 逻辑字段的映射（比「型号/数量」更多的常用字段一并支持） */
interface ImpColMap {
  model: number | null; name: number | null; qty: number | null
  price: number | null; amount: number | null
  part_no: number | null; brand: number | null; package: number | null
  supplier: number | null; note: number | null; link: number | null
}
/** name 需排在 model 之后：型号是匹配主键，优先占用更「像型号」的列 */
const IMP_FIELDS = ['model', 'name', 'qty', 'price', 'amount', 'part_no', 'brand', 'package', 'supplier', 'note', 'link'] as const
/** 空映射（全部跟随自动识别） */
function emptyMap(): ImpColMap {
  return {
    model: null, name: null, qty: null, price: null, amount: null,
    part_no: null, brand: null, package: null,
    supplier: null, note: null, link: null,
  }
}

const impSteps: WizardStep[] = [
  { title: '导入配置', desc: '导入文件 + 方案识别' },
  { title: '匹配确认', desc: '匹配库存，未匹配可补建' },
]
const impStep = ref(0)
/** 匹配结果筛选：all / matched / unmatched */
const impFilter = ref<'all' | 'matched' | 'unmatched'>('all')

const raw = ref('')
const headers = ref<string[]>([])
/** 已解析的订单文件（可多个）：调整列映射后按全部文件重建入库行 */
const impFiles = ref<ParsedFile[]>([])
/** 已导入的文件名（展示用，来源自 impFiles） */
const impFileNames = computed(() => impFiles.value.map(f => f.name))
/** 解析出的原始矩阵（未切分表头），用于手动改表头行 */
const rawMatrix = ref<string[][]>([])
/** 当前表头所在行索引 */
const headerIndex = ref(0)
/** 解析成功后回填 textarea 的预览文本，用于判断 raw 是否被用户改动 */
const previewText = ref('')
const impRows = ref<ImpRow[]>([])
const impErr = ref('')
const impBusy = ref(false)
const importing = ref(false)
/** 批量入库进度计数（逐行累加，供蒙版进度条展示） */
const impDone = ref(0)
/** 批量入库前置校验未通过列表（非空即整批阻止并弹出问题清单） */
const impBlock = ref<ImpIssue[]>([])
const impDragging = ref(false)
/** 导入方案：'auto' = 按表头自动判定，否则为 IMPORT_PRESETS 中的方案 id */
const presetId = ref('auto')
/** 实际生效的方案（auto 时为自动判定结果） */
const activePreset = ref<ImportPreset>(IMPORT_PRESETS[IMPORT_PRESETS.length - 1])
/** 当前方案自动识别出的列映射 */
const autoMap = ref<ImpColMap>(emptyMap())
/** 用户手动覆盖的映射；null = 跟随自动识别结果（此前选「自动」会拿到空列，现改为回落自动结果） */
const colMap = ref<ImpColMap>(emptyMap())
/** 最终生效的映射：手动指定优先，未指定则用自动识别 */
const effMap = computed<ImpColMap>(() => {
  const a = autoMap.value
  const c = colMap.value
  const out = emptyMap()
  for (const k of IMP_FIELDS) out[k] = c[k] ?? a[k]
  return out
})
/** 物料绑定弹窗目标行（自身库 + 立创 共用） */
const pickerImpFor = ref<ImpRow | null>(null)
let impSuppliersLoaded = false

/** 方案下拉：首项为自动识别（附带判定结果） */
const presetOpts = computed(() => [
  {
    value: 'auto',
    label: headers.value.length && presetId.value === 'auto'
      ? `自动识别 · ${activePreset.value.name}`
      : '自动识别',
  },
  ...IMPORT_PRESETS.map(p => ({ value: p.id, label: p.name })),
])

/** 字段下拉：自动项显示实际落到的列，列项带序号与表头名（空表头也能分辨） */
function colOpts(field: keyof ImpColMap) {
  const auto = autoMap.value[field]
  const autoLabel = auto != null && headers.value[auto]
    ? `自动 · 第 ${auto + 1} 列 ${headers.value[auto]}`
    : '自动 · 未识别'
  const list: { value: number | null; label: string }[] = [{ value: null, label: autoLabel }]
  headers.value.forEach((h, i) => {
    list.push({ value: i, label: h ? `第 ${i + 1} 列 · ${h}` : `第 ${i + 1} 列（空表头）` })
  })
  return list
}

/** 按当前方案重新识别列映射；换方案会清空旧的手动覆盖 */
function detectWithPreset(h: string[]) {
  activePreset.value = presetId.value === 'auto'
    ? pickPreset(h)
    : IMPORT_PRESETS.find(p => p.id === presetId.value) || IMPORT_PRESETS[IMPORT_PRESETS.length - 1]
  const m = detectColumnsPrecise(h, activePreset.value.rules)
  const next = emptyMap()
  for (const k of IMP_FIELDS) next[k] = m[k] ?? null
  autoMap.value = next
  colMap.value = emptyMap()
}

/** 切换导入方案 */
function onPresetChange(id: unknown) {
  presetId.value = typeof id === 'string' ? id : 'auto'
  if (!headers.value.length) return
  detectWithPreset(headers.value)
  void rebuildImpRows()
}

/** 手动指定某字段对应的列（null = 跟随自动识别） */
function onColChange(field: keyof ImpColMap, v: unknown) {
  colMap.value[field] = typeof v === 'number' ? v : null
  scheduleRebuild()
}

/** 由解析出的数据行构建入库行；src 为来源文件名，用于区分入库备注与保证 key 唯一 */
function buildImpRows(d: string[][], src: string): ImpRow[] {
  const m = effMap.value
  /** 取文本列（未映射或取不到则返回 null） */
  const txt = (r: string[], i: number | null) => (i != null ? (r[i] || '').trim() || null : null)
  /** 取数字列，兼容「¥12.50」「1,234 元」等写法 */
  const num = (r: string[], i: number | null) => {
    if (i == null) return null
    const v = parseFloat((r[i] || '').replace(/[^0-9.]/g, ''))
    return Number.isFinite(v) ? v : null
  }
  return d.map((r, i) => {
    const qty = Math.max(1, parseInt((m.qty != null ? (r[m.qty] || '1') : '1').toString().replace(/[^0-9.]/g, '')) || 1)
    const price = num(r, m.price)
    const amount = num(r, m.amount)
    return {
      key: `${src}#${i}`,
      src,
      model: txt(r, m.model) || '',
      name: txt(r, m.name) || '',
      qty,
      supplierName: txt(r, m.supplier),
      supplier_id: null,
      note: txt(r, m.note),
      partNo: txt(r, m.part_no),
      brand: txt(r, m.brand),
      package: txt(r, m.package),
      price: price ?? (amount != null && qty > 0 ? +(amount / qty).toFixed(4) : null),
      amount,
      link: txt(r, m.link),
      material_id: null, matchedName: '', stockQty: null,
      pending: null,
      lcsc: null,
      lcscPrice: null,
      formBusy: false,
      manual: false,
    }
  }).filter(r => r.model)
}

/**
 * 按当前映射重建入库行并重新匹配。
 * 重建会保留已填写的立创草稿与手动指定的物料，避免调整映射后白干。
 */
function rebuildImpRows(src = '当前文件') {
  if (!impFiles.value.length) return false
  const keep = new Map<string, Pick<ImpRow, 'pending' | 'lcsc' | 'lcscPrice' | 'material_id' | 'matchedName' | 'stockQty' | 'manual'>>()
  for (const r of impRows.value) {
    if (r.pending || r.manual) {
      keep.set(r.model, {
        pending: r.pending, lcsc: r.lcsc, lcscPrice: r.lcscPrice,
        material_id: r.material_id, matchedName: r.matchedName, stockQty: r.stockQty, manual: r.manual,
      })
    }
  }
  // 多文件：按全部已解析文件依次构建，每行带各自来源文件名
  const rows: ImpRow[] = []
  for (const f of impFiles.value) rows.push(...buildImpRows(f.data, f.name))
  impRows.value = rows
  for (const r of impRows.value) {
    const k = keep.get(r.model)
    if (!k) continue
    if (k.pending) { r.pending = k.pending; r.lcsc = k.lcsc; r.lcscPrice = k.lcscPrice }
    if (k.manual) {
      r.material_id = k.material_id; r.matchedName = k.matchedName; r.stockQty = k.stockQty; r.manual = true
    }
  }
  if (!impRows.value.length) {
    impErr.value = effMap.value.model == null
      ? `未识别到「型号 / 名称」列（当前方案：${activePreset.value.name}），请手动指定或切换导入方案`
      : `「${src}」未识别到有效数据行，请返回「导入配置」调整列映射`
    return false
  }
  impErr.value = ''
  void matchAllImp()
  return true
}

/** 映射改动后自动重新应用（防抖，避免连续调整触发大量匹配请求） */
let rebuildTimer: number | undefined
function scheduleRebuild() {
  window.clearTimeout(rebuildTimer)
  rebuildTimer = window.setTimeout(() => { void rebuildImpRows() }, 250)
}

/**
 * 写入（或更新）一份文件的解析结果，并按该表头识别方案、重建全部入库行。
 * 多文件场景下每次只作用于指定 src 的那一份。
 */
function applyParsed(h: string[], d: string[][], src: string, matrix?: string[][], hi?: number) {
  if (matrix) { rawMatrix.value = matrix; headerIndex.value = hi ?? 0 }
  headers.value = h
  previewText.value = [h.join('\t'), ...d.slice(0, 50).map(r => r.join('\t'))].join('\n')
  raw.value = previewText.value
  const entry: ParsedFile = {
    name: src, headers: h, data: d,
    matrix: matrix ?? rawMatrix.value, headerIndex: hi ?? headerIndex.value,
  }
  const idx = impFiles.value.findIndex(f => f.name === src)
  if (idx >= 0) impFiles.value[idx] = entry
  else impFiles.value.push(entry)
  detectWithPreset(h)
  rebuildImpRows(src)
}

/** 可手动指定的表头行：前 60 行内的非空行，标签带前几列内容便于辨认 */
const headerRowOpts = computed(() => {
  const out: { value: unknown; label: string }[] = []
  const m = rawMatrix.value
  for (let i = 0; i < Math.min(60, m.length); i++) {
    const cells = m[i].filter(c => c)
    if (!cells.length) continue
    const peek = cells.slice(0, 3).join(' / ')
    out.push({ value: String(i), label: `第 ${i + 1} 行：${peek.length > 30 ? peek.slice(0, 30) + '…' : peek}` })
  }
  return out
})

/** 手动改表头行：按所选行重新切分表头与数据并重新识别列 */
function onHeaderRowChange(v: unknown) {
  const i = Number(v)
  if (!rawMatrix.value.length || !Number.isFinite(i)) return
  const { headers: h, rows: d } = sliceAt(rawMatrix.value, i)
  headerIndex.value = i
  // rawMatrix 属于最后一份文件：按该文件名更新，避免新增一个无来源的条目
  const name = impFiles.value[impFiles.value.length - 1]?.name ?? '手动指定表头行'
  applyParsed(h, d, name, rawMatrix.value, i)
}

/** 解析单个文件并登记到 impFiles；返回是否解析成功 */
async function loadFile(buf: ArrayBuffer, fname: string): Promise<boolean> {
  const ps = parseSheet(buf)
  if (!ps.headers.length) { impErr.value = `无法解析「${fname}」，请检查文件格式`; return false }
  // 先登记，多个文件全部解析完再统一识别方案与重建行（避免逐个触发匹配）
  const entry: ParsedFile = { name: fname, headers: ps.headers, data: ps.rows, matrix: ps.matrix, headerIndex: ps.headerIndex }
  const idx = impFiles.value.findIndex(f => f.name === fname)
  if (idx >= 0) impFiles.value[idx] = entry
  else impFiles.value.push(entry)
  headers.value = ps.headers
  rawMatrix.value = ps.matrix
  headerIndex.value = ps.headerIndex
  previewText.value = [ps.headers.join('\t'), ...ps.rows.slice(0, 50).map(r => r.join('\t'))].join('\n')
  raw.value = previewText.value
  return true
}

/** 多份文件解析完成后统一：按最后一份的表头识别方案并重建全部行 */
function finalizeLoad() {
  const last = impFiles.value[impFiles.value.length - 1]
  if (!last) return
  detectWithPreset(last.headers)
  rebuildImpRows(last.name)
}

/** 移除某个已导入文件：连同其解析出的行一起去掉，剩余文件重建 */
function removeImpFile(name: string) {
  const idx = impFiles.value.findIndex(f => f.name === name)
  if (idx < 0) return
  // 只有删掉「当前提供表头的最后一份」时才需要回退表头 / 预览并重识别方案，
  // 否则会清掉用户手动指定的列映射
  const wasLast = idx === impFiles.value.length - 1
  impFiles.value.splice(idx, 1)
  impErr.value = ''
  if (!impFiles.value.length) {
    impRows.value = []
    headers.value = []
    rawMatrix.value = []
    headerIndex.value = 0
    raw.value = ''
    previewText.value = ''
    impStep.value = 0
    return
  }
  if (wasLast) {
    const last = impFiles.value[impFiles.value.length - 1]
    headers.value = last.headers
    rawMatrix.value = last.matrix
    headerIndex.value = last.headerIndex
    previewText.value = [last.headers.join('\t'), ...last.data.slice(0, 50).map(r => r.join('\t'))].join('\n')
    raw.value = previewText.value
    detectWithPreset(last.headers)
  }
  rebuildImpRows()
}

/** 批量加载多个文件（选择 / 拖入都走这里） */
async function loadFiles(files: File[]) {
  impErr.value = ''
  let okCount = 0
  for (const f of files) {
    try {
      if (await loadFile(await f.arrayBuffer(), f.name)) okCount++
    } catch { impErr.value = `无法解析「${f.name}」，请检查文件格式` }
  }
  if (!okCount) return
  finalizeLoad()
}

async function onFile(e: Event) {
  const input = e.target as HTMLInputElement
  const files = Array.from(input.files || [])
  // 清空以允许再次选择同一批文件
  input.value = ''
  if (!files.length) return
  await loadFiles(files)
}

async function onDrop(e: DragEvent) {
  impDragging.value = false
  const files = Array.from(e.dataTransfer?.files || [])
  if (!files.length) return
  await loadFiles(files)
}

async function matchAllImp() {
  impBusy.value = true
  try {
    // 预加载供应商做名称匹配
    if (!impSuppliersLoaded) {
      try { suppliers.value = await listSuppliers(); impSuppliersLoaded = true; suppliersLoaded.value = true } catch { /* 静默 */ }
    }
    // 批量匹配型号（手动指定过的行不覆盖）
    for (const r of impRows.value) {
      if (!r.model || r.manual) continue
      const cands = await matchMaterialByModel(r.model)
      const best = cands.length ? cands[0] : null
      if (best) {
        r.material_id = best.id; r.matchedName = best.name; r.stockQty = best.qty
      }
      // 匹配供应商
      if (r.supplierName) {
        const sup = suppliers.value.find(s => s.name === r.supplierName || s.name.includes(r.supplierName!))
        if (sup) r.supplier_id = sup.id
      }
    }
  } catch (e: unknown) { impErr.value = '匹配失败：' + ((e as Error).message || e) }
  finally { impBusy.value = false }
}

const impMatched = computed(() => impRows.value.filter(r => r.material_id).length)
/** 待创建：新增物料表单已确认，入库时才统一建料 */
const impPending = computed(() => impRows.value.filter(r => r.pending).length)
const impUnmatched = computed(() => impRows.value.filter(r => !r.material_id && !r.pending).length)
const filteredImpRows = computed(() => {
  if (impFilter.value === 'matched') return impRows.value.filter(r => r.material_id)
  if (impFilter.value === 'unmatched') return impRows.value.filter(r => !r.material_id && !r.pending)
  return impRows.value
})

// 表格用 table-layout: fixed，故全部给确定 width（总宽约 820px）
// 单元格内容超长时省略号截断，整体放不下则由表格自身横向滚动
const impCols: DtColumn[] = [
  { key: 'model', label: '型号', width: '100px' },
  { key: 'name', label: '名称', width: '110px' },
  { key: 'qty', label: '数量', align: 'center', width: '40px' },
  { key: 'price', label: '单价', align: 'right', width: '70px' },
  { key: 'amount', label: '金额', align: 'right', width: '80px' },
  { key: 'supplier', label: '供应商', width: '100px' },
  // { key: 'note', label: '备注', width: '100px' },
  { key: 'match', label: '匹配结果', width: '90px' },
  { key: 'ops', label: '操作', width: '170px', cls: 'ops' },
]

/** 单价展示：整数不带小数，其余保留两位 */
function fmtPrice(v: number): string {
  return '¥' + (Number.isInteger(v) ? v.toString() : v.toFixed(2))
}

function goMatch() {
  if (!impRows.value.length) { impErr.value = '请先导入文件'; return }
  impErr.value = ''
  impStep.value = 1
}

/**
 * 打开「选择物料」弹窗：物料库 / 立创商城 / 新建物料 三个来源共用这一个入口，
 * 行上不再单独放「新建」按钮（新建并入弹窗的「新建物料」tab）。
 */
async function pickManualImp(r: ImpRow) {
  await ensureImpCategories()
  pickerImpFor.value = r
}
/** 弹窗回调：自身库命中 = 直接关联；立创命中 = 打开新增物料表单；弹窗内新建 = 拿到草稿 */
function choosePickedImp(
  p: { kind: 'material' | 'lcsc'; item: MaterialRow | LcscHit } | { kind: 'draft'; draft: MaterialDraft },
) {
  const r = pickerImpFor.value
  if (!r) return
  pickerImpFor.value = null
  if (p.kind === 'material') {
    const c = p.item as MaterialRow
    r.pending = null
    r.material_id = c.id; r.matchedName = c.name; r.stockQty = c.qty; r.manual = true
    r.issue = null
  } else if (p.kind === 'draft') {
    applyPendingDraft(r, p.draft)
  } else {
    void openLcscFormImp(r, p.item as LcscHit)
  }
}
/** 草稿落到行上进入「待创建」（不落库，入库时统一建料） */
function applyPendingDraft(r: ImpRow, draft: MaterialDraft) {
  r.material_id = null; r.matchedName = ''; r.stockQty = null; r.manual = false
  r.pending = draft
  r.issue = null
  toast.success(`「${draft.name}」已加入待创建，入库时一并建料`)
}
function clearMatch(r: ImpRow) {
  r.material_id = null; r.matchedName = ''; r.stockQty = null; r.manual = false
  r.pending = null
  r.issue = null
}

// ===== 立创 → 新增物料表单（预填 + 暂存不落库，点「保存入库」时才建料 + 附件 + 入库） =====
/** 新增物料表单（立创预填）的目标行 */
const impFormRow = ref<ImpRow | null>(null)
const showImpForm = ref(false)
const impFormLcsc = ref<LcscComponent | null>(null)
const impFormLcscPrice = ref<number | null>(null)
/** 普通预填（非立创 / 非编辑）：用导入行数据直接新建物料 */
const impFormPrefill = ref<Partial<MaterialDraft> | null>(null)
/** 新增 / 编辑表单的初始库存默认值：草稿已设数量则沿用，否则以本行导入数量作为初始库存 */
const impInitialStock = computed<number | null>(() => {
  const r = impFormRow.value
  if (!r) return null
  return r.pending && r.pending.qty > 0 ? r.pending.qty : r.qty
})
/** 新增物料表单标题：编辑草稿 / 立创预填 / 按本行新建 三种场景区分 */
const impFormTitle = computed(() => {
  const r = impFormRow.value
  if (!r) return undefined
  if (r.pending) return '编辑待创建物料'
  return r.lcsc ? '新增物料（来自立创）' : '新增物料'
})
/** 「选择物料」弹窗「新建物料」tab 的预填：已有草稿就接着草稿改，否则用本行数据 */
const impPickerPrefill = computed<Partial<MaterialDraft> | null>(() => {
  const r = pickerImpFor.value
  if (!r) return null
  return r.pending ?? rowPrefill(r)
})
/** 「新建物料」tab 的初始库存默认值：沿用本行导入数量 */
const impPickerStock = computed<number | null>(() => pickerImpFor.value?.qty ?? null)
/** 分类数据（表单需要大类 / 小类 / 参数模板） */
const impCategories = ref<Category[]>([])

/** 确保分类数据已加载（进入页面即预取；打开「新增物料」表单的各入口也共用此兜底） */
async function ensureImpCategories() {
  if (impCategories.value.length) return
  try { impCategories.value = await listCategories() } catch { impCategories.value = [] }
}

onMounted(() => { void ensureImpCategories() })

/** 选中立创商品：取详情 → 打开新增物料表单（deferPersist：保存不落库，草稿绑定行） */
async function openLcscFormImp(r: ImpRow, h: LcscHit) {
  if (r.formBusy) return
  r.formBusy = true
  try {
    const d = await lcscLookup(h.part_no)
    await ensureImpCategories()
    impFormRow.value = r
    // 订单行解析出的名称优先（立创的「商品名称」常就是型号串，直接用会把型号写进名称）
    impFormLcsc.value = r.name ? { ...d, name: r.name } : d
    // 搜索命中价优先；立创详情不带价时回退用订单行单价，避免表单显示 0
    impFormLcscPrice.value = h.price ?? r.price
    showImpForm.value = true
  } catch (e: unknown) {
    toast.error('查立创详情失败：' + ((e as Error).message || e))
  } finally {
    r.formBusy = false
  }
}

/** 表单保存：把「待创建」草稿绑定到行（不落库，入库时统一建料） */
function onImpFormSaved(res: import('../../lib/types').MaterialFormResult) {
  const r = impFormRow.value
  if (!r) return
  applyPendingDraft(r, res.draft)
}

/** 新增物料表单开关：关闭（取消）时丢弃本次选择 */
function onImpFormToggle(v: boolean) {
  showImpForm.value = v
  if (!v) {
    impFormRow.value = null
    impFormLcsc.value = null
    impFormLcscPrice.value = null
    impFormPrefill.value = null
  }
}

/** 用导入行数据生成新增物料表单的预填（订单行名称 / 型号 / 品牌 / 封装 / 编号 / 单价 / 链接） */
function rowPrefill(r: ImpRow): Partial<MaterialDraft> {
  return {
    name: r.name || r.model,
    model: r.model,
    brand: r.brand || '',
    package: r.package || '',
    part_no: r.partNo || '',
    // 该行导入数量即初始库存（可修改），保存入库时按此数量记初始入库
    qty: r.qty,
    // 订单行单价同步进「新增物料」表单（可为空，入库时仍以行单价为准）
    price: r.price ?? 0,
    link: r.link || '',
  }
}

/**
 * 未匹配行：用本行数据预填新增物料表单（保存后进入待创建，入库时统一建料）。
 * 行上入口已并入「选择物料」弹窗，这里主要供问题清单的「按本行新建」直接唤起。
 */
async function newImpMaterial(r: ImpRow) {
  await ensureImpCategories()
  impFormRow.value = r
  impFormLcsc.value = null
  impFormLcscPrice.value = null
  impFormPrefill.value = rowPrefill(r)
  showImpForm.value = true
}

// ===== 一键匹配立创 =====
const impLcscMatching = ref(false)
const impLcscProg = ref({ done: 0, total: 0, kw: '' })
/** 可参与一键匹配的行：未绑定（无物料、无待创建草稿、非手动指定）且有型号 */
const impMatchable = computed(() =>
  impRows.value.filter(r => !r.material_id && !r.pending && !r.manual && r.model),
)

/** 为所有未绑定行自动查立创，命中即生成「待创建」草稿（不落库，入库时统一建料） */
async function autoMatchImpLcsc() {
  const targets = impMatchable.value
  if (!targets.length || impLcscMatching.value) return
  // 分类用于按立创分类编码定位本地分类，未就绪则现取
  await ensureImpCategories()
  impLcscMatching.value = true
  try {
    const res = await matchLcscBatch(
      targets.map(r => ({ keyword: r.model, partNo: r.partNo })),
      impCategories.value,
      p => { impLcscProg.value = { done: p.done, total: p.total, kw: p.keyword } },
    )
    let ok = 0, noHit = 0, fail = 0
    res.forEach((o, i) => {
      const r = targets[i]
      if (o.status === 'ok' && o.draft && o.lcsc) {
        r.material_id = null; r.matchedName = ''; r.stockQty = null; r.manual = false
        // 同上：订单行解析出的名称优先于立创名称
        r.pending = r.name ? { ...o.draft, name: r.name } : o.draft
        r.lcsc = o.lcsc
        r.lcscPrice = o.price ?? null
        r.issue = null
        ok++
      } else if (o.status === 'no-hit') noHit++
      else fail++
    })
    // 匹配过程中可能按立创分类树新建了「大类 / 小类」，重新拉一次保证入库校验能看到
    if (ok) {
      try { impCategories.value = await listCategories() } catch { /* 静默 */ }
    }
    const parts = [`匹配成功 ${ok}`]
    if (noHit) parts.push(`立创无结果 ${noHit}`)
    if (fail) parts.push(`失败 ${fail}`)
    const msg = `立创匹配完成：${parts.join('，')}`
    if (ok) toast.success(msg)
    else toast.warning(msg)
  } catch (e: unknown) {
    toast.error('匹配立创失败：' + ((e as Error).message || e))
  } finally {
    impLcscMatching.value = false
    // 稍延迟清除进度，让用户看到 100%
    setTimeout(() => { impLcscProg.value = { done: 0, total: 0, kw: '' } }, 600)
  }
}

/**
 * 编辑「待创建」草稿：始终打开新增物料表单并以草稿内容回填（分类 / 参数 / 图片 / 附件一并带回），
 * 不再跳「选择物料」弹窗 —— 想改绑已有物料走行上的「改选」。
 */
async function editPendingImp(r: ImpRow) {
  await ensureImpCategories()
  impFormRow.value = r
  impFormLcsc.value = null
  impFormLcscPrice.value = null
  impFormPrefill.value = r.pending
  showImpForm.value = true
}

/**
 * 批量入库前置必填校验：
 * - 未匹配也未新建的行：必须先「绑定」或「新建」，不允许入库时按行自动裸建；
 * - 待创建草稿（含一键立创匹配）：与新增物料表单一致的必填项（名称 / 商品编号 / 大类 / 小类）。
 * 校验结果不直接抛错误文案，而是产出结构化清单供弹窗逐行给处理入口。
 */
function checkImpRowsForImport(): ImpIssue[] {
  const issues: ImpIssue[] = []
  impRows.value.forEach((r, i) => {
    const no = i + 1
    // 已匹配到库内物料：直接入库
    if (r.material_id) return
    const label = r.model || r.name || r.partNo || `第 ${no} 行`
    // 未匹配也未新建：必须先绑定或新建，禁止自动裸建
    if (!r.pending) {
      issues.push({
        key: r.key, no, label,
        kind: 'unmatched',
        missing: [],
        reason: '库里还没有这个物料：可绑定现有物料，或用订单信息新建一个',
      })
      return
    }
    // 待创建草稿：逐项校验必填（与新增物料表单规则一致）
    const d = r.pending
    const missing: string[] = []
    if (!(d.name || '').trim()) missing.push('名称')
    if (!(d.part_no || '').trim()) missing.push('商品编号')
    const minor = d.category_id ? impCategories.value.find(c => c.id === d.category_id) : undefined
    // 小类必须存在（即分类树中的叶子/子级），大类由小类反推即可
    if (!minor || !minor.parent) missing.push('分类（大类/小类）')
    if (missing.length) {
      issues.push({
        key: r.key, no, label,
        kind: 'incomplete',
        missing,
        reason: '新建信息还不完整，补全后即可入库',
      })
    }
  })
  return issues
}

async function doImport() {
  if (!impRows.value.length) return
  // 入库流水备注按每行的来源文件分别标注，如「xxx订单.xls 导入」（多文件导入时各自对应）
  const noteOf = (r: ImpRow) => r.note || (r.src ? `${r.src} 导入` : '订单导入')
  // 入库前必填校验（整批阻止）：分类归属判断需用到分类表，先确保已加载
  await ensureImpCategories()
  const issues = checkImpRowsForImport()
  if (issues.length) {
    // 问题行行内做轻量标记（不展示长文案），原因与处理入口交给弹窗清单
    const byKey = new Map(issues.map(it => [it.key, it]))
    for (const r of impRows.value) {
      const it = byKey.get(r.key)
      r.issue = it ? (it.kind === 'incomplete' ? '待补全信息' : '待绑定或新建') : null
    }
    impBlock.value = issues
    impFilter.value = 'all'
    toast.warning(`本次未入库：有 ${issues.length} 行需先处理，已列出原因`)
    return
  }
  importing.value = true
  impDone.value = 0
  let ok = 0, created = 0
  try {
    for (const r of impRows.value) {
      impDone.value++
      let mid = r.material_id
      const pend = r.pending
      // 待创建（新增物料表单确认）：建料（带分类 / 参数 / 手册 / 附件），随后统一入库
      if (pend) {
        const m = await createMaterial({
          name: pend.name, model: pend.model, brand: pend.brand, package: pend.package,
          part_no: pend.part_no, category_id: pend.category_id, params: pend.params,
          location: pend.location,
          price: r.price ?? pend.price,
          threshold: pend.threshold,
          image_path: pend.image_path, datasheet_path: pend.datasheet_path,
          link: pend.link, remark: r.src || null, qty: 0,
        })
        // 立创附件（数据手册 / 认证资料 / 行业资讯）全部落库
        if (pend.files?.length) await createMaterialFiles(m.id, pend.files)
        mid = m.id
        created++
        comps.value.push({ ...m, qty: 0 })
        r.pending = null
      } else {
        // 已匹配：仅补全空字段，不覆盖用户已维护的资料。
        // 入库前必填校验已保证每行「已匹配」或「待创建已建料」；未匹配也未新建的行禁止兜底裸建，直接跳过。
        if (!mid) continue
        const exist = comps.value.find(c => c.id === mid)
        if (exist) {
          const patch: Partial<MaterialRow> = {}
          if (!exist.part_no && r.partNo) patch.part_no = r.partNo
          if (!exist.brand && r.brand) patch.brand = r.brand
          if (!exist.package && r.package) patch.package = r.package
          if (!exist.price && r.price) patch.price = r.price
          if (!exist.link && r.link) patch.link = r.link
          if (!exist.remark && r.src) patch.remark = r.src
          if (Object.keys(patch).length) {
            const upd = await updateMaterial(mid, patch)
            const idx = comps.value.findIndex(c => c.id === mid)
            if (idx >= 0) comps.value[idx] = { ...comps.value[idx], ...upd }
          }
        }
      }
      // 入库数量：新建物料（待创建表单已确认）以表单「初始库存」为准（默认 = 本行导入数量），
      // 已在库的匹配物料为累加入库，仍用本行数量
      const stockQty = pend && pend.qty > 0 ? pend.qty : r.qty
      const cur = comps.value.find(c => c.id === mid)?.qty ?? 0
      const fresh = await applyStock({
        material_id: mid, type: 'in', qty: stockQty, currentQty: cur,
        supplier_id: r.supplier_id, note: noteOf(r),
      })
      // 同步本地
      const idx = comps.value.findIndex(c => c.id === mid)
      if (idx >= 0) comps.value[idx] = { ...comps.value[idx], qty: fresh.qty }
      const s = sumOf(mid)
      s.total_in += stockQty; s.last30_in += stockQty
      summaryMap.value.set(mid, s)
      ok++
    }
    expandCache.clear()
    refreshLogs()
    toast.success(`入库完成 ${ok} 项${created ? `，新建物料 ${created}` : ''}`)
    raw.value = ''; previewText.value = ''
    impRows.value = []; headers.value = []; impFiles.value = []
    colMap.value = emptyMap()
    autoMap.value = emptyMap()
    presetId.value = 'auto'
    impFilter.value = 'all'
    impStep.value = 0
  } catch (e: unknown) { toast.error('入库失败：' + ((e as Error).message || e)) }
  finally { importing.value = false }
}

// ===== 入库问题清单：弹窗逐行给处理入口（入口即对应表格内同款操作） =====
function closeImpBlock() {
  impBlock.value = []
}
function impIssueRow(it: ImpIssue) {
  return impRows.value.find(r => r.key === it.key)
}
/** 待创建信息不完整：关掉清单，打开表单补全 */
function fixImpIssue(it: ImpIssue) {
  const r = impIssueRow(it)
  if (!r) return
  closeImpBlock()
  // 立创草稿走「编辑待创建」；其余由绑定弹窗承接（两种都会被整批校验拦下，不会误入库）
  if (r.lcsc) editPendingImp(r)
  else pickManualImp(r)
}
/** 未绑定：关掉清单，打开「绑定已有物料」 */
function bindImpIssue(it: ImpIssue) {
  const r = impIssueRow(it)
  if (!r) return
  closeImpBlock()
  pickManualImp(r)
}
/** 未绑定：关掉清单，直接按本行订单数据走「新建物料」 */
function newImpIssue(it: ImpIssue) {
  const r = impIssueRow(it)
  if (!r) return
  closeImpBlock()
  void newImpMaterial(r)
}

// 展开缓存：导入入库后失效，保证切回列表看到最新流水
const expandCache = new Map<string, StockLog[]>()
</script>

<style scoped>
.tab {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

/* ===== 导入入库（页内两步，与 BOM 导入同款样式） ===== */
.import-wrap {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.wizard-steps {
  flex-shrink: 0;
  padding: 14px 18px 0;
}

/* 步骤 0：导入配置 */
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

/* 步骤 0：左文件框 / 右列映射，两张等高卡片，超出滚动 */
.imp-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
  height: 360px;
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

/* 左：文件拖拽区 */
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

/* 多文件：列出已选文件名，超出滚动 */
.file-names {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 6px;
  max-height: 120px;
  overflow-y: auto;
  padding: 0 4px;
}

.fn-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  max-width: 100%;
  padding: 3px 4px 3px 9px;
  border-radius: 999px;
  background: var(--c-primary-soft);
  color: var(--c-primary);
  font-size: var(--fs-xs);
  font-weight: 600;
}

.fn-txt {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 移除单个文件 */
.fn-x {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  flex-shrink: 0;
  padding: 0;
  border: none;
  border-radius: 50%;
  background: transparent;
  color: inherit;
  opacity: 0.6;
  cursor: pointer;
  transition: all var(--motion-fast);
}

.fn-x:hover {
  opacity: 1;
  background: var(--c-danger);
  color: #fff;
}

.file-drop small {
  font-size: var(--fs-xs);
  color: var(--c-text-3);
}

/* 右：列映射网格，超出滚动 */
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

/* 方案选择独占一行（下方字段为两列网格） */
.adv-field.wide {
  grid-column: 1 / -1;
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

.imp-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}

/* 步骤 1：匹配结果 */
.wiz-result {
  flex: 1;
  min-height: 0;
  min-width: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
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

/* 批量操作按钮组（统计 chip 右侧） */
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

.stats {
  display: flex;
  gap: 14px;
  align-items: center;
  flex-wrap: wrap;
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

.imp-pend {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 3px 10px;
  border-radius: 999px;
  background: rgba(83, 122, 255, 0.08);
  color: var(--c-primary);
  font-size: var(--fs-xs);
  font-weight: 600;
}

.imp-pend .dot {
  background: var(--c-primary);
}

/* 表格：复用 DataTable，固定布局，列宽由表头决定，窄屏改由表格自身横向滚动（与 BOM 导入一致） */
.wiz-result :deep(.dt-wrap) {
  min-width: 0;
}

.wiz-result :deep(table) {
  table-layout: fixed;
  min-width: 0;
}

/* 行内单元格 */
.mono {
  font-family: ui-monospace, 'SF Mono', Menlo, Consolas, monospace;
  font-size: var(--fs-xs);
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.qty-cell {
  font-weight: 700;
  font-size: var(--fs-md);
}

/* 型号下方的商品编号 / 商家编码（次要信息） */
.row-sub {
  display: block;
  margin-top: 2px;
  color: var(--c-text-3);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.price-cell {
  font-weight: 600;
  font-size: var(--fs-sm);
}

.dim {
  color: var(--c-text-3);
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



/* ===== 批量入库问题清单弹窗 ===== */
.ib-mask {
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

.ib-card {
  position: relative;
  width: min(560px, 94vw);
  max-height: min(74vh, 640px);
  background: var(--c-elevated);
  border: 1px solid var(--c-border);
  border-radius: var(--r-2xl);
  box-shadow: var(--shadow-lg);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  animation: ib-in 220ms cubic-bezier(0.34, 1.56, 0.64, 1);
}

@keyframes ib-in {
  from { opacity: 0; transform: translateY(12px) scale(0.98); }
  to { opacity: 1; transform: none; }
}

.ib-x {
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

.ib-x:hover {
  background: var(--c-glass);
  color: var(--c-text);
}

.ib-head {
  display: flex;
  gap: 10px;
  align-items: flex-start;
  padding: 16px 48px 4px 16px;
}

.ib-ico {
  width: 36px;
  height: 36px;
  flex-shrink: 0;
  display: grid;
  place-items: center;
  border-radius: var(--r-md);
  background: rgba(255, 107, 107, 0.12);
  color: var(--c-danger);
}

.ib-head-txt {
  min-width: 0;
}

.ib-head-txt h3 {
  margin: 0 0 3px;
  font-size: var(--fs-md);
  font-weight: 600;
  line-height: 1.4;
}

.ib-head-txt p {
  margin: 0;
  font-size: var(--fs-sm);
  color: var(--c-text-2);
  line-height: 1.5;
}

.ib-list {
  margin-top: 10px;
  padding: 0 16px 4px;
  overflow: auto;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.ib-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 10px;
  border: 1px solid var(--c-border);
  border-radius: var(--r-md);
  background: var(--c-glass);
}

.ib-main {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.ib-line {
  display: flex;
  align-items: baseline;
  gap: 8px;
  min-width: 0;
}

.ib-no {
  flex-shrink: 0;
  font-size: 11px;
  color: var(--c-text-3);
}

.ib-label {
  flex-shrink: 0;
  max-width: 170px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 500;
}

.ib-reason {
  flex: 1;
  min-width: 0;
  font-size: 12px;
  color: var(--c-text-2);
  line-height: 1.45;
  overflow-wrap: break-word;
}

.ib-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.ib-tag {
  font-size: 11px;
  line-height: 1;
  padding: 3px 7px;
  border-radius: 999px;
  background: rgba(255, 107, 107, 0.1);
  color: var(--c-danger);
}

.ib-actions {
  flex-shrink: 0;
  display: flex;
  gap: 6px;
}

.ib-foot {
  display: flex;
  justify-content: flex-end;
  padding: 10px 16px 14px;
  border-top: 1px solid var(--c-border);
  margin-top: 8px;
}

/* 匹配结果单元格：pill 按内容宽度排列（不做 stretch，避免文字短时右侧空一长条底色） */
.match-cell {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 3px;
  min-width: 0;
}

/* 三个状态 pill 统一样式：图标 + 同宽内边距，整体宽度随文字收缩 */
.match-cell .pill {
  flex-shrink: 0;
}

.row-issue {
  display: block;
  align-self: stretch;
  max-width: 100%;
  font-size: 11px;
  line-height: 1.4;
  color: var(--c-danger);
  overflow-wrap: break-word;
}

/* 页内底部操作条 */
.imp-foot {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  padding: 14px 20px;
  border-top: 1px solid var(--c-border-hairline);
  flex-shrink: 0;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

@media (max-width: 820px) {
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
