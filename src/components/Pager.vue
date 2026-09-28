<template>
  <div class="pager">
    <span class="pg-total">共 {{ total }} 条</span>
    <div class="pg-ctrl">
      <button class="pg-btn" :disabled="page <= 1" title="上一页" @click="go(page - 1)">‹</button>
      <button
        v-for="p in pages" :key="String(p)"
        class="pg-num" :class="{ active: p === page, gap: p === '…' }"
        :disabled="p === '…'"
        @click="p !== '…' && go(p as number)"
      >{{ p }}</button>
      <button class="pg-btn" :disabled="page >= pageCount" title="下一页" @click="go(page + 1)">›</button>
    </div>
    <div class="pg-size">
      <select :value="pageSize" title="每页条数" @change="onSize(($event.target as HTMLSelectElement).value)">
        <option v-for="s in sizeOptions" :key="s" :value="s">{{ s }} 条/页</option>
      </select>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

const props = withDefaults(defineProps<{
  page: number
  pageSize: number
  total: number
  sizeOptions?: number[]
}>(), {
  sizeOptions: () => [10, 20, 50, 100],
})

const emit = defineEmits<{
  (e: 'change', page: number): void
  (e: 'update:pageSize', size: number): void
}>()

const pageCount = computed(() => Math.max(1, Math.ceil(props.total / props.pageSize)))

/** 计算要展示的页码：首/尾 + 当前页 ±1，过长用省略号 */
const pages = computed<Array<number | '…'>>(() => {
  const cnt = pageCount.value
  const cur = props.page
  if (cnt <= 7) return Array.from({ length: cnt }, (_, i) => i + 1)
  const set = new Set<number>([1, cnt, cur, cur - 1, cur + 1])
  const arr = [...set].filter(p => p >= 1 && p <= cnt).sort((a, b) => a - b)
  const out: Array<number | '…'> = []
  let prev = 0
  for (const p of arr) {
    if (p - prev > 1) out.push('…')
    out.push(p)
    prev = p
  }
  return out
})

function go(p: number) {
  const target = Math.min(Math.max(1, p), pageCount.value)
  if (target !== props.page) emit('change', target)
}

function onSize(v: string) {
  const size = Number(v)
  if (size !== props.pageSize) emit('update:pageSize', size)
}
</script>

<style scoped>
.pager {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  padding: 10px 16px;
  border-top: 1px solid var(--c-border-hairline);
  background: var(--c-glass);
  flex-shrink: 0;
}

.pg-total {
  font-size: var(--fs-xs);
  color: var(--c-text-2);
  white-space: nowrap;
}

.pg-ctrl {
  display: flex;
  align-items: center;
  gap: 4px;
}

.pg-btn,
.pg-num {
  min-width: 30px;
  height: 30px;
  padding: 0 6px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: var(--fs-xs);
  color: var(--c-text);
  background: var(--c-surface);
  border: 1px solid var(--c-border);
  border-radius: var(--r-sm);
  cursor: pointer;
  transition: all var(--motion-fast);
}

.pg-btn:hover:not(:disabled),
.pg-num:hover:not(:disabled):not(.gap) {
  border-color: var(--c-primary);
  color: var(--c-primary);
}

.pg-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.pg-num.active {
  border-color: var(--c-primary);
  background: var(--c-primary-soft);
  color: var(--c-primary);
  font-weight: 600;
}

.pg-num.gap {
  border: none;
  background: transparent;
  cursor: default;
  min-width: 16px;
}

.pg-size select {
  height: 30px;
  padding: 0 6px;
  font-size: var(--fs-xs);
  color: var(--c-text);
  background: var(--c-surface);
  border: 1px solid var(--c-border);
  border-radius: var(--r-sm);
  cursor: pointer;
}
</style>
