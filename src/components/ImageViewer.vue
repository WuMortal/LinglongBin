<script setup lang="ts">
// 全屏图片预览：点击遮罩 / 关闭按钮关闭，点图不关，支持 ESC
// 通过 v-model:open 控制显隐，src 为预览地址（null 时不渲染）
import { onMounted, onUnmounted } from 'vue'

const props = defineProps<{
  /** 是否显示预览 */
  open: boolean
  /** 预览图片地址（null 时不渲染） */
  src: string | null
}>()

const emit = defineEmits<{ 'update:open': [value: boolean] }>()

function close() {
  emit('update:open', false)
}

function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') close()
}

onMounted(() => window.addEventListener('keydown', onKey))
onUnmounted(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <Teleport to="body">
    <Transition name="imgv">
      <div v-if="open && src" class="imgv-mask" @click="close">
        <img :src="src" alt="预览" class="imgv-img" @click.stop />
        <button type="button" class="imgv-close" title="关闭" @click="close">✕</button>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.imgv-mask {
  position: fixed;
  inset: 0;
  z-index: 200;
  background: rgba(0, 0, 0, 0.85);
  display: grid;
  place-items: center;
  cursor: zoom-out;
}

.imgv-img {
  max-width: 90vw;
  max-height: 90vh;
  object-fit: contain;
  border-radius: var(--r-md);
  box-shadow: 0 12px 48px rgba(0, 0, 0, 0.5);
}

.imgv-close {
  position: absolute;
  top: 20px;
  right: 24px;
  width: 36px;
  height: 36px;
  border: none;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.15);
  color: #fff;
  font-size: 18px;
  line-height: 1;
  cursor: pointer;
  transition: background var(--motion);
}

.imgv-close:hover {
  background: rgba(255, 255, 255, 0.25);
}

.imgv-enter-active,
.imgv-leave-active {
  transition: opacity 180ms ease;
}

.imgv-enter-from,
.imgv-leave-to {
  opacity: 0;
}
</style>
