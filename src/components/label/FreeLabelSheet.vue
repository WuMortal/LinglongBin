<template>
  <div ref="rootEl" class="fl-paper" :style="paperStyle">
    <div class="fl-sheet" :class="[`ph-${layout.ph_mode}`, { guides: layout.guides }]" :style="sheetStyle">
      <div v-for="i in cellCount" :key="i" class="fl-label" :data-no="showNo ? String(noBase + i) : null">
        <textarea v-if="editable" class="fl-txt" :data-i="i - 1" rows="1" spellcheck="false"
          @input="onInput(i - 1, $event)" @focus="emit('focus-cell', i - 1)" />
        <div v-else class="fl-txt">{{ cells[i - 1] }}</div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import type { FreeLabelLayout } from '../../lib/types'
import { paperSize, usedSize } from '../../lib/freeLabel'

/**
 * 一张物理纸的标签网格。屏幕预览（editable：格子可直接打字）与打印输出（editable=false：纯文本）
 * 共用同一套 mm 布局，保证所见即所得。
 * - layout：纸张 / 标签尺寸 / 排版参数；
 * - cells：本页每个格子的文本，长度不足时后面的格子留空。
 *
 * 可编辑态刻意不给 textarea 绑 value：绑了以后每次按键都会触发本组件重渲染、把 value 写回 DOM，
 * 光标会被顶到末尾，中途插字就没法用。改为「外部数据整体替换时才回写 DOM」，
 * 逐格打字走 @input 上抛，父级原地改数组，不反过来重渲染这里。
 */
const props = withDefaults(
  defineProps<{
    layout: FreeLabelLayout
    cells: string[]
    /** 屏幕预览为 true（渲染 textarea 可直接编辑）；打印用 false（渲染纯文本 div） */
    editable?: boolean
    /** 序号起始值（= 本页之前已累计的格子数），用于空格子上的占位提示 */
    noBase?: number
  }>(),
  { editable: false, noBase: 0 },
)

const emit = defineEmits<{
  'cell-input': [idx: number, value: string]
  /** 格子获得焦点：父级据此知道「当前页」，用于复制 / 删除本页 */
  'focus-cell': [idx: number]
}>()

const rootEl = ref<HTMLElement | null>(null)

const size = computed(() => paperSize(props.layout))
/** 只依赖长度：这样逐格改内容不会让本组件重渲染（保护输入框光标） */
const cellCount = computed(() => props.cells.length)

const paperStyle = computed(() => ({
  width: `${size.value[0]}mm`,
  height: `${size.value[1]}mm`,
}))

/**
 * 标签尺寸 / 间距 / 行列全部走 CSS 自定义属性（与 demo 同机制）。
 * 改 label_w / label_h 时只更新变量，浏览器立即重排网格 —— 右侧预览实时缩放，
 * 不触发任何 JS 重建，这正是原 HTML 里「改数值右侧实时变化」的来源。
 */
const sheetStyle = computed(() => {
  const L = props.layout
  const [pw, ph] = size.value
  const used = usedSize(L)
  return {
    '--pad': `${L.pad}mm`,
    '--label-w': `${L.label_w}mm`,
    '--label-h': `${L.label_h}mm`,
    '--gap-w': `${L.gap_w}mm`,
    '--gap-h': `${L.gap_h}mm`,
    '--cols': String(Math.max(1, Math.round(L.cols))),
    '--rows': String(Math.max(1, Math.round(L.rows))),
    left: `${(pw - used.w) / 2 + L.off_x}mm`,
    top: `${(ph - used.h) / 2 + L.off_y}mm`,
    fontSize: `${L.font_pt}pt`,
    transform: `scale(${L.scale_fix || 1})`,
    transformOrigin: 'center',
  }
})

/** 只在屏幕预览显示序号（打印输出不带任何辅助信息） */
const showNo = computed(() => props.editable && props.layout.ph_mode !== 'none')

/** textarea 跟着内容长高：多行才能在格子里垂直居中，且不出现滚动条 */
function grow(el: HTMLTextAreaElement) {
  el.style.height = 'auto'
  el.style.height = `${el.scrollHeight}px`
}

function onInput(i: number, e: Event) {
  const el = e.target as HTMLTextAreaElement
  grow(el)
  el.parentElement?.classList.toggle('is-empty', !el.value)
  emit('cell-input', i, el.value)
}

/**
 * 批量重算高度。
 * 「写 style → 读 scrollHeight」会强制同步重排，逐格这么干 = 每格一次整页布局，
 * 几百个格子时页面直接卡死。这里拆成「先全部写、再全部读、再全部写」，整批只触发布局一次。
 */
function growBatch(els: HTMLTextAreaElement[]) {
  if (!els.length) return
  els.forEach(el => { el.style.height = 'auto' })
  const heights = els.map(el => el.scrollHeight)
  els.forEach((el, i) => { el.style.height = `${heights[i]}px` })
}

/**
 * 把外部数据写回输入框（文本 + 空格标记 + 高度）。
 * 只在整份 cells 被替换（导入 / 批量填充 / 增页删页 / 重排 / 恢复默认）或格子数变化时调用，
 * 逐格编辑时不会走到这里，因此不会干扰正在输入的那一个格子。
 */
function syncText() {
  const root = rootEl.value
  if (!root || !props.editable) return
  const els = Array.from(root.querySelectorAll<HTMLTextAreaElement>('textarea.fl-txt'))
  els.forEach(el => {
    const v = props.cells[Number(el.dataset.i)] ?? ''
    if (el.value !== v) el.value = v
    el.parentElement?.classList.toggle('is-empty', !v)
  })
  growBatch(els)
}

watch(() => props.cells, () => syncText(), { flush: 'post' })
watch(cellCount, () => syncText(), { flush: 'post' })
// 格子宽高 / 字号变了，换行结果随之变化，行高要跟着重测（走的是批量写-读-写，仍只触发一次布局）
watch(
  () => [props.layout.label_w, props.layout.label_h, props.layout.font_pt],
  () => syncText(),
  { flush: 'post' },
)
// 初次挂载的格子是空 DOM，按数据补一次
onMounted(syncText)
</script>

<!-- 非 scoped：纸面样式与打印规则要作用到 Teleport 到 body 的打印区 -->
<style>
.fl-paper {
  position: relative;
  background: #fff;
  overflow: hidden;
}

.fl-sheet {
  position: absolute;
  display: grid;
  box-sizing: border-box;
  /* 全部由 :layout 上的 CSS 变量驱动（与 demo 同机制），改尺寸即时重排 */
  padding: var(--pad);
  grid-template-columns: repeat(var(--cols), var(--label-w));
  grid-template-rows: repeat(var(--rows), var(--label-h));
  gap: var(--gap-h) var(--gap-w);
}

.fl-label {
  width: var(--label-w);
  height: var(--label-h);
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  overflow: hidden;
  break-inside: avoid;
}

.fl-txt {
  width: 100%;
  max-height: 100%;
  margin: 0;
  padding: 0;
  border: 0;
  outline: none;
  background: transparent;
  color: #1f2328;
  font-family: inherit;
  font-size: inherit;
  line-height: 1.15;
  text-align: center;
  white-space: pre-wrap;
  word-break: break-word;
  overflow: hidden;
}

textarea.fl-txt {
  resize: none;
  overflow: hidden;
}

textarea.fl-txt:focus {
  background: #f2f7ff;
}

/* 辅助线（裁切用）：只画每个标签的虚线 */
.fl-sheet.guides .fl-label {
  outline: 0.5px dashed #ccc;
}

/* 空格子的序号：默认透明看不见，悬停或「始终显示」时才显形 */
.fl-label[data-no]::after {
  content: attr(data-no);
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: transparent;
  pointer-events: none;
  transition: color 0.12s;
}

.fl-sheet.ph-hover .fl-label.is-empty:hover::after {
  color: #b9bec6;
}

.fl-sheet.ph-always .fl-label.is-empty::after {
  color: #c2c7cf;
}

/* 打印区：屏幕隐藏，打印时输出 */
.pv-print {
  display: none;
}

@media print {
  body {
    margin: 0;
    background: #fff;
  }

  /* 只打印 .pv-print 内的整页标签，应用本体全部隐藏（打印区已 Teleport 到 body 下） */
  body > *:not(.pv-print) {
    display: none !important;
  }

  .pv-print {
    display: block;
  }

  /* 一张纸一页；最后一页不再分页，避免末尾多出空白页 */
  .pv-print .fl-paper {
    break-after: page;
  }

  .pv-print .fl-paper:last-child {
    break-after: auto;
  }
}

@page {
  margin: 0;
}
</style>
