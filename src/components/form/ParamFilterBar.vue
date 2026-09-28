<script setup lang="ts">
// 紧凑参数筛选条（弹窗等纵向空间紧张的场景）。
//   · 尺寸比常规表单更小：控件高度压到 24px、参数名 10px
//   · 默认只展示 rows 行，其余收起，右侧按钮「展开 / 收起」
//   · 被收起的参数里若有已选值，按钮高亮显示「已选 N」，避免筛选生效却看不见
import { ref, computed, onMounted, onBeforeUnmount, watch, nextTick } from 'vue'
import { ChevronDown, X } from 'lucide-vue-next'
import AppSelect from './AppSelect.vue'
import type { CategoryParam } from '../../lib/types'

const props = withDefaults(defineProps<{
  /** 参数模板（顺序即展示顺序） */
  params: CategoryParam[]
  /** 已选值：{ 参数 key: 值 }，未选的不写入 */
  modelValue: Record<string, string>
  /** 每个参数的可选值 */
  optionsOf: (p: CategoryParam) => string[]
  /** 折叠态保留的行数 */
  rows?: number
  /** 是否折叠：false = 平铺展示全部参数，不再出现「展开」按钮与二级浮层 */
  collapse?: boolean
}>(), { rows: 1, collapse: true })

const emit = defineEmits<{
  'update:modelValue': [v: Record<string, string>]
  clear: []
}>()

const expanded = ref(false)
const flowEl = ref<HTMLElement | null>(null)
/** 折叠态保留区高度（rows 行） */
const keepH = ref(0)
/** 超出保留行、被收起的参数 key（按实际换行位置测量，适配任意宽度） */
const hiddenKeys = ref<string[]>([])

const selectedCount = computed(() => props.params.filter(p => props.modelValue[p.key]).length)
const hiddenSelected = computed(() => hiddenKeys.value.filter(k => props.modelValue[k]).length)
/** 被收起（折叠后不可见）的参数，展开时单独浮层展示 */
const hiddenParams = computed(() => props.params.filter(p => hiddenKeys.value.includes(p.key)))
const collapsedStyle = computed(() =>
  keepH.value ? { maxHeight: keepH.value + 'px' } : undefined)

/** 下拉选项：首项「全部」表示不筛选 */
function optsOf(p: CategoryParam) {
  return [{ value: '', label: '全部' }, ...props.optionsOf(p).map(v => ({ value: v, label: v }))]
}

function setVal(key: string, v: unknown) {
  const next: Record<string, string> = {}
  for (const k of Object.keys(props.modelValue)) {
    if (k !== key && props.modelValue[k]) next[k] = props.modelValue[k]
  }
  const s = (v as string) || ''
  if (s) next[key] = s
  emit('update:modelValue', next)
}

/** 测量首行高度与被收起的参数（items 与 params 索引一一对应） */
function measure() {
  const el = flowEl.value
  if (!el) return
  // 平铺模式：不裁剪、不计算被收起的参数，因此不会出现二级「展开」浮层
  if (!props.collapse) { keepH.value = 0; hiddenKeys.value = []; return }
  const items = Array.from(el.children).filter(n => n instanceof HTMLElement) as HTMLElement[]
  if (!items.length) { keepH.value = 0; hiddenKeys.value = []; return }
  const gap = parseFloat(getComputedStyle(el).rowGap || '0') || 0
  const h = items[0].offsetHeight
  const step = h + gap
  keepH.value = h * props.rows + gap * (props.rows - 1)
  const top0 = items[0].offsetTop
  const keys: string[] = []
  for (let i = 0; i < items.length; i++) {
    const line = step > 0 ? Math.round((items[i].offsetTop - top0) / step) : 0
    const k = props.params[i]?.key
    if (line >= props.rows && k) keys.push(k)
  }
  hiddenKeys.value = keys
}

let ro: ResizeObserver | null = null
let lastW = 0
onMounted(() => {
  nextTick(measure)
  if (typeof ResizeObserver !== 'undefined' && flowEl.value) {
    ro = new ResizeObserver(entries => {
      // 只在宽度变化时重测，避免折叠高度变化引发抖动
      const w = entries[0]?.contentRect.width ?? 0
      if (Math.abs(w - lastW) < 1) return
      lastW = w
      measure()
    })
    ro.observe(flowEl.value)
  }
})
onBeforeUnmount(() => { ro?.disconnect(); ro = null })

watch(() => props.params, () => nextTick(measure))
</script>

<template>
  <div class="pf-bar" :class="{ expanded }">
    <div ref="flowEl" class="pf-flow" :class="{ collapsed: collapse }" :style="collapsedStyle">
      <div v-for="p in params" :key="p.key" class="pf-cell">
        <span class="pf-name" :title="p.name || p.key">{{ p.name || p.key }}</span>
        <AppSelect
          class="pf-select"
          :model-value="modelValue[p.key] || ''"
          :options="optsOf(p)"
          size="sm"
          searchable
          :search-placeholder="p.name || p.key"
          placeholder="全部"
          :min-width="0"
          @update:model-value="(v) => setVal(p.key, v)"
        />
      </div>
    </div>

    <!-- 展开时，被收起的参数以浮层覆盖候选列表（首行已选参数仍保留在筛选条内） -->
    <div v-if="expanded && hiddenParams.length" class="pf-pop">
      <div v-for="p in hiddenParams" :key="p.key" class="pf-cell">
        <span class="pf-name" :title="p.name || p.key">{{ p.name || p.key }}</span>
        <AppSelect
          class="pf-select"
          :model-value="modelValue[p.key] || ''"
          :options="optsOf(p)"
          size="sm"
          searchable
          :search-placeholder="p.name || p.key"
          placeholder="全部"
          :min-width="0"
          @update:model-value="(v) => setVal(p.key, v)"
        />
      </div>
    </div>

    <div class="pf-acts">
      <button v-if="selectedCount" class="pf-btn ghost" title="清空筛选" @click="emit('clear')">
        <X :size="11" style="display: inline-flex; flex-shrink: 0" />清空
      </button>
      <button
        v-if="hiddenKeys.length || expanded"
        class="pf-btn"
        :class="{ alert: !!hiddenSelected }"
        :title="expanded ? '收起多余参数' : `展开其余 ${hiddenKeys.length} 项参数`"
        @click="expanded = !expanded"
      >
        <template v-if="expanded">收起</template>
        <template v-else-if="hiddenSelected">已选 {{ hiddenSelected }}</template>
        <template v-else>展开 {{ hiddenKeys.length }}</template>
        <ChevronDown
          :size="11"
          class="chev"
          :class="{ flip: expanded }"
          style="display: inline-flex; flex-shrink: 0"
        />
      </button>
    </div>
  </div>
</template>

<style scoped>
.pf-bar {
  /* 覆盖 AppSelect 的小号控件高度，让整条筛选栏更紧凑 */
  --ctrl-h-sm: 24px;
  position: relative;
  display: flex;
  align-items: flex-start;
  gap: 8px;
}

.pf-flow {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-wrap: wrap;
  align-content: flex-start;
  gap: 6px 8px;
}

.pf-flow.collapsed {
  overflow: hidden;
}

/* 展开时被收起的参数浮在候选列表之上（首行已选参数仍保留在条内） */
.pf-pop {
  position: absolute;
  top: calc(100% + 6px);
  left: 0;
  right: 0;
  z-index: 50;
  display: flex;
  flex-wrap: wrap;
  align-content: flex-start;
  gap: 6px 8px;
  padding: 10px;
  background: var(--c-elevated);
  border: 1px solid var(--c-border);
  border-radius: var(--r-md);
  box-shadow: var(--shadow-md);
  max-height: 260px;
  overflow: auto;
}

.pf-cell {
  display: flex;
  flex-direction: column;
  gap: 2px;
  /* 与 AppSelect 的 sm 最小宽度一致，避免换行计算溢出 */
  min-width: 88px;
  flex: 1 1 88px;
  max-width: 152px;
}

.pf-name {
  font-size: 10px;
  line-height: 12px;
  color: var(--c-text-3);
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.pf-acts {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
  /* 与第一行下拉框对齐（参数名 12px + 间距 2px） */
  padding-top: 14px;
}

.pf-btn {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  height: 24px;
  padding: 0 8px;
  border: 1px solid var(--c-border);
  border-radius: var(--r-sm);
  background: var(--c-glass);
  color: var(--c-text-2);
  font-family: inherit;
  font-size: 10px;
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
  transition: background-color var(--motion-fast), color var(--motion-fast), border-color var(--motion-fast);
}

.pf-btn:hover {
  background: var(--c-surface-hover);
  color: var(--c-text);
}

.pf-btn.alert {
  border-color: rgba(79, 140, 255, 0.35);
  background: var(--c-primary-soft);
  color: var(--c-primary);
}

.chev {
  transition: transform var(--motion-fast);
}

.chev.flip {
  transform: rotate(180deg);
}
</style>
