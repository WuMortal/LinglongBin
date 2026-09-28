<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Search } from 'lucide-vue-next'
import type { MaterialRow } from '../../lib/types'
import { materialSpecLine } from '../../lib/paramFields'

/**
 * 分类物料选择弹框：列出某分类（含子分类）下的物料，可搜索、逐项勾选 / 全选 / 清空。
 *
 * 与分类树上复选框的分工：复选框 = 整类全选 / 取消；点分类名 = 打开本弹框按物料挑。
 * 组件不关心分类树结构，分类下的「大类 + 小类 id」由父级算好后传进来。
 */
const props = defineProps<{
  /** 弹框标题用：当前分类名 */
  catName: string
  /** 当前分类及其子分类的 id */
  catIds: string[]
  /** 全量物料；组件按 catIds 过滤 */
  materials: MaterialRow[]
  /** 已选物料 id */
  selectedIds: string[]
  /** 分类 id → 「大类 · 小类」展示名；不传则不显示分类标签 */
  catLabels?: Record<string, string>
}>()
const emit = defineEmits<{
  (e: 'close'): void
  (e: 'update:selectedIds', ids: string[]): void
}>()

const kw = ref('')

/** 当前分类（含子分类）下的物料，可按关键词过滤 */
const list = computed(() => {
  const ids = new Set(props.catIds)
  const q = kw.value.trim().toLowerCase()
  return props.materials.filter(m => {
    if (!ids.has(m.category_id ?? '')) return false
    if (!q) return true
    return `${m.name} ${m.model ?? ''} ${m.brand ?? ''} ${m.package ?? ''}`.toLowerCase().includes(q)
  })
})
const pickedCount = computed(() => list.value.filter(m => props.selectedIds.includes(m.id)).length)

function isPicked(id: string): boolean { return props.selectedIds.includes(id) }

function toggle(id: string, on: boolean) {
  const s = new Set(props.selectedIds)
  if (on) s.add(id)
  else s.delete(id)
  emit('update:selectedIds', [...s])
}

/** 「全选 / 清空」只作用于当前筛选出来的物料 */
function pickAll(on: boolean) {
  const s = new Set(props.selectedIds)
  for (const m of list.value) {
    if (on) s.add(m.id)
    else s.delete(m.id)
  }
  emit('update:selectedIds', [...s])
}

/** 副行（小字）：品牌 + 前 3 个扩展字段，与「已选物料」列表共用同一套文案 */
function sub(m: MaterialRow): string { return materialSpecLine(m) }

/** 换分类时清空搜索词 */
watch(() => props.catName, () => { kw.value = '' })
</script>

<template>
  <Teleport to="body">
    <div class="modal-mask" @click.self="emit('close')">
      <div class="modal pick-modal">
        <div class="modal-head">
          <span>{{ catName }} · 选择物料</span>
          <button class="modal-x" @click="emit('close')">×</button>
        </div>

        <div class="modal-body">
          <div class="inp-wrap">
            <Search :size="13" class="inp-ico" style="display: inline-flex" />
            <input v-model="kw" placeholder="搜索名称 / 型号 / 品牌 / 封装…" />
          </div>

          <ul class="cand">
            <li v-for="m in list" :key="m.id" :class="{ on: isPicked(m.id) }"
              @click="toggle(m.id, !isPicked(m.id))">
              <!-- 纯展示勾选态，点击由整行接管，避免双重切换 -->
              <input class="pick-check" type="checkbox" :checked="isPicked(m.id)" tabindex="-1" />
              <div class="cand-info">
                <div class="cand-line1">
                  <strong>{{ m.name }}</strong>
                  <span v-if="m.model" class="cand-model">{{ m.model }}</span>
                </div>
                <small>{{ sub(m) }}</small>
              </div>
              <span v-if="catLabels?.[m.category_id ?? '']" class="cand-cat">{{ catLabels[m.category_id ?? '']
                }}</span>
            </li>
            <li v-if="!list.length" class="no">无匹配物料</li>
          </ul>
        </div>

        <div class="modal-foot">
          <span class="foot-hint">已选 {{ pickedCount }} / {{ list.length }}</span>
          <button class="btn btn-ghost btn-sm" @click="pickAll(false)">清空</button>
          <button class="btn btn-ghost btn-sm" @click="pickAll(true)">全选</button>
          <button class="btn btn-primary  btn-sm" @click="emit('close')">完成</button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
/* 用 .modal-mask .pick-modal（0,3,0）压过全局 .modal-mask .modal（0,2,0），宽度才改得动 */
.modal-mask .pick-modal {
  max-width: 620px;
  height: min(560px, 82vh);
}

.modal-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.modal-x {
  border: none;
  background: transparent;
  font-size: 18px;
  line-height: 1;
  color: var(--c-text-3);
  cursor: pointer;
}

.pick-modal .modal-body {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

/* ===== 搜索框 ===== */
.inp-wrap {
  position: relative;
  display: flex;
  flex: 0 0 auto;
}

.inp-wrap input {
  width: 100%;
  height: var(--ctrl-h-sm);
  padding: 0 10px 0 28px;
  font-size: var(--fs-xs);
  background: var(--c-surface);
  border: 1px solid var(--c-border);
  border-radius: var(--r-sm);
}

.inp-wrap input:focus {
  border-color: var(--c-primary);
  background: var(--c-surface-hover);
}

.inp-ico {
  position: absolute;
  left: 8px;
  top: 50%;
  transform: translateY(-50%);
  color: var(--c-text-3);
  pointer-events: none;
}

/* ===== 物料卡片（参考物料库 .cand） ===== */
.cand {
  list-style: none;
  margin: 0;
  padding: 0;
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.cand li {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  border: 1px solid var(--c-border-hairline);
  border-radius: var(--r-md);
  background: var(--c-glass);
  cursor: pointer;
  transition: border-color var(--motion-fast), background var(--motion-fast);
}

.cand li:hover {
  background: var(--c-surface-hover);
}

.cand li.on {
  border-color: var(--c-primary);
  background: var(--c-primary-soft);
}

.pick-check {
  width: 14px;
  height: 14px;
  flex-shrink: 0;
  accent-color: var(--c-primary);
  pointer-events: none;
}

.cand-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.cand-line1 {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.cand-line1 strong {
  font-size: var(--fs-md);
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 型号是电子元件的关键标识，单独高亮（等宽字体，便于核对） */
.cand-model {
  flex-shrink: 0;
  font-family: var(--font-mono);
  font-size: var(--fs-xs);
  color: var(--c-primary);
  background: var(--c-primary-soft);
  padding: 1px 6px;
  border-radius: var(--r-sm);
}

.cand-info small {
  font-size: var(--fs-xs);
  color: var(--c-text-3);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 分类标签：「大类 · 小类」 */
.cand-cat {
  flex-shrink: 0;
  font-size: var(--fs-xs);
  color: var(--c-text-2);
  background: var(--c-surface);
  border: 1px solid var(--c-border);
  padding: 2px 8px;
  border-radius: var(--r-pill);
  white-space: nowrap;
}

.cand .no {
  justify-content: center;
  color: var(--c-text-3);
  font-size: var(--fs-sm);
  cursor: default;
  background: transparent;
  border-style: dashed;
}

.foot-hint {
  margin-right: auto;
  font-size: var(--fs-xs);
  color: var(--c-text-3);
}
</style>
