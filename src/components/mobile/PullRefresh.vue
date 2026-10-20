<template>
  <div ref="wrapEl" class="pr-wrap">
    <!-- 下拉指示器（箭头/加载圈） -->
    <div class="pr-indicator" :style="{ height: dist + 'px', opacity: dist > 0 ? 1 : 0 }">
      <span v-if="loading" class="pr-spinner" />
      <ArrowDown v-else :size="16" class="pr-arrow" :class="{ flip: triggerReady }" />
    </div>
    <!-- 内容（跟随下拉位移；仅松手复位时带动画，拖拽中必须即时跟手） -->
    <div class="pr-content" :class="{ anim: !dragging }" :style="{ transform: `translateY(${dist}px)` }">
      <slot />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { ArrowDown } from 'lucide-vue-next'

/**
 * 移动端通用下拉刷新（WebView 无原生支持，自实现 touch 手势）。
 * 适用于任何嵌入滚动容器的页面（MobileShell .content 等）：
 * 自动向上查找最近的可滚动祖先，仅在其滚到顶时才允许下拉。
 * 触发阈值 64px、阻尼 0.5；loading 期间锁定，父组件完成后调 done() 复位。
 */
const props = defineProps<{
  /** 触发阈值（px），默认 64 */
  threshold?: number
}>()

const emit = defineEmits<{
  /** 下拉到位松手触发；数据刷新完成后必须调 done() 复位 */
  (e: 'refresh', done: () => void): void
}>()

const wrapEl = ref<HTMLElement | null>(null)

const dist = ref(0)
const loading = ref(false)
/** 拖拽中：内容位移即时跟手，不走过渡（锁定/复位阶段允许动画） */
const dragging = computed(() => pulling)

const trigAt = computed(() => props.threshold ?? 64)
const triggerReady = computed(() => dist.value >= trigAt.value && !loading.value)

/** 阻尼：越拉越重 */
const DAMPING = 0.5

let startY = 0
let pulling = false
/** 手势起始时最近滚动祖先是否已在顶部 */
let atTop = false

/** 向上找最近的可滚动祖先（overflow auto/scroll 且内容溢出） */
function findScrollAncestor(el: HTMLElement | null): HTMLElement | null {
  let node = el?.parentElement ?? null
  while (node) {
    const oy = getComputedStyle(node).overflowY
    if ((oy === 'auto' || oy === 'scroll') && node.scrollHeight > node.clientHeight) return node
    node = node.parentElement
  }
  return null
}

function onTouchStart(e: TouchEvent) {
  if (loading.value) return
  const sc = findScrollAncestor(wrapEl.value)
  atTop = !sc || sc.scrollTop <= 0
  if (!atTop) return
  startY = e.touches[0].clientY
  pulling = true
}

function onTouchMove(e: TouchEvent) {
  if (!pulling || loading.value) return
  const delta = e.touches[0].clientY - startY
  if (delta <= 0) {
    if (dist.value !== 0) dist.value = 0
    return // 向上手势交还滚动容器
  }
  e.preventDefault() // 接管下拉，阻止原生滚动
  dist.value = Math.min(delta * DAMPING, 110)
}

function onTouchEnd() {
  if (!pulling) return
  pulling = false
  if (triggerReady.value) {
    loading.value = true
    dist.value = 52 // 锁定加载位
    emit('refresh', () => {
      loading.value = false
      dist.value = 0
    })
  } else {
    dist.value = 0
  }
}

onMounted(() => {
  const el = wrapEl.value
  if (!el) return
  // touchmove 需 passive:false 才能 preventDefault
  el.addEventListener('touchstart', onTouchStart, { passive: true })
  el.addEventListener('touchmove', onTouchMove, { passive: false })
  el.addEventListener('touchend', onTouchEnd, { passive: true })
  el.addEventListener('touchcancel', onTouchEnd, { passive: true })
})

onBeforeUnmount(() => {
  const el = wrapEl.value
  if (!el) return
  el.removeEventListener('touchstart', onTouchStart)
  el.removeEventListener('touchmove', onTouchMove)
  el.removeEventListener('touchend', onTouchEnd)
  el.removeEventListener('touchcancel', onTouchEnd)
})
</script>

<style scoped>
.pr-wrap {
  position: relative;
  min-height: 100%;
}

.pr-indicator {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  pointer-events: none;
  color: var(--c-text-3);
}

.pr-arrow {
  transition: transform 160ms ease;
}

.pr-arrow.flip {
  transform: rotate(180deg);
  color: var(--c-primary);
}

.pr-spinner {
  width: 18px;
  height: 18px;
  border: 2px solid var(--c-border);
  border-top-color: var(--c-primary);
  border-radius: 50%;
  animation: pr-spin 0.7s linear infinite;
}

@keyframes pr-spin {
  to { transform: rotate(360deg); }
}

.pr-content.anim {
  transition: transform 240ms cubic-bezier(0.22, 1, 0.36, 1);
}
</style>
