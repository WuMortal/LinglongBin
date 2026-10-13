<script setup lang="ts">
// 通用分类树（大类 → 小类）：首页筛选与标签打印共用
//
// 两种用法：
//   单选（首页）：传 selectedId，点分类名 → emit pick，用于筛选
//   多选（标签打印）：checkable + isChecked / isIndeterminate，复选框 → emit check
//
// 数量徽标：counts 传「分类 id → 该分类自身物料数」，大类会自动累加其子级
import { computed, ref, watch } from 'vue'
import { ChevronRight, ChevronsUpDown, ChevronsDownUp, Search } from 'lucide-vue-next'
import type { CategoryNode } from '../../lib/db'

const props = withDefaults(defineProps<{
  /** 分类树（一级节点） */
  nodes: CategoryNode[]
  /** 分类 id → 物料数量（自身，不含子级）；不传则不显示徽标 */
  counts?: Record<string, number> | null
  /** 单选模式：高亮的分类 id */
  selectedId?: string | null
  /** 多选模式：显示复选框 */
  checkable?: boolean
  /** 多选模式：该节点是否已全选（由父级按其选中集合判定） */
  isChecked?: (node: CategoryNode) => boolean
  /** 多选模式：该节点是否部分选中 */
  isIndeterminate?: (node: CategoryNode) => boolean
  /** 是否渲染内置搜索框 + 全部展开 / 折叠按钮 */
  searchable?: boolean
  /** 初始是否全部展开（默认全部折叠） */
  defaultExpandAll?: boolean
  /** 分类名 title 文案 */
  nameTitle?: (node: CategoryNode) => string
}>(), {
  counts: null,
  selectedId: null,
  checkable: false,
  searchable: false,
  defaultExpandAll: false,
})

const emit = defineEmits<{
  /** 点分类名 */
  pick: [node: CategoryNode]
  /** 勾选 / 取消整类（多选模式） */
  check: [node: CategoryNode, on: boolean]
}>()

const search = ref('')
/** 折叠的大类 id；分类是异步加载的，树到位后再初始化折叠集合 */
const collapsed = ref<Set<string>>(new Set())

watch(() => props.nodes, (ns) => {
  collapsed.value = new Set(
    props.defaultExpandAll ? [] : ns.filter(n => n.children.length).map(n => n.cat.id),
  )
}, { immediate: true })

/** 按关键词过滤：命中大类保留整棵，命中小类只保留匹配子项 */
const filtered = computed<CategoryNode[]>(() => {
  const q = search.value.trim().toLowerCase()
  if (!q) return props.nodes
  return props.nodes
    .map(n => n.cat.name.toLowerCase().includes(q)
      ? n
      : { ...n, children: n.children.filter(c => c.cat.name.toLowerCase().includes(q)) })
    .filter(n => n.children.length || n.cat.name.toLowerCase().includes(q))
})

/** 搜索时强制展开，否则命中的小类会被折叠住看不见 */
function isOpen(id: string): boolean {
  if (search.value.trim()) return true
  return !collapsed.value.has(id)
}
function toggleNode(id: string) {
  const s = new Set(collapsed.value)
  if (s.has(id)) s.delete(id)
  else s.add(id)
  collapsed.value = s
}
function expandAll() { collapsed.value = new Set() }
function collapseAll() {
  // 搜索时 isOpen 强制展开，不清空搜索词「全部折叠」看不出效果
  search.value = ''
  collapsed.value = new Set(props.nodes.filter(n => n.children.length).map(n => n.cat.id))
}

/** 该分类（含子级）的物料数量 */
function countOf(node: CategoryNode): number {
  if (!props.counts) return 0
  let n = props.counts[node.cat.id] ?? 0
  for (const c of node.children) n += props.counts[c.cat.id] ?? 0
  return n
}

function titleOf(node: CategoryNode): string {
  return props.nameTitle ? props.nameTitle(node) : `只看「${node.cat.name}」`
}

function onCheck(node: CategoryNode, e: Event) {
  emit('check', node, (e.target as HTMLInputElement).checked)
}

/** 点分类名：大类顺带展开，方便接着挑小类 */
function onPick(node: CategoryNode) {
  if (node.children.length) {
    const s = new Set(collapsed.value)
    s.delete(node.cat.id)
    collapsed.value = s
  }
  emit('pick', node)
}

defineExpose({ expandAll, collapseAll })
</script>

<template>
  <div class="ctree">
    <!-- 搜索 + 展开 / 折叠 -->
    <div v-if="searchable" class="ct-search">
      <span class="ct-inp">
        <Search :size="13" class="ct-ico" style="display: inline-flex" />
        <input v-model="search" placeholder="搜索分类…" />
      </span>
      <button class="ct-btn" title="全部展开" @click="expandAll">
        <ChevronsUpDown :size="13" style="display: inline-flex; flex-shrink: 0" />
      </button>
      <button class="ct-btn" title="全部折叠" @click="collapseAll">
        <ChevronsDownUp :size="13" style="display: inline-flex; flex-shrink: 0" />
      </button>
    </div>

    <div class="ct-body">
      <!-- 顶部附加行（如首页的「全部」） -->
      <slot name="top" />
      <div v-for="node in filtered" :key="node.cat.id" class="tn">
        <div class="tn-row" :class="{ on: selectedId === node.cat.id }">
          <button v-if="node.children.length" class="tn-caret" :title="isOpen(node.cat.id) ? '折叠' : '展开'"
            @click="toggleNode(node.cat.id)">
            <ChevronRight :size="12" class="caret" :class="{ open: isOpen(node.cat.id) }" style="display: inline-flex" />
          </button>
          <span v-else class="tn-caret tn-caret--empty"></span>
          <input v-if="checkable" class="tn-check" type="checkbox" :checked="isChecked?.(node) ?? false"
            :indeterminate="isIndeterminate?.(node) ?? false" title="全选 / 取消该分类" @change="onCheck(node, $event)" />
          <button class="tn-name" :title="titleOf(node)" @click="onPick(node)">{{ node.cat.name }}</button>
          <span v-if="counts" class="tn-count" :class="{ zero: countOf(node) === 0 }"
            :title="`${countOf(node)} 个物料`">{{ countOf(node) }}</span>
        </div>
        <div v-if="node.children.length && isOpen(node.cat.id)" class="tn-kids">
          <div v-for="c in node.children" :key="c.cat.id" class="tn-row child" :class="{ on: selectedId === c.cat.id }">
            <input v-if="checkable" class="tn-check" type="checkbox" :checked="isChecked?.(c) ?? false"
              :indeterminate="isIndeterminate?.(c) ?? false" title="全选 / 取消该分类" @change="onCheck(c, $event)" />
            <button class="tn-name" :title="titleOf(c)" @click="onPick(c)">{{ c.cat.name }}</button>
            <span v-if="counts" class="tn-count" :class="{ zero: countOf(c) === 0 }"
              :title="`${countOf(c)} 个物料`">{{ countOf(c) }}</span>
          </div>
        </div>
      </div>
      <p v-if="!filtered.length" class="ct-empty">
        <slot name="empty">没有匹配的分类</slot>
      </p>
    </div>
  </div>
</template>

<style scoped>
.ctree {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

/* 搜索条 */
.ct-search {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 10px;
  border-bottom: 1px solid var(--c-border-hairline);
}

.ct-inp {
  position: relative;
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
}

.ct-ico {
  position: absolute;
  left: 8px;
  color: var(--c-text-3);
  pointer-events: none;
}

.ct-inp input {
  width: 100%;
  height: var(--ctrl-h-sm);
  padding: 0 var(--ctrl-px) 0 26px;
  font-size: var(--fs-xs);
}

/* 展开 / 折叠：方形图标按钮 */
.ct-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: var(--ctrl-h-sm);
  height: var(--ctrl-h-sm);
  flex-shrink: 0;
  border: 1px solid var(--c-border);
  border-radius: var(--r-sm);
  background: var(--c-surface);
  color: var(--c-text-2);
  transition: all var(--motion-fast);
}

.ct-btn:hover {
  color: var(--c-primary);
  border-color: var(--c-primary);
  background: var(--c-surface-hover);
}

/* ===== 树体 ===== */
.ct-body {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 8px 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.tn-row {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 3px 6px;
  border-radius: var(--r-sm);
  font-size: var(--fs-sm);
  transition: background var(--motion);
}

.tn-row:hover {
  background: var(--c-surface-hover);
}

/* 当前选中的分类 */
.tn-row.on {
  background: var(--c-primary-soft);
}

.tn-row.on .tn-name {
  color: var(--c-primary);
  font-weight: 600;
}

/* 折叠箭头；无子级时用占位保持缩进对齐 */
.tn-caret {
  width: 18px;
  height: 18px;
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--r-xs);
  color: var(--c-text-3);
  transition: background var(--motion), color var(--motion);
}

.tn-caret:hover {
  background: var(--c-surface-active);
  color: var(--c-text);
}

.tn-caret--empty {
  visibility: hidden;
}

.caret {
  transition: transform var(--motion);
}

.caret.open {
  transform: rotate(90deg);
}

/* 复选框：整类全选 / 取消 */
.tn-check {
  width: 14px;
  height: 14px;
  flex-shrink: 0;
  accent-color: var(--c-primary);
  cursor: pointer;
}

/* 点分类名：单选筛选 / 多选打开物料弹框，由父级决定 */
.tn-name {
  flex: 1;
  min-width: 0;
  text-align: left;
  font-size: var(--fs-sm);
  padding: 2px 3px;
  border-radius: var(--r-xs);
  background: transparent;
  color: inherit;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  cursor: pointer;
  transition: color var(--motion-fast), background var(--motion-fast);
}

.tn-name:hover {
  color: var(--c-primary);
  background: var(--c-surface);
}

/* 物料数量徽标：0 时高亮，一眼看出哪些分类是空的 */
.tn-count {
  flex-shrink: 0;
  margin-left: auto;
  padding: 0 7px;
  height: 18px;
  display: inline-flex;
  align-items: center;
  font-size: var(--fs-xs);
  font-variant-numeric: tabular-nums;
  color: var(--c-text-2);
  background: var(--c-surface);
  border-radius: var(--r-pill);
}

.tn-count.zero {
  color: var(--c-danger);
  background: color-mix(in srgb, var(--c-danger) 12%, transparent);
}

.tn-kids {
  margin-left: 15px;
  padding-left: 6px;
  border-left: 1px dashed var(--c-border);
}

.tn-row.child {
  color: var(--c-text-2);
  padding-left: 2px;
}

.ct-empty {
  margin: 20px 0;
  text-align: center;
  color: var(--c-text-3);
  font-size: var(--fs-sm);
}
</style>
