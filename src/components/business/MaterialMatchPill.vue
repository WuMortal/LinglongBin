<script setup lang="ts">
// 匹配结果状态标签：已匹配 / 待创建 / 未匹配 三态统一呈现。
// BOM 导入与库存导入共用，保证「同一个状态长同一个样子」。
import { computed } from 'vue'
import { Check, X, Plus } from 'lucide-vue-next'

const props = defineProps<{
  /** 已绑定到库内物料 */
  hasMaterial?: boolean
  /** 有「待创建」草稿（暂存未落库） */
  hasPending?: boolean
  /** 已匹配时显示的物料名称 */
  matchedName?: string
  /** 待创建草稿名称（仅用于 hover 提示，标签本身不显示内容） */
  pendingName?: string
  /** 待创建状态的补充提示，如「入库时统一建料」 */
  pendingHint?: string
}>()
const emit = defineEmits<{
  /** 点击「未匹配」标签：打开物料来源选择（新建 / 自身库 / 立创） */
  pick: []
}>()

const state = computed<'matched' | 'pending' | 'unmatched'>(() =>
  props.hasMaterial ? 'matched' : (props.hasPending ? 'pending' : 'unmatched'))

const pendingTitle = computed(() =>
  `已加入待创建${props.pendingName ? `：${props.pendingName}` : ''}${props.pendingHint ? `，${props.pendingHint}` : ''}`)
</script>

<template>
  <span v-if="state === 'matched'" class="pill ok" :title="matchedName">
    <Check :size="12" style="display: inline-flex; flex-shrink: 0" /><span class="pill-txt">{{ matchedName }}</span>
  </span>
  <span v-else-if="state === 'pending'" class="pill pend" :title="pendingTitle">
    <Plus :size="12" style="display: inline-flex; flex-shrink: 0" /><span class="pill-txt">待创建</span>
  </span>
  <span v-else class="pill bad clickable" title="未匹配 — 点击新建或绑定物料" @click.stop="emit('pick')">
    <X :size="12" style="display: inline-flex; flex-shrink: 0" /><span class="pill-txt">未匹配</span>
  </span>
</template>

<style scoped>
.pill {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  max-width: 100%;
  padding: 3px 10px;
  border-radius: 999px;
  font-size: var(--fs-xs);
  font-weight: 600;
}

/* pill 内文本单独截断（flex 子项需 min-width:0 才能收缩） */
.pill-txt {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pill.ok {
  background: rgba(52, 218, 191, 0.12);
  color: var(--c-accent);
}

.pill.pend {
  background: rgba(83, 122, 255, 0.14);
  color: var(--c-primary);
}

.pill.bad {
  background: rgba(255, 107, 107, 0.12);
  color: var(--c-danger);
}

.pill.clickable {
  cursor: pointer;
}

.pill.clickable:hover {
  filter: brightness(1.08);
}
</style>
