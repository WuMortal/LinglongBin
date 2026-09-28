<template>
  <section class="page">
    <header class="head">
      <div class="head-left">
        <PageBackButton to="/tools" label="" />
        <div>
          <h1>标签模板</h1>
          <p>配置标签尺寸、字段布局与打印排版，物料打印时使用</p>
        </div>
      </div>
    </header>

    <div class="lt card">
      <!-- ===== 模板列表 ===== -->
      <aside class="lt-list">
        <div class="lt-list-head">
          <span class="lt-title">模板</span>
          <button class="btn btn-ghost mini" title="新建模板" @click="createTpl">
            <Plus :size="13" style="display: inline-flex; flex-shrink: 0" />新建
          </button>
        </div>

        <div v-if="loading" class="lt-hint">加载中…</div>
        <div v-else-if="!templates.length" class="lt-hint">还没有模板，点「新建」建一个</div>
        <ul v-else class="tpl-ul">
          <li v-for="t in templates" :key="t.id" class="tpl-item" :class="{ on: curId === t.id }" @click="selectTpl(t)">
            <div class="tpl-line">
              <b class="tpl-name">{{ t.name }}</b>
              <span v-if="t.builtin" class="pill mini-pill">内置</span>
              <span v-if="t.is_default" class="pill ok mini-pill">默认</span>
            </div>
            <small class="tpl-meta">{{ t.width_mm }}×{{ t.height_mm }}mm · 栅格 {{ t.grid_rows }}×{{ t.grid_cols }} · {{
              (t.cats || []).length }} 个分类</small>
            <small v-if="catName(t)" class="tpl-meta">适用：{{ catName(t) }}</small>
            <div class="tpl-ops">
              <button class="btn btn-ghost mini" @click.stop="copyTpl(t)">复制</button>
              <button class="btn btn-ghost mini" :disabled="t.is_default" @click.stop="setDefault(t)">设为默认</button>
              <button v-if="!t.builtin" class="btn btn-ghost mini danger" @click.stop="removeTpl(t)">删除</button>
            </div>
          </li>
        </ul>
      </aside>

      <!-- ===== 编辑器 ===== -->
      <section v-if="draft" class="lt-main">
        <div class="lt-bar">
          <strong class="lt-bar-title">{{ isNew ? '新建模板' : draft.name }}</strong>
          <span v-if="dirty" class="pill warn">未保存</span>
          <div class="lt-bar-ops">
            <button class="btn btn-ghost" @click="doPrint">
              <Printer :size="13" style="display: inline-flex; flex-shrink: 0" />预览
            </button>
            <button class="btn btn-ghost" :disabled="saving" @click="revert">
              <RotateCcw :size="13" style="display: inline-flex; flex-shrink: 0" />还原
            </button>
            <button class="btn btn-primary" :disabled="saving || !canSave" @click="save">
              <Save :size="13" style="display: inline-flex; flex-shrink: 0" />{{ saving ? '保存中…' : '保存' }}
            </button>
          </div>
        </div>

        <div class="lt-body">
          <!-- 基本信息 -->
          <div class="sec">
            <span class="sec-title">基本信息</span>
            <div class="basic-row">
              <div class="f-row">
                <label class="f fname">
                  <span>名称<span class="req">*</span></span>
                  <input v-model="draft.name" placeholder="如：电阻小卡 24×12" />
                </label>
                <label class="f slim">
                  <span>标签宽 (mm)</span>
                  <input v-model.number="draft.width_mm" type="number" min="1" step="0.5" />
                </label>
                <label class="f slim">
                  <span>标签高 (mm)</span>
                  <input v-model.number="draft.height_mm" type="number" min="1" step="0.5" />
                </label>
                <label class="f">
                  <span>栅格 行 × 列</span>
                  <span class="f-pair">
                    <input v-model.number="draft.grid_rows" type="number" min="1" step="1" />
                    <i>×</i>
                    <input v-model.number="draft.grid_cols" type="number" min="1" step="1" />
                  </span>
                </label>
                <label class="f slim">
                  <span>默认字号 (pt)</span>
                  <input v-model.number="draft.default_font_pt" type="number" min="4" max="24" step="0.5" />
                </label>
              </div>
              <div class="basic-preview">
                <LabelPreview :blocks="previewBlocks" :rows="draft.grid_rows" :cols="draft.grid_cols" :width-mm="draft.width_mm"
                  :height-mm="draft.height_mm" />
              </div>
            </div>
            <p class="tip">此处为打印纸上的标签尺寸配置，栅格指当前标签中的布局</p>
          </div>

          <!-- 分类配置：每个分类一份字段布局（尺寸共用模板） -->
          <div class="sec">
            <div class="cats-head">
              <span class="sec-title">分类配置</span>
              <button class="btn btn-ghost mini" @click="openAddCat">+ 新增分类</button>
            </div>
            <p class="tip">标签尺寸与栅格是共用的；每个分类可分别配置「显示字段」与「打印排序」。
              不选择分类的配置会作为<b>默认格式</b>，用于未匹配到任何分类的物料。</p>
            <EmptyState v-if="!draft.cats.length" :icon="Tags" description="还没有分类配置，点「+ 新增分类」开始" />
            <div v-for="(c, i) in draft.cats" :key="c.category_id || '__default__'" class="cat-row">
              <span class="cat-name">
                {{ c.category_id ? catLabel(c.category_id) : '默认格式' }}
                <span v-if="!c.category_id" class="tag">未匹配分类时使用</span>
              </span>
              <span class="muted">{{ c.blocks.length }} 块</span>
              <span class="cat-ops">
                <button class="btn btn-ghost mini" @click="openEditCat(i)">配置</button>
                <button class="btn btn-ghost mini danger" @click="removeCat(i)">删除</button>
              </span>
            </div>
          </div>

          <LabelCatConfigDialog :open="dlgOpen" :cat="dlgCat" :category-options="catOptions" :rows="draft.grid_rows"
            :cols="draft.grid_cols" :width-mm="draft.width_mm" :height-mm="draft.height_mm"
            :default-font-pt="draft.default_font_pt" @close="closeDlg" @save="onDlgSave" />



          <!-- 纸张 / 排版（沿用贴纸打印工具的参数） -->
          <details class="sec">
            <summary class="sec-title">纸张与排版（打印时生效）</summary>
            <div class="form-grid">
              <div class="f">
                <span>纸张</span>
                <AppSelect v-model="draft.layout.paper" :options="paperOptions" />
              </div>
              <label class="f">
                <span>纸宽 (mm)</span>
                <input v-model.number="draft.layout.paper_w" type="number" min="1"
                  :disabled="draft.layout.paper !== 'CUSTOM'" />
              </label>
              <label class="f">
                <span>纸高 (mm)</span>
                <input v-model.number="draft.layout.paper_h" type="number" min="1"
                  :disabled="draft.layout.paper !== 'CUSTOM'" />
              </label>
              <div class="f">
                <span>每页 列 × 行</span>
                <span class="f-auto"
                  :title="`按纸张 ${draft.layout.paper_w}×${draft.layout.paper_h}mm 减去留白，再按标签 ${draft.width_mm}×${draft.height_mm}mm 与间距算出的最大容纳数`">
                  <b>{{ draft.layout.cols }} × {{ draft.layout.rows }}</b>
                  <span class="tag">自动</span>
                </span>
              </div>
              <label class="f">
                <span>留白 / 列距 / 行距 (mm)</span>
                <span class="f-pair">
                  <input v-model.number="draft.layout.pad" type="number" min="0" step="0.5" />
                  <input v-model.number="draft.layout.gap_w" type="number" min="0" step="0.5" />
                  <input v-model.number="draft.layout.gap_h" type="number" min="0" step="0.5" />
                </span>
              </label>
              <label class="f">
                <span>偏移 X / Y (mm)</span>
                <span class="f-pair">
                  <input v-model.number="draft.layout.off_x" type="number" step="0.5" />
                  <input v-model.number="draft.layout.off_y" type="number" step="0.5" />
                </span>
              </label>
              <label class="f">
                <span>比例校正</span>
                <input v-model.number="draft.layout.scale_fix" type="number" step="0.001" />
              </label>
              <label class="f f-check">
                <label><input type="checkbox" v-model="draft.layout.guides" /> 打印辅助线</label>
              </label>
            </div>
            <p class="tip">标签直接排在整张纸上（不再有独立的「贴纸」层）：纸张尺寸减去留白，再按标签尺寸与间距
              自动算出每页最大可容纳的「列 × 行」，无需手填；偏移 X / Y 用于校准打印机偏差。
              比例校正 = 100 ÷ 实测基准条长度；打印时选「实际大小 / 100%」，关闭页眉页脚。</p>
          </details>
        </div>
      </section>

      <div v-else class="lt-main lt-empty">
        <Printer :size="34" />
        <p>左侧选一个模板，或点「新建」</p>
      </div>
    </div>

    <!-- 打印整页：屏幕隐藏，点击【打印】直接输出（复用 LabelSheet，与编辑器画布同布局） -->
    <Teleport to="body">
      <div v-if="draft" class="pv-print">
        <LabelSheet :template="draft" :items="previewItems" />
      </div>
    </Teleport>
  </section>
</template>

<script setup lang="ts">
import { computed, ref, watch, onMounted } from 'vue'
import { Plus, Printer, RotateCcw, Save, Tags } from 'lucide-vue-next'
import {
  listLabelTemplates, createLabelTemplate, updateLabelTemplate, deleteLabelTemplate,
  listCategories, getCategoryParams, buildCategoryTree,
} from '../../lib/db'
import type { Category, CategoryParam, LabelBlock, LabelCatConfig, LabelTemplate } from '../../lib/types'
import type { CategoryNode } from '../../lib/db'
import type { LabelSheetLayout } from '../../lib/types'
import { DEFAULT_LABEL_LAYOUT, DEFAULT_LABEL_BLOCKS, FIXED_FIELDS } from '../../lib/labelDefaults'
import PageBackButton from '../../components/PageBackButton.vue'
import AppSelect from '../../components/form/AppSelect.vue'
import LabelSheet from '../../components/label/LabelSheet.vue'
import LabelCatConfigDialog from '../../components/label/LabelCatConfigDialog.vue'
import LabelPreview from '../../components/label/LabelPreview.vue'
import EmptyState from '../../components/EmptyState.vue'
import { useToast } from '../../composables/toast'
import { confirm } from '../../composables/confirm'

const toast = useToast()



/** 画布缩放：px / mm */
const SCALE = 8

const templates = ref<LabelTemplate[]>([])
const categories = ref<Category[]>([])
const catParams = ref<CategoryParam[]>([])
const loading = ref(false)
const saving = ref(false)

const curId = ref<string | null>(null)
/** null = 未选中；对象 = 正在编辑的草稿 */
const draft = ref<LabelTemplate | null>(null)
const origin = ref<string>('')
const isNew = ref(false)

const dirty = computed(() => !!draft.value && JSON.stringify(draft.value) !== origin.value)
const canSave = computed(() => !!draft.value && !!draft.value.name.trim()
  && draft.value.width_mm > 0 && draft.value.height_mm > 0
  && draft.value.grid_rows >= 1 && draft.value.grid_cols >= 1)

/** 分类树（大类 → 小类），与首页同一套：buildCategoryTree 已按 sort_order / name 排序 */
const tree = computed<CategoryNode[]>(() => buildCategoryTree(categories.value))

/** 适用分类：多选小类（按大类分组）；空数组 = 通用（全部分类） */
const catOptions = computed(() =>
  tree.value.flatMap(n => n.children.map(c => ({
    value: c.cat.id as unknown,
    label: c.cat.name,
    group: n.cat.name,
  }))),
)

function catLabel(id: string) {
  return categories.value.find(c => c.id === id)?.name || id
}

/** 模板列表里显示已配置的分类（含默认格式） */
function catName(t: LabelTemplate) {
  const cats = t.cats ?? []
  const names = cats.map(c => c.category_id ? catLabel(c.category_id) : '').filter(Boolean)
  if (cats.some(c => !c.category_id)) names.unshift('默认')
  return names.join('、') || '未配置分类'
}

/* ===== 分类配置弹框：每个分类一份 blocks + 该分类内排序 ===== */
const dlgOpen = ref(false)
const dlgEditingIdx = ref<number | null>(null)
const dlgCat = ref<LabelCatConfig>({
  category_id: '', blocks: [], sort_mode: 'cat', sort_field: null, sort_dir: 'asc',
})

function openAddCat() {
  dlgEditingIdx.value = null
  dlgCat.value = {
    category_id: '', blocks: DEFAULT_LABEL_BLOCKS(), sort_mode: 'cat', sort_field: null, sort_dir: 'asc',
  }
  dlgOpen.value = true
}
function openEditCat(i: number) {
  const c = draft.value?.cats[i]
  if (!c) return
  dlgEditingIdx.value = i
  dlgCat.value = JSON.parse(JSON.stringify(c)) as LabelCatConfig
  dlgOpen.value = true
}
function closeDlg() { dlgOpen.value = false }
function onDlgSave(cat: LabelCatConfig) {
  const d = draft.value
  if (!d) return
  if (dlgEditingIdx.value === null) {
    // 未指定分类 = 默认格式（未匹配到分类的物料用它），只允许一份
    if (cat.category_id) {
      if (d.cats.some(c => c.category_id === cat.category_id)) { toast.warning('该分类已配置过'); return }
    } else if (d.cats.some(c => !c.category_id)) {
      toast.warning('已存在默认格式')
      return
    }
    d.cats.push(cat)
  } else {
    d.cats[dlgEditingIdx.value] = cat
  }
  dlgOpen.value = false
}
function removeCat(i: number) {
  if (draft.value) draft.value.cats.splice(i, 1)
}
const valignOptions = [
  { value: 'top', label: '上' },
  { value: 'middle', label: '中' },
  { value: 'bottom', label: '下' },
]
const sortModeOptions = [
  { value: 'cat', label: '分类序号' },
  { value: 'field', label: '指定扩展字段' },
]
const sortDirOptions = [
  { value: 'asc', label: '升序' },
  { value: 'desc', label: '降序' },
]
const paperOptions = [
  { value: 'A4', label: 'A4 210×297' },
  { value: 'A5', label: 'A5 148×210' },
  { value: 'LETTER', label: 'Letter 216×279' },
  { value: 'CUSTOM', label: '自定义' },
]
/* ===== 模板打印（点击【打印】直接输出，无弹框预览） ===== */

/**
 * 纸张尺寸（mm）：标准纸查表，CUSTOM 用 layout 里的 paper_w / paper_h。
 * 「贴纸（不干胶整张）」不再单独配置，直接等于整张纸 —— 标签就排在纸上。
 */
function paperSize(L: LabelSheetLayout): [number, number] {
  if (L.paper === 'CUSTOM') return [L.paper_w || 210, L.paper_h || 297]
  return PAPER_SIZES[L.paper] ?? [210, 297]
}

/** 贴纸 = 整张纸：sheet_w / sheet_h 由纸张尺寸推导；定位固定为「左上角 + 偏移」 */
function applySheet() {
  const L = draft.value?.layout
  if (!L) return
  const [w, h] = paperSize(L)
  L.sheet_w = w
  L.sheet_h = h
  L.pos_mode = 'custom'
}

/**
 * 每页能放多少 列×行：纸张尺寸减去留白，再按「标签尺寸 + 间距」取最大可容纳数。
 * 不再手工填写，避免手填的 列×行 超出纸张导致标签被裁。
 */
function computeGrid(L: LabelSheetLayout): { cols: number; rows: number } {
  const d = draft.value
  const [pw, ph] = paperSize(L)
  const innerW = Math.max(0, pw - 2 * L.pad)
  const innerH = Math.max(0, ph - 2 * L.pad)
  const denomW = (d?.width_mm ?? 0) + L.gap_w
  const denomH = (d?.height_mm ?? 0) + L.gap_h
  return {
    cols: denomW > 0 ? Math.max(1, Math.floor((innerW + L.gap_w) / denomW)) : 1,
    rows: denomH > 0 ? Math.max(1, Math.floor((innerH + L.gap_h) / denomH)) : 1,
  }
}

/**
 * 把推导出的贴纸尺寸与 列×行 写回 layout。
 * 数据模型不变（仍存 sheet_w / sheet_h / cols / rows），
 * 预览、整页打印、每页张数照旧读它们，无需改存储或迁移。
 */
function applyLayout() {
  const L = draft.value?.layout
  if (!L) return
  applySheet()
  const g = computeGrid(L)
  L.cols = g.cols
  L.rows = g.rows
}

// 纸张 / 留白 / 间距 / 标签尺寸变化时，贴纸尺寸与 列×行 一并重算
watch(
  () => draft.value && [
    draft.value.layout.paper, draft.value.layout.paper_w, draft.value.layout.paper_h,
    draft.value.layout.pad, draft.value.layout.gap_w, draft.value.layout.gap_h,
    draft.value.width_mm, draft.value.height_mm,
  ],
  () => applyLayout(),
  { immediate: true },
)



/** 标准纸张尺寸（mm）；CUSTOM 用 layout 里的 paper_w / paper_h */
const PAPER_SIZES: Record<string, [number, number]> = {
  A4: [210, 297], A5: [148, 210], LETTER: [216, 279],
}

/**
 * 选标准纸张时把标准尺寸写回 paper_w / paper_h：
 * 之前只在 CUSTOM 下才显示这两个字段、且选标准纸张不回写，
 * 于是数据里保留着上一次的值（切到「自定义」就看到错误数字），显示与存储也不一致。
 */
watch(() => draft.value?.layout.paper, (p) => {
  const L = draft.value?.layout
  if (!L || !p || p === 'CUSTOM') return
  const s = PAPER_SIZES[p]
  if (s) { L.paper_w = s[0]; L.paper_h = s[1] }
}, { immediate: true })

/** 预览用的示例数据：模板只描述布局，不绑定具体物料 */
const DEMO_VALUES: Record<string, string> = {
  name: '贴片电阻', model: '0805 10KΩ', brand: 'UNI ROYAL', package: '0805',
  part_no: 'C25804', location: 'A-01-02', category_minor: '贴片电阻', qty: '120', price: '0.012', id: 'DEMO-0001',
}

/**
 * 基本信息区的预览只体现「尺寸 + 栅格」，不跟随分类配置变化：
 * 固定传空块，LabelPreview 会按 行×列 画空格子（各分类的字段块在「分类配置」弹框里配置）。
 */
const previewBlocks: LabelBlock[] = []

/** 编辑器预览：用首个分类配置的 blocks + 示例数据铺满整页，供 LabelSheet 渲染 */
const previewItems = computed<Array<{ data: Record<string, string>; blocks: LabelBlock[] }>>(() => {
  const t = draft.value
  const blocks = t?.cats?.[0]?.blocks ?? []
  const demo: Record<string, string> = { ...DEMO_VALUES }
  for (const b of blocks) if (b.type === 'field' && b.field?.startsWith('param:')) demo[b.field] = '参数值'
  const n = t ? Math.max(1, Math.round(t.layout.cols)) * Math.max(1, Math.round(t.layout.rows)) : 0
  return Array.from({ length: n }, () => ({ data: demo, blocks }))
})



function doPrint() {
  const anyBlocks = (draft.value?.cats ?? []).some(c => c.blocks.length)
  if (!anyBlocks) { toast.warning('还没有分类配置的内容块，先新增分类并配置字段'); return }
  window.print()
}

async function load() {
  loading.value = true
  try {
    templates.value = await listLabelTemplates()
    if (!categories.value.length) categories.value = await listCategories()
  } catch (e: unknown) { toast.error('模板加载失败：' + ((e as Error).message || e)) }
  finally { loading.value = false }
}

function snapshot(t: LabelTemplate) { return JSON.stringify(t) }

function selectTpl(t: LabelTemplate) {
  curId.value = t.id
  isNew.value = false
  draft.value = JSON.parse(JSON.stringify(t)) as LabelTemplate
  origin.value = snapshot(draft.value)
}

function blankTpl(): LabelTemplate {
  return {
    id: '', owner: '', name: '新模板',
    width_mm: 24, height_mm: 12, grid_rows: 2, grid_cols: 2,
    cats: [], default_font_pt: 6,
    layout: DEFAULT_LABEL_LAYOUT(), is_default: !templates.value.length,
    created_at: '', deleted_at: null,
  }
}

function createTpl() {
  curId.value = null
  isNew.value = true
  draft.value = blankTpl()
  origin.value = snapshot(draft.value)
}

function revert() {
  if (isNew.value) {
    // 新建模式下「还原」= 清空为空白模板，而不是关掉整个配置面板
    draft.value = blankTpl()
    origin.value = snapshot(draft.value)
    return
  }
  const t = templates.value.find(x => x.id === curId.value)
  if (t) selectTpl(t)
}

async function save() {
  const d = draft.value
  if (!d || !canSave.value) return
  saving.value = true
  try {
    const payload: Partial<LabelTemplate> = {
      name: d.name.trim(),
      width_mm: d.width_mm, height_mm: d.height_mm,
      grid_rows: d.grid_rows, grid_cols: d.grid_cols,
      cats: d.cats,
      default_font_pt: d.default_font_pt,
      layout: { ...DEFAULT_LABEL_LAYOUT(), ...d.layout } as LabelSheetLayout,
      is_default: d.is_default,
    }
    if (isNew.value) {
      const t = await createLabelTemplate(payload)
      toast.success('已创建模板')
      curId.value = t.id
      isNew.value = false
      draft.value = JSON.parse(JSON.stringify(t)) as LabelTemplate
    } else {
      const t = await updateLabelTemplate(d.id, payload)
      draft.value = JSON.parse(JSON.stringify(t)) as LabelTemplate
      toast.success('已保存')
    }
    origin.value = snapshot(draft.value)
    await load()
  } catch (e: unknown) { toast.error('保存失败：' + ((e as Error).message || e)) }
  finally { saving.value = false }
}

async function copyTpl(t: LabelTemplate) {
  try {
    const copy = await createLabelTemplate({
      name: `${t.name} 副本`,
      width_mm: t.width_mm, height_mm: t.height_mm,
      grid_rows: t.grid_rows, grid_cols: t.grid_cols, cats: t.cats ?? [],
      default_font_pt: t.default_font_pt, layout: t.layout,
      is_default: false,
    })
    toast.success('已复制')
    await load()
    const fresh = templates.value.find(x => x.id === copy.id)
    if (fresh) selectTpl(fresh)
  } catch (e: unknown) { toast.error('复制失败：' + ((e as Error).message || e)) }
}

async function setDefault(t: LabelTemplate) {
  if (t.is_default) return
  try {
    await updateLabelTemplate(t.id, { is_default: true })
    toast.success('已设为默认模板')
    await load()
  } catch (e: unknown) { toast.error('设置失败：' + ((e as Error).message || e)) }
}

async function removeTpl(t: LabelTemplate) {
  const ok = await confirm({
    content: `删除模板「${t.name}」？`, confirmText: '删除', danger: true,
  })
  if (!ok) return
  try {
    await deleteLabelTemplate(t.id)
    if (curId.value === t.id) { draft.value = null; curId.value = null }
    toast.success('已删除')
    await load()
  } catch (e: unknown) { toast.error('删除失败：' + ((e as Error).message || e)) }
}



onMounted(async () => {
  await load()
  // 打开时优先选中默认模板
  const def = templates.value.find(t => t.is_default) || templates.value[0]
  if (def) selectTpl(def)
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

.lt {
  flex: 1;
  min-height: 0;
  display: flex;
  overflow: hidden;
}

/* ===== 左：模板列表 ===== */
.lt-list {
  width: 200px;
  flex-shrink: 0;
  border-right: 1px solid var(--c-border-hairline);
  display: flex;
  flex-direction: column;
  overflow: auto;
}

.lt-list-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 14px;
  border-bottom: 1px solid var(--c-border-hairline);
  position: sticky;
  top: 0;
  background: var(--c-glass-strong);
  backdrop-filter: blur(12px);
  z-index: 1;
}

.lt-title {
  font-size: var(--fs-sm);
  font-weight: 600;
}

.lt-hint {
  padding: 24px 14px;
  text-align: center;
  font-size: var(--fs-xs);
  color: var(--c-text-3);
}

.tpl-ul {
  list-style: none;
  margin: 0;
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.tpl-item {
  padding: 8px 10px;
  border: 1px solid var(--c-border);
  border-radius: var(--r-md);
  cursor: pointer;
  transition: all var(--motion);
}

.tpl-item:hover {
  background: var(--c-surface-hover);
}

.tpl-item.on {
  background: var(--c-primary-soft);
  border-color: rgba(79, 140, 255, 0.35);
}

.tpl-line {
  display: flex;
  align-items: center;
  gap: 6px;
}

.tpl-name {
  font-size: var(--fs-sm);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tpl-meta {
  display: block;
  font-size: var(--fs-xs);
  color: var(--c-text-3);
}

.tpl-ops {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 8px;
}

/* ===== 右：编辑器 ===== */
.lt-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.lt-empty {
  align-items: center;
  justify-content: center;
  gap: 10px;
  color: var(--c-text-3);
  font-size: var(--fs-sm);
}

.lt-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 9px 16px;
  border-bottom: 1px solid var(--c-border-hairline);
  flex-shrink: 0;
}

.lt-bar-title {
  font-size: var(--fs-md);
}

.lt-bar-ops {
  margin-left: auto;
  display: flex;
  gap: 8px;
}

.lt-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.sec {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.sec-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.sec-title {
  font-size: var(--fs-sm);
  font-weight: 600;
  color: var(--c-text-2);
}

summary.sec-title {
  cursor: pointer;
  user-select: none;
}

/* 固定列宽上限：控件不用被拉得很长，窄屏也能自动减列 */
.form-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(120px, 0fr));
  gap: 10px 12px;
}

/* 关键字段跨两列：避免在 4~5 列布局里被压得太窄 */
.f.span-2 {
  grid-column: span 1;
}

/* 块属性：每行至少 4 个控件，窄屏逐级减列 */
.grid-4 {
  grid-template-columns: repeat(4, minmax(110px, 1fr));
}

.grid-4 .f-check {
  grid-column: 1 / -1;
}

@media (max-width: 640px) {
  .grid-4 {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 380px) {
  .grid-4 {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 540px) {
  .f.span-2 {
    grid-column: span 1;
  }
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
  height: var(--ctrl-h);
  padding: 0 8px;
  font-size: var(--fs-sm);
}

/* 基本信息：左侧字段紧凑一行 + 右侧标签实时预览 */
.basic-row {
  display: flex;
  align-items: flex-end;
  gap: 10px 20px;
  flex-wrap: wrap;
}

.f-row {
  display: flex;
  align-items: flex-end;
  gap: 10px 14px;
  flex: 1 1 auto;
  min-width: 0;
  flex-wrap: wrap;
}

.f-row .f {
  flex: 0 0 auto;
  min-width: 0;
}

.f-row .fname input {
  width: 150px;
  max-width: 100%;
}

.f-row .slim input {
  width: 66px;
  max-width: 100%;
}

.f-row .f-pair input {
  width: 56px;
}

.basic-preview {
  flex: 0 0 auto;
  margin-left: auto;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 3px;
}

.f-pair {
  display: flex;
  align-items: center;
  gap: 4px;
}

.f-pair input {
  width: 100%;
  min-width: 0;
  height: var(--ctrl-h);
  padding: 0 6px;
  font-size: var(--fs-sm);
}

.f-pair i {
  color: var(--c-text-3);
  font-style: normal;
}

/* 只读态（标准纸张的尺寸、自动铺满时的贴纸尺寸等） */
.f input:disabled {
  color: var(--c-text-3);
  background: var(--c-surface);
  cursor: not-allowed;
}

/* 只读的自动计算值（每页 列 × 行） */
.f-auto {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: var(--ctrl-h);
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

.req {
  margin-left: 3px;
  color: var(--c-danger);
}

.tip {
  margin: 0;
  font-size: var(--fs-xs);
  color: var(--c-text-3);
  line-height: 1.7;
}

.tip code {
  font-family: var(--font-mono);
  color: var(--c-text-2);
}

/* ===== 画布与属性左右分栏 ===== */
.layout-row {
  display: flex;
  align-items: flex-start;
  gap: 20px;
}

.layout-canvas {
  flex: 0 1 auto;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  min-width: 220px;
  max-width: 380px;
}

.layout-props {
  flex: 1;
  min-width: 0;
}

/* ===== 画布 ===== */
.canvas-wrap {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
}

.canvas {
  border: 1px dashed var(--c-border-strong);
  border-radius: 2px;
  background: #fff;
  overflow: hidden;
  max-width: 100%;
}

.grid {
  width: 100%;
  height: 100%;
  display: grid;
  gap: 0;
}

.blk {
  display: flex;
  padding: 1px 2px;
  font-size: 9px;
  line-height: 1.1;
  color: #1f2328;
  outline: 1px dotted #b9bec6;
  outline-offset: -1px;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  cursor: pointer;
}

.blk.sel {
  outline: 2px solid var(--c-primary);
  background: rgba(79, 140, 255, 0.12);
}

.canvas-meta {
  font-size: var(--fs-xs);
  color: var(--c-text-3);
}

/* ===== 块属性 ===== */
.blk-prop {
  padding: 12px;
  border: 1px solid var(--c-border);
  border-radius: var(--r-md);
  background: var(--c-glass);
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.geom {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.geom-title {
  font-size: var(--fs-xs);
  color: var(--c-text-2);
}

.geom input {
  width: 46px;
  height: var(--ctrl-h-sm);
  padding: 0 6px;
  font-size: var(--fs-xs);
}

.pill {
  display: inline-flex;
  align-items: center;
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

.btn.mini {
  height: 26px;
  padding: 0 8px;
  font-size: var(--fs-xs);
  gap: 4px;
}

.btn.mini.danger {
  color: var(--c-danger);
}

.btn.mini.danger:hover {
  border-color: var(--c-danger);
}

/* ===== 分类配置列表 ===== */
.cats-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 6px;
}

.cat-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 8px;
  border: 1px solid #eee;
  border-radius: 6px;
  margin-bottom: 6px;
  font-size: 13px;
}

.cat-name {
  font-weight: 600;
  min-width: 120px;
}

.cat-ops {
  margin-left: auto;
  display: flex;
  gap: 6px;
}

/* ===== 模板打印（屏幕隐藏，仅打印时输出） ===== */
.pv-print {
  display: none;
}

/* 纸张 / 贴纸 / 标签：全部用 mm，屏幕预览与打印同尺寸 */
.pv-paper {
  position: relative;
  background: #fff;
  overflow: hidden;
}

.pv-sheet {
  position: absolute;
  display: grid;
  place-content: center;
  box-sizing: border-box;
}

.pv-label {
  display: grid;
  overflow: hidden;
  box-sizing: border-box;
  break-inside: avoid;
}

.pv-blk {
  display: flex;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  color: #000;
  padding: 0 0.4mm;
}

/* 打印辅助线（裁切用）：只画单个标签的虚线，不画贴纸整张外框 */
.pv-sheet.guides .pv-label {
  outline: 0.5px dashed #ccc;
}

@media print {
  :global(body) {
    margin: 0;
    background: #fff;
  }

  /* 只打印整页标签，应用本体全部隐藏（打印区已 Teleport 到 body 下） */
  :global(body > *:not(.pv-print)) {
    display: none !important;
  }

  .pv-print {
    display: block;
  }

  .pv-paper {
    box-shadow: none;
  }
}

@page {
  margin: 0;
}
</style>
