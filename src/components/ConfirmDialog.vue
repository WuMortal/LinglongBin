<script setup lang="ts">
import { computed } from 'vue'
import { TriangleAlert, CircleAlert, Info, X } from 'lucide-vue-next'
import { useConfirmState, resolveConfirm } from '../composables/confirm'

const state = useConfirmState()

const iconComp = computed(() => {
  switch (state.value.variant) {
    case 'danger': return TriangleAlert
    case 'warning': return TriangleAlert
    default: return Info
  }
})
const iconClass = computed(() => state.value.variant)
const isDanger = computed(() => state.value.variant === 'danger')

function onConfirm() { resolveConfirm(true) }
function onCancel() { resolveConfirm(false) }
function onMask() { resolveConfirm(false) }
</script>

<template>
  <Teleport to="body">
    <transition name="cf-fade">
      <div v-if="state.visible" class="cf-mask" @click.self="onMask">
        <div class="cf-card">
          <button class="cf-x" @click="onCancel"><X :size="16" style="display: inline-flex; flex-shrink: 0" /></button>
          <div class="cf-ico" :class="iconClass">
            <component :is="iconComp" :size="22" style="display: inline-flex; flex-shrink: 0" />
          </div>
          <div class="cf-body">
            <h3 class="cf-title">{{ state.title }}</h3>
            <p class="cf-content">{{ state.content }}</p>
          </div>
          <div class="cf-actions">
            <button class="btn btn-ghost" @click="onCancel">{{ state.cancelText }}</button>
            <button
              class="btn"
              :class="isDanger ? 'btn-danger' : 'btn-primary'"
              @click="onConfirm"
            >{{ state.confirmText }}</button>
          </div>
        </div>
      </div>
    </transition>
  </Teleport>
</template>

<style scoped>
.cf-mask {
  position: fixed; inset: 0; z-index: 1000;
  background: rgba(0, 0, 0, 0.6);
  backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px);
  display: grid; place-items: center; padding: 24px;
  animation: cf-in 200ms ease;
}
@keyframes cf-in { from { opacity: 0; } to { opacity: 1; } }

.cf-card {
  position: relative;
  width: min(420px, 92vw);
  background: var(--c-elevated);
  border: 1px solid var(--c-border);
  border-radius: var(--r-2xl);
  box-shadow: var(--shadow-lg);
  padding: 24px;
  display: flex; gap: 14px; align-items: flex-start; flex-wrap: wrap;
  animation: cf-card-in 250ms cubic-bezier(0.34, 1.56, 0.64, 1);
}
@keyframes cf-card-in { from { opacity: 0; transform: scale(0.95) translateY(10px); } to { opacity: 1; transform: scale(1) translateY(0); } }

.cf-x {
  position: absolute; top: 10px; right: 10px;
  width: 24px; height: 24px;
  border: none; background: transparent;
  color: var(--c-text-3); cursor: pointer;
  border-radius: var(--r-sm);
  display: grid; place-items: center;
  transition: all var(--motion);
}
.cf-x:hover { background: var(--c-glass); color: var(--c-text); }

.cf-ico {
  width: 40px; height: 40px; flex-shrink: 0;
  border-radius: var(--r-md);
  display: grid; place-items: center;
  background: var(--c-primary-soft);
  color: var(--c-primary);
}
.cf-ico.danger { background: rgba(239, 68, 68, 0.12); color: var(--c-danger); }
.cf-ico.warning { background: rgba(245, 158, 11, 0.12); color: var(--c-warning); }

.cf-body { flex: 1; min-width: 0; padding-right: 20px; }
.cf-title { margin: 0 0 6px; font-size: var(--fs-md); font-weight: 600; color: var(--c-text); }
.cf-content { margin: 0; font-size: var(--fs-sm); color: var(--c-text-2); line-height: 1.55; word-break: break-word; }

.cf-actions {
  flex: 1 1 100%;
  display: flex; justify-content: flex-end; gap: 8px;
  margin-top: 4px; padding-top: 4px;
}

.cf-fade-enter-active, .cf-fade-leave-active { transition: opacity 200ms ease; }
.cf-fade-enter-from, .cf-fade-leave-to { opacity: 0; }
</style>
