<script setup lang="ts">
// 自身库选择面板（MaterialBindDialog 的「自身库」tab 内容）。
// 内部再左右分：
//   左：分类树（大类 → 小类，顶部搜索框过滤节点，大类可展开/折叠）
//   右：上部 = 该分类的参数筛选器；下部 = 物料结果列表
import { ref, reactive, computed, watch } from 'vue'
import { Search, Inbox, Folder, FolderOpen, Tag, ChevronRight } from 'lucide-vue-next'
import { listMaterials, listCategories, getCategoryParams, buildCategoryTree } from '../../lib/db'
import type { CategoryNode } from '../../lib/db'
import type { MaterialRow, Category, CategoryParam } from '../../lib/types'
import ParamFilterBar from '../form/ParamFilterBar.vue'

const props = defineProps<{ keyword?: string }>()
const emit = defineEmits<{ pick: [m: MaterialRow] }>()

const kw = ref('')
const allComps = ref<MaterialRow[]>([])
const allCats = ref<Category[]>([])

// 分类树
const tree = computed<CategoryNode[]>(() => buildCategoryTree(allCats.value))
const treeKw = ref('')
/** 展开的大类 id 集合（搜索时自动展开命中项） */
const expanded = ref<Set<string>>(new Set())
/** 选中的分类节点：'' = 全部 */
const selectedCatId = ref('')

// 参数筛选
const activeCatParams = ref<CategoryParam[]>([])
const paramSel = reactive<Record<string, string>>({})

function clearParams() {
  for (const k of Object.keys(paramSel)) delete paramSel[k]
}

async function loadData() {
  try {
    if (!allComps.value.length) allComps.value = await listMaterials({})
    if (!allCats.value.length) allCats.value = await listCategories()
  } catch { /* 静默 */ }
}
loadData()

watch(() => props.keyword, v => { kw.value = v || '' }, { immediate: true })

/** 选中的分类（大类时代表含其下所有小类） */
const selectedCat = computed(() => allCats.value.find(c => c.id === selectedCatId.value) || null)
const selectedIsMajor = computed(() => !!selectedCat.value && !selectedCat.value.parent)

/** 结果集用到的分类 id 集合：小类=自身；大类=自身+所有子小类 */
const filterCatIds = computed<Set<string> | null>(() => {
  if (!selectedCatId.value) return null
  const ids = new Set<string>([selectedCatId.value])
  if (selectedIsMajor.value) {
    for (const c of allCats.value) if (c.parent === selectedCatId.value) ids.add(c.id)
  }
  return ids
})

// ===== 分类树过滤 =====
/** 树节点 + 过滤后的子节点（搜索时按名称匹配，命中则保留并自动展开） */
interface TreeNode {
  id: string
  name: string
  children: TreeNode[]
  /** 该大类（含小类）下的物料数 */
  count: number
}

const materialCountOf = (id: string) => allComps.value.filter(m => m.category_id === id).length

const filteredTree = computed<TreeNode[]>(() => {
  const k = treeKw.value.trim().toLowerCase()
  const out: TreeNode[] = []
  for (const node of tree.value) {
    const majorName = node.cat.name
    const minors = node.children.map(ch => ({
      id: ch.cat.id,
      name: ch.cat.name,
      children: [] as TreeNode[],
      count: materialCountOf(ch.cat.id),
    }))
    const majorHit = !k || majorName.toLowerCase().includes(k)
    const hitMinors = k ? minors.filter(m => m.name.toLowerCase().includes(k)) : minors
    // 大类命中 → 保留全部小类；否则只保留命中的小类
    if (!majorHit && !hitMinors.length) continue
    out.push({
      id: node.cat.id,
      name: majorName,
      children: majorHit ? minors : hitMinors,
      count: node.cat.id ? allComps.value.filter(m => {
        const ids = new Set([node.cat.id, ...node.children.map(c => c.cat.id)])
        return ids.has(m.category_id || '')
      }).length : 0,
    })
  }
  return out
  })

  // 搜索时自动展开命中的大类分支
  watch([treeKw, tree], () => {
    const k = treeKw.value.trim().toLowerCase()
    if (!k) return
    const s = new Set(expanded.value)
    for (const node of tree.value) {
      const majorHit = node.cat.name.toLowerCase().includes(k)
      const minorHit = node.children.some(ch => ch.cat.name.toLowerCase().includes(k))
      if (majorHit || minorHit) s.add(node.cat.id)
    }
    expanded.value = s
  })

function toggleExpand(id: string) {
  const s = new Set(expanded.value)
  if (s.has(id)) s.delete(id)
  else s.add(id)
  expanded.value = s
}

async function selectCat(id: string) {
  selectedCatId.value = selectedCatId.value === id ? '' : id
  clearParams()
  activeCatParams.value = []
  if (!selectedCatId.value) return
  try { activeCatParams.value = await getCategoryParams(selectedCatId.value) } catch { /* 静默 */ }
}

// ===== 参数筛选 =====
/** 筛选条返回新的选中集合，同步回响应式 paramSel（保持引用不变） */
function onParamsChange(v: Record<string, string>) {
  for (const k of Object.keys(paramSel)) delete paramSel[k]
  Object.assign(paramSel, v)
}

/** 某参数的可选值：模板预设 ∪ 该分类下库存物料实际出现的值 */
function paramOptions(p: CategoryParam): string[] {
  const set = new Set<string>()
  for (const v of p.values || []) if (v != null && String(v) !== '') set.add(String(v))
  const ids = filterCatIds.value
  if (ids) {
    for (const m of allComps.value) {
      if (!ids.has(m.category_id || '')) continue
      const v = m.params?.[p.key]
      if (v != null && String(v) !== '') set.add(String(v))
    }
  }
  return [...set]
}

// ===== 结果列表 =====
const cands = computed<MaterialRow[]>(() => {
  let list = allComps.value
  const ids = filterCatIds.value
  if (ids) list = list.filter(m => ids.has(m.category_id || ''))
  const keys = activeCatParams.value.map(p => p.key).filter(k => paramSel[k])
  if (keys.length) {
    list = list.filter(m => keys.every(k => String(m.params?.[k] ?? '') === paramSel[k]))
  }
  const k = kw.value.trim().toLowerCase()
  if (k) list = list.filter(c => (c.name + ' ' + (c.model || '')).toLowerCase().includes(k))
  return list
})

function choose(c: MaterialRow) { emit('pick', c) }
</script>

<template>
  <div class="picker-split">
    <!-- 左：分类树 -->
    <div class="cat-pane">
      <div class="pane-head">
        <span class="pane-title"><Folder :size="13" />分类</span>
        <span class="pane-count">{{ allComps.length }} 项</span>
      </div>
      <div class="tree-search">
        <Search :size="13" class="s-ico" />
        <input v-model="treeKw" placeholder="搜索大类 / 小类…" />
      </div>
      <div class="tree-list">
        <button class="tree-node all" :class="{ on: !selectedCatId }" @click="selectCat('')">
          <span class="node-name">全部物料</span>
          <span class="node-count">{{ allComps.length }}</span>
        </button>

        <template v-for="major in filteredTree" :key="major.id">
          <div class="tree-major">
            <button class="tree-node major" :class="{ on: selectedCatId === major.id }"
              @click="selectCat(major.id)">
              <span class="node-arrow" @click.stop="toggleExpand(major.id)">
                <ChevronRight :size="12" :class="{ open: expanded.has(major.id) }" />
              </span>
              <component :is="expanded.has(major.id) ? FolderOpen : Folder" :size="13"
                class="node-ico" />
              <span class="node-name">{{ major.name }}</span>
              <span class="node-count">{{ major.count }}</span>
            </button>

            <template v-if="expanded.has(major.id)">
              <button v-for="mi in major.children" :key="mi.id" class="tree-node minor"
                :class="{ on: selectedCatId === mi.id }" @click="selectCat(mi.id)">
                <Tag :size="12" class="node-ico" />
                <span class="node-name">{{ mi.name }}</span>
                <span class="node-count">{{ mi.count }}</span>
              </button>
            </template>
          </div>
        </template>

        <div v-if="!filteredTree.length" class="tree-empty">无匹配分类</div>
      </div>
    </div>

    <!-- 右：上部参数筛选 + 下部结果 -->
    <div class="result-pane">
      <div class="result-top">
        <div class="m-search">
          <Search :size="14" class="s-ico" />
          <input v-model="kw" placeholder="搜索名称 / 型号…" />
        </div>
        <!-- 参数筛选条：默认一行，其余折叠（被折叠项若有选中值，按钮会高亮提示） -->
        <ParamFilterBar
          v-if="activeCatParams.length"
          :key="selectedCatId"
          :params="activeCatParams"
          :model-value="paramSel"
          :options-of="paramOptions"
          @update:model-value="onParamsChange"
          @clear="clearParams"
        />
        <p v-else class="params-hint">
          <template v-if="selectedCat">「{{ selectedCat.name }}」无参数模板，直接用关键词筛选</template>
          <template v-else>从左侧选择分类可展开参数筛选</template>
        </p>
      </div>

      <ul class="cand">
        <li v-for="c in cands" :key="c.id" @click="choose(c)">
          <div class="cand-info">
            <strong>{{ c.name }}</strong>
            <small>{{ c.model || '—' }} · {{ c.package || '—' }}<template v-if="c.categories?.name"> · {{ c.categories.name }}</template></small>
          </div>
          <span class="mq" :class="{ low: c.qty <= (c.categories?.threshold ?? 5) }">库存 {{ c.qty }}</span>
        </li>
        <li v-if="!cands.length" class="no">
          <Inbox :size="20" />无匹配候选
        </li>
      </ul>
    </div>
  </div>
</template>

<style scoped>
.picker-split {
  display: grid;
  grid-template-columns: 178px 1fr;
  gap: 14px;
  height: 100%;
  min-height: 470px;
}

/* ===== 左：分类树 ===== */
.cat-pane {
  display: flex;
  flex-direction: column;
  min-height: 0;
  border-right: 1px solid var(--c-border-hairline);
  padding-right: 12px;
}

.pane-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 8px;
}

.pane-title {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: var(--fs-xs);
  font-weight: 600;
  color: var(--c-text-2);
}

.pane-count {
  font-size: var(--fs-xs);
  color: var(--c-text-3);
}

.tree-search,
.m-search {
  position: relative;
  display: flex;
  align-items: center;
  margin-bottom: 8px;
}

.s-ico {
  position: absolute;
  left: 10px;
  color: var(--c-text-3);
}

.tree-search input,
.m-search input {
  width: 100%;
  height: 32px;
  padding: 0 10px 0 30px;
  font-size: var(--fs-sm);
  background: var(--c-glass);
  border: 1px solid var(--c-border);
  border-radius: var(--r-md);
  color: var(--c-text);
  font-family: inherit;
  transition: all var(--motion);
}

.tree-search input:focus,
.m-search input:focus {
  border-color: var(--c-primary);
  background: var(--c-surface);
  box-shadow: 0 0 0 3px var(--c-primary-glow);
  outline: none;
}

.tree-list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.tree-major {
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.tree-node {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 6px 8px;
  border: 1px solid transparent;
  border-radius: var(--r-sm);
  background: transparent;
  color: var(--c-text-2);
  font-size: var(--fs-sm);
  font-family: inherit;
  cursor: pointer;
  text-align: left;
  transition: background-color var(--motion-fast), color var(--motion-fast);
}

.tree-node:hover {
  background: var(--c-surface-hover);
  color: var(--c-text);
}

.tree-node.on {
  background: var(--c-primary-soft);
  border-color: rgba(79, 140, 255, 0.25);
  color: var(--c-primary);
  font-weight: 600;
}

.tree-node.minor {
  padding-left: 26px;
  font-size: var(--fs-xs);
}

.node-arrow {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 14px;
  height: 14px;
  flex-shrink: 0;
  color: var(--c-text-3);
}

.node-arrow :deep(svg) {
  transition: transform var(--motion-fast);
}

.node-arrow :deep(.open) {
  transform: rotate(90deg);
}

.node-ico {
  flex-shrink: 0;
}

.node-name {
  flex: 1;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.node-count {
  font-size: var(--fs-xs);
  color: var(--c-text-3);
  flex-shrink: 0;
}

.tree-empty {
  padding: 16px 8px;
  text-align: center;
  font-size: var(--fs-xs);
  color: var(--c-text-3);
}

/* ===== 右：参数 + 结果 ===== */
.result-pane {
  display: flex;
  flex-direction: column;
  min-height: 0;
  gap: 10px;
}

.result-top {
  flex-shrink: 0;
}

.m-search {
  margin-bottom: 8px;
}

.params-hint {
  margin: 0;
  font-size: var(--fs-xs);
  color: var(--c-text-3);
}

.cand {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}

.cand li {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 10px 12px;
  border-radius: var(--r-md);
  background: var(--c-glass);
  cursor: pointer;
  transition: all var(--motion);
  border: 1px solid transparent;
}

.cand li:hover {
  background: var(--c-surface-active);
  border-color: var(--c-primary);
}

.cand li.no {
  justify-content: center;
  cursor: default;
  color: var(--c-text-2);
  gap: 8px;
}

.cand li.no:hover {
  background: var(--c-glass);
  border-color: transparent;
}

.cand-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.cand-info strong {
  font-size: var(--fs-sm);
  font-weight: 600;
}

.cand-info small {
  color: var(--c-text-2);
  font-size: var(--fs-xs);
}

.mq {
  font-weight: 700;
  font-size: var(--fs-sm);
  color: var(--c-accent);
  flex-shrink: 0;
}

.mq.low { color: var(--c-danger); }
</style>