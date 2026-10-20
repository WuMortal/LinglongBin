<template>
  <Teleport to="body">
    <Transition name="msheet">
      <div v-if="open" class="bs-mask" :class="{ top }" @click.self="emit('close')">
        <div class="bs" :class="{ tall: tall }">
          <div class="grab" />
          <header v-if="title" class="bs-head">
            <h3>{{ title }}</h3>
            <button v-if="closable" type="button" class="bs-x" title="关闭" @click="emit('close')">
              <X :size="17" style="display: inline-flex; flex-shrink: 0" />
            </button>
          </header>
          <div class="bs-body">
            <slot />
          </div>
          <div v-if="$slots.foot" class="bs-foot">
            <slot name="foot" />
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { X } from 'lucide-vue-next'

/**
 * 移动端通用底部弹层（Material 3 Bottom Sheet 语义）：
 * 遮罩点击关闭 + 把手 + 可选标题 / 关闭按钮 + 内容区 + 底部固定操作区（#foot）。
 * z-index 130，与 QuickStockSheet 同级；二级弹层用 .bs-mask.top（140）。
 */
defineProps<{
  open: boolean
  title?: string
  /** 是否显示右上角关闭按钮（默认显示） */
  closable?: boolean
  /** 内容区更高（用于列表型弹层：max-height 62vh） */
  tall?: boolean
  /** 二级弹层：z-index 提到 140，叠在另一个 sheet 之上 */
  top?: boolean
}>()

const emit = defineEmits<{ close: [] }>()
</script>

<style scoped>
.bs-mask {
  position: fixed;
  inset: 0;
  z-index: 130;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
}

/* 二级弹层（叠在主弹层之上） */
.bs-mask.top {
  z-index: 140;
}

.bs {
  background: var(--c-elevated);
  border-radius: var(--r-2xl) var(--r-2xl) 0 0;
  padding: 8px 16px calc(16px + env(safe-area-inset-bottom));
  box-shadow: var(--shadow-pop);
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.grab {
  width: 36px;
  height: 4px;
  margin: 4px auto 10px;
  border-radius: 999px;
  background: var(--c-border-strong);
  flex-shrink: 0;
}

.bs-head {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 8px;
}

.bs-head h3 {
  flex: 1;
  min-width: 0;
  margin: 0;
  font-size: var(--fs-lg);
  font-weight: 700;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.bs-x {
  flex-shrink: 0;
  width: 30px;
  height: 30px;
  display: grid;
  place-items: center;
  border: 1px solid var(--c-border);
  border-radius: var(--r-md);
  background: var(--c-surface);
  color: var(--c-text-2);
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}

.bs-body {
  min-height: 0;
  overflow-y: auto;
}

.bs.tall .bs-body {
  max-height: 62vh;
}

.bs-foot {
  margin-top: 12px;
  display: flex;
  gap: 8px;
  flex-shrink: 0;
}

/* 底部滑入动效（与 QuickStockSheet 同一组参数） */
.msheet-enter-active,
.msheet-leave-active {
  transition: opacity 0.2s ease;
}

.msheet-enter-active .bs,
.msheet-leave-active .bs {
  transition: transform 0.24s cubic-bezier(0.22, 1, 0.36, 1);
}

.msheet-enter-from,
.msheet-leave-to {
  opacity: 0;
}

.msheet-enter-from .bs,
.msheet-leave-to .bs {
  transform: translateY(100%);
}
</style>
