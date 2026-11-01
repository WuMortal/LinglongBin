<template>
  <section class="page">
    <header class="head">
      <div class="head-left">
        <PageBackButton to="/tools" label="" />
        <div>
          <h1>随心标签</h1>
          <p>自由编辑每个标签的文字，自定义纸张与排版后直接打印</p>
        </div>
      </div>
      <div class="head-actions">
        <span class="sum">共 {{ state.pages.length }} 页 · 每页 {{ per }} 贴 · 已填 {{ filledCount }}</span>
        <div class="head-operate">
          <button class="btn btn-ghost" title="导入之前导出的内容 JSON" @click="pickFile">
            <Upload :size="13" style="display: inline-flex; flex-shrink: 0" />导入
          </button>
          <button class="btn btn-ghost" title="把当前内容与排版导出为 JSON" @click="doExport">
            <Download :size="13" style="display: inline-flex; flex-shrink: 0" />导出
          </button>
          <button class="btn btn-ghost" title="清空内容并把排版恢复为出厂设置" @click="resetAll">
            <RotateCcw :size="13" style="display: inline-flex; flex-shrink: 0" />恢复默认
          </button>
          <button class="btn btn-primary" @click="doPrint">
            <Printer :size="13" style="display: inline-flex; flex-shrink: 0" />打印
          </button>
          <input ref="fileEl" type="file" accept=".json" hidden @change="onFile" />
        </div>
      </div>
    </header>

    <div class="fl card">
      <!-- ===== 左：参数 ===== -->
      <aside class="fl-side">
        <!-- 标签与文字 -->
        <div class="sec">
          <span class="sec-title">标签与文字</span>
          <div class="form-grid">
            <div class="label-base">
              <!-- 一个字段含两个输入框，不能用 <label> 包：label 只会把点击关联到第一个控件 -->
              <div class="f">
                <span>标签宽 × 高 (mm)</span>
                <span class="f-pair">
                  <input v-model.number="num.label_w" type="number" min="1" step="0.5" />
                  <i>×</i>
                  <input v-model.number="num.label_h" type="number" min="1" step="0.5" />
                </span>
              </div>
              <label class="f">
                <span>字号 (pt)</span>
                <input v-model.number="num.font_pt" type="number" min="4" max="24" step="0.5" />
              </label>
            </div>
            <div class="label-view">
              <div class="f">
                <span>空格序号</span>
                <AppSelect v-model="L.ph_mode" :options="phOptions" size="sm" />
              </div>
              <div class="f">
                <span>改排布时</span>
                <AppSelect v-model="L.reflow" :options="reflowOptions" size="sm" />
              </div>
            </div>
          </div>
          <p class="tip">格子里直接打字，<b>回车即换行</b>（多行自动垂直居中，超出部分不打印）；
            「改排布时」指每页格数因纸张 / 标签尺寸变化而改变时，已有内容如何安置。</p>
        </div>

        <!-- 纸张与排版：与「标签模板」同一套口径 -->
        <details class="sec" open>
          <summary class="sec-title">纸张与排版（打印时生效）</summary>
          <div class="form-grid">
            <div class="pager-info">
              <div class="f">
                <span>纸张</span>
                <AppSelect v-model="L.paper" :options="PAPER_OPTIONS" size="sm" />
              </div>
              <label class="f">
                <span>纸宽 (mm)</span>
                <input v-model.number="num.paper_w" type="number" min="1" :disabled="L.paper !== 'CUSTOM'" />
              </label>
              <label class="f">
                <span>纸高 (mm)</span>
                <input v-model.number="num.paper_h" type="number" min="1" :disabled="L.paper !== 'CUSTOM'" />
              </label>
            </div>
            <div class="pager-calc-result">
              <div class="f">
                <span>每页 列 × 行</span>
                <span class="f-auto"
                  :title="`按纸张 ${L.paper_w}×${L.paper_h}mm 减去留白，再按标签 ${L.label_w}×${L.label_h}mm 与间距算出的最大容纳数`">
                  <b>{{ L.cols }} × {{ L.rows }}</b>
                  <span class="tag">自动</span>
                </span>
              </div>
              <div class="f">
                <span>标签区占用 (mm)</span>
                <span class="f-auto" title="标签 × 列行 + 间距 + 四周留白的实际占位，已按此居中放置">
                  <b>{{ used.w }} × {{ used.h }}</b>
                  <span class="tag">含留白</span>
                </span>
              </div>
            </div>
            <div class="f">
              <span>留白 / 列距 / 行距 (mm)</span>
              <span class="f-pair">
                <input v-model.number="num.pad" type="number" min="0" step="0.5" />
                <input v-model.number="num.gap_w" type="number" min="0" step="0.5" />
                <input v-model.number="num.gap_h" type="number" min="0" step="0.5" />
              </span>
            </div>
            <div class="f f-btn">
              <span>&nbsp;</span>
              <button class="btn btn-ghost btn-sm" @click="evenOut">均分铺满</button>
            </div>
            <div class="f">
              <span>偏移 X / Y (mm)</span>
              <span class="f-pair">
                <input v-model.number="num.off_x" type="number" step="0.5" />
                <input v-model.number="num.off_y" type="number" step="0.5" />
              </span>
            </div>
            <label class="f">
              <span>比例校正</span>
              <input v-model.number="num.scale_fix" type="number" step="0.001" min="0.5" />
            </label>
            <div class="f f-check">
              <label><input v-model="L.guides" type="checkbox" /> 打印辅助线</label>
              <label><input v-model="L.calib" type="checkbox" /> 加印校准页</label>
            </div>
          </div>
          <p class="tip">标签直接排在整张纸上：纸张尺寸减去留白，再按标签尺寸与间距自动算出每页最大可容纳的
            「列 × 行」，无需手填；偏移 X / Y 用于校准打印机偏差。
            比例校正 = 100 ÷ 实测基准条长度；打印时选「实际大小 / 100%」，关闭页眉页脚。</p>
        </details>

        <!-- 批量填充 -->
        <details class="sec">
          <summary class="sec-title">批量填充</summary>
          <textarea v-model="batchText" class="batch" rows="5"
            placeholder="第一行&#10;第二行&#10;第三行&#10;……每行填入一个标签格"></textarea>
          <div class="batch-ops">
            <button class="btn btn-ghost btn-sm" @click="fillText(false)">填充（覆盖）</button>
            <button class="btn btn-ghost btn-sm" @click="fillText(true)">追加到空格</button>
          </div>
          <p class="tip">从表格 / Excel 一列里复制多行粘贴进来，一次性铺满；「追加」会跳过已有内容，
            从第一个空格子往后写。</p>
        </details>

        <details class="sec">
          <summary class="sec-title">校准与打印说明</summary>
          <p class="tip">
            <b>一、校准</b>：勾选「加印校准页」→ 打印 → 量：① 标尺 10mm 是否准；② 100mm 基准条实测 L；
            ③ 红色虚线框（标签区外框）与实际标签的位置差 ΔX、ΔY。<br />
            若 L≠100mm：<b>比例校正 = 100 ÷ L</b>；若位置偏移：偏移 X = 现值 + ΔX，偏移 Y = 现值 + ΔY。<br />
            <b>二、打印设置</b>：缩放「默认 / 100%（实际大小）」，不要选「适合页面」；边距「无」；关闭页眉页脚。<br />
            <b>三、正式打印</b>：取消「加印校准页」与「打印辅助线」。
          </p>
        </details>
      </aside>

      <!-- ===== 右：画布 ===== -->
      <section class="fl-main">
        <div class="cv-bar">
          <button class="btn btn-ghost btn-sm" @click="addPage">
            <Plus :size="13" style="display: inline-flex; flex-shrink: 0" />空白页
          </button>
          <button class="btn btn-ghost btn-sm" @click="dupPage(curPage)">
            <Copy :size="13" style="display: inline-flex; flex-shrink: 0" />复制第 {{ curPage + 1 }} 页
          </button>
          <button class="btn btn-ghost btn-sm" :disabled="state.pages.length <= 1" @click="delPage(curPage)">
            <Trash2 :size="13" style="display: inline-flex; flex-shrink: 0" />删第 {{ curPage + 1 }} 页
          </button>
          <button class="btn btn-ghost btn-sm" title="删除完全没有内容的页" @click="compactPages">
            <Scissors :size="13" style="display: inline-flex; flex-shrink: 0" />整理空页
          </button>
          <button class="btn btn-ghost btn-sm danger" @click="clearContent">清空内容</button>
          <span class="grow" />
          <span class="zoom-lbl">预览</span>
          <input v-model.number="zoom" class="zoom" type="range" min="0.3" max="1.5" step="0.05" />
          <span class="zoom-val">{{ Math.round(L.zoom * 100) }}%</span>
        </div>

        <div class="cv-view">
          <div v-for="(cells, i) in state.pages" :key="i" class="cv-pagebox">
            <div class="cv-pagebar">
              <b>第 {{ i + 1 }} 页</b>
              <span class="muted">已填 {{ cells.filter(Boolean).length }} / {{ per }}</span>
              <span class="grow" />
              <button class="btn btn-ghost mini" @click="dupPage(i)">复制</button>
              <button class="btn btn-ghost mini danger" :disabled="state.pages.length <= 1"
                @click="delPage(i)">删除</button>
            </div>
            <div class="cv-stage" :style="{ width: `${pw * L.zoom}mm`, height: `${ph * L.zoom}mm` }">
              <div class="cv-scaler" :style="scalerStyle">
                <FreeLabelSheet editable :layout="L" :cells="cells" :no-base="i * per"
                  @cell-input="(idx, v) => setCell(i, idx, v)" @focus-cell="() => (curPage = i)" />
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>

    <!-- 打印区：屏幕隐藏，点击【打印】直接输出整页标签。
         平时不渲染 —— 否则整份内容会同时存在两份 DOM（预览 + 打印），
         每次敲键盘都要一起重渲染，格子一多就卡。 -->
    <Teleport to="body">
      <div v-if="printing" class="pv-print">
        <FreeCalibPage v-if="L.calib" :layout="L" />
        <FreeLabelSheet v-for="(cells, i) in state.pages" :key="'p' + i" :layout="L" :cells="cells" />
      </div>
    </Teleport>
  </section>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, reactive, ref, watch } from 'vue'
import {
  Copy, Download, Plus, Printer, RotateCcw, Scissors, Trash2, Upload,
} from 'lucide-vue-next'
import {
  PAPER_OPTIONS, PAPER_SIZES, MAX_CELLS_PER_PAGE, clampGrid, computeGrid, clearFreeState, loadFreeState,
  padCells, paperSize, perPage, firstEmptyIndex, reflowPages, saveFreeState, DEFAULT_FREE_STATE, usedSize,
} from '../../lib/freeLabel'
import type { FreeLabelLayout, FreeLabelState } from '../../lib/types'
import AppSelect from '../../components/form/AppSelect.vue'
import PageBackButton from '../../components/PageBackButton.vue'
import FreeLabelSheet from '../../components/label/FreeLabelSheet.vue'
import FreeCalibPage from '../../components/label/FreeCalibPage.vue'
import { useToast } from '../../composables/toast'
import { confirm } from '../../composables/confirm'

const toast = useToast()

/** 本地存档状态：每次改动写回 localStorage（防抖），内容与排版一并保留 */
const state = ref<FreeLabelState>(loadFreeState())
const L = computed(() => state.value.layout)

const per = computed(() => perPage(L.value))
const size = computed(() => paperSize(L.value))
const pw = computed(() => size.value[0])
const ph = computed(() => size.value[1])
const filledCount = computed(() =>
  state.value.pages.reduce((n, p) => n + p.filter(Boolean).length, 0),
)

/** 当前操作的页：格子获得焦点时更新，供「复制 / 删除第 N 页」使用 */
const curPage = ref(0)
const batchText = ref('')
const fileEl = ref<HTMLInputElement | null>(null)

const phOptions = [
  { value: 'hover', label: '悬停显示' },
  { value: 'always', label: '始终显示' },
  { value: 'none', label: '不显示' },
]
const reflowOptions = [
  { value: 'keep', label: '保持内容（自动增页）' },
  { value: 'trim', label: '保持页数（丢弃超出）' },
]

const scalerStyle = computed(() => ({
  width: `${pw.value}mm`,
  height: `${ph.value}mm`,
  transform: `scale(${L.value.zoom})`,
  transformOrigin: 'top left',
}))

/* ===== 参数写入 ===== */

type NumKey = Extract<
  keyof FreeLabelLayout,
  'paper_w' | 'paper_h' | 'label_w' | 'label_h' | 'pad' | 'gap_w' | 'gap_h' | 'off_x' | 'off_y' | 'scale_fix' | 'font_pt'
>

/**
 * 数值字段的「可写 computed」：读即当前值，写在 set 里统一夹紧 / 回落。
 * 模板直接 v-model.number="num.xxx"，不再手动取 e.target —— 这才是 Vue 的双向绑定写法。
 */
function numModel(key: NumKey, min: number, fallback: number) {
  return computed({
    get: () => L.value[key],
    set: (v: number | string) => {
      const n = typeof v === 'string' ? Number(v) : v
      const next = Number.isFinite(n) ? Math.max(min, n) : fallback
      if (next !== L.value[key]) L.value[key] = next
    },
  })
}

/** reactive 会自动解包内部的 ref，所以模板里 num.label_w 拿到的是数字本身 */
const num = reactive({
  paper_w: numModel('paper_w', 1, 210),
  paper_h: numModel('paper_h', 1, 297),
  label_w: numModel('label_w', 1, 24),
  label_h: numModel('label_h', 1, 12),
  pad: numModel('pad', 0, 3),
  gap_w: numModel('gap_w', 0, 5),
  gap_h: numModel('gap_h', 0, 2),
  off_x: numModel('off_x', -100, 0),
  off_y: numModel('off_y', -100, 0),
  scale_fix: numModel('scale_fix', 0.5, 1),
  font_pt: numModel('font_pt', 4, 8),
})

/** 预览缩放：夹在 0.3 ~ 1.5，同样走 v-model */
const zoom = computed({
  get: () => L.value.zoom,
  set: (v: number | string) => {
    const n = typeof v === 'string' ? Number(v) : v
    L.value.zoom = Math.min(1.5, Math.max(0.3, Number.isFinite(n) ? n : 0.7))
  },
})

/** 选标准纸张时把标准尺寸写回宽高，避免切到「自定义」时看到上一次的残留值 */
watch(() => L.value.paper, p => {
  if (!p || p === 'CUSTOM') return
  const s = PAPER_SIZES[p]
  if (s) { L.value.paper_w = s[0]; L.value.paper_h = s[1] }
})

/**
 * 纸张 / 留白 / 间距 / 标签尺寸变化 → 立刻重算每页「列 × 行」并刷新画布。
 *
 * 刻意不在这里重排已有内容：输入 "24" 的过程中会经过 "2"，
 * 而每页格数是自动算的 —— 中间值会让整页瞬间涨到上千格，重建这些输入框会把页面卡死。
 * 尺寸先实时生效（只是一次重绘），真正重排内容交给防抖的 reflow。
 */
function applyGrid() {
  const raw = computeGrid(L.value)
  const g = clampGrid(raw.cols, raw.rows)
  clamped = g.cols !== raw.cols || g.rows !== raw.rows
  if (g.cols === L.value.cols && g.rows === L.value.rows) return
  L.value.cols = g.cols
  L.value.rows = g.rows
  scheduleReflow()
}

/** 自动排布是否触到了上限（用于给提示，避免静默截断） */
let clamped = false

let reflowTimer: number | null = null
/** 内容重排：重建所有输入框，比较贵，等尺寸敲定（停手 350ms）再做 */
function scheduleReflow() {
  if (reflowTimer) clearTimeout(reflowTimer)
  reflowTimer = window.setTimeout(() => {
    reflowTimer = null
    const pages = reflowPages(state.value, perPage(L.value))
    if (curPage.value > pages - 1) curPage.value = pages - 1
    if (clamped) {
      clamped = false
      toast.warning(`已达到每页 ${MAX_CELLS_PER_PAGE} 贴的上限，当前 ${L.value.cols} 列 × ${L.value.rows} 行；再密会让页面卡住`)
    } else if (L.value.reflow === 'keep') {
      toast.info(`每页 ${perPage(L.value)} 贴，内容已按顺序重排为 ${pages} 页`)
    } else {
      toast.warning(`每页 ${perPage(L.value)} 贴，超出容量的内容已丢弃`)
    }
  }, 350)
}

watch(
  () => [
    L.value.paper, L.value.paper_w, L.value.paper_h,
    L.value.pad, L.value.gap_w, L.value.gap_h,
    L.value.label_w, L.value.label_h,
  ],
  () => applyGrid(),
)

/** 均分铺满：按当前行列把间距调成等距，让标签区刚好占满纸张（减去留白） */
function evenOut() {
  const [w, h] = size.value
  const innerW = w - 2 * L.value.pad
  const innerH = h - 2 * L.value.pad
  const gw = L.value.cols > 1 ? (innerW - L.value.cols * L.value.label_w) / (L.value.cols - 1) : 0
  const gh = L.value.rows > 1 ? (innerH - L.value.rows * L.value.label_h) / (L.value.rows - 1) : 0
  if (gw < 0 || gh < 0) { toast.warning('当前行列放不下，请先缩小标签尺寸'); return }
  L.value.gap_w = Math.round(Math.max(0, gw) * 10) / 10
  L.value.gap_h = Math.round(Math.max(0, gh) * 10) / 10
}

/* ===== 内容编辑 ===== */

function setCell(pi: number, ci: number, v: string) {
  const page = state.value.pages[pi]
  if (!page) return
  page[ci] = v
  scheduleSave()
}

let saveTimer: number | null = null
function scheduleSave() {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = window.setTimeout(() => { saveFreeState(state.value); saveTimer = null }, 400)
}
// 排版参数变化也要落盘（内容编辑走 setCell 的防抖，这里兜住其余字段）
watch(L, () => scheduleSave(), { deep: true })

/* ===== 页面操作 ===== */

function emptyPage(): string[] { return Array(per.value).fill('') }

function addPage() {
  state.value.pages.push(emptyPage())
  scrollToLast()
  toast.success(`已新增空白页（共 ${state.value.pages.length} 页）`)
}

function dupPage(i: number) {
  const src = state.value.pages[i]
  if (!src) return
  state.value.pages.splice(i + 1, 0, [...src])
  toast.success(`已复制第 ${i + 1} 页（共 ${state.value.pages.length} 页）`)
}

function delPage(i: number) {
  if (state.value.pages.length <= 1) return
  state.value.pages.splice(i, 1)
  if (curPage.value > state.value.pages.length - 1) curPage.value = state.value.pages.length - 1
}

/** 整理空页：删掉完全没内容的页（至少保留一页，否则画布没东西可编辑） */
function compactPages() {
  const before = state.value.pages.length
  if (before <= 1) { toast.info('只有一页，无需整理'); return }
  const kept = state.value.pages.filter((p, i) => i === 0 || p.some(Boolean))
  if (kept.length === before) { toast.info('没有空白页可整理'); return }
  state.value.pages = kept
  if (curPage.value > kept.length - 1) curPage.value = kept.length - 1
  toast.success(`已删除 ${before - kept.length} 个空白页`)
}

async function clearContent() {
  if (!filledCount.value) { toast.info('还没有内容'); return }
  const ok = await confirm({ content: '清空所有页面的文字？', confirmText: '清空', danger: true })
  if (!ok) return
  state.value.pages = state.value.pages.map(() => emptyPage())
  toast.success('已清空')
}

async function resetAll() {
  const ok = await confirm({
    content: '将清空所有文字并把纸张排版恢复为出厂设置，确定？',
    confirmText: '恢复默认', danger: true,
  })
  if (!ok) return
  clearFreeState()
  state.value = DEFAULT_FREE_STATE()
  const g = computeGrid(L.value)
  L.value.cols = g.cols
  L.value.rows = g.rows
  state.value.pages = [emptyPage()]
  curPage.value = 0
  batchText.value = ''
  toast.success('已恢复默认')
}

/* ===== 批量填充 ===== */

function fillText(append: boolean) {
  const lines = batchText.value.split('\n').map(s => s.trim()).filter(Boolean)
  if (!lines.length) { toast.warning('请先粘贴内容，每行一条'); return }
  const n = per.value
  const flat = append ? state.value.pages.flat() : []
  let gi = append ? firstEmptyIndex(state.value) : 0
  for (const t of lines) {
    while (flat.length < gi + 1) for (let k = 0; k < n; k++) flat.push('')
    flat[gi++] = t
  }
  const out: string[][] = []
  for (let i = 0; i < Math.max(flat.length, n); i += n) out.push(padCells(flat.slice(i, i + n), n))
  state.value.pages = out
  curPage.value = 0
  if (append) scrollToLast()
  toast.success(`已${append ? '追加' : '填充'} ${lines.length} 条，共 ${out.length} 页`)
}

/* ===== 导入 / 导出 ===== */

function pickFile() { fileEl.value?.click() }

function doExport() {
  const data = JSON.stringify({ layout: L.value, pages: state.value.pages }, null, 2)
  const url = URL.createObjectURL(new Blob([data], { type: 'application/json' }))
  const a = document.createElement('a')
  a.href = url
  a.download = `随心标签-${new Date().toISOString().slice(0, 10)}.json`
  a.click()
  URL.revokeObjectURL(url)
}

function onFile() {
  const f = fileEl.value?.files?.[0]
  if (!f) return
  const r = new FileReader()
  r.onload = () => {
    try {
      const data = JSON.parse(String(r.result)) as unknown
      const raw = normalizeImport(data)
      if (!raw.length) throw new Error('没有可导入的内容')
      const n = per.value
      const flat: string[] = []
      for (const p of raw) (Array.isArray(p) ? p : [p]).forEach(v => flat.push(v == null ? '' : String(v)))
      const out: string[][] = []
      for (let i = 0; i < Math.max(flat.length, n); i += n) out.push(padCells(flat.slice(i, i + n), n))
      state.value.pages = out
      curPage.value = 0
      const withTpl = data && typeof data === 'object' && 'layout' in data
        ? (data as { layout?: Partial<FreeLabelLayout> }).layout
        : undefined
      if (withTpl) {
        Object.assign(L.value, {
          paper: withTpl.paper ?? L.value.paper,
          paper_w: withTpl.paper_w ?? L.value.paper_w,
          paper_h: withTpl.paper_h ?? L.value.paper_h,
          label_w: withTpl.label_w ?? L.value.label_w,
          label_h: withTpl.label_h ?? L.value.label_h,
          pad: withTpl.pad ?? L.value.pad,
          gap_w: withTpl.gap_w ?? L.value.gap_w,
          gap_h: withTpl.gap_h ?? L.value.gap_h,
          off_x: withTpl.off_x ?? L.value.off_x,
          off_y: withTpl.off_y ?? L.value.off_y,
          scale_fix: withTpl.scale_fix ?? L.value.scale_fix,
          guides: withTpl.guides ?? L.value.guides,
          font_pt: withTpl.font_pt ?? L.value.font_pt,
        })
        const auto = computeGrid(L.value)
        const g = clampGrid(auto.cols, auto.rows)
        if (g.cols !== L.value.cols || g.rows !== L.value.rows) {
          L.value.cols = g.cols
          L.value.rows = g.rows
          reflowPages(state.value, perPage(L.value))
        }
      }
      toast.success(`已导入 ${flat.filter(Boolean).length} 条内容`)
    } catch (err: unknown) {
      toast.error('导入失败：' + ((err as Error).message || err))
    } finally {
      // 清空以便同一个文件能再次触发 change
      if (fileEl.value) fileEl.value.value = ''
    }
  }
  r.readAsText(f, 'utf-8')
}

/** 兼容三种写法：二维数组 / 一维字符串数组 / { pages: [...] } */
function normalizeImport(data: unknown): unknown[] {
  if (Array.isArray(data)) return data
  if (data && typeof data === 'object' && Array.isArray((data as { pages?: unknown }).pages)) {
    return (data as { pages: unknown[] }).pages
  }
  return []
}

/* ===== 打印 ===== */

/** 打印区是否挂载：平时不渲染，点【打印】时才铺出来 */
const printing = ref(false)

async function doPrint() {
  document.activeElement instanceof HTMLElement && document.activeElement.blur()
  printing.value = true
  // 等打印区真正进 DOM 并完成一次布局，再唤起打印对话框
  await nextTick()
  await new Promise(r => requestAnimationFrame(() => r(null)))
  try {
    window.print()
  } finally {
    printing.value = false
  }
}

function scrollToLast() {
  requestAnimationFrame(() => {
    const view = document.querySelector('.cv-view')
    if (view) view.scrollTop = view.scrollHeight
  })
}

/** 标签区尺寸（含留白）：侧栏展示用，让用户知道内容在纸上的实际占位 */
const used = computed(() => {
  const s = usedSize(L.value)
  return { w: Math.round(s.w * 10) / 10, h: Math.round(s.h * 10) / 10 }
})

onMounted(() => {
  const g = computeGrid(L.value)
  if (g.cols !== L.value.cols || g.rows !== L.value.rows) applyGrid()
  else if (!state.value.pages.length) state.value.pages = [emptyPage()]
})
</script>

<style scoped>
.page {
  height: 100%;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.head-left {
  display: flex;
  align-items: center;
  gap: 12px;
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
  gap: 8px;
  flex-wrap: wrap;
  justify-content: space-between;
}

.head-operate {
  display: grid;
  gap: 10px;
  grid-auto-flow: column;
}

.sum {
  font-size: var(--fs-xs);
  color: var(--c-text-3);
  font-variant-numeric: tabular-nums;
}

.fl {
  flex: 1;
  min-height: 0;
  display: flex;
  overflow: hidden;
}

/* ===== 左：参数 ===== */
.fl-side {
  width: 300px;
  flex-shrink: 0;
  border-right: 1px solid var(--c-border-hairline);
  overflow-y: auto;
  padding: 14px;
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.sec {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.sec-title {
  font-size: var(--fs-sm);
  font-weight: 600;
  color: var(--c-text-2);
}

.pager-info {
  display: grid;
  gap: 10px;
  grid-auto-flow: column;
  grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
}

.pager-calc-result {
  display: grid;
  gap: 10px;
  grid-auto-flow: column;
}

summary.sec-title {
  cursor: pointer;
  user-select: none;
}

.form-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
  gap: 10px 12px;
}

.label-base {
  display: grid;
  gap: 10px;
  grid-auto-flow: column;
}

.label-view {
  display: grid;
  gap: 10px;
  grid-auto-flow: column;
}

.f {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.f>span:first-child {
  font-size: var(--fs-xs);
  color: var(--c-text-2);
}

.f input,
.f select {
  height: var(--ctrl-h-sm);
  padding: 0 8px;
  font-size: var(--fs-sm);
}

.f input:disabled {
  color: var(--c-text-3);
  background: var(--c-surface);
  cursor: not-allowed;
}

.f-pair {
  display: flex;
  align-items: center;
  gap: 4px;
}

.f-pair input {
  width: 100%;
  min-width: 0;
  height: var(--ctrl-h-sm);
  padding: 0 6px;
  font-size: var(--fs-sm);
}

.f-pair i {
  color: var(--c-text-3);
  font-style: normal;
}

.f-btn {
  justify-content: flex-end;
}

.f-auto {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: var(--ctrl-h-sm);
  font-size: var(--fs-sm);
  color: var(--c-text-2);
}

.f-auto b {
  color: var(--c-text);
  font-variant-numeric: tabular-nums;
}

.tag {
  font-size: var(--fs-xs);
  color: var(--c-text-3);
  background: var(--c-surface);
  border: 1px solid var(--c-border);
  border-radius: var(--r-pill);
  padding: 1px 6px;
}

.f-check {
  flex-direction: row;
  align-items: center;
  gap: 14px;
  flex-wrap: wrap;
}

.f-check label {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: var(--fs-xs);
  color: var(--c-text-2);
}

.tip {
  margin: 0;
  font-size: var(--fs-xs);
  color: var(--c-text-3);
  line-height: 1.7;
}

.tip b {
  color: var(--c-text-2);
}

.batch {
  width: 100%;
  padding: 6px;
  font-size: var(--fs-sm);
  font-family: inherit;
  color: var(--c-text);
  background: var(--c-glass);
  border: 1px solid var(--c-border);
  border-radius: var(--r-md);
  resize: vertical;
}

.batch-ops {
  display: flex;
  gap: 8px;
}

/* ===== 右：画布 ===== */
.fl-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.cv-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  padding: 8px 14px;
  border-bottom: 1px solid var(--c-border-hairline);
  flex-shrink: 0;
}

.grow {
  flex: 1;
  min-width: 0;
}

.zoom {
  width: 100px;
}

.zoom-lbl,
.zoom-val {
  font-size: var(--fs-xs);
  color: var(--c-text-3);
}

.zoom-val {
  min-width: 34px;
  font-variant-numeric: tabular-nums;
}

.cv-view {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 16px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
}

.cv-pagebox {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.cv-pagebar {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: var(--fs-xs);
  color: var(--c-text-2);
}

.muted {
  color: var(--c-text-3);
}

.cv-stage {
  position: relative;
  overflow: hidden;
  box-shadow: var(--shadow-md);
}

.cv-scaler {
  position: absolute;
  left: 0;
  top: 0;
}

.btn.mini {
  height: 22px;
  padding: 0 8px;
  font-size: var(--fs-xs);
}

.btn-sm.danger,
.btn.mini.danger {
  color: var(--c-danger);
}

.btn-sm.danger:hover,
.btn.mini.danger:hover {
  border-color: var(--c-danger);
}
</style>
