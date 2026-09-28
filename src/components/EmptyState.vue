<script setup lang="ts">
import { type Component } from 'vue'
import { Inbox } from 'lucide-vue-next'

withDefaults(defineProps<{
  /** 图标组件，默认 Inbox */
  icon?: Component
  /** 标题（可选） */
  title?: string
  /** 描述文字（可选） */
  description?: string
}>(), {
  icon: Inbox,
})
</script>

<template>
  <div class="empty">
    <div class="empty-ico">
      <component :is="icon" :size="40" style="display: inline-flex; flex-shrink: 0" />
    </div>
    <h3 v-if="title">{{ title }}</h3>
    <p v-if="description">{{ description }}</p>
  </div>
</template>

<style scoped>
.empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  color: var(--c-text-2);
  text-align: center;
  padding: 24px;
}

.empty-ico {
  width: 72px;
  height: 72px;
  border-radius: var(--r-xl);
  background: var(--c-glass);
  display: grid;
  place-items: center;
  color: var(--c-text-3);
  margin-bottom: 8px;
}

.empty h3 {
  margin: 0;
  font-size: var(--fs-lg);
  color: var(--c-text);
}

.empty p {
  margin: 0;
  font-size: var(--fs-sm);
}
</style>
