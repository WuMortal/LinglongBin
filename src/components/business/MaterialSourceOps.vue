<script setup lang="ts">
// 行内物料操作按钮组：编辑草稿 / 选择·改选 / 撤销。
// BOM 导入与库存导入共用；BOM 的「切替代料」等独有按钮通过 pre 插槽前置。
import { computed } from 'vue'
import { MousePointer2, Pencil } from 'lucide-vue-next'

const props = defineProps<{
  /** 已绑定到库内物料 */
  hasMaterial?: boolean
  /** 有「待创建」草稿 */
  hasPending?: boolean
  /** 立创查询中：选择按钮进入 loading */
  busy?: boolean
}>()
const emit = defineEmits<{
  /** 编辑「待创建」草稿 */
  edit: []
  /** 打开物料来源选择（新建 / 自身库 / 立创） */
  pick: []
  /** 撤销决定，回到未匹配 */
  undo: []
}>()

/** 已做过决定（已绑定或已有草稿）*/
const decided = computed(() => !!props.hasMaterial || !!props.hasPending)
</script>

<template>
  <div class="mso">
    <slot name="pre" />
    <button v-if="hasPending" type="button" class="btn btn-ghost mso-btn" title="编辑待创建物料"
      @click.stop="emit('edit')">
      <Pencil :size="12" style="display: inline-flex; flex-shrink: 0" />编辑
    </button>
    <button type="button" class="btn btn-ghost mso-btn" :disabled="busy"
      :title="decided ? '改选物料（新建 / 自身库 / 立创）' : '选择物料（新建 / 自身库 / 立创）'"
      @click.stop="emit('pick')">
      <template v-if="busy"><span class="spinner-xs" />查询中</template>
      <template v-else>
        <MousePointer2 :size="12" style="display: inline-flex; flex-shrink: 0" />{{ decided ? '改选' : '选择' }}
      </template>
    </button>
    <!-- 撤销按钮（临时注释）：库存导入与 BOM 导入结果共用
    <button v-if="decided" type="button" class="btn btn-ghost mso-btn" title="撤销（回到未匹配）"
      @click.stop="emit('undo')">
      <Undo2 :size="12" style="display: inline-flex; flex-shrink: 0" />撤销
    </button>
    -->
  </div>
</template>

<style scoped>
.mso {
  display: flex;
  align-items: center;
  gap: 4px;
}

/* 行内按钮统一小尺寸（原来散落在两个页面的 .bind-btn） */
.mso-btn {
  height: 24px;
  padding: 0 8px;
  font-size: var(--fs-xs);
  gap: 4px;
}

.spinner-xs {
  width: 11px;
  height: 11px;
  border: 2px solid var(--c-border);
  border-top-color: var(--c-primary);
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
