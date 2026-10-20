<template>
  <Teleport to="body">
    <Transition name="fpanel">
      <div v-if="open" class="mask" @click.self="emit('close')">
        <div class="panel">
          <!-- 头部 -->
          <!-- <header class="p-head">
            <h3>筛选</h3>
            <button class="p-x" @click="emit('close')">
              <X :size="18" style="display: inline-flex; flex-shrink: 0" />
            </button>
          </header> -->

          <div class="p-body">
            <!-- 左：纵向属性导航（大类常驻；选了大类出现小类；选了小类出现扩展参数） -->
            <aside class="nav-col">
              <button v-for="n in navItems" :key="n.key"
                class="nav-item" :class="{ on: activeKey === n.key }"
                @click="activeKey = n.key">
                {{ n.label }}
                <span v-if="n.badge" class="nav-dot" />
              </button>
            </aside>

            <!-- 右：选项网格 -->
            <div class="opt-col">
              <!-- 库位（字典项） -->
              <div v-if="activeKey === 'loc'" class="opt-group">
                <h4 class="g-title">库位</h4>
                <div class="opt-grid">
                  <button class="opt" :class="{ on: !localLocation }" @click="pickLocation(null)">不限</button>
                  <button v-for="l in locationItems" :key="l" class="opt"
                    :class="{ on: localLocation === l }"
                    @click="pickLocation(l)">
                    {{ l }}
                  </button>
                </div>
              </div>

              <!-- 大类 -->
              <div v-else-if="activeKey === 'top'" class="opt-group">
                <h4 class="g-title">大类</h4>
                <div class="opt-grid">
                  <button class="opt" :class="{ on: !localCatId }" @click="pickTop(null)">不限</button>
                  <button v-for="n in tree" :key="n.cat.id" class="opt"
                    :class="{ on: localCatId === n.cat.id || activeTopId === n.cat.id }"
                    @click="pickTop(n.cat.id)">
                    {{ n.cat.name }}
                  </button>
                </div>
              </div>

              <!-- 小类 -->
              <div v-else-if="activeKey === 'children'" class="opt-group">
                <h4 class="g-title">小类</h4>
                <div class="opt-grid">
                  <button class="opt" :class="{ on: localCatId === activeTopId }" @click="pickChild(activeTopId)">全部</button>
                  <button v-for="c in children" :key="c.cat.id" class="opt"
                    :class="{ on: localCatId === c.cat.id }"
                    @click="pickChild(c.cat.id)">
                    {{ c.cat.name }}
                  </button>
                </div>
              </div>

              <!-- 扩展参数 -->
              <div v-else-if="activeParam" class="opt-group">
                <h4 class="g-title">{{ activeParam.name }}</h4>
                <div v-if="!paramOptions(activeParam).length" class="g-empty">暂无可选值</div>
                <div class="opt-grid">
                  <button class="opt" :class="{ on: !localParams[activeParam.key] }"
                    @click="setParam(activeParam.key, '')">不限</button>
                  <button v-for="v in paramOptions(activeParam)" :key="v" class="opt"
                    :class="{ on: localParams[activeParam.key] === v }"
                    @click="setParam(activeParam.key, v)">
                    {{ v }}
                  </button>
                </div>
              </div>
            </div>
          </div>

          <!-- 底部：重置 / 确定 -->
          <footer class="p-foot">
            <button class="btn-reset" @click="resetAll">重置</button>
            <button class="btn-ok" @click="apply">确定</button>
          </footer>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { X } from 'lucide-vue-next'
import { getCategoryParams, listMaterials, listDictItems } from '../../lib/db'
import type { CategoryNode } from '../../lib/db'
import type { CategoryParam, MaterialRow } from '../../lib/types'

/**
 * 移动端物料筛选面板（参考立创商城筛选）：左侧属性纵向导航 + 右侧选项网格。
 * 层级渐进：库位 + 大类常驻 → 选中大类后出现「小类」→ 选中小类（叶子）后出现该小类的扩展参数。
 * 参数可选值 = 分类参数模板预设 ∪ 该小类下物料实际出现的值（与桌面参数筛选口径一致）。
 * 库位取「库位」字典（location），与分类 / 参数条件为 AND 关系。
 */
const props = defineProps<{
  open: boolean
  tree: CategoryNode[]
  /** 当前生效的分类 id（大类或小类） */
  catId: string | null
  /** 当前生效的参数筛选 */
  params: Record<string, string>
  /** 当前生效的库位筛选（精确匹配） */
  location?: string | null
}>()

const emit = defineEmits<{
  /** 确定：回传分类 id、参数与库位（父组件触发重新查询） */
  apply: [payload: { catId: string | null; params: Record<string, string>; location: string | null }]
  close: []
}>()

/** 面板内草稿（确定才生效，取消/遮罩关闭不改动已选） */
const localCatId = ref<string | null>(null)
const localParams = ref<Record<string, string>>({})
/** 库位草稿：null = 不限 */
const localLocation = ref<string | null>(null)
/** 库位字典项（label 列表） */
const locationItems = ref<string[]>([])
/** 当前选中叶子分类的参数模板 */
const leafParams = ref<CategoryParam[]>([])
/** 当前叶子分类下的物料（取参数实际值） */
const leafMats = ref<MaterialRow[]>([])

/** 左侧当前激活项：'loc' | 'top' | 'children' | 参数 key */
const activeKey = ref<string>('top')

interface NavItem { key: string; label: string; badge: boolean }

/** 当前选中的大类节点（无论选的是大类本身还是其下小类） */
const activeTop = computed<CategoryNode | null>(() => {
  const id = localCatId.value
  if (!id) return null
  for (const n of props.tree) {
    if (n.cat.id === id || n.children.some(c => c.cat.id === id)) return n
  }
  return null
})
const activeTopId = computed(() => activeTop.value?.cat.id ?? '')
const children = computed(() => activeTop.value?.children ?? [])

/** 当前是否选中叶子小类（决定是否加载参数） */
const activeLeaf = computed(() => {
  const id = localCatId.value
  if (!id) return null
  // 在大类节点里找不到自身、但在某大类 children 里找到 → 叶子
  const isTop = props.tree.some(n => n.cat.id === id)
  if (isTop) return null
  return activeTop.value?.children.find(c => c.cat.id === id) ?? null
})

/** 激活项对应的参数定义（activeKey 为参数 key 时） */
const activeParam = computed<CategoryParam | null>(() =>
  activeKey.value.startsWith('p:')
    ? leafParams.value.find(p => 'p:' + p.key === activeKey.value) ?? null
    : null)

/** 左导航：库位 + 大类 + 小类（选了大类才有）+ 各扩展参数（选了小类才有） */
const navItems = computed<NavItem[]>(() => {
  const items: NavItem[] = [
    { key: 'loc', label: '库位', badge: !!localLocation.value },
    { key: 'top', label: '大类', badge: !!localCatId.value },
  ]
  if (activeTop.value) items.push({ key: 'children', label: '小类', badge: activeLeaf.value !== null })
  for (const p of leafParams.value) {
    items.push({ key: 'p:' + p.key, label: p.name, badge: !!localParams.value[p.key] })
  }
  return items
})

/** 某参数可选值：模板预设 ∪ 该小类物料实际值（去重） */
function paramOptions(p: CategoryParam): string[] {
  const set = new Set<string>()
  for (const v of p.values || []) if (v != null && String(v) !== '') set.add(String(v))
  for (const m of leafMats.value) {
    const v = m.params?.[p.key]
    if (v != null && String(v).trim() !== '') set.add(String(v).trim())
  }
  return [...set]
}

/** 选大类：清参数，右栏跳到「小类」（无小类则停留在大类） */
function pickTop(id: string | null) {
  localCatId.value = id
  clearParamsAndLeaf()
  if (id) {
    const node = props.tree.find(n => n.cat.id === id)
    activeKey.value = node?.children.length ? 'children' : 'top'
  } else {
    activeKey.value = 'top'
  }
}

/** 选小类：'全部' 传回大类 id（按大类聚合查，无参数）；选叶子则加载参数 */
function pickChild(id: string) {
  localCatId.value = id
  clearParamsAndLeaf()
  if (id !== activeTopId.value) void loadLeaf(id)
}

function setParam(key: string, v: string) {
  if (v) localParams.value[key] = v
  else delete localParams.value[key]
}

/** 选库位：null = 不限；与分类 / 参数为 AND 关系，互不清除 */
function pickLocation(l: string | null) {
  localLocation.value = l
}

function clearParamsAndLeaf() {
  localParams.value = {}
  leafParams.value = []
  leafMats.value = []
}

/** 叶子分类：加载参数模板 + 该分类物料（取参数实际值）；右栏停留在小类，参数项出现在左导航 */
async function loadLeaf(id: string) {
  try {
    const [ps, mats] = await Promise.all([
      getCategoryParams(id),
      listMaterials({ categoryId: id }),
    ])
    leafParams.value = ps
    leafMats.value = mats
  } catch {
    leafParams.value = []
    leafMats.value = []
  }
}

function resetAll() {
  localCatId.value = null
  localLocation.value = null
  clearParamsAndLeaf()
  activeKey.value = 'top'
}

function apply() {
  const p: Record<string, string> = {}
  for (const [k, v] of Object.entries(localParams.value)) if (v) p[k] = v
  emit('apply', { catId: localCatId.value, params: p, location: localLocation.value })
  emit('close')
}

/** 打开：把外部已选拷进草稿；若已是叶子则把参数模板补载好（左导航才能显示参数项） */
watch(() => props.open, async (open) => {
  if (!open) return
  localCatId.value = props.catId
  localParams.value = { ...props.params }
  localLocation.value = props.location ?? null
  leafParams.value = []
  leafMats.value = []
  // 库位字典懒加载（打开时拉一次，失败静默）
  if (!locationItems.value.length) {
    try { locationItems.value = (await listDictItems('location')).map(i => i.label) } catch { /* 静默 */ }
  }
  if (props.catId) {
    const isTop = props.tree.some(n => n.cat.id === props.catId)
    if (!isTop) {
      await loadLeaf(props.catId)
      // 打开时落在小类列表，参数项已在左导航，用户自行点选
      activeKey.value = 'children'
    } else {
      const node = props.tree.find(n => n.cat.id === props.catId)
      activeKey.value = node?.children.length ? 'children' : 'top'
    }
  } else {
    activeKey.value = 'top'
  }
})
</script>

<style scoped>
/* ===== 全屏遮罩 + 右侧大面板 ===== */
.mask {
  position: fixed;
  inset: 0;
  z-index: 150;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  justify-content: flex-end;
}

.panel {
  width: min(78vw, 340px);
  height: 100%;
  background: var(--c-bg);
  display: flex;
  flex-direction: column;
  box-shadow: var(--shadow-pop);
  border-radius: var(--r-lg) 0 0 var(--r-lg);
  overflow: hidden;
}

.p-head {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 50px;
  padding: 0 12px 0 18px;
  border-bottom: 1px solid var(--c-border-hairline);
}

.p-head h3 {
  margin: 0;
  font-size: var(--fs-lg);
  font-weight: 700;
}

.p-x {
  width: 36px;
  height: 36px;
  border: none;
  border-radius: 50%;
  background: transparent;
  color: var(--c-text-2);
  display: grid;
  place-items: center;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}

.p-x:active {
  background: var(--c-surface-hover);
}

.p-body {
  flex: 1;
  display: flex;
  min-height: 0;
}

/* ===== 左侧属性导航 ===== */
.nav-col {
  width: 90px;
  flex-shrink: 0;
  overflow-y: auto;
  background: var(--c-glass);
  border-right: 1px solid var(--c-border-hairline);
}

.nav-item {
  position: relative;
  width: 100%;
  min-height: 48px;
  padding: 10px 14px;
  border: none;
  background: transparent;
  color: var(--c-text-2);
  font-family: inherit;
  font-size: var(--fs-sm);
  font-weight: 500;
  text-align: left;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}

.nav-item.on {
  background: var(--c-bg);
  color: var(--c-primary);
  font-weight: 700;
}

/* 激活项左侧蓝条（电商筛选常见指示） */
.nav-item.on::before {
  content: '';
  position: absolute;
  left: 0;
  top: 50%;
  transform: translateY(-50%);
  width: 3px;
  height: 18px;
  border-radius: 0 3px 3px 0;
  background: var(--c-primary);
}

.nav-dot {
  display: inline-block;
  width: 6px;
  height: 6px;
  margin-left: 6px;
  border-radius: 50%;
  background: var(--c-primary);
  vertical-align: middle;
}

/* ===== 右侧选项网格 ===== */
.opt-col {
  flex: 1;
  min-width: 0;
  overflow-y: auto;
  padding: 14px 12px 20px;
}

.g-title {
  margin: 0 0 12px;
  font-size: var(--fs-md);
  font-weight: 700;
}

.g-empty {
  color: var(--c-text-3);
  font-size: var(--fs-sm);
  padding: 8px 0;
}

.opt-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 8px;
}

.opt {
  min-height: 38px;
  padding: 6px 10px;
  border: 1px solid var(--c-border);
  border-radius: var(--r-md);
  background: var(--c-surface);
  color: var(--c-text);
  font-family: inherit;
  font-size: var(--fs-sm);
  font-weight: 500;
  line-height: 1.3;
  cursor: pointer;
  word-break: break-all;
  transition: background-color var(--motion-fast), color var(--motion-fast), border-color var(--motion-fast);
  -webkit-tap-highlight-color: transparent;
}

.opt.on {
  background: var(--c-primary-soft);
  border-color: transparent;
  color: var(--c-primary);
  font-weight: 600;
}

/* ===== 底部操作 ===== */
.p-foot {
  flex-shrink: 0;
  display: flex;
  gap: 10px;
  padding: 10px 14px calc(10px + env(safe-area-inset-bottom));
  border-top: 1px solid var(--c-border-hairline);
  background: var(--c-elevated);
}

.btn-reset,
.btn-ok {
  flex: 1;
  height: 44px;
  border-radius: var(--r-md);
  font-family: inherit;
  font-size: var(--fs-md);
  font-weight: 700;
  cursor: pointer;
}

.btn-reset {
  border: 1px solid var(--c-border-strong);
  background: transparent;
  color: var(--c-text);
}

.btn-ok {
  border: none;
  background: var(--c-primary);
  color: #fff;
}

.btn-ok:active {
  opacity: 0.9;
}

/* ===== 面板从右滑入 ===== */
.fpanel-enter-active,
.fpanel-leave-active {
  transition: opacity 0.2s ease;
}

.fpanel-enter-active .panel,
.fpanel-leave-active .panel {
  transition: transform 0.24s cubic-bezier(0.22, 1, 0.36, 1);
}

.fpanel-enter-from,
.fpanel-leave-to {
  opacity: 0;
}

.fpanel-enter-from .panel,
.fpanel-leave-to .panel {
  transform: translateX(100%);
}
</style>
