<template>
  <div class="stepper">
    <button class="step minus" type="button" :disabled="modelValue <= min" @click="dec" aria-label="减少">
      <Minus :size="16" style="display: inline-flex; flex-shrink: 0" />
    </button>
    <input
      class="val"
      :value="modelValue"
      type="text"
      inputmode="numeric"
      @input="onInput"
      @blur="onBlur"
    />
    <button
      class="step plus"
      type="button"
      :disabled="max != null && modelValue >= max"
      @click="inc"
      aria-label="增加"
    >
      <Plus :size="16" style="display: inline-flex; flex-shrink: 0" />
    </button>
  </div>
</template>

<script setup lang="ts">
import { Minus, Plus } from 'lucide-vue-next'

const props = withDefaults(defineProps<{
  modelValue: number
  min?: number
  max?: number | null
  step?: number
}>(), {
  min: 1,
  max: null,
  step: 1,
})

const emit = defineEmits<{
  (e: 'update:modelValue', v: number): void
  (e: 'change', v: number): void
}>()

function clamp(v: number): number {
  let n = v
  if (Number.isFinite(props.min)) n = Math.max(n, props.min)
  if (props.max != null && Number.isFinite(props.max)) n = Math.min(n, props.max)
  return n
}

function set(v: number) {
  const n = clamp(v)
  emit('update:modelValue', n)
  emit('change', n)
}

function dec() { set((props.modelValue || props.min) - props.step) }
function inc() { set((props.modelValue || props.min) + props.step) }

function parseNum(s: string): number {
  const m = s.replace(/[^\d]/g, '')
  if (!m) return props.min
  const n = parseInt(m, 10)
  return Number.isFinite(n) ? n : props.min
}

function onInput(e: Event) {
  const t = e.target as HTMLInputElement
  if (t.value.replace(/[^\d]/g, '') === '') return // 允许先清空，blur 时修正
  set(parseNum(t.value))
}

function onBlur(e: Event) {
  const t = e.target as HTMLInputElement
  const n = clamp(parseNum(t.value))
  set(n)
  t.value = String(n)
}
</script>

<style scoped>
.stepper {
  display: inline-flex;
  align-items: center;
  height: 28px;
  border: 1px solid var(--c-border);
  border-radius: var(--r-md);
  background: var(--c-bg-2);
  overflow: hidden;
  -webkit-tap-highlight-color: transparent;
}
.step {
  width: 28px;
  height: 100%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: none;
  background: transparent;
  color: var(--c-text);
  cursor: pointer;
}
.step:disabled {
  color: var(--c-text-3);
  opacity: 0.45;
  cursor: not-allowed;
}
.step.minus { border-right: 1px solid var(--c-border); }
.step.plus { border-left: 1px solid var(--c-border); }
.step:not(:disabled):active { background: var(--c-surface-hover); }

.val {
  width: 40px;
  height: 100%;
  border: none;
  background: transparent;
  color: var(--c-text);
  text-align: center;
  font-family: inherit;
  font-size: var(--fs-sm);
  font-variant-numeric: tabular-nums;
  padding: 0 4px;
}
.val:focus { outline: none; }
</style>
