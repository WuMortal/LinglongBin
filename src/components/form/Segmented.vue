<script setup lang="ts" generic="T extends string | number">
import type { Component } from 'vue'

defineProps<{
  modelValue: T
  options: Array<{ value: T; label?: string; icon?: Component }>
  /** 整行铺满 */
  full?: boolean
}>()

defineEmits<{
  'update:modelValue': [v: T]
}>()
</script>

<template>
  <div class="seg-control" :class="{ full }">
    <button v-for="opt in options" :key="String(opt.value)" type="button"
      :class="{ on: modelValue === opt.value }" @click="$emit('update:modelValue', opt.value)">
      <component :is="opt.icon" v-if="opt.icon" :size="15" style="display: inline-flex; flex-shrink: 0" />
      <span v-if="opt.label">{{ opt.label }}</span>
    </button>
  </div>
</template>

<style scoped>
.seg-control {
  display: inline-flex;
  gap: 4px;
  padding: 3px;
  background: var(--c-glass);
  border: 1px solid var(--c-border);
  border-radius: var(--r-md);
}

.seg-control.full {
  display: flex;
  width: 100%;
}

.seg-control.full button {
  flex: 1;
}

.seg-control button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  height: calc(var(--ctrl-h) - 8px);
  padding: 0 12px;
  border: none;
  border-radius: var(--r-sm);
  background: transparent;
  color: var(--c-text-2);
  font-weight: 600;
  font-size: var(--fs-sm);
  cursor: pointer;
  white-space: nowrap;
  transition: background-color 120ms ease-out, color 120ms ease-out, box-shadow 120ms ease-out;
}

.seg-control button:hover {
  color: var(--c-text);
}

.seg-control button.on {
  background: var(--c-primary);
  color: #fff;
  box-shadow: var(--shadow-glow);
}
</style>
