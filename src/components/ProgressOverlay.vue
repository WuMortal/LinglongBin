<script setup lang="ts">
import { computed } from 'vue'
import { Loader2, Check, X, TriangleAlert } from 'lucide-vue-next'

const props = withDefaults(
  defineProps<{
    visible: boolean
    title?: string
    message?: string
    /** 进度 0-100，不传则不显示进度条 */
    progress?: number
    /** 未知进度模式（动画） */
    indeterminate?: boolean
    /** 图标类型，默认 spinner */
    variant?: 'spinner' | 'success' | 'error' | 'warning'
    /** 遮罩点击不关闭（默认 true，进度中不能关） */
    persistent?: boolean
  }>(),
  {
    title: '',
    message: '',
    progress: undefined,
    indeterminate: false,
    variant: 'spinner',
    persistent: true,
  }
)

const emit = defineEmits<{ close: [] }>()

const iconComp = computed(() => {
  switch (props.variant) {
    case 'success': return Check
    case 'error': return X
    case 'warning': return TriangleAlert
    default: return Loader2
  }
})
const iconClass = computed(() => ({
  spin: props.variant === 'spinner',
  ok: props.variant === 'success',
  err: props.variant === 'error',
  warn: props.variant === 'warning',
}))
const pct = computed(() => {
  if (typeof props.progress !== 'number') return null
  return Math.max(0, Math.min(100, Math.round(props.progress)))
})

function onMaskClick() {
  if (!props.persistent) emit('close')
}
</script>

<template>
  <Teleport to="body">
    <transition name="po-fade">
      <div v-if="visible" class="po-mask" @click.self="onMaskClick">
        <div class="po-card">
          <div class="po-ico" :class="iconClass">
            <component :is="iconComp" :size="26" style="display: inline-flex; flex-shrink: 0" />
          </div>
          <div class="po-text">
            <div v-if="title" class="po-title">{{ title }}</div>
            <div v-if="message" class="po-msg">{{ message }}</div>
            <slot />
            <div v-if="pct !== null || indeterminate" class="po-bar" :class="{ indeterminate }">
              <div v-if="!indeterminate" class="po-bar-fill" :style="{ width: (pct ?? 0) + '%' }" />
            </div>
            <div v-if="pct !== null" class="po-pct">{{ pct }}%</div>
          </div>
        </div>
      </div>
    </transition>
  </Teleport>
</template>

<style scoped>
.po-mask {
  position: fixed; inset: 0; z-index: 100;
  background: rgba(0, 0, 0, 0.6);
  backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px);
  display: grid; place-items: center; padding: 24px;
  animation: po-fade-in 200ms ease;
}
@keyframes po-fade-in { from { opacity: 0; } to { opacity: 1; } }

.po-card {
  width: min(440px, 92vw);
  display: flex; gap: 16px; align-items: flex-start;
  background: var(--c-elevated);
  border: 1px solid var(--c-border);
  border-radius: var(--r-2xl);
  box-shadow: var(--shadow-lg);
  padding: 24px;
  animation: po-in 250ms cubic-bezier(0.34, 1.56, 0.64, 1);
}
@keyframes po-in { from { opacity: 0; transform: scale(0.95) translateY(10px); } to { opacity: 1; transform: scale(1) translateY(0); } }

.po-ico {
  width: 44px; height: 44px; flex-shrink: 0;
  border-radius: var(--r-md);
  display: grid; place-items: center;
  background: var(--c-primary-soft);
  color: var(--c-primary);
}
.po-ico.spin { animation: po-spin 0.9s linear infinite; }
.po-ico.ok { background: rgba(34, 197, 94, 0.12); color: #22c55e; }
.po-ico.err { background: rgba(239, 68, 68, 0.12); color: var(--c-danger); }
.po-ico.warn { background: rgba(245, 158, 11, 0.12); color: var(--c-warning); }
@keyframes po-spin { to { transform: rotate(360deg); } }

.po-text { flex: 1; min-width: 0; }
.po-title {
  font-size: var(--fs-md); font-weight: 600; color: var(--c-text);
  margin-bottom: 4px;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.po-msg {
  font-size: var(--fs-xs); color: var(--c-text-2);
  margin-bottom: 10px;
  line-height: 1.5;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}

.po-bar {
  height: 4px; background: var(--c-border);
  border-radius: 2px; overflow: hidden;
  position: relative;
}
.po-bar-fill {
  height: 100%; background: var(--c-primary);
  border-radius: 2px;
  transition: width 200ms ease;
}
.po-bar.indeterminate::after {
  content: '';
  position: absolute; top: 0; left: 0; bottom: 0; width: 40%;
  background: var(--c-primary);
  border-radius: 2px;
  animation: po-indet 1.4s ease-in-out infinite;
}
@keyframes po-indet {
  0% { left: -40%; }
  100% { left: 100%; }
}

.po-pct {
  margin-top: 6px;
  font-size: 10px; color: var(--c-text-3);
  text-align: right;
}

.po-fade-enter-active, .po-fade-leave-active { transition: opacity 200ms ease; }
.po-fade-enter-from, .po-fade-leave-to { opacity: 0; }
</style>
