<script setup lang="ts">
import { computed, watch } from 'vue'
import { TriangleAlert, CircleAlert, Info, X } from 'lucide-vue-next'
import { useConfirmState, resolveConfirm } from '../composables/confirm'
import { getPlatformSync } from '../lib/platform'

const state = useConfirmState()

/**
 * 同一套 state / promise 契约，只是形态按平台分流：
 * - 移动端：底部动作面板（标题居中 + 说明 + 主操作 + 独立取消块），业界主流做法
 *   （微信 / 支付宝 / iOS action sheet 都是这一套），拇指热区落在屏幕下半部；
 * - 桌面端：保持原来的居中卡片 + 图标 + 右下按钮，一行不动。
 */
const isMobile = getPlatformSync().kind !== 'mobile'

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

// 移动端弹面板时锁掉背景滚动：遮罩虽然盖住全屏，但不禁滚动的话，
// 手指在遮罩区域滑动依然会带动下面的列表一起滚
watch(() => state.value.visible, v => {
  if (!isMobile) return
  document.body.style.overflow = v ? 'hidden' : ''
})
</script>

<template>
  <Teleport to="body">
    <transition name="cf">
      <div v-if="state.visible" class="cf-mask" :class="{ m: isMobile }" @click.self="onMask">

        <!-- ===== 移动端：底部动作面板 ===== -->
        <div v-if="isMobile" class="cf-sheet">
          <div class="cf-grab" />
          <h3 class="cf-s-title">{{ state.title }}</h3>
          <p v-if="state.content" class="cf-s-content">{{ state.content }}</p>
          <button type="button" class="cf-s-btn" :class="isDanger ? 'danger' : 'primary'" @click="onConfirm">
            {{ state.confirmText }}
          </button>
          <button type="button" class="cf-s-cancel" @click="onCancel">{{ state.cancelText }}</button>
        </div>

        <!-- ===== 桌面端：原居中卡片，保持不变 ===== -->
        <div v-else class="cf-card">
          <button class="cf-x" @click="onCancel">
            <X :size="16" style="display: inline-flex; flex-shrink: 0" />
          </button>
          <div class="cf-ico" :class="iconClass">
            <component :is="iconComp" :size="22" style="display: inline-flex; flex-shrink: 0" />
          </div>
          <div class="cf-body">
            <h3 class="cf-title">{{ state.title }}</h3>
            <p class="cf-content">{{ state.content }}</p>
          </div>
          <div class="cf-actions">
            <button class="btn btn-ghost" @click="onCancel">{{ state.cancelText }}</button>
            <button class="btn" :class="isDanger ? 'btn-danger' : 'btn-primary'" @click="onConfirm">{{ state.confirmText
              }}</button>
          </div>
        </div>

      </div>
    </transition>
  </Teleport>
</template>

<style scoped>
.cf-mask {
  position: fixed;
  inset: 0;
  z-index: 1000;
  background: rgba(0, 0, 0, 0.6);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  display: grid;
  place-items: center;
  padding: 24px;
  animation: cf-in 200ms ease;
}

@keyframes cf-in {
  from {
    opacity: 0;
  }

  to {
    opacity: 1;
  }
}

/* 移动端：贴底、通栏，不用居中卡片的 padding */
.cf-mask.m {
  place-items: end center;
  padding: 0;
}

/* ===== 移动端底部动作面板 ===== */
.cf-sheet {
  width: 100%;
  background: var(--c-elevated);
  border-radius: var(--r-2xl) var(--r-2xl) 0 0;
  border-top: 1px solid var(--c-border-hairline);
  padding: 8px 16px calc(16px + env(safe-area-inset-bottom));
  box-shadow: var(--shadow-pop);
  text-align: center;
}

.cf-grab {
  width: 36px;
  height: 4px;
  margin: 4px auto 14px;
  border-radius: 999px;
  background: var(--c-border-strong);
}

.cf-s-title {
  margin: 0;
  font-size: var(--fs-lg);
  font-weight: 700;
  color: var(--c-text);
}

.cf-s-content {
  margin: 6px 0 0;
  font-size: var(--fs-sm);
  color: var(--c-text-2);
  line-height: 1.6;
  word-break: break-word;
}

/* 主操作：满宽大按钮，危险操作用红 */
.cf-s-btn {
  width: 80%;
  height: 48px;
  margin-top: 18px;
  border: none;
  border-radius: var(--r-lg);
  font-family: inherit;
  font-size: var(--fs-md);
  font-weight: 700;
  color: #fff;
  cursor: pointer;
  transition: transform 120ms ease-out, opacity var(--motion-fast);
  -webkit-tap-highlight-color: transparent;
}

.cf-s-btn.primary {
  background: var(--c-primary);
}

.cf-s-btn.danger {
  background: var(--c-danger);
}

.cf-s-btn:active {
  transform: scale(0.985);
  opacity: 0.9;
}

/* 取消：与主操作分开的独立块，弱化处理 */
.cf-s-cancel {
  width: 80%;
  height: 48px;
  margin-top: 10px;
  border: none;
  border-radius: var(--r-lg);
  background: var(--c-bg-2);
  color: var(--c-text-2);
  font-family: inherit;
  font-size: var(--fs-md);
  font-weight: 600;
  cursor: pointer;
  transition: background-color var(--motion-fast), color var(--motion-fast);
  -webkit-tap-highlight-color: transparent;
}

.cf-s-cancel:active {
  background: var(--c-surface-hover);
  color: var(--c-text);
}

/* ===== 桌面端：原卡片，保持不变 ===== */
.cf-card {
  position: relative;
  width: min(420px, 92vw);
  background: var(--c-elevated);
  border: 1px solid var(--c-border);
  border-radius: var(--r-2xl);
  box-shadow: var(--shadow-lg);
  padding: 24px;
  display: flex;
  gap: 14px;
  align-items: flex-start;
  flex-wrap: wrap;
  animation: cf-card-in 250ms cubic-bezier(0.34, 1.56, 0.64, 1);
}

@keyframes cf-card-in {
  from {
    opacity: 0;
    transform: scale(0.95) translateY(10px);
  }

  to {
    opacity: 1;
    transform: scale(1) translateY(0);
  }
}

.cf-x {
  position: absolute;
  top: 10px;
  right: 10px;
  width: 24px;
  height: 24px;
  border: none;
  background: transparent;
  color: var(--c-text-3);
  cursor: pointer;
  border-radius: var(--r-sm);
  display: grid;
  place-items: center;
  transition: all var(--motion);
}

.cf-x:hover {
  background: var(--c-glass);
  color: var(--c-text);
}

.cf-ico {
  width: 40px;
  height: 40px;
  flex-shrink: 0;
  border-radius: var(--r-md);
  display: grid;
  place-items: center;
  background: var(--c-primary-soft);
  color: var(--c-primary);
}

.cf-ico.danger {
  background: rgba(239, 68, 68, 0.12);
  color: var(--c-danger);
}

.cf-ico.warning {
  background: rgba(245, 158, 11, 0.12);
  color: var(--c-warning);
}

.cf-body {
  flex: 1;
  min-width: 0;
  padding-right: 20px;
}

.cf-title {
  margin: 0 0 6px;
  font-size: var(--fs-md);
  font-weight: 600;
  color: var(--c-text);
}

.cf-content {
  margin: 0;
  font-size: var(--fs-sm);
  color: var(--c-text-2);
  line-height: 1.55;
  word-break: break-word;
}

.cf-actions {
  flex: 1 1 100%;
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 4px;
  padding-top: 4px;
}

/* ===== 过渡：桌面缩放淡入 / 移动端底部上滑 ===== */
.cf-enter-active,
.cf-leave-active {
  transition: opacity 200ms ease;
}

.cf-enter-active .cf-card,
.cf-leave-active .cf-card {
  transition: transform 250ms cubic-bezier(0.34, 1.56, 0.64, 1);
}

.cf-enter-active .cf-sheet,
.cf-leave-active .cf-sheet {
  transition: transform 240ms cubic-bezier(0.22, 1, 0.36, 1);
}

.cf-enter-from,
.cf-leave-to {
  opacity: 0;
}

.cf-enter-from .cf-card,
.cf-leave-to .cf-card {
  transform: scale(0.95) translateY(10px);
}

.cf-enter-from .cf-sheet,
.cf-leave-to .cf-sheet {
  transform: translateY(100%);
}
</style>
