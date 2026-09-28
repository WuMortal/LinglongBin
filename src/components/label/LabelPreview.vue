<template>
  <div class="lp">
    <div class="lp-wrap">
      <span v-if="showMeta" class="lp-meta">{{ widthMm }}×{{ heightMm }}mm 标签预览</span>
      <div class="lp-canvas" :style="canvasStyle">
        <div class="lp-grid" :style="gridStyle">
          <template v-if="visibleBlocks.length">
            <div v-for="b in visibleBlocks" :key="b.id" class="lp-blk" :class="{ sel: b.id === selId }"
              :style="blkStyle(b)" @click="interactive && $emit('select', b.id)">
              {{ previewText(b) }}
            </div>
          </template>
          <template v-else>
            <div v-for="i in cellCount" :key="i" class="lp-cell"></div>
          </template>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { getCategoryParams } from '../../lib/db'
import type { CategoryParam, LabelBlock } from '../../lib/types'
import { FIXED_FIELDS } from '../../lib/labelDefaults'

/**
 * 单个标签的画布预览（与「分类配置弹框」内画布同源）。
 * - blocks：该标签内的字段块布局。
 * - rows/cols/widthMm/heightMm：标签栅格与尺寸。
 * - categoryId：用于解析「分类参数」字段的中文名（可选）。
 * - interactive：为 true 时块可点击并高亮（弹框编辑用）；基本信息预览用 false。
 */
const props = withDefaults(defineProps<{
  blocks: LabelBlock[]
  rows: number
  cols: number
  widthMm: number
  heightMm: number
  categoryId?: string | null
  selId?: string | null
  interactive?: boolean
  /** 预览画布较长边的最大像素，控制缩放 */
  maxPx?: number
  /** 是否显示底部「宽×高 mm」尺寸标注（弹框内画布上方已有该信息，通常关闭） */
  showMeta?: boolean
}>(), { categoryId: null, selId: null, interactive: false, maxPx: 150, showMeta: true })

defineEmits<{ (e: 'select', id: string): void }>()

const catParams = ref<CategoryParam[]>([])
watch(() => props.categoryId, async (id) => {
  catParams.value = []
  if (!id) return
  try { catParams.value = await getCategoryParams(id) } catch { /* 静默 */ }
}, { immediate: true })

const paramFields = computed(() =>
  catParams.value.map(p => ({ value: `param:${p.key}`, label: p.name || p.key })))

const SCALE = 8
const canvasStyle = computed(() => {
  const wmm = props.widthMm
  const hmm = props.heightMm
  let w = wmm * SCALE
  const k = Math.min(1, props.maxPx / w, props.maxPx / (hmm * SCALE))
  w *= k
  // 只用像素值，不掺百分比：百分比会按内容固有宽度解析，导致块里文字变短（如清空前缀）时画布跟着塌缩。
  // 上限由上面的 k 兜住，宽度永远 ≤ maxPx，不会撑乱页面布局。
  return { width: `${w}px`, aspectRatio: `${wmm} / ${hmm}` }
})
const gridStyle = computed(() => ({
  // minmax(0, 1fr) 去掉轨道的自动最小尺寸（=文字 min-content），否则长文字会把格子撑宽溢出画布
  gridTemplateColumns: `repeat(${props.cols}, minmax(0, 1fr))`,
  gridTemplateRows: `repeat(${props.rows}, minmax(0, 1fr))`,
}))

/**
 * 只画起点落在栅格内的块。
 * 越界的块（如默认 2×2 块在 1 行栅格里）若照样渲染，CSS Grid 会撑出隐式行/列，
 * 导致预览的 行×列 与配置不一致。
 */
const visibleBlocks = computed(() =>
  props.blocks.filter(b => b.x >= 0 && b.y >= 0 && b.x < props.cols && b.y < props.rows))

/** 无块可画时的空格子数（行 × 列），用于按栅格展示空方格 */
const cellCount = computed(() => Math.max(1, props.rows) * Math.max(1, props.cols))

function blkStyle(b: LabelBlock) {
  return {
    gridColumn: `${b.x + 1} / span ${Math.max(1, Math.min(b.w, props.cols - b.x))}`,
    gridRow: `${b.y + 1} / span ${Math.max(1, Math.min(b.h, props.rows - b.y))}`,
    justifyContent: b.align === 'right' ? 'flex-end' : b.align === 'center' ? 'center' : 'flex-start',
    alignItems: b.valign === 'bottom' ? 'flex-end' : b.valign === 'middle' ? 'center' : 'flex-start',
    fontWeight: b.bold ? 700 : 400,
  }
}

/** 画布里显示什么：字段块显示字段名，文本块显示文本 */
function previewText(b: LabelBlock): string {
  if (b.type === 'text') return b.text || '（文本）'
  const f = FIXED_FIELDS.find(x => x.value === b.field)
  if (f) return (b.prefix || '') + f.label
  const pf = paramFields.value.find(x => x.value === b.field)
  return (b.prefix || '') + (pf?.label ?? b.field ?? '（未选字段）')
}
</script>

<style scoped>
.lp {
  display: inline-flex;
}

.lp-wrap {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.lp-canvas {
  background: #fff;
  border: 1px solid #ccc;
  border-radius: 4px;
  overflow: hidden;
}

.lp-grid {
  display: grid;
  width: 100%;
  height: 100%;
}

.lp-blk {
  display: flex;
  align-items: center;
  border: 1px dashed #bbb;
  overflow: hidden;
  /* grid 项默认 min-width:auto 会解析成文字 min-content，需显式归零才能真正跟随轨道收缩 */
  min-width: 0;
  font-size: 9px;
  white-space: nowrap;
  text-overflow: ellipsis;
  padding: 0 2px;
}

.lp-blk.sel {
  border-color: #2d6cdf;
  background: #eaf1fd;
  cursor: pointer;
}

.lp-cell {
  border: 1px dashed #ddd;
}

.lp-meta {
  font-size: 12px;
  color: #888;
}
</style>
