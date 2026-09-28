<script setup lang="ts">
// 新增 / 编辑物料弹窗：只负责弹窗外壳（标题 / 取消 / 保存），
// 表单主体统一复用 MaterialFormPanel（绑定弹窗的「新建物料」tab 用的是同一个面板）。
import { ref, computed } from 'vue'
import type { Category, MaterialRow, MaterialDraft, MaterialFormResult } from '../../lib/types'
import type { LcscComponent } from '../../lib/lcscApi'
import MaterialFormPanel from './MaterialFormPanel.vue'

const props = defineProps<{
  modelValue: boolean
  categories: Category[]
  /** 传入则为编辑模式 */
  material?: MaterialRow | null
  /** 立创数据：传入则以立创信息预填表单（新增模式） */
  lcsc?: LcscComponent | null
  /** 立创搜索结果的价格（详情接口本身不返回价格，由调用方从搜索结果带入） */
  lcscPrice?: number | null
  /** 暂存模式：不落库，仅把表单数据 emit 出去（BOM / 库存导入场景，点保存时统一入库） */
  deferPersist?: boolean
  /** 普通预填（非编辑 / 非立创）：用传入的物料草稿字段预填表单（如库存导入行数据 / 待创建草稿） */
  prefill?: Partial<MaterialDraft> | null
  /** 新增（含立创预填）时「初始库存」的默认值：传入则预填（如库存导入把订单数量作为初始库存），缺省为 0 */
  initialStock?: number | null
  /** 自定义标题（如「编辑待创建物料」），缺省按模式自动生成 */
  title?: string
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

const title = computed(() =>
  props.title || (props.material ? '编辑物料' : (props.lcsc ? '新增物料（来自立创）' : '添加物料')))

function close() { visible.value = false }
function submit() { void panel.value?.submit() }
/** 面板保存成功（已落库或产出草稿）后统一关闭弹窗 */
function onSaved(res: MaterialFormResult) {
  emit('saved', res)
  close()
}
</script>

<template>
  <Teleport to="body">
    <div v-if="visible" class="modal-mask">
      <div class="modal" style="max-width: 640px">
        <div class="modal-head">
          <h3>{{ title }}</h3>
        </div>
        <div class="modal-body">
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
        </div>
        <div class="modal-foot">
          <button class="btn btn-ghost" @click="close">取消</button>
          <button class="btn btn-primary" :disabled="saving" @click="submit">
            <span v-if="saving" class="spinner-sm" />{{ saving ? '保存中…' : '保存' }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
/* 从抽屉中打开时也需浮在抽屉之上（抽屉 z-index 120） */
.modal-mask {
  z-index: 200;
}
</style>
