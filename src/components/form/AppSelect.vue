<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, nextTick, watch } from 'vue'
import { ChevronDown, Check } from 'lucide-vue-next'

/** group 可选：同组选项会在浮层里合并显示一个小标题（如「主表字段 / 分类参数」） */
interface Opt { value: unknown; label: string; disabled?: boolean; group?: string }
const props = withDefaults(
  defineProps<{
    modelValue: unknown
    options: Opt[]
    placeholder?: string
    searchable?: boolean
    searchPlaceholder?: string
    minWidth?: number
    maxWidth?: number
    width?: number
    disabled?: boolean
    /** 尺寸：sm 小号（--ctrl-h-sm），md 常规（--ctrl-h），默认 md */
    size?: 'sm' | 'md'
    /** 多选：modelValue 为数组，选项可叠加勾选 */
    multiple?: boolean
  }>(),
  { placeholder: '请选择', searchPlaceholder: '搜索…', minWidth: undefined, maxWidth: undefined, width: undefined, disabled: false, size: 'md', multiple: false }
)
const emit = defineEmits<{ 'update:modelValue': [value: unknown] }>()

const open = ref(false)
const root = ref<HTMLElement | null>(null)
const triggerEl = ref<HTMLElement | null>(null)
const search = ref('')

// 浮层定位（fixed 坐标）
const popStyle = ref<Record<string, string>>({})

const selectedLabel = computed(() => {
  if (props.multiple) {
    const arr = Array.isArray(props.modelValue) ? (props.modelValue as unknown[]) : []
    if (!arr.length) return props.placeholder
    return `已选 ${arr.length} 项`
  }
  const f = props.options.find(o => o.value === props.modelValue)
  return f ? f.label : props.placeholder
})

const filtered = computed(() => {
  if (!props.searchable || !search.value.trim()) return props.options
  const k = search.value.trim().toLowerCase()
  return props.options.filter(o => o.label.toLowerCase().includes(k))
})

function updatePos() {
  if (!triggerEl.value) return
  const r = triggerEl.value.getBoundingClientRect()
  // 估算下拉高度（最大 280 + padding/搜索框约 320）
  const estH = Math.min(320, 40 + filtered.value.length * 36 + (props.searchable ? 32 : 0))
  // 视口底部剩余空间
  const bottomSpace = window.innerHeight - r.bottom
  const showBelow = bottomSpace >= Math.min(estH, 280) || bottomSpace >= window.innerHeight / 2
  const top = showBelow ? r.bottom + 6 : Math.max(8, r.top - estH - 6)
  // 宽度：优先 trigger 宽度，但不小于 160
  const w = Math.max(r.width, 160)
  // 水平：默认与 trigger 左对齐；若右侧溢出则向左贴齐
  let left = r.left
  if (left + w > window.innerWidth - 8) left = window.innerWidth - w - 8
  if (left < 8) left = 8
  popStyle.value = {
    position: 'fixed',
    top: top + 'px',
    left: left + 'px',
    width: w + 'px',
    maxHeight: '280px',
  }
}

async function toggle() {
  if (props.disabled) return
  open.value = !open.value
  if (open.value) {
    search.value = ''
    await nextTick()
    updatePos()
  }
}
function isSelected(o: Opt): boolean {
  if (props.multiple) return Array.isArray(props.modelValue) && props.modelValue.includes(o.value)
  return o.value === props.modelValue
}
function choose(o: Opt) {
  if (o.disabled) return
  if (props.multiple) {
    const arr = Array.isArray(props.modelValue) ? [...(props.modelValue as unknown[])] : []
    const i = arr.indexOf(o.value)
    if (i >= 0) arr.splice(i, 1); else arr.push(o.value)
    emit('update:modelValue', arr)
    return
  }
  emit('update:modelValue', o.value)
  open.value = false
}
function onDocClick(e: MouseEvent) {
  const t = e.target as Node
  // 触发器 root 或 teleport 出去的浮层（.pop-float）任一被点击，都不算外部
  if (root.value?.contains(t)) return
  const popEl = document.querySelector('.pop-float')
  if (popEl && popEl.contains(t)) return
  open.value = false
}
function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') open.value = false
}
function onScroll() { if (open.value) updatePos() }
function onResize() { if (open.value) updatePos() }

watch(open, (v) => {
  if (v) {
    document.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onResize)
  } else {
    document.removeEventListener('scroll', onScroll, true)
    window.removeEventListener('resize', onResize)
  }
})

onMounted(() => { document.addEventListener('click', onDocClick); document.addEventListener('keydown', onKey) })
onBeforeUnmount(() => {
  document.removeEventListener('click', onDocClick)
  document.removeEventListener('keydown', onKey)
  document.removeEventListener('scroll', onScroll, true)
  window.removeEventListener('resize', onResize)
})
</script>

<template>
  <div ref="root" class="app-select" :class="{ open, disabled, sm: size === 'sm' }"
    :style="width ? { width: width + 'px' } : minWidth ? { minWidth: minWidth + 'px' } : maxWidth ? { maxWidth: maxWidth + 'px' } : undefined">
    <button ref="triggerEl" type="button" class="trigger" :disabled="disabled" @click="toggle">
      <span class="val" :class="{ ph: modelValue === null || modelValue === undefined || modelValue === '' }">{{
        selectedLabel }}</span>
      <ChevronDown :size="size === 'sm' ? 13 : 16" class="caret" style="display: inline-flex; flex-shrink: 0" />
    </button>
    <Teleport to="body">
      <transition name="pop">
        <div v-if="open" class="pop-float" :class="{ sm: size === 'sm' }" :style="popStyle">
          <input v-if="searchable" v-model="search" :placeholder="searchPlaceholder" class="pop-search" />
          <ul class="list">
            <template v-for="(o, i) in filtered" :key="String(o.value)">
              <li v-if="o.group && o.group !== filtered[i - 1]?.group" class="grp">{{ o.group }}</li>
              <li class="opt" :class="{ on: isSelected(o), disabled: o.disabled }" @click="choose(o)">
                <span>{{ o.label }}</span>
                <Check v-if="isSelected(o)" :size="size === 'sm' ? 13 : 16" class="tick"
                  style="display: inline-flex; flex-shrink: 0" />
              </li>
            </template>
            <li v-if="searchable && !filtered.length" class="empty">无匹配</li>
          </ul>
        </div>
      </transition>
    </Teleport>
  </div>
</template>

<style scoped>
.app-select {
  position: relative;
  display: inline-block;
  min-width: 8px;
}

.trigger {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  height: var(--ctrl-h);
  padding: 0 var(--ctrl-px);
  background: var(--c-elevated-2);
  border: 1px solid var(--c-border-strong);
  border-radius: var(--r-md);
  color: var(--c-text);
  transition: border-color var(--motion), box-shadow var(--motion);
}

.app-select.open .trigger,
.trigger:focus {
  border-color: var(--c-primary);
  box-shadow: 0 0 0 3px var(--c-primary-soft);
}

.app-select.disabled .trigger {
  opacity: 0.5;
  cursor: not-allowed;
}

.val {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--fs-xs);
}

.val.ph {
  color: var(--c-text-3);
}

.caret {
  color: var(--c-text-2);
  flex-shrink: 0;
  transition: transform var(--motion);
}

.app-select.open .caret {
  transform: rotate(180deg);
}

/* 小号：用于筛选栏 / 弹窗工具栏等紧凑场景 */
.app-select.sm {
  min-width: 88px;
}

.app-select.sm .trigger {
  height: var(--ctrl-h-sm);
  padding: 0 8px;
  gap: 6px;
  border-radius: var(--r-sm);
}
</style>

<style>
/* 非 scoped，让 teleport 到 body 的浮层能命中 */
.pop-float {
  z-index: 1000;
  background: var(--c-elevated);
  border: 1px solid var(--c-border);
  border-radius: var(--r-md);
  box-shadow: var(--shadow-pop);
  padding: 6px;
  overflow: auto;
}

.pop-float .pop-search {
  width: 100%;
  height: 26px;
  margin-bottom: 6px;
  padding: 0 10px;
  border: 1px solid var(--c-border-strong);
  border-radius: var(--r-sm);
  background: var(--c-elevated-2);
  color: var(--c-text);
  font-size: var(--fs-xs);
}

.pop-float .pop-search:focus {
  outline: none;
  border-color: var(--c-primary);
}

.pop-float .list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.pop-float .opt {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 9px 10px;
  border-radius: var(--r-sm);
  cursor: pointer;
  font-size: var(--fs-xs);
  transition: background var(--motion);
  color: var(--c-text);
}

/* 分组小标题（相邻同组只显示一次） */
.pop-float .grp {
  padding: 8px 10px 4px;
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.04em;
  color: var(--c-text-3);
  cursor: default;
}

.pop-float .opt:hover {
  background: var(--c-elevated-2);
}

.pop-float .opt.on {
  color: var(--c-primary);
  background: var(--c-primary-soft);
  font-weight: 600;
}

.pop-float .opt.disabled {
  color: var(--c-text-3);
  pointer-events: none;
}

.pop-float .tick {
  color: var(--c-primary);
}

.pop-float .empty {
  padding: 10px;
  text-align: center;
  color: var(--c-text-3);
  font-size: var(--fs-sm);
}

/* 小号浮层：更紧凑的选项行 */
.pop-float.sm {
  padding: 4px;
  border-radius: var(--r-sm);
}

.pop-float.sm .pop-search {
  height: 24px;
  padding: 0 8px;
  margin-bottom: 4px;
}

.pop-float.sm .opt {
  padding: 6px 8px;
}

.pop-float.sm .empty {
  padding: 8px;
  font-size: var(--fs-xs);
}

.pop-enter-active,
.pop-leave-active {
  transition: opacity var(--motion), transform var(--motion);
}

.pop-enter-from,
.pop-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}
</style>
