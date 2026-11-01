<template>
  <div class="fl-paper calib" :style="paperStyle">
    <!-- 上下左右标尺：小格 1mm，大格 10mm -->
    <div class="cb-rh"></div>
    <div class="cb-rv"></div>
    <div v-for="x in ticksX" :key="'h' + x" class="cb-tick h" :style="{ left: `${x}mm` }">{{ x }}</div>
    <div v-for="y in ticksY" :key="'v' + y" class="cb-tick v" :style="{ top: `${y}mm` }">{{ y }}</div>

    <!-- 100mm 基准条：打印后实测长度 L，比例校正 = 100 ÷ L -->
    <div class="cb-bar" :style="{ left: '20mm', top: `${h - 40}mm`, width: '100mm' }"></div>
    <div class="cb-note" :style="{ left: '20mm', top: `${h - 46}mm` }">
      黑色基准条 = 100.00mm；实测 L，比例校正 = 100 ÷ L
    </div>

    <!-- 纸张几何中心十字 -->
    <div class="cb-cross" :style="{ left: `${w / 2 - 10}mm`, top: `${h / 2}mm`, width: '20mm', height: '0.3mm' }"></div>
    <div class="cb-cross" :style="{ left: `${w / 2}mm`, top: `${h / 2 - 10}mm`, width: '0.3mm', height: '20mm' }"></div>
    <div class="cb-note" :style="{ left: `${w / 2 + 3}mm`, top: `${h / 2 + 2}mm` }">
      十字＝纸张几何中心 ({{ w }}, {{ h }})
    </div>

    <!-- 标签区虚线框：与实际打印位置对比，偏移量填到「偏移 X / Y」 -->
    <div class="cb-frame" :style="frameStyle"></div>
    <div class="cb-note" :style="{ left: '14mm', top: '14mm' }">
      标尺：小格 1mm，大格 10mm；红虚线框＝标签区外框 {{ usedW }}×{{ usedH }}mm（含留白 {{ layout.pad }}mm）。
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { FreeLabelLayout } from '../../lib/types'
import { paperSize, usedSize } from '../../lib/freeLabel'

/**
 * 校准页：与正式内容一起打印，用来量出打印机的走纸偏差与缩放误差。
 * 用法：打印后量 100mm 基准条 → 填「比例校正」；量红框与实际标签的位置差 → 填「偏移 X / Y」。
 */
const props = defineProps<{ layout: FreeLabelLayout }>()

const size = computed(() => paperSize(props.layout))
const w = computed(() => Math.round(size.value[0]))
const h = computed(() => Math.round(size.value[1]))

const used = computed(() => usedSize(props.layout))
const usedW = computed(() => Math.round(used.value.w * 10) / 10)
const usedH = computed(() => Math.round(used.value.h * 10) / 10)

const paperStyle = computed(() => ({ width: `${size.value[0]}mm`, height: `${size.value[1]}mm` }))

const ticksX = computed(() => range(w.value))
const ticksY = computed(() => range(h.value))

/** 与标签网格同位置（居中 + 偏移 + 比例校正），比对的才是真正的打印位置 */
const frameStyle = computed(() => {
  const L = props.layout
  return {
    left: `${(size.value[0] - used.value.w) / 2 + L.off_x}mm`,
    top: `${(size.value[1] - used.value.h) / 2 + L.off_y}mm`,
    width: `${used.value.w}mm`,
    height: `${used.value.h}mm`,
    transform: `scale(${L.scale_fix || 1})`,
    transformOrigin: 'center',
  }
})

function range(max: number): number[] {
  const out: number[] = []
  for (let i = 0; i <= max; i += 10) out.push(i)
  return out
}
</script>

<style>
.calib .cb-rh {
  position: absolute;
  left: 0;
  top: 0;
  width: 100%;
  height: 12mm;
  background-image:
    repeating-linear-gradient(to right, #000 0 0.12mm, transparent 0.12mm 1mm),
    repeating-linear-gradient(to right, #000 0 0.25mm, transparent 0.25mm 10mm);
  background-size: 100% 4mm, 100% 11mm;
  background-repeat: no-repeat, no-repeat;
}

.calib .cb-rv {
  position: absolute;
  left: 0;
  top: 0;
  width: 12mm;
  height: 100%;
  background-image:
    repeating-linear-gradient(to bottom, #000 0 0.12mm, transparent 0.12mm 1mm),
    repeating-linear-gradient(to bottom, #000 0 0.25mm, transparent 0.25mm 10mm);
  background-size: 4mm 100%, 11mm 100%;
  background-repeat: no-repeat, no-repeat;
}

.calib .cb-tick {
  position: absolute;
  font-size: 6pt;
  color: #333;
}

.calib .cb-tick.h {
  width: 12mm;
  text-align: center;
  transform: translateX(-6mm);
  top: 12mm;
}

.calib .cb-tick.v {
  left: 12mm;
  transform: translateY(-3pt);
  text-align: left;
}

.calib .cb-bar {
  position: absolute;
  height: 3mm;
  background: #000;
}

.calib .cb-note {
  position: absolute;
  font-size: 8pt;
  color: #333;
  line-height: 1.6;
}

.calib .cb-cross {
  position: absolute;
  background: #e74c3c;
}

.calib .cb-frame {
  position: absolute;
  border: 1px dashed #e74c3c;
}
</style>
