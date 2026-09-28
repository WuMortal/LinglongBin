<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from 'vue';
import { HelpCircle } from 'lucide-vue-next';

type Placement = 'top' | 'bottom';

const props = withDefaults(
  defineProps<{
    title?: string;
    description?: string;
    okText?: string;
    cancelText?: string;
    /** 确认按钮类型: danger=红色(删除类), primary=主题蓝 */
    okType?: 'danger' | 'primary';
    placement?: Placement;
  }>(),
  {
    title: '确定要执行该操作吗？',
    description: '',
    okText: '确定',
    cancelText: '取消',
    okType: 'danger',
    placement: 'top',
  }
);

const emit = defineEmits<{
  confirm: [];
  cancel: [];
}>();

const visible = ref(false);
const rootRef = ref<HTMLElement | null>(null);

function toggle() {
  visible.value = !visible.value;
}

function handleConfirm() {
  emit('confirm');
  visible.value = false;
}

function handleCancel() {
  emit('cancel');
  visible.value = false;
}

function onClickOutside(e: MouseEvent) {
  if (visible.value && rootRef.value && !rootRef.value.contains(e.target as Node)) {
    visible.value = false;
  }
}

onMounted(() => {
  document.addEventListener('click', onClickOutside);
});

onBeforeUnmount(() => {
  document.removeEventListener('click', onClickOutside);
});
</script>

<template>
  <div ref="rootRef" class="pc-root" :class="`pc-root--${placement}`">
    <span class="pc-trigger" @click.stop="toggle">
      <slot />
    </span>

    <Transition name="pc-pop">
      <div v-if="visible" class="pc-pop">
        <div class="pc-arrow"></div>
        <div class="pc-body">
          <HelpCircle :size="16" class="pc-icon" />
          <div class="pc-text">
            <div v-if="title" class="pc-title">{{ title }}</div>
            <div v-if="description" class="pc-desc">{{ description }}</div>
          </div>
        </div>
        <div class="pc-actions">
          <button class="pc-btn pc-btn-cancel" @click="handleCancel">{{ cancelText }}</button>
          <button class="pc-btn" :class="okType === 'danger' ? 'pc-btn-danger' : 'pc-btn-primary'" @click="handleConfirm">
            {{ okText }}
          </button>
        </div>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.pc-root {
  position: relative;
  display: inline-flex;
}

.pc-trigger {
  display: inline-flex;
}

/* 气泡卡片 */
.pc-pop {
  position: absolute;
  width: 260px;
  background: var(--c-elevated);
  border: 1px solid var(--c-border-strong);
  border-radius: var(--r-lg);
  box-shadow: var(--shadow-lg);
  padding: 14px 16px 12px;
  z-index: 21;
}

/* 默认显示在触发元素上方 */
.pc-root--top .pc-pop {
  bottom: calc(100% + 10px);
  left: 0;
}

.pc-root--bottom .pc-pop {
  top: calc(100% + 10px);
  left: 0;
}

/* 指向触发元素的小三角 */
.pc-arrow {
  position: absolute;
  width: 10px;
  height: 10px;
  background: var(--c-elevated);
  border-right: 1px solid var(--c-border-strong);
  border-bottom: 1px solid var(--c-border-strong);
}

.pc-root--top .pc-arrow {
  bottom: -6px;
  left: 20px;
  transform: rotate(45deg);
}

.pc-root--bottom .pc-arrow {
  top: -6px;
  left: 20px;
  transform: rotate(-135deg);
}

.pc-body {
  display: flex;
  gap: 8px;
  align-items: flex-start;
  margin-bottom: 12px;
}

.pc-icon {
  color: var(--c-warning);
  flex-shrink: 0;
  margin-top: 1px;
}

.pc-text {
  font-size: var(--fs-md);
  line-height: 1.6;
}

.pc-title {
  color: var(--c-text);
  font-weight: 600;
}

.pc-desc {
  color: var(--c-text-2);
  margin-top: 2px;
  font-size: var(--fs-sm);
}

.pc-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.pc-btn {
  border: 1px solid var(--c-border);
  background: var(--c-elevated-2);
  color: var(--c-text);
  padding: 5px 14px;
  border-radius: var(--r-md);
  cursor: pointer;
  font-size: var(--fs-sm);
  transition: all var(--motion);
}

.pc-btn:hover {
  border-color: var(--c-primary);
  color: var(--c-primary);
}

.pc-btn-cancel {
  background: var(--c-elevated-2);
}

.pc-btn-primary {
  background: var(--c-primary);
  border-color: var(--c-primary);
  color: #ffffff;
}

.pc-btn-primary:hover {
  background: var(--c-primary-press);
  border-color: var(--c-primary-press);
  color: #ffffff;
}

.pc-btn-danger {
  background: var(--c-danger);
  border-color: var(--c-danger);
  color: #ffffff;
}

.pc-btn-danger:hover {
  background: #E14B60;
  border-color: #E14B60;
  color: #ffffff;
}

/* 出现动画 */
.pc-pop-enter-active,
.pc-pop-leave-active {
  transition: opacity 0.18s ease, transform 0.18s ease;
}

.pc-root--top .pc-pop-enter-from,
.pc-root--top .pc-pop-leave-to {
  opacity: 0;
  transform: translateY(6px);
}

.pc-root--bottom .pc-pop-enter-from,
.pc-root--bottom .pc-pop-leave-to {
  opacity: 0;
  transform: translateY(-6px);
}
</style>
