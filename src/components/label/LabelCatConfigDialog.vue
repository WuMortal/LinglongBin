<template>
  <div v-if="open" class="modal-mask" @click.self="$emit('close')">
    <div class="modal">
      <div class="modal-head">
        <span>{{ isEdit ? '配置分类标签' : '新增分类配置' }}</span>
        <button class="modal-x" @click="$emit('close')">×</button>
      </div>
      <div class="modal-body">
        <div class="sort-row">
          <div class="f">
            <AppSelect v-model="local.category_id" :options="categoryOptions" searchable :width="100"
              search-placeholder="搜索分类" placeholder="选择分类（不选 = 默认）" />
          </div>
          <div class="f">
            <AppSelect v-model="local.sort_mode" :options="sortModeOptions" :width="100" />
          </div>
          <div class="f" v-if="local.sort_mode === 'field'">
            <AppSelect v-model="local.sort_field" :options="sortFieldOptions" searchable :width="85"
              search-placeholder="搜索字段" placeholder="选择字段" />
          </div>
          <div class="f" v-if="local.sort_mode === 'field'">
            <AppSelect v-model="local.sort_dir" :options="sortDirOptions" :width="80" />
          </div>
        </div>
        <p v-if="!local.category_id" class="dlg-tip">
          未选择分类：作为<b>默认格式</b>，用于未匹配到任何分类配置的物料
        </p>
        <LabelBlockEditor v-model:blocks="local.blocks" :rows="rows" :cols="cols" :width-mm="widthMm"
          :height-mm="heightMm" :default-font-pt="defaultFontPt" :category-id="local.category_id" />
      </div>
      <div class="modal-foot">
        <button class="btn" @click="$emit('close')">取消</button>
        <button class="btn primary" @click="onSave">保存</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import AppSelect from '../form/AppSelect.vue'
import LabelBlockEditor from './LabelBlockEditor.vue'
import { getCategoryParams } from '../../lib/db'
import { DEFAULT_LABEL_BLOCKS } from '../../lib/labelDefaults'

import type { CategoryParam, LabelCatConfig } from '../../lib/types'

const props = defineProps<{
  open: boolean
  /** 当前编辑的分类配置（新增时为空白模板） */
  cat: LabelCatConfig
  categoryOptions: Array<{ value: unknown; label: string; group?: string }>
  /** 模板统一尺寸与栅格（弹框内画布用，不随分类变） */
  rows: number
  cols: number
  widthMm: number
  heightMm: number
  defaultFontPt: number
}>()
const emit = defineEmits<{ (e: 'close'): void; (e: 'save', cat: LabelCatConfig): void }>()

const isEdit = computed(() => !!props.cat?.category_id)

function blank(): LabelCatConfig {
  return { category_id: '', blocks: DEFAULT_LABEL_BLOCKS(), sort_mode: 'cat', sort_field: null, sort_dir: 'asc' }
}

/** 弹框内的可编辑副本，关闭/打开时从外部 cat 重新初始化 */
const local = ref<LabelCatConfig>(blank())
watch(() => [props.open, props.cat] as const, () => {
  if (props.open) local.value = JSON.parse(JSON.stringify(props.cat ?? blank()))
}, { immediate: true, deep: true })

/** 排序字段：取该分类自己的参数字段（各分类字段不同，故按分类分别取） */
const params = ref<CategoryParam[]>([])
watch(() => local.value.category_id, async (id) => {
  params.value = []
  if (!id) return
  try { params.value = await getCategoryParams(id) } catch { /* 静默 */ }
}, { immediate: true })
const sortFieldOptions = computed(() =>
  params.value.map(p => ({ value: p.key as unknown, label: p.name || p.key })))

const sortModeOptions = [
  { value: 'cat', label: '分类序号' },
  { value: 'field', label: '指定扩展字段' },
]
const sortDirOptions = [
  { value: 'asc', label: '升序' },
  { value: 'desc', label: '降序' },
]

function onSave() {
  // 分类可以留空 = 默认格式（未匹配分类的物料用它）；是否已有默认配置由父组件校验
  emit('save', JSON.parse(JSON.stringify(local.value)))
}
</script>

<style scoped>
.modal-mask {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, .35);
  z-index: 100;
  display: flex;
  align-items: center;
  justify-content: center;
}


.modal-mask .modal {
  display: flex;
  flex-direction: column;
  width: min(580px, 96vw);
  max-width: none;
  max-height: 90vh;
  overflow: hidden;
}

.modal-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid #eee;
  font-size: 15px;
  font-weight: 600;
}

.modal-x {
  border: none;
  background: transparent;
  font-size: 18px;
  cursor: pointer;
  color: #888;
}

.modal-body {
  padding: 16px 18px;
  overflow: auto;
}

.dlg-tip {
  margin: 0 0 12px;
  font-size: var(--fs-xs);
  color: var(--c-text-2);
}

/* 分类 / 排序方式 / 排序字段 / 方向 强制单行并排，字段各占自身宽度 */
.sort-row {
  display: flex;
  flex-wrap: nowrap;
  align-items: flex-end;
  gap: 10px 16px;
  margin-bottom: 16px;
}

.sort-row .f {
  flex: 0 0 auto;
  min-width: 0;
}

.modal-foot {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  padding: 12px 16px;
  border-top: 1px solid #eee;
}

.btn.primary {
  background: #2d6cdf;
  color: #fff;
  border-color: #2d6cdf;
}
</style>
