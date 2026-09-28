<script setup lang="ts">
import { Check } from 'lucide-vue-next'

export interface WizardStep {
  title: string
  desc?: string
}

const props = defineProps<{
  steps: WizardStep[]
  /** 当前步骤索引（从 0 开始） */
  current: number
  /** 为 true 时禁止点击回退步骤（如保存中） */
  disabled?: boolean
}>()

const emit = defineEmits<{
  'update:current': [i: number]
}>()

/** 仅允许回到已完成的步骤 */
function go(i: number) {
  if (props.disabled) return
  if (i >= props.current) return
  emit('update:current', i)
}
</script>

<template>
  <div class="wizard" role="tablist" aria-label="步骤">
    <template v-for="(s, i) in steps" :key="i">
      <div v-if="i > 0" class="conn" :class="{ done: i <= current }" />
      <button
        class="step" :class="{ on: i === current, done: i < current }"
        type="button" :disabled="disabled || i > current"
        :aria-current="i === current ? 'step' : undefined"
        :aria-label="`第 ${i + 1} 步：${s.title}`"
        @click="go(i)"
      >
        <span class="dot">
          <Check v-if="i < current" :size="14" class="ic" />
          <template v-else>{{ i + 1 }}</template>
        </span>
        <span class="txt">
          <strong>{{ s.title }}</strong>
          <small v-if="s.desc">{{ s.desc }}</small>
        </span>
      </button>
    </template>
  </div>
</template>

<style scoped>
.wizard {
  display: flex;
  align-items: flex-start;
  justify-content: center;
  gap: 8px;
}

.conn {
  flex: 0 0 72px;
  height: 2px;
  margin-top: 15px;
  border-radius: 999px;
  background: var(--c-border);
  transition: background var(--motion);
}

.conn.done { background: var(--c-primary); }

.step {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0;
  border: none;
  background: none;
  text-align: left;
  flex-shrink: 0;
  cursor: default;
}

.step:disabled { opacity: 1; cursor: not-allowed; }
.step.done { cursor: pointer; }

.dot {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  flex-shrink: 0;
  background: var(--c-surface);
  border: 1px solid var(--c-border);
  color: var(--c-text-3);
  font-size: var(--fs-sm);
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  transition: all var(--motion);
}

.dot .ic { color: inherit; }

.step.on .dot {
  background: var(--grad-brand);
  border-color: transparent;
  color: #fff;
  box-shadow: var(--shadow-glow);
}

.step.done .dot {
  background: var(--c-primary-soft);
  border-color: transparent;
  color: var(--c-primary);
}

.step.done:hover .dot {
  border-color: var(--c-primary);
  box-shadow: 0 0 0 3px var(--c-primary-glow);
}

.txt { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
.txt strong {
  font-size: var(--fs-sm);
  font-weight: 600;
  color: var(--c-text-2);
  transition: color var(--motion);
  white-space: nowrap;
}
.txt small {
  font-size: var(--fs-xs);
  color: var(--c-text-3);
  white-space: nowrap;
}
.step.on .txt strong { color: var(--c-text); }
</style>
