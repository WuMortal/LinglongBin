<script setup lang="ts">
import { computed } from 'vue'
import * as Lucide from 'lucide-vue-next'

type KpiTone = 'blue' | 'teal' | 'red'

/** 单个普通 KPI：图标 + 大数字 + 小标签 */
export interface KpiItem {
  /** lucide 图标名，如 'Boxes' / 'Package' / 'ArrowDownToLine' */
  icon: keyof typeof Lucide
  tone?: KpiTone
  value: string | number
  label: string
}

/** 环形 KPI（首位特殊形态） */
export interface KpiRing {
  kind: 'ring'
  value: string | number
  /** 0-100，环形进度 */
  pct: number
  label: string
  sub?: string
}

export type KpiEntry = KpiRing | KpiItem

const props = defineProps<{
  items: KpiEntry[]
  /** 紧凑尺寸：用于空间紧张的页面（如库存 tab 页），默认常规 */
  compact?: boolean
}>()

const iconSize = computed(() => props.compact ? 18 : 20)

const isRing = (i: KpiEntry): i is KpiRing => (i as KpiRing).kind === 'ring'

function resolveIcon(name: keyof typeof Lucide) {
  return (Lucide as any)[name] as any
}

const dashArray = computed(() => {
  const ring = props.items.find(isRing) as KpiRing | undefined
  if (!ring) return ''
  return `${ring.pct * 1.63} 163`
})
</script>

<template>
  <div class="kpis" :class="{ 'kpis--compact': compact }">
    <template v-for="(it, i) in items" :key="i">
      <!-- 环形 KPI -->
      <div v-if="isRing(it)" class="kpi kpi-total">
        <div class="kpi-ring">
          <svg viewBox="0 0 64 64" class="ring">
            <circle cx="32" cy="32" r="26" class="ring-bg" />
            <circle cx="32" cy="32" r="26" class="ring-fg" :style="{ strokeDasharray: dashArray }" />
          </svg>
          <div class="kpi-num">{{ it.value }}</div>
        </div>
        <div class="kpi-label">
          <span class="label">{{ it.label }}</span>
          <span v-if="it.sub" class="sub">{{ it.sub }}</span>
        </div>
      </div>
      <!-- 普通 KPI -->
      <div v-else class="kpi">
        <div class="kpi-ico" :class="it.tone || 'teal'">
          <component :is="resolveIcon(it.icon)" :size="iconSize" style="display: inline-flex; flex-shrink: 0" />
        </div>
        <div class="kpi-text">
          <b>{{ it.value }}</b>
          <span>{{ it.label }}</span>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.kpis {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 12px;
}

.kpi {
  background: var(--c-surface);
  border: 1px solid var(--c-border);
  border-radius: var(--r-xl);
  padding: 16px;
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  display: flex;
  align-items: center;
  gap: 14px;
  transition: all var(--motion);
}

.kpi:hover {
  background: var(--c-surface-hover);
  transform: translateY(-1px);
}

.kpi-total {
  grid-column: span 1;
}

.kpi-ring {
  position: relative;
  width: 64px;
  height: 64px;
  flex-shrink: 0;
}

.ring {
  width: 100%;
  height: 100%;
  transform: rotate(-90deg);
}

.ring-bg {
  fill: none;
  stroke: var(--c-border);
  stroke-width: 4;
}

.ring-fg {
  fill: none;
  stroke: var(--c-primary);
  stroke-width: 4;
  stroke-linecap: round;
  filter: drop-shadow(0 0 4px var(--c-primary-glow));
  transition: stroke-dasharray 600ms cubic-bezier(0.22, 1, 0.36, 1);
}

.kpi-num {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  font-size: var(--fs-lg);
  font-weight: 700;
}

.kpi-label {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.kpi-label .label {
  font-size: var(--fs-sm);
  color: var(--c-text-2);
}

.kpi-label .sub {
  font-size: var(--fs-xs);
  color: var(--c-text-3);
}

.kpi-ico {
  width: 44px;
  height: 44px;
  border-radius: var(--r-md);
  display: grid;
  place-items: center;
  flex-shrink: 0;
}

.kpi-ico.blue {
  background: linear-gradient(135deg, rgba(79, 140, 255, 0.2), rgba(79, 140, 255, 0.08));
  color: #4F8CFF;
}

.kpi-ico.teal {
  background: linear-gradient(135deg, rgba(52, 218, 191, 0.2), rgba(52, 218, 191, 0.08));
  color: #34DABF;
}

.kpi-ico.red {
  background: linear-gradient(135deg, rgba(255, 107, 107, 0.2), rgba(255, 107, 107, 0.08));
  color: #FF6B6B;
}

.kpi-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.kpi-text b {
  font-size: var(--fs-xl);
  font-weight: 700;
  line-height: 1;
  font-variant-numeric: tabular-nums;
}

.kpi-text span {
  font-size: var(--fs-xs);
  color: var(--c-text-2);
}

@media (max-width: 820px) {
  .kpis {
    grid-template-columns: repeat(2, 1fr);
  }
}

/* ===== 紧凑态：图标/内边距/字号整体收紧，用于表格为主的页面 ===== */
.kpis--compact {
  gap: 10px;
}

.kpis--compact .kpi {
  padding: 10px 12px;
  gap: 10px;
  border-radius: var(--r-lg);
}

.kpis--compact .kpi-ico {
  width: 34px;
  height: 34px;
  border-radius: var(--r-sm);
}

.kpis--compact .kpi-text b {
  font-size: var(--fs-lg);
}

.kpis--compact .kpi-text span {
  font-size: var(--fs-xs);
}

.kpis--compact .kpi-ring {
  width: 44px;
  height: 44px;
}

.kpis--compact .kpi-num {
  font-size: var(--fs-md);
}

.kpis--compact .ring-bg,
.kpis--compact .ring-fg {
  stroke-width: 3.5;
}
</style>
