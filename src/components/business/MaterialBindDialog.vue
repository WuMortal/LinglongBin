<script setup lang="ts">

import { ref, computed, watch } from 'vue'
import { Database, ShoppingBag, Plus } from 'lucide-vue-next'
import type { Category, MaterialRow, MaterialDraft, MaterialFormResult } from '../../lib/types'
import type { LcscHit } from '../../lib/lcscApi'
import MaterialPickerPanel from './MaterialPickerPanel.vue'
import LcscPickerPanel from './LcscPickerPanel.vue'
import MaterialFormPanel from './MaterialFormPanel.vue'

type Picked =
  | { kind: 'material'; item: MaterialRow }
  | { kind: 'lcsc'; item: LcscHit }
  /** 直接在弹窗里新建的物料草稿（不落库，由调用方决定何时建料） */
  | { kind: 'draft'; draft: MaterialDraft }

// 注意：allowLcsc 必须给默认值 true。Vue 3 对 Boolean 类型的 prop 有 casting 规则
// （父组件未传值且无默认值时强制为 false），不设默认会导致默认场景下的立创 tab 被隐藏。
const props = withDefaults(defineProps<{
  /** 是否显示 */
  modelValue: boolean
  /** 默认搜索关键词（型号 / 立创编号等） */
  keyword?: string
  /** 底部提示：当前在为哪一行挑选 */
  desc?: string
  /** 默认打开的来源 */
  defaultKind?: 'new' | 'material' | 'lcsc'
  /** 是否允许切到「嘉立创查」。待采单关联库存等场景传 false */
  allowLcsc?: boolean
  /** 是否显示「新建物料」tab：导入类场景把新建并入本弹窗，统一一个入口 */
  allowNew?: boolean
  /** 「新建物料」tab 的表单预填（如导入行数据） */
  prefill?: Partial<MaterialDraft> | null
  /** 「新建物料」tab 的初始库存默认值 */
  initialStock?: number | null
  /** 分类数据（「新建物料」tab 需要大类 / 小类 / 参数模板） */
  categories?: Category[]
}>(), {
  allowLcsc: true,
  allowNew: false,
})

const emit = defineEmits<{
  'update:modelValue': [v: boolean]
  select: [picked: Picked]
}>()

const visible = computed({
  get: () => props.modelValue,
  set: (v: boolean) => emit('update:modelValue', v),
})

const allowLcsc = computed(() => props.allowLcsc !== false)
/** 新建 tab 需显式开启（Boolean prop 默认 false） */
const allowNew = computed(() => props.allowNew === true)
const kind = ref<'new' | 'material' | 'lcsc'>('material')

/** 「新建物料」tab 的表单面板：保存中状态由其暴露 */
const newPanel = ref<InstanceType<typeof MaterialFormPanel> | null>(null)
const saving = computed(() => newPanel.value?.saving ?? false)

/** 立创面板（footer 渲染选用按钮时引用） */
const lcscPanel = ref<InstanceType<typeof LcscPickerPanel> | null>(null)
const lcscSel = ref<LcscHit | null>(null)

function close() { visible.value = false }

function onMaterialPick(m: MaterialRow) {
  emit('select', { kind: 'material', item: m })
  close()
}

function onLcscPick(h: LcscHit) {
  emit('select', { kind: 'lcsc', item: h })
  close()
}

/** 「新建物料」tab 保存：草稿交给调用方（暂存不落库），随后关闭 */
function onDraftSaved(res: MaterialFormResult) {
  emit('select', { kind: 'draft', draft: res.draft })
  close()
}
function submitNew() { void newPanel.value?.submit() }

watch(visible, v => {
  if (!v) return
  // 打开时重置来源：显式指定优先，否则自身库
  if (props.defaultKind === 'lcsc' && allowLcsc.value) kind.value = 'lcsc'
  else if (props.defaultKind === 'new' && allowNew.value) kind.value = 'new'
  else kind.value = 'material'
})

// Esc 关闭
function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape' && visible.value) close()
}
watch(visible, v => {
  if (v) window.addEventListener('keydown', onKey)
  else window.removeEventListener('keydown', onKey)
})
</script>

<template>
  <Teleport to="body">
    <div v-if="visible" class="modal-mask" @click.self="close">
      <div class="modal bind-modal">
        <div class="modal-body bind-body">
          <aside class="tabs-col">
            <button v-if="allowNew" class="tab-item" :class="{ on: kind === 'new' }" @click="kind = 'new'">
              <Plus :size="16" style="display: inline-flex; flex-shrink: 0" />
              <span>新建物料</span>
            </button>
            <button class="tab-item" :class="{ on: kind === 'material' }" @click="kind = 'material'">
              <Database :size="16" style="display: inline-flex; flex-shrink: 0" />
              <span>物料库</span>
            </button>
            <button v-if="allowLcsc" class="tab-item" :class="{ on: kind === 'lcsc' }"
              @click="kind = 'lcsc'">
              <ShoppingBag :size="16" style="display: inline-flex; flex-shrink: 0" />
              <span>立创商城</span>
            </button>
          </aside>

          <section class="tab-content" :class="{ 'tab-form': kind === 'new' }">
            <MaterialFormPanel v-if="kind === 'new'" ref="newPanel" :categories="categories || []"
              :prefill="prefill" :initial-stock="initialStock" defer-persist @saved="onDraftSaved" />
            <MaterialPickerPanel v-else-if="kind === 'material'" :keyword="keyword"
              @pick="onMaterialPick" />
            <LcscPickerPanel v-else ref="lcscPanel" v-model:selected="lcscSel" :footer-pick="true"
              :keyword="keyword" @pick="onLcscPick" />
          </section>
        </div>

        <div class="modal-foot">
          <span v-if="desc" class="foot-hint">{{ desc }}</span>
          <button class="btn btn-ghost" @click="close">关闭</button>
          <button v-if="kind === 'lcsc'" class="btn btn-primary"
            :disabled="!lcscSel" @click="lcscPanel?.confirmPick()">选用</button>
          <button v-if="kind === 'new'" class="btn btn-primary" :disabled="saving" @click="submitNew">
            <span v-if="saving" class="spinner-sm" />{{ saving ? '保存中…' : '保存并选用' }}
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

.modal-mask .bind-modal {
  position: relative;
  max-width: 900px;
  height: min(620px, 86vh);
}

.bind-body {
  padding: 0;
  display: flex;
  flex-direction: row;
  overflow: hidden;
}

/* ===== 左侧来源 tab（与 Settings.vue 同一套样式） ===== */
.tabs-col {
  width: 150px;
  flex-shrink: 0;
  padding: 10px 8px;
  padding-left: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
  border-right: 1px solid var(--c-border-hairline);
}

.tab-item {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  height: 38px;
  padding: 0 12px;
  border-radius: var(--r-sm);
  border: 1px solid transparent;
  background: transparent;
  color: var(--c-text-2);
  font-size: var(--fs-sm);
  font-weight: 500;
  font-family: inherit;
  cursor: pointer;
  transition: background-color var(--motion-fast), color var(--motion-fast),
    border-color var(--motion-fast);
  text-align: left;
}

.tab-item:hover {
  background: var(--c-surface-hover);
  color: var(--c-text);
}

.tab-item.on {
  background: var(--c-primary-soft);
  border-color: rgba(79, 140, 255, 0.25);
  color: var(--c-primary);
  font-weight: 600;
}

/* ===== 右侧内容区 ===== */
.tab-content {
  flex: 1;
  min-width: 0;
  overflow-y: auto;
  padding: 14px 18px;
}

/* 「新建物料」tab：内嵌新增物料表单，底部给按钮留点余量 */
.tab-form {
  padding: 14px 18px 18px;
}

.foot-hint {
  margin-right: auto;
  font-size: var(--fs-xs);
  color: var(--c-text-3);
}
</style>