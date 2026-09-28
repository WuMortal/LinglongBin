<template>
  <div class="pv-paper" :style="paperStyle">
    <div class="pv-sheet" :class="{ guides: template.layout.guides }" :style="sheetStyle">
      <div v-for="i in labelCount" :key="i" class="pv-label" :style="labelStyle">
        <template v-for="b in itemOf(i - 1).blocks" :key="b.id">
          <div v-if="labelVisible(b, itemOf(i - 1).data)" class="pv-blk" :style="pvBlkStyle(b, itemOf(i - 1).data)">{{ labelValue(b, itemOf(i - 1).data) }}</div>
        </template>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { LabelBlock, LabelTemplate } from '../../lib/types'
import { FIXED_FIELDS } from '../../lib/labelDefaults'

/**
 * 一张物理纸（标签整页）的渲染。编辑器的「打印」与打印页的预览/打印共用，保证所见即所得。
 * - template：标签模板（尺寸 / 栅格 / 块 / 排版）。
 * - items：每个标签的数据映射（字段 key → 文本）；长度不足时剩余标签留空（自动铺满留白）。
 *   字段 key 支持 param:<key> 形式（分类参数），由调用方在 items 里解析好值。
 */
const props = defineProps<{
  template: LabelTemplate
  /** 每个标签：数据映射 + 该标签用哪套 blocks（多分类模板下各分类 blocks 不同） */
  items: Array<{ data: Record<string, string>; blocks: LabelBlock[] }>
}>()

const d = computed(() => props.template)
const L = computed(() => props.template.layout)

const PAPER_SIZES: Record<string, [number, number]> = {
  A4: [210, 297], A5: [148, 210], LETTER: [216, 279],
}

const paperSize = computed(() => {
  const l = L.value
  if (l.paper === 'CUSTOM') return { w: l.paper_w || 210, h: l.paper_h || 297 }
  const s = PAPER_SIZES[l.paper]
  return s ? { w: s[0], h: s[1] } : { w: l.paper_w || 210, h: l.paper_h || 297 }
})

const labelCount = computed(() =>
  Math.max(1, Math.round(L.value.cols)) * Math.max(1, Math.round(L.value.rows)),
)

const paperStyle = computed(() => ({
  width: `${paperSize.value.w}mm`,
  height: `${paperSize.value.h}mm`,
  transform: `scale(${L.value.scale_fix || 1})`,
  transformOrigin: 'top left',
}))

const sheetStyle = computed(() => {
  const t = d.value
  const l = L.value
  const box = {
    width: `${l.sheet_w}mm`,
    height: `${l.sheet_h}mm`,
    padding: `${l.pad}mm`,
    gridTemplateColumns: `repeat(${Math.max(1, Math.round(l.cols))}, ${t.width_mm}mm)`,
    gridTemplateRows: `repeat(${Math.max(1, Math.round(l.rows))}, ${t.height_mm}mm)`,
    gap: `${l.gap_h}mm ${l.gap_w}mm`,
  }
  if (l.pos_mode === 'custom') return { ...box, left: `${l.off_x}mm`, top: `${l.off_y}mm` }
  return { ...box, left: '50%', top: '50%', transform: 'translate(-50%, -50%)' }
})

const labelStyle = computed(() => {
  const t = d.value
  return {
    width: `${t.width_mm}mm`,
    height: `${t.height_mm}mm`,
    gridTemplateColumns: `repeat(${Math.max(1, Math.round(t.grid_cols))}, 1fr)`,
    gridTemplateRows: `repeat(${Math.max(1, Math.round(t.grid_rows))}, 1fr)`,
  }
})

function itemOf(i: number): { data: Record<string, string>; blocks: LabelBlock[] } {
  return props.items[i] ?? { data: {}, blocks: [] }
}

/** 块在标签里的实际取值（固定文本 / 字段值；缺值回退到字段名） */
function labelValue(b: LabelBlock, data: Record<string, string>): string {
  if (b.type === 'text') return b.text || ''
  const key = b.field || ''
  const v = data[key]
  if (v == null || v === '') return (b.prefix || '') + (FIXED_FIELDS.find(f => f.value === key)?.label ?? '')
  return (b.prefix || '') + v
}

/** 取值为空且设为 hide 时，整块不画 */
function labelVisible(b: LabelBlock, data: Record<string, string>): boolean {
  if (b.empty_behavior === 'hide' && !labelValue(b, data).trim()) return false
  return true
}

/** 块的样式：位置 + 对齐 + 字号（含超长自动缩字号） */
function pvBlkStyle(b: LabelBlock, data: Record<string, string>) {
  const t = d.value
  const basePt = b.font_pt || t.default_font_pt
  let fs = basePt
  if (b.auto_shrink) {
    const txt = labelValue(b, data)
    const cellWmm = (t.width_mm / Math.max(1, t.grid_cols)) * Math.max(1, b.w)
    const cellHmm = (t.height_mm / Math.max(1, t.grid_rows)) * Math.max(1, b.h)
    const maxChars = Math.max(1, Math.floor(cellWmm / (basePt * 0.353 * 0.55)))
    const maxLines = Math.max(1, Math.floor(cellHmm / (basePt * 0.353 * 1.15)))
    const fit = maxChars * maxLines
    if (txt.length > fit) fs = Math.max(4, basePt * (fit / txt.length))
  }
  return {
    gridColumn: `${b.x + 1} / span ${Math.max(1, Math.min(b.w, t.grid_cols - b.x))}`,
    gridRow: `${b.y + 1} / span ${Math.max(1, Math.min(b.h, t.grid_rows - b.y))}`,
    justifyContent: b.align === 'right' ? 'flex-end' : b.align === 'center' ? 'center' : 'flex-start',
    alignItems: b.valign === 'bottom' ? 'flex-end' : b.valign === 'middle' ? 'center' : 'flex-start',
    fontWeight: b.bold ? 700 : 400,
    fontSize: `${fs.toFixed(2)}pt`,
    lineHeight: 1.15,
  }
}
</script>

<!-- 全局打印样式：屏幕预览与打印同尺寸；.pv-print 由父组件包裹，用于隐藏/打印切换 -->
<style>
.pv-print { display: none; }

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

/* 辅助线只画每个标签的裁切虚线；不画整张贴纸的外框 ——
   网格一旦超出贴纸配置尺寸，这个框会悬在标签中间，看起来像个莫名的居中框 */
.pv-sheet.guides .pv-label { outline: 0.5px dashed #ccc; }

/*
 * 注意：本 style 块没有 scoped，选择器本身已是全局的，不能套 :global()。
 * Vue 只对 <style scoped> 做 :global() 转换；非 scoped 块里 :global(...) 会原样输出，
 * 浏览器视为非法选择器而整条丢弃 —— 之前正是这样导致「隐藏应用本体」失效，打印出的是程序页面。
 */
@media print {
  body { margin: 0; background: #fff; }
  /* 只打印 .pv-print 内的整页标签，应用本体全部隐藏（打印区已 Teleport 到 body 下） */
  body > *:not(.pv-print) { display: none !important; }
  .pv-print { display: block; }
  .pv-paper { box-shadow: none; }
  /* 一张纸一页；最后一页不再分页，避免末尾多出空白页 */
  .pv-print .pv-paper { break-after: page; }
  .pv-print .pv-paper:last-child { break-after: auto; }
}

@page { margin: 0; }
</style>
