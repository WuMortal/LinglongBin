<template>
  <header class="navbar">
    <button v-if="showBack" class="back" type="button" :title="backTitle" :aria-label="backTitle" @click="onBack">
      <ArrowLeft :size="19" class="ico" />
    </button>
    <h1 class="title" :title="title">{{ title }}</h1>
    <div class="extra">
      <slot name="extra" />
    </div>
  </header>
</template>

<script setup lang="ts">
import { getCurrentInstance } from 'vue'
import { useRouter } from 'vue-router'
import { ArrowLeft } from 'lucide-vue-next'

/**
 * 移动端二级页通用吸顶返回栏（通栏玻璃态）：
 * - 负水平外边距吃掉 MobileShell `.content` 的 16px padding，视觉上通栏；
 * - 右侧 `#extra` 插槽放操作按钮（无内容时不占位）。
 *
 * 返回行为：默认「有历史就退、没历史去 fallback」；
 * 若父组件监听了 `back`（如设置子面板要退回列表而非路由），则完全交给父组件处理。
 */
const props = withDefaults(defineProps<{
  title?: string
  /** 是否显示返回按钮 */
  showBack?: boolean
  /** 无历史可退时的兜底路由 */
  fallback?: string
  backTitle?: string
}>(), {
  title: '',
  showBack: true,
  fallback: '/m/home',
  backTitle: '返回',
})

const emit = defineEmits<{ back: [] }>()

const router = useRouter()
const instance = getCurrentInstance()

function onBack() {
  if (instance?.vnode.props?.onBack) {
    emit('back')
    return
  }
  if (window.history.length > 1) router.back()
  else router.replace(props.fallback)
}
</script>

<style scoped>
.navbar {
  position: sticky;
  top: 0;
  z-index: 20;
  display: flex;
  align-items: center;
  gap: 10px;
  height: 52px;
  /* 水平负外边距 = 通栏；顶部不加负 margin（.content 顶部 padding 本就是 0） */
  margin: 0 -16px;
  padding: 0 10px 0 8px;
  background: var(--c-glass-strong);
  backdrop-filter: blur(24px) saturate(160%);
  -webkit-backdrop-filter: blur(24px) saturate(160%);
  border-bottom: 1px solid var(--c-border-hairline);
  box-shadow: 0 6px 16px -12px rgba(0, 0, 0, 0.55);
}

/* 底部品牌色渐隐细线，弱化生硬的分隔 */
.navbar::after {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  bottom: -1px;
  height: 1px;
  background: linear-gradient(90deg, transparent, var(--c-primary-glow), transparent);
  pointer-events: none;
}

.back {
  width: 34px;
  height: 34px;
  flex-shrink: 0;
  display: grid;
  place-items: center;
  border: 1px solid var(--c-border);
  border-radius: var(--r-md);
  background: var(--c-surface);
  color: var(--c-text);
  cursor: pointer;
  transition: background var(--motion), transform var(--motion), border-color var(--motion);
  -webkit-tap-highlight-color: transparent;
}

.back:active {
  background: var(--c-surface-active);
  border-color: var(--c-border-strong);
  transform: scale(0.92);
}

.back :deep(.ico) {
  color: inherit;
}

.title {
  flex: 1;
  min-width: 0;
  margin: 0;
  font-size: var(--fs-lg);
  font-weight: 600;
  letter-spacing: -0.01em;
  color: var(--c-text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.extra {
  margin-left: auto;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}
</style>
