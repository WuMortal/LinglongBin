<script setup lang="ts">
import { computed } from 'vue'
import { Plus, Trash2, ChevronDown, ChevronRight } from 'lucide-vue-next'
import type { CategoryParam } from '../../lib/types'

const props = defineProps<{
  modelValue: CategoryParam[]
  loading?: boolean
}>()
const emit = defineEmits<{ 'update:modelValue': [v: CategoryParam[]] }>()

const list = computed({
  get: () => props.modelValue || [],
  set: (v: CategoryParam[]) => emit('update:modelValue', v),
})

function update(idx: number, patch: Partial<CategoryParam>) {
  const next = list.value.map((it, i) => (i === idx ? { ...it, ...patch } : it))
  list.value = next
}
function updateValues(idx: number, text: string) {
  // 逗号或换行分隔
  const values = text.split(/[,\n]/).map(s => s.trim()).filter(Boolean)
  update(idx, { values })
}
function remove(idx: number) {
  list.value = list.value.filter((_, i) => i !== idx)
}
function add() {
  list.value = [...list.value, { key: '', name: '', values: [] }]
}

function valuesText(p: CategoryParam) {
  return (p.values || []).join(', ')
}
</script>

<template>
  <div class="params-editor">
    <div v-if="loading" class="loading">
      <div class="spinner-sm" />
      <span>加载参数中…</span>
    </div>

    <template v-else>
      <div v-if="!list.length" class="empty">
        <span>该分类暂无参数模板</span>
      </div>

      <div v-for="(p, i) in list" :key="i" class="param-item">
        <div class="param-head">
          <ChevronRight :size="12" class="arrow" style="display: inline-flex; flex-shrink: 0" />
          <input
            class="inp inp-name"
            :value="p.name"
            placeholder="参数名称（如 容值）"
            @input="update(i, { name: ($event.target as HTMLInputElement).value })"
          />
          <input
            class="inp inp-key"
            :value="p.key"
            placeholder="key（如 param_10951_n）"
            @input="update(i, { key: ($event.target as HTMLInputElement).value })"
          />
          <span class="cnt">{{ p.values?.length || 0 }} 项</span>
          <button class="del-btn" title="删除参数" @click="remove(i)">
            <Trash2 :size="12" style="display: inline-flex; flex-shrink: 0" />
          </button>
        </div>
        <textarea
          class="inp values-area"
          :value="valuesText(p)"
          placeholder="可选值，逗号或换行分隔，如 0.1pF, 0.2pF, 1nF"
          rows="2"
          @input="updateValues(i, ($event.target as HTMLTextAreaElement).value)"
        />
      </div>

      <button class="add-btn" @click="add">
        <Plus :size="12" style="display: inline-flex; flex-shrink: 0" />新增参数
      </button>
    </template>
  </div>
</template>

<style scoped>
.params-editor { display: flex; flex-direction: column; gap: 10px; }

.loading { display: flex; align-items: center; gap: 8px; padding: 16px; color: var(--c-text-2); font-size: var(--fs-xs); }
.spinner-sm { width: 12px; height: 12px; border: 2px solid var(--c-border); border-top-color: var(--c-primary); border-radius: 50%; animation: spin 0.6s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }

.empty { padding: 16px; text-align: center; color: var(--c-text-3); font-size: var(--fs-xs); background: var(--c-glass); border-radius: var(--r-sm); }

.param-item {
  border: 1px solid var(--c-border-hairline, var(--c-border));
  border-radius: var(--r-sm);
  padding: 8px;
  background: var(--c-surface);
  display: flex; flex-direction: column; gap: 6px;
}
.param-head { display: flex; align-items: center; gap: 6px; }
.arrow { color: var(--c-text-3); flex-shrink: 0; }
.inp {
  height: var(--ctrl-h-sm, 28px);
  padding: 0 8px;
  font-size: var(--fs-xs);
  background: var(--c-surface);
  border: 1px solid var(--c-border);
  border-radius: var(--r-sm);
  color: var(--c-text);
  transition: border-color var(--motion);
}
.inp:focus { outline: none; border-color: var(--c-primary); }
.inp-name { flex: 1; min-width: 0; }
.inp-key { flex: 1.2; min-width: 0; color: var(--c-text-2); font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11px; }
.cnt { font-size: 10px; color: var(--c-text-3); flex-shrink: 0; padding: 0 4px; }
.del-btn {
  width: 22px; height: 22px; border: none; border-radius: var(--r-sm);
  background: transparent; color: var(--c-text-3); cursor: pointer;
  display: grid; place-items: center; flex-shrink: 0;
  transition: all var(--motion);
}
.del-btn:hover { background: rgba(255,107,107,0.1); color: var(--c-danger); }

.values-area {
  width: 100%; padding: 6px 8px; font-size: var(--fs-xs);
  background: var(--c-surface); border: 1px solid var(--c-border);
  border-radius: var(--r-sm); color: var(--c-text); resize: vertical;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  line-height: 1.5;
}
.values-area:focus { outline: none; border-color: var(--c-primary); }

.add-btn {
  align-self: flex-start;
  display: inline-flex; align-items: center; gap: 4px;
  padding: 6px 10px; font-size: var(--fs-xs);
  background: var(--c-primary-soft); color: var(--c-primary);
  border: 1px dashed var(--c-primary); border-radius: var(--r-sm);
  cursor: pointer; transition: all var(--motion);
}
.add-btn:hover { background: var(--c-primary); color: #fff; }
</style>
