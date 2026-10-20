<template>
  <section class="mpage">
    <!-- 吸顶：搜索 + 分类筛选（横向滚动 chips；负外边距吃掉 MobileShell .content 的 16px padding） -->
    <div class="topbar">
      <div class="search">
        <Search :size="16" class="s-ico" style="display: inline-flex; flex-shrink: 0" />
        <input v-model="search" type="search" placeholder="搜索名称 / 型号 / 编号…" />
      </div>
      <div v-if="tree.length" class="chips">
        <button class="chip" :class="{ on: !catId }" @click="catId = null">
          全部<span class="ct">{{ totalCount }}</span>
        </button>
        <button v-for="n in tree" :key="n.cat.id" class="chip" :class="{ on: catId === n.cat.id }"
          @click="pickTop(n.cat.id)">
          {{ n.cat.name }}<span class="ct">{{ countOf(n) }}</span>
        </button>
      </div>
      <!-- 二级 chips：选中大类后出现（该大类无小类则不显示） -->
      <div v-if="childRow.length" class="chips sub">
        <button class="chip" :class="{ on: catId === activeTopId }" @click="catId = activeTopId">
          全部<span class="ct">{{ activeTopCount }}</span>
        </button>
        <button v-for="c in childRow" :key="c.cat.id" class="chip" :class="{ on: catId === c.cat.id }"
          @click="pickChild(c.cat.id)">
          {{ c.cat.name }}<span class="ct">{{ countOf(c) }}</span>
        </button>
      </div>
    </div>

    <div class="list-wrap">
      <p v-if="error" class="error">
        {{ error }}
        <button v-if="!items.length" class="retry-link" @click="load">重试</button>
      </p>

      <div v-if="loading" class="hint">
        <div class="spinner-lg" />
      </div>
      <div v-else-if="!items.length" class="empty">
        <div class="empty-ico">
          <Box :size="40" style="display: inline-flex; flex-shrink: 0" />
        </div>
        <h3>{{ hasFilters ? '没有匹配的物料' : '还没有物料' }}</h3>
        <p>{{ hasFilters ? '换个关键词或分类试试' : '点击右下角「+」添加物料' }}</p>
      </div>

      <template v-else>
        <div class="grid">
          <!-- 电商橱窗卡片：大图 + 名称 + 品牌型号 + 价格/库存，零操作（操作在详情页） -->
          <article v-for="it in items" :key="it.id" class="item" @click="openDetail(it)">
            <div class="thumb">
              <img v-if="imagePublicUrl(it.image_path)" :src="imagePublicUrl(it.image_path)" alt="" loading="lazy" />
              <div v-else class="thumb-ph">
                <ImageIcon :size="26" style="display: inline-flex; flex-shrink: 0" />
              </div>
              <span v-if="isLow(it)" class="low-tag">低库存</span>
            </div>
            <div class="body">
              <h3>{{ it.name }}</h3>
              <p class="meta">{{ it.brand || '—' }} · {{ it.model || '—' }}</p>
              <div class="row">
                <span class="price">¥{{ formatPrice(it.price) }}</span>
                <span class="qty" :class="{ low: isLow(it) }">×{{ it.qty }}</span>
              </div>
            </div>
          </article>
        </div>
        <div v-if="hasMore" class="load-more">
          <div v-if="loadingMore" class="spinner-sm" />
          <span v-else>上拉加载更多</span>
        </div>
        <div v-else class="load-end">没有更多了</div>
      </template>

      <!-- 无限滚动哨兵：始终在 DOM，IntersectionObserver 监听 -->
      <div ref="sentinelEl" class="sentinel" />
    </div>

    <!-- 添加物料 FAB（悬浮在 tabbar 上方） -->
    <button class="fab" title="添加物料" @click="openAdd">
      <Plus :size="22" style="display: inline-flex; flex-shrink: 0" />
    </button>

    <!-- 新增物料表单（复用桌面弹窗；编辑在详情页） -->
    <MaterialFormDialog v-model="showAdd" :categories="categories" :material="null" @saved="onSaved" />
  </section>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import { useRouter } from 'vue-router'
import { Search, Plus, Box, Image as ImageIcon } from 'lucide-vue-next'
import {
  listMaterials, countMaterials, countMaterialsByCategory, listCategories,
  imagePublicUrl, buildCategoryTree, descendantCategoryIds,
} from '../../lib/db'
import type { Category, MaterialRow } from '../../lib/types'
import type { CategoryNode } from '../../lib/db'
import type { ListMaterialsOpts } from '../../lib/storage'
import { withAuthRetry } from '../../lib/authRetry'
import MaterialFormDialog from '../../components/business/MaterialFormDialog.vue'
import { useToast } from '../../composables/toast'

/**
 * 移动端物料库 Tab（电商橱窗式）：搜索 + 分类 chips + 双列大图卡片流。
 * 卡片零操作（电商原则），编辑 / 删除 / 出入库都在详情页 /m/material/:id。
 */
const router = useRouter()
const toast = useToast()

const items = ref<MaterialRow[]>([])
const categories = ref<Category[]>([])
const tree = ref<CategoryNode[]>([])
const search = ref('')
/** 分类筛选：null = 全部；大类 = 含其下所有小类；小类 = 精确匹配（与桌面一致） */
const catId = ref<string | null>(null)
/** 各分类物料数（全库聚合，不随筛选变化），chips 徽标用 */
const catCountMap = ref<Record<string, number>>({})

const loading = ref(false)
const error = ref('')
const limit = ref(20)
const offset = ref(0)
const total = ref(0)
const hasMore = ref(false)
const loadingMore = ref(false)

const showAdd = ref(false)

const totalCount = computed(() => Object.values(catCountMap.value).reduce((s, n) => s + n, 0))

/** 当前生效的大类节点（选中大类本身或其小类时） */
const activeTop = computed<CategoryNode | null>(() => {
  const id = catId.value
  if (!id) return null
  for (const n of tree.value) {
    if (n.cat.id === id) return n
    if (n.children.some(c => c.cat.id === id)) return n
  }
  return null
})
const activeTopId = computed(() => activeTop.value?.cat.id ?? '')
const activeTopCount = computed(() => (activeTop.value ? countOf(activeTop.value) : 0))
/** 二级 chips：选中大类（含小类）后展示其小类列表 */
const childRow = computed(() => (activeTop.value?.children.length ? activeTop.value!.children : []))

/** 分类计数：小类直取；大类聚合自身 + 子类 */
function countOf(node: CategoryNode): number {
  const own = catCountMap.value[node.cat.id] || 0
  return node.children.reduce((s, c) => s + countOf(c), own)
}

function pickTop(id: string) {
  catId.value = catId.value === id ? null : id
}
function pickChild(id: string) {
  // 再点一次已选小类 → 回到该大类（即二级行的「全部」）
  catId.value = catId.value === id ? activeTopId.value : id
}

function isLow(it: MaterialRow) {
  const t = it.threshold || it.categories?.threshold || 5
  return it.qty <= t
}
function formatPrice(v: number) { return Number(v || 0).toFixed(2) }

/** 当前分类筛选范围：大类 = 含其下所有小类；小类 / 无子级分类 = 精确匹配；未选 = 全部 */
function categoryScope(): Pick<ListMaterialsOpts, 'categoryId' | 'categoryIds'> {
  const id = catId.value
  if (!id) return {}
  for (const n of tree.value) {
    if (n.cat.id === id) {
      return n.children.length
        ? { categoryIds: descendantCategoryIds(categories.value, id) }
        : { categoryId: id }
    }
    if (n.children.some(c => c.cat.id === id)) return { categoryId: id }
  }
  return { categoryId: id }
}

const hasFilters = computed(() => !!search.value || !!catId.value)

let debounce: ReturnType<typeof setTimeout> | undefined
function scheduleLoad() {
  clearTimeout(debounce); debounce = setTimeout(load, 250)
}
watch(search, scheduleLoad)
watch(catId, scheduleLoad)

async function load() {
  loading.value = true; error.value = ''
  offset.value = 0
  try {
    const opts: ListMaterialsOpts = { search: search.value, ...categoryScope() }
    const [page, count] = await withAuthRetry(() => Promise.all([
      listMaterials({ ...opts, limit: limit.value, offset: 0 }),
      countMaterials(opts),
    ]))
    items.value = page
    total.value = count
    hasMore.value = page.length < count
  }
  catch (e: unknown) { error.value = '加载失败：' + ((e as Error).message || e) }
  finally { loading.value = false }
}

async function loadMore() {
  if (loading.value || loadingMore.value || !hasMore.value || error.value) return
  loadingMore.value = true
  try {
    offset.value += limit.value
    const page = await withAuthRetry(() =>
      listMaterials({ search: search.value, ...categoryScope(), limit: limit.value, offset: offset.value }))
    items.value.push(...page)
    hasMore.value = items.value.length < total.value
  }
  catch (e: unknown) { error.value = '加载更多失败：' + ((e as Error).message || e) }
  finally { loadingMore.value = false }
}

// 无限滚动：哨兵进入视口（含 600px 预加载区）即拉下一页，不依赖具体滚动容器
const sentinelEl = ref<HTMLElement | null>(null)
let io: IntersectionObserver | null = null

async function loadCategories() {
  try {
    categories.value = await listCategories()
    tree.value = buildCategoryTree(categories.value)
  } catch { /* 静默 */ }
  try { catCountMap.value = await countMaterialsByCategory() } catch { /* 静默 */ }
}

function openAdd() { showAdd.value = true }

/** 点卡片 → 全屏详情页（操作都集中在那里） */
function openDetail(it: MaterialRow) {
  router.push(`/m/material/${it.id}`)
}

/** 新增保存后：刷新列表与计数 */
async function onSaved() {
  showAdd.value = false
  await load()
  void refreshCounts()
  toast.success('物料已添加')
}

/** 分类计数刷新 */
async function refreshCounts() {
  try { catCountMap.value = await countMaterialsByCategory() } catch { /* 静默 */ }
}

onMounted(() => {
  loadCategories()
  load()
  io = new IntersectionObserver(es => {
    if (es.some(e => e.isIntersecting)) loadMore()
  }, { rootMargin: '600px 0px' })
  if (sentinelEl.value) io.observe(sentinelEl.value)
})
onBeforeUnmount(() => {
  io?.disconnect()
  clearTimeout(debounce)
})
</script>

<style scoped>
.mpage {
  display: flex;
  flex-direction: column;
  min-height: 100%;
}

/* ===== 吸顶工具区：搜索 + 分类 chips =====
   负外边距吃掉 MobileShell .content 的 16px padding，使吸顶时贴住滚动区顶缘 */
.topbar {
  position: sticky;
  top: 0;
  z-index: 10;
  margin: -16px -16px 0;
  padding: 12px 16px 10px;
  background: var(--c-bg);
  border-bottom: 1px solid var(--c-border-hairline);
}

.search {
  display: flex;
  align-items: center;
  gap: 8px;
  background: var(--c-surface);
  border: 1px solid var(--c-border);
  border-radius: var(--r-md);
  padding: 0 12px;
  height: var(--ctrl-h-lg);
}

.search:focus-within {
  border-color: var(--c-primary);
}

.search input {
  border: none;
  background: transparent;
  flex: 1;
  height: 100%;
  padding: 0;
  font-size: var(--fs-lg);
}

.search input:focus {
  box-shadow: none;
  outline: none;
}

.s-ico {
  color: var(--c-text-3);
}

/* 分类 chips：横向滚动，不换行 */
.chips {
  display: flex;
  gap: 6px;
  margin-top: 8px;
  overflow-x: auto;
  scrollbar-width: none;
}

.chips::-webkit-scrollbar {
  display: none;
}

.chips.sub {
  margin-top: 6px;
}

.chip {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 30px;
  padding: 0 12px;
  border: 1px solid var(--c-border);
  border-radius: var(--r-pill);
  background: var(--c-surface);
  color: var(--c-text-2);
  font-family: inherit;
  font-size: var(--fs-sm);
  font-weight: 500;
  white-space: nowrap;
  cursor: pointer;
  transition: background-color var(--motion-fast), color var(--motion-fast), border-color var(--motion-fast);
}

.chip.on {
  background: var(--c-primary-soft);
  border-color: transparent;
  color: var(--c-primary);
  font-weight: 600;
}

.chip .ct {
  font-size: var(--fs-xs);
  font-variant-numeric: tabular-nums;
  color: var(--c-text-3);
}

.chip.on .ct {
  color: var(--c-primary);
  opacity: 0.75;
}

/* ===== 列表区 ===== */
.list-wrap {
  margin-top: 12px;
  display: flex;
  flex-direction: column;
  flex: 1;
}

.error {
  margin: 0 0 10px;
  color: var(--c-danger);
  font-size: var(--fs-sm);
}

.retry-link {
  margin-left: 8px;
  padding: 0;
  border: none;
  background: transparent;
  color: var(--c-primary);
  font-family: inherit;
  font-size: var(--fs-sm);
  font-weight: 600;
  cursor: pointer;
  text-decoration: underline;
}

.hint {
  display: grid;
  place-items: center;
  padding: 60px 0;
}

.spinner-lg {
  width: 32px;
  height: 32px;
  border: 3px solid var(--c-border);
  border-top-color: var(--c-primary);
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 60px 0;
  color: var(--c-text-2);
  text-align: center;
}

.empty-ico {
  width: 72px;
  height: 72px;
  border-radius: var(--r-xl);
  background: var(--c-surface);
  display: grid;
  place-items: center;
  color: var(--c-text-3);
  margin-bottom: 8px;
}

.empty h3 {
  margin: 0;
  font-size: var(--fs-lg);
  color: var(--c-text);
}

.empty p {
  margin: 0;
  font-size: var(--fs-sm);
}

.grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 10px;
}

.load-more,
.load-end {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 14px 0 4px;
  font-size: var(--fs-xs);
  color: var(--c-text-3);
}

.spinner-sm {
  width: 14px;
  height: 14px;
  border: 2px solid var(--c-border);
  border-top-color: var(--c-primary);
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
}

.sentinel {
  height: 1px;
}

/* ===== 电商橱窗卡片：大图 + 少文字 + 价格重心，零操作 ===== */
.item {
  position: relative;
  background: var(--c-surface);
  border: 1px solid var(--c-border);
  border-radius: var(--r-lg);
  overflow: hidden;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  transition: transform 120ms ease-out;
  -webkit-tap-highlight-color: transparent;
}

/* 触屏按压反馈 */
.item:active {
  transform: scale(0.98);
}

/* 1:1 方图（电商橱窗比例） */
.thumb {
  position: relative;
  aspect-ratio: 1;
  background: var(--c-glass);
  overflow: hidden;
  flex-shrink: 0;
}

.thumb img {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.thumb-ph {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  color: var(--c-text-3);
}

/* 低库存角标（缩略图左上角） */
.low-tag {
  position: absolute;
  top: 6px;
  left: 6px;
  z-index: 1;
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--c-danger);
  color: #fff;
  font-size: var(--fs-xs);
  font-weight: 600;
  pointer-events: none;
}

/* 卡片内容 */
.body {
  padding: 8px 10px 10px;
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
}

/* 名称：最多两行（电商标题式） */
.body h3 {
  margin: 0;
  font-size: var(--fs-md);
  font-weight: 600;
  line-height: 1.35;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  min-height: 2.7em;
  word-break: break-all;
}

.meta {
  margin: 3px 0 0;
  font-size: var(--fs-xs);
  color: var(--c-text-2);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.row {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  margin-top: auto;
  padding-top: 6px;
  gap: 6px;
}

/* 价格：视觉重心（电商式大号价格） */
.price {
  font-size: 16px;
  font-weight: 800;
  color: var(--c-danger);
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.01em;
  white-space: nowrap;
}

.qty {
  font-size: var(--fs-xs);
  font-weight: 600;
  color: var(--c-text-3);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.qty.low {
  color: var(--c-danger);
}

/* ===== 添加物料 FAB：悬浮于 tabbar 上方 ===== */
.fab {
  position: fixed;
  right: 18px;
  bottom: calc(var(--tabbar-h) + env(safe-area-inset-bottom) + 20px);
  z-index: 40;
  width: 52px;
  height: 52px;
  border: none;
  border-radius: 50%;
  background: var(--c-primary);
  color: #fff;
  display: grid;
  place-items: center;
  cursor: pointer;
  box-shadow: var(--shadow-lg);
  transition: transform 120ms ease-out, background-color var(--motion-fast);
  -webkit-tap-highlight-color: transparent;
}

.fab:active {
  background: var(--c-primary-press);
  transform: scale(0.92);
}
</style>
