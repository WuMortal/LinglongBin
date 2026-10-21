<script setup lang="ts">
// 移动端新增 / 编辑物料弹层：BottomSheet 外壳 + 复用桌面表单主体 MaterialFormPanel。
// 与桌面 MaterialFormDialog 一一对应（同样的 props / 行为），只是外壳换成移动端底部弹层，
// 避免移动端仍弹出桌面居中弹窗。
import { ref, computed } from 'vue'
import type { Category, MaterialRow, MaterialDraft, MaterialFormResult } from '../../lib/types'
import type { LcscComponent } from '../../lib/lcscApi'
import BottomSheet from './BottomSheet.vue'
import MaterialFormPanel from '../business/MaterialFormPanel.vue'

const props = defineProps<{
  modelValue: boolean
  categories: Category[]
  /** 传入则为编辑模式 */
  material?: MaterialRow | null
  /** 立创数据：传入则以立创信息预填表单（新增模式） */
  lcsc?: LcscComponent | null
  /** 立创搜索结果的价格（详情接口本身不返回价格，由调用方从搜索结果带入） */
  lcscPrice?: number | null
  /** 暂存模式：不落库，仅把表单数据 emit 出去（BOM / 库存导入场景点保存时统一入库） */
  deferPersist?: boolean
  /** 普通预填（非编辑 / 非立创）：用传入的草稿字段预填表单，保存仍为新增 */
  prefill?: Partial<MaterialDraft> | null
  /** 新增（含立创预填）时「初始库存」的默认值，缺省为 0 */
  initialStock?: number | null
  /** 自定义标题（如「编辑待创建物料」），缺省按模式自动生成 */
  title?: string
  /** 二级弹层：叠在另一个 sheet 之上（z-index 140） */
  top?: boolean
}>()
const emit = defineEmits<{
  'update:modelValue': [v: boolean]
  /** 保存结果：暂存模式下 material 为 null */
  saved: [result: MaterialFormResult]
}>()

const visible = computed({
  get: () => props.modelValue,
  set: (v: boolean) => emit('update:modelValue', v),
})

const panel = ref<InstanceType<typeof MaterialFormPanel> | null>(null)
/** 保存中状态来自面板（defineExpose 的 ref 取值即为布尔） */
const saving = computed(() => panel.value?.saving ?? false)

const sheetTitle = computed(() =>
  props.title || (props.material ? '编辑物料' : (props.lcsc ? '新增物料（来自立创）' : '添加物料')))

function close() { visible.value = false }
function submit() { void panel.value?.submit() }
/** 面板保存成功（已落库或产出草稿）后统一关闭弹层 */
function onSaved(res: MaterialFormResult) {
  emit('saved', res)
  close()
}
</script>

<template>
  <BottomSheet :open="visible" tall :top="top" :title="sheetTitle" @close="close">
    <!-- v-if 挂载：每次打开都是一份全新表单，打开前切换 prefill / lcsc 也能正确预填 -->
    <MaterialFormPanel
      v-if="visible"
      ref="panel"
      :categories="categories"
      :material="material"
      :lcsc="lcsc"
      :lcsc-price="lcscPrice"
      :defer-persist="deferPersist"
      :prefill="prefill"
      :initial-stock="initialStock"
      @saved="onSaved"
    />
    <template #foot>
      <button type="button" class="btn-cancel" :disabled="saving" @click="close">取消</button>
      <button type="button" class="btn-save" :disabled="saving" @click="submit">
        <span v-if="saving" class="spinner-sm" />{{ saving ? '保存中…' : '保存' }}
      </button>
    </template>
  </BottomSheet>
</template>

<style scoped>
/* 底部操作区按钮：与 QuickStockSheet 的「取消 + 确认」同一套观感 */
.btn-cancel {
  flex: 1;
  height: 46px;
  padding: 0 18px;
  border: 1px solid var(--c-border);
  border-radius: var(--r-lg);
  background: var(--c-bg-2);
  color: var(--c-text-2);
  font-family: inherit;
  font-size: var(--fs-md);
  font-weight: 600;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}
.btn-cancel:active { background: var(--c-surface-hover); color: var(--c-text); }
.btn-cancel:disabled { opacity: 0.35; cursor: not-allowed; }

.btn-save {
  flex: 2;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  height: 46px;
  padding: 0 18px;
  border: none;
  border-radius: var(--r-lg);
  background: var(--c-primary);
  color: #fff;
  font-family: inherit;
  font-size: var(--fs-md);
  font-weight: 700;
  cursor: pointer;
  transition: transform 120ms ease-out, opacity var(--motion-fast);
  -webkit-tap-highlight-color: transparent;
}
.btn-save:active:not(:disabled) { transform: scale(0.98); opacity: 0.9; }
.btn-save:disabled { opacity: 0.55; cursor: not-allowed; }
</style>
