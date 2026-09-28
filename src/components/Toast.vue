<script setup lang="ts">
import type { Component } from 'vue'
import { Check, X, TriangleAlert, Info } from 'lucide-vue-next'
import { useToast } from '@/composables/toast'

const { toasts, remove } = useToast()

const iconMap: Record<string, Component> = {
  success: Check,
  error: X,
  warning: TriangleAlert,
  info: Info,
}
</script>

<template>
  <Teleport to="body">
    <div class="toast-container">
      <TransitionGroup name="toast">
        <div
          v-for="toast in toasts"
          :key="toast.id"
          class="toast-item"
          :class="`toast-${toast.type}`"
          @click="remove(toast.id)"
        >
          <component :is="iconMap[toast.type]" :size="16" class="toast-icon" style="display: inline-flex; flex-shrink: 0" />
          <span class="toast-msg">{{ toast.message }}</span>
          <button class="toast-close" @click.stop="remove(toast.id)">
            <X :size="12" style="display: inline-flex; flex-shrink: 0" />
          </button>
        </div>
      </TransitionGroup>
    </div>
  </Teleport>
</template>

<style scoped>
.toast-container {
  position: fixed;
  top: 60px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 10000;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  pointer-events: none;
}

.toast-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  border-radius: var(--r-md);
  font-size: var(--fs-sm);
  font-weight: 500;
  box-shadow: var(--shadow-md);
  cursor: pointer;
  pointer-events: auto;
  min-width: 200px;
  max-width: 420px;
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  background: var(--c-elevated);
  border: 1px solid var(--c-border);
}

.toast-icon { flex-shrink: 0; }

.toast-msg {
  flex: 1;
  min-width: 0;
  line-height: 1.4;
  overflow-wrap: break-word;
  word-break: break-word;
}

.toast-close {
  flex-shrink: 0;
  width: 20px;
  height: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  background: var(--c-surface);
  border-radius: var(--r-sm);
  cursor: pointer;
  opacity: 0.6;
  transition: opacity 0.15s;
  color: inherit;
}
.toast-close:hover { opacity: 1; }

/* Success */
.toast-success { color: var(--c-success); border-color: rgba(52, 211, 153, 0.25); }
.toast-success .toast-icon { color: var(--c-success); }

/* Error */
.toast-error { color: var(--c-danger); border-color: rgba(255, 92, 114, 0.25); }
.toast-error .toast-icon { color: var(--c-danger); }

/* Warning */
.toast-warning { color: var(--c-warning); border-color: rgba(255, 179, 71, 0.25); }
.toast-warning .toast-icon { color: var(--c-warning); }

/* Info */
.toast-info { color: var(--c-primary); border-color: rgba(79, 140, 255, 0.25); }
.toast-info .toast-icon { color: var(--c-primary); }

/* Transition */
.toast-enter-active { transition: all 0.3s ease; }
.toast-leave-active { transition: all 0.2s ease; }
.toast-enter-from { opacity: 0; transform: translateY(-12px) scale(0.95); }
.toast-leave-to { opacity: 0; transform: translateY(-8px) scale(0.95); }
</style>
