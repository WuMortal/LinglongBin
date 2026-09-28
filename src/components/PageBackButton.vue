<template>
  <button v-if="visible" class="page-back" @click="back" :title="title">
    <ArrowLeft :size="16" style="display: inline-flex; flex-shrink: 0" />
    <span class="label">{{ label }}</span>
  </button>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ArrowLeft } from 'lucide-vue-next'

const props = withDefaults(defineProps<{
  /** 强制显示返回到某个路径（覆盖 query.from） */
  to?: string
  /** 返回按钮显示文案，默认「返回」 */
  label?: string
  /** 当没有可返回目标时是否隐藏按钮，默认 true */
  hideWhenNone?: boolean
}>(), {
  label: '返回',
  hideWhenNone: true,
})

const route = useRoute()
const router = useRouter()

const target = computed<string | null>(() => props.to || (typeof route.query.from === 'string' ? route.query.from : null))
const visible = computed(() => !!target.value || !props.hideWhenNone)
const title = computed(() => target.value ? `返回到 ${target.value}` : '返回')

function back() {
  if (target.value) {
    router.push(target.value)
  } else if (window.history.length > 1) {
    router.back()
  }
}
</script>

<style scoped>
.page-back {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 32px;
  padding: 0 12px;
  font-size: var(--fs-sm);
  color: var(--c-text-2);
  background: var(--c-glass);
  border: 1px solid var(--c-border);
  border-radius: var(--r-md);
  cursor: pointer;
  transition: all var(--motion-fast);
}

.page-back:hover {
  background: var(--c-surface-hover);
  border-color: var(--c-border-strong);
  color: var(--c-text);
}

.page-back .label {
  font-weight: 500;
}
</style>
