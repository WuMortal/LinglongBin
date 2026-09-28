<script lang="ts">
/** 数据表格列定义 */
export interface DtColumn {
  /** 列标识（用于插槽名 cell-{key} 与默认取值字段） */
  key: string
  label?: string
  /** 对齐方式，表头与单元格保持一致 */
  align?: 'left' | 'right' | 'center'
  width?: string
  minWidth?: string
  maxWidth?: string
  /** 可排序（受控：父组件维护 sortKey / sortDir） */
  sortable?: boolean
  /** 排序字段，默认取 key */
  sortField?: string
  /** 附加到 th / td 的 class */
  cls?: string
}
</script>

<script setup lang="ts" generic="R extends object">
import { Inbox } from 'lucide-vue-next'

const props = withDefaults(defineProps<{
  columns: DtColumn[]
  rows: R[]
  /** 行主键（字段名或取值函数） */
  rowKey: string | ((row: R) => string)
  /** 当前排序字段（受控） */
  sortKey?: string | null
  /** 当前排序方向 */
  sortDir?: 'asc' | 'desc'
  /** 当前展开行主键（配合 expand 插槽） */
  expandedKey?: string | null
  /** 行是否可点击 */
  clickable?: boolean
}>(), {
  sortKey: null,
  sortDir: 'desc',
  expandedKey: null,
  clickable: true,
})

const emit = defineEmits<{
  sort: [field: string]
  'row-click': [row: R]
}>()

function keyOf(row: R): string {
  return typeof props.rowKey === 'function' ? props.rowKey(row) : String((row as Record<string, unknown>)[props.rowKey])
}

function fieldOf(col: DtColumn): string {
  return col.sortField ?? col.key
}

function isActive(col: DtColumn): boolean {
  return !!col.sortable && props.sortKey === fieldOf(col)
}

function arrowOf(col: DtColumn): string {
  if (!isActive(col)) return '↕'
  return props.sortDir === 'asc' ? '↑' : '↓'
}
</script>

<template>
  <div class="dt-wrap">
    <table>
      <thead>
        <tr>
          <th v-for="col in columns" :key="col.key"
            :class="[col.cls, col.align, { sortable: col.sortable }]"
            :style="{ width: col.width, minWidth: col.minWidth, maxWidth: col.maxWidth }"
            @click="col.sortable && emit('sort', fieldOf(col))">
            <slot :name="`header-${col.key}`" :col="col">{{ col.label }}</slot>
            <span v-if="col.sortable" class="sort" :class="{ on: isActive(col) }">{{ arrowOf(col) }}</span>
          </th>
        </tr>
      </thead>
      <tbody>
        <template v-for="row in rows" :key="keyOf(row)">
          <tr class="dt-row" :class="{ open: expandedKey === keyOf(row), clickable }"
            @click="clickable && emit('row-click', row)">
            <td v-for="col in columns" :key="col.key"
              :class="[col.cls, col.align]"
              :style="{ width: col.width, minWidth: col.minWidth, maxWidth: col.maxWidth }">
              <slot :name="`cell-${col.key}`" :row="row"
                :value="(row as Record<string, unknown>)[col.key]">
                {{ (row as Record<string, unknown>)[col.key] }}
              </slot>
            </td>
          </tr>
          <tr v-if="expandedKey === keyOf(row)" class="dt-detail">
            <td :colspan="columns.length">
              <slot name="expand" :row="row" />
            </td>
          </tr>
        </template>
        <tr v-if="!rows.length">
          <td :colspan="columns.length" class="dt-empty">
            <slot name="empty">
              <Inbox :size="28" style="display: inline-flex; flex-shrink: 0" />
              <span>暂无数据</span>
            </slot>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<style scoped>
.dt-wrap {
  flex: 1;
  min-height: 0;
  overflow: auto;
}

table {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--fs-sm);
}

thead th {
  text-align: left;
  padding: 10px 14px;
  color: var(--c-text-3);
  font-weight: 500;
  font-size: var(--fs-xs);
  position: sticky;
  top: 0;
  background: var(--c-glass-strong);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  z-index: 1;
  border-bottom: 1px solid var(--c-border-hairline);
  white-space: nowrap;
}

/* 对齐方式：表头与单元格统一，避免错位 */
th.right,
td.right {
  text-align: right;
}

th.center,
td.center {
  text-align: center;
}

th.sortable {
  cursor: pointer;
  user-select: none;
  transition: color var(--motion);
}

th.sortable:hover {
  color: var(--c-text);
}

.sort {
  display: inline-block;
  margin-left: 4px;
  min-width: 10px;
  color: var(--c-primary);
}

.sort:not(.on) {
  visibility: hidden;
}

th.sortable:hover .sort:not(.on) {
  visibility: visible;
  color: var(--c-text-3);
}

tbody td {
  padding: 9px 14px;
  border-bottom: 1px solid var(--c-border-hairline);
  vertical-align: middle;
}

.dt-row {
  transition: background var(--motion);
}

.dt-row.clickable {
  cursor: pointer;
}

.dt-row.clickable:hover,
.dt-row.open {
  background: var(--c-surface-active);
}

.dt-detail td {
  background: var(--c-glass);
  padding: 0 14px;
}

.dt-empty {
  text-align: center;
  padding: 40px 0;
  color: var(--c-text-3);
}

.dt-empty span {
  margin-left: 8px;
  font-size: var(--fs-sm);
}
</style>
