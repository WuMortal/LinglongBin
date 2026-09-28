<template>
  <div class="lbe">
    <div class="lbe-row">
      <div class="lbe-canvas">
        <div class="canvas-bar">
          <button class="btn btn-icon mini" title="添加块" @click="addBlock">
            <Plus :size="12" />
          </button>
          <button class="btn btn-icon mini danger" title="删除该块" :disabled="!sel" @click="removeBlock">
            <Trash2 :size="12" />
          </button>
        </div>
        <LabelPreview :blocks="blocks" :rows="rows" :cols="cols" :width-mm="widthMm" :height-mm="heightMm"
          :category-id="categoryId" :sel-id="selId" :show-meta="false" interactive @select="selId = $event" />
      </div>

      <div class="lbe-props">
        <div v-if="sel" class="blk-prop">
          <div class="form-grid">
            <div class="f">
              <span>类型</span>
              <AppSelect v-model="sel.type" :options="typeOptions" />
            </div>
            <div class="f" v-if="sel.type === 'field'">
              <span>取值字段</span>
              <AppSelect v-model="sel.field" :options="fieldOptions" searchable search-placeholder="搜索字段"
                placeholder="选择字段" />
            </div>

            <label class="f" v-else>
              <span>文本内容</span>
              <input v-model="sel.text" placeholder="固定显示文字" />
            </label>
            <div class="f">
              <span>水平对齐</span>
              <AppSelect v-model="sel.align" :options="alignOptions" />
            </div>
            <div class="f">
              <span>垂直对齐</span>
              <AppSelect v-model="sel.valign" :options="valignOptions" />
            </div>
            <div class="f">
              <span>值为空时</span>
              <AppSelect v-model="sel.empty_behavior" :options="emptyOptions" />
            </div>
            <label class="f" v-if="sel.type === 'field'">
              <span>前缀</span>
              <input v-model="sel.prefix" placeholder="如：型号 " />
            </label>
            <label class="f">
              <span>字号 (pt)</span>
              <input v-model.number="sel.font_pt" type="number" min="4" max="24" step="0.5"
                :placeholder="String(defaultFontPt)" />
            </label>
            <label class="f f-check">
              <label><input type="checkbox" v-model="sel.bold" /> 加粗</label>
              <label><input type="checkbox" v-model="sel.auto_shrink" /> 超长自动缩字号</label>
            </label>
          </div>

          <div class="geom">
            <span class="geom-title">位置 / 跨度（单元块）</span>
            <span class="f-pair">
              X<input v-model.number="sel.x" type="number" min="0" :max="cols - 1" step="1" />
              Y<input v-model.number="sel.y" type="number" min="0" :max="rows - 1" step="1" />
              跨<input v-model.number="sel.w" type="number" min="1" :max="cols" step="1" />
              高<input v-model.number="sel.h" type="number" min="1" :max="rows" step="1" />
            </span>
            <label class="geom-check"><input type="checkbox" :checked="fullRow" @change="onFullRowChange" />
              占满整行</label>
          </div>
        </div>
        <p v-else class="tip">点画布里的块来编辑它。</p>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { getCategoryParams } from '../../lib/db'
import type { CategoryParam, LabelBlock } from '../../lib/types'
import { FIXED_FIELDS } from '../../lib/labelDefaults'
import { Plus, Trash2 } from 'lucide-vue-next'
import AppSelect from '../form/AppSelect.vue'
import LabelPreview from './LabelPreview.vue'
import { useToast } from '../../composables/toast'

/**
 * 在固定标签尺寸里编辑字段块（画布 + 块属性）。
 * 供模板编辑器的「分类配置弹框」复用：每个分类一份 blocks，尺寸由模板统一给定。
 */
const props = defineProps<{
  blocks: LabelBlock[]
  rows: number
  cols: number
  widthMm: number
  heightMm: number
  defaultFontPt: number
  /** 所属分类：决定「分类参数」可选字段 */
  categoryId: string | null
}>()
const emit = defineEmits<{ 'update:blocks': [LabelBlock[]] }>()

const toast = useToast()
const selId = ref<string | null>(props.blocks[0]?.id ?? null)
const sel = computed(() => props.blocks.find(b => b.id === selId.value) ?? null)

watch(() => props.blocks, (arr) => {
  if (!arr.some(b => b.id === selId.value)) selId.value = arr[0]?.id ?? null
})

/** 分类参数字段（当前分类自己的，不存在并集/交集问题） */
const catParams = ref<CategoryParam[]>([])
watch(() => props.categoryId, async (id) => {
  catParams.value = []
  if (!id) return
  try { catParams.value = await getCategoryParams(id) } catch { /* 静默 */ }
}, { immediate: true })

const paramFields = computed(() =>
  catParams.value.map(p => ({ value: `param:${p.key}`, label: p.name || p.key })))
const fieldOptions = computed(() => [
  ...FIXED_FIELDS.map(f => ({ value: f.value as unknown, label: f.label, group: '主表字段' })),
  ...paramFields.value.map(f => ({ value: f.value as unknown, label: f.label, group: '分类参数' })),
])

const typeOptions = [
  { value: 'field', label: '物料字段' },
  { value: 'text', label: '固定文本' },
]
const alignOptions = [
  { value: 'left', label: '左' },
  { value: 'center', label: '中' },
  { value: 'right', label: '右' },
]
const valignOptions = [
  { value: 'top', label: '上' },
  { value: 'middle', label: '中' },
  { value: 'bottom', label: '下' },
]
const emptyOptions = [
  { value: 'keep', label: '保留空格子' },
  { value: 'hide', label: '不画该块' },
]

/** 被已存在块占用的单元格集合（"x,y"） */
function occupiedCells(): Set<string> {
  const set = new Set<string>()
  for (const b of props.blocks) {
    for (let yy = b.y; yy < b.y + b.h; yy++)
      for (let xx = b.x; xx < b.x + b.w; xx++) set.add(`${xx},${yy}`)
  }
  return set
}
/** 行优先找到能放下 w×h 块的第一个空位；排满返回 null */
function firstFreeCell(w = 1, h = 1): { x: number; y: number } | null {
  const occ = occupiedCells()
  for (let y = 0; y <= props.rows - h; y++) {
    for (let x = 0; x <= props.cols - w; x++) {
      let ok = true
      for (let yy = y; yy < y + h && ok; yy++)
        for (let xx = x; xx < x + w && ok; xx++)
          if (occ.has(`${xx},${yy}`)) ok = false
      if (ok) return { x, y }
    }
  }
  return null
}

let seq = 0
function addBlock() {
  const cell = firstFreeCell(1, 1)
  if (!cell) return
  const nb: LabelBlock = {
    id: `b${Date.now().toString(36)}${++seq}`, type: 'field', field: 'name',
    x: cell.x, y: cell.y, w: 1, h: 1, align: 'left', valign: 'middle', auto_shrink: true,
  }
  emit('update:blocks', [...props.blocks, nb])
  selId.value = nb.id
}
function removeBlock() {
  const next = props.blocks.filter(b => b.id !== selId.value)
  emit('update:blocks', next)
  selId.value = next[0]?.id ?? null
}
/**
 * 「占满整行」勾选框：勾选 = 块横跨整行（X=0、跨=列数、高=1）。
 * 状态由 X/跨 反推，所以手动把 X 改 0、跨改成列数时勾选框会自动勾上；取消勾选则还原到勾选前的跨度。
 */
const prevSpan = ref<{ x: number; w: number; h: number } | null>(null)
watch(selId, () => { prevSpan.value = null })

/** 勾选状态由 X/跨 反推：手动把 X 改 0、跨改成列数时也会自动勾上 */
const fullRow = computed(() => !!sel.value && sel.value.x === 0 && sel.value.w === props.cols)

/** 某一行里被「其它块」占用的格子数（排除当前选中块自身） */
function rowOccupiedByOthers(y: number): number {
  const occ = new Set<string>()
  for (const b of props.blocks) {
    if (b.id === selId.value) continue
    for (let yy = b.y; yy < b.y + b.h; yy++)
      for (let xx = b.x; xx < b.x + b.w; xx++) occ.add(`${xx},${yy}`)
  }
  let n = 0
  for (let x = 0; x < props.cols; x++) if (occ.has(`${x},${y}`)) n++
  return n
}

/**
 * 勾选「占满整行」：先把块撑满整行（X=0、跨=列数、高=1）。
 * 目标行若已被其它块占用则拒绝并提示（占满会重叠），最后用真实状态校正勾选框。
 */
function onFullRowChange(e: Event) {
  const el = e.target as HTMLInputElement
  const s = sel.value
  if (s && el.checked) {
    const used = rowOccupiedByOthers(s.y)
    if (used >= props.cols) {
      toast.warning(`第 ${s.y + 1} 行已被其它块占满，无法再占满整行`)
    } else if (used > 0) {
      toast.warning(`第 ${s.y + 1} 行还有其它块，占满会重叠`)
    } else {
      prevSpan.value = { x: s.x, w: s.w, h: s.h }
      s.x = 0; s.w = props.cols; s.h = 1
    }
  } else if (s) {
    const p = prevSpan.value
    if (p) { s.x = p.x; s.w = p.w; s.h = p.h } else { s.w = 1 }
    prevSpan.value = null
  }
  // 被拒绝时不改变数据，需手动把勾选框拉回真实状态
  el.checked = fullRow.value
}
</script>

<style scoped>
.lbe-row {
  display: flex;
  gap: 20px;
  align-items: flex-start;
  flex-wrap: wrap;
}

.lbe-canvas {
  flex: 0 0 auto;
}

/* 预览上方的工具栏：系统统一的方形小图标按钮 */
.canvas-bar {
  display: flex;
  gap: 6px;
  margin-bottom: 8px;
}

.canvas-bar .btn-icon.mini {
  width: 22px;
  height: 22px;
}

.lbe-props {
  flex: 1;
  min-width: 300px;
  min-width: 0;
}

/* 属性网格：自适应列数，窄了自动减列，不再把复选框挤成竖排 */
.form-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(100px, 1fr));
  gap: 10px 14px;
}

.f {
  display: flex;
  flex-direction: column;
  gap: 3px;
  font-size: 12px;
  min-width: 0;
}

.f>span {
  color: #666;
  font-size: 11px;
  white-space: nowrap;
}

.f input {
  width: 100%;
  box-sizing: border-box;
  height: 26px;
  padding: 4px 8px;
  border: 1px solid #ddd;
  border-radius: 4px;
  font-size: 12px;
}

.f-check {
  grid-column: 1 / -1;
  flex-direction: row;
  gap: 16px;
  align-items: center;
  flex-wrap: wrap;
}

.f-check label {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  white-space: nowrap;
}

.geom {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 12px;
  flex-wrap: wrap;
}

.geom-title {
  font-size: 12px;
  color: #666;
}

/* 「占满整行」勾选框：与属性区的复选框同一套观感 */
.geom-check {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 12px;
  color: #666;
  white-space: nowrap;
  cursor: pointer;
}

.f-pair {
  display: flex;
  align-items: center;
  gap: 4px;
}

.f-pair input {
  width: 52px;
  height: 24px;
  padding: 3px 5px;
  border: 1px solid #ddd;
  border-radius: 4px;
  font-size: 12px;
}

.tip {
  color: #888;
  font-size: 12px;
}
</style>
