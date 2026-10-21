<template>
  <section class="mpage">
    <!-- 下拉刷新只包住滚动内容：PullRefresh 的内容层带 transform，会成为 fixed 的包含块，
         所以 FAB / 弹窗 / 筛选面板必须留在外面，否则会跟着位移或错位。
         section 保持单一根节点，<Transition mode="out-in"> 才能正常算出进出场。 -->
    <PullRefresh @refresh="onRefresh">
      <!-- 吸顶：搜索 + 筛选（参考立创商城：搜索框 + 右侧筛选入口） -->
      <div class="topbar">
      <div class="search-row">
        <div class="search">
          <Search :size="14" class="s-ico" style="display: inline-flex; flex-shrink: 0" />
          <input v-model="search" type="search" placeholder="搜索名称 / 型号 / 编号…" />
        </div>
        <button class="icon-btn" title="切换视图" @click="toggleView">
          <component :is="viewMode === 'list' ? Grid3x3 : List" :size="16" style="display: inline-flex; flex-shrink: 0" />
        </button>
        <button class="filter-btn" :class="{ on: filterCount > 0 }" @click="panelOpen = true">
          <SlidersHorizontal :size="15" style="display: inline-flex; flex-shrink: 0" />
          <span>筛选</span>
          <i v-if="filterCount" class="f-badge">{{ filterCount }}</i>
        </button>
      </div>
      <!-- 已选条件（横向 chips，可单个清除） -->
      <div v-if="selectedTags.length" class="sel-tags">
        <button v-for="t in selectedTags" :key="t.key" class="sel-tag" @click="removeTag(t.key)">
          {{ t.label }}<X :size="11" style="display: inline-flex; flex-shrink: 0" />
        </button>
        <button class="sel-tag clear" @click="clearAll">清空</button>
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
        <!-- 双列卡片（字段与 PC 物料卡片对齐：名称+编号/品牌型号/参数/小类+封装tag/库存+库位+价格） -->
        <div v-if="viewMode === 'grid'" class="grid">
          <article v-for="it in items" :key="it.id" class="item grid-item" @click="openDetail(it)">
            <div class="thumb">
              <img v-if="imagePublicUrl(it.image_path)" :src="imagePublicUrl(it.image_path)" alt="" loading="lazy" />
              <div v-else class="thumb-ph">
                <ImageIcon :size="24" style="display: inline-flex; flex-shrink: 0" />
              </div>
              <span v-if="isLow(it)" class="low-tag">低库存</span>
            </div>
            <div class="body">
              <h3>
                <span class="name">{{ it.name }}</span>
                <span class="part-no" v-if="it.part_no">{{ it.part_no }}</span>
              </h3>
              <p class="meta">{{ it.brand || '—' }} · {{ it.model || '—' }}</p>
              <p v-if="specLine(it)" class="specs">{{ specLine(it) }}</p>
              <div class="tags">
                <span class="tag" v-if="it.categories?.name">{{ it.categories.name }}</span>
                <span class="tag" v-if="it.package">{{ it.package }}</span>
              </div>
              <div class="row">
                <span class="qty" :class="{ low: isLow(it) }">×{{ it.qty }}</span>
                <span class="row-r">
                  <span v-if="it.location" class="loc">
                    <MapPin :size="12" style="display: inline-flex; flex-shrink: 0" />{{ it.location }}
                  </span>
                  <span class="price">¥{{ formatPrice(it.price) }}</span>
                </span>
              </div>
            </div>
          </article>
        </div>

        <!-- 单列行卡（同一套字段，行式布局） -->
        <div v-else class="list">
          <article v-for="it in items" :key="it.id" class="item row-item" @click="openDetail(it)">
            <div class="row-thumb">
              <img v-if="imagePublicUrl(it.image_path)" :src="imagePublicUrl(it.image_path)" alt="" loading="lazy" />
              <div v-else class="thumb-ph">
                <ImageIcon :size="22" style="display: inline-flex; flex-shrink: 0" />
              </div>
              <span v-if="isLow(it)" class="low-tag sm">低库存</span>
            </div>
            <div class="row-body">
              <div class="row-head">
                <h3 class="row-name">
                  {{ it.name }}
                  <span v-if="it.part_no" class="row-pn">{{ it.part_no }}</span>
                </h3>
                <span class="row-qty" :class="{ low: isLow(it) }">×{{ it.qty }}</span>
              </div>
              <p class="row-line2">{{ it.brand || '—' }} · {{ it.model || '—' }}</p>
              <p v-if="specLine(it)" class="row-specs">{{ specLine(it) }}</p>
              <div v-if="it.categories?.name || it.package" class="row-tags">
                <span class="row-tag" v-if="it.categories?.name">{{ it.categories.name }}</span>
                <span class="row-tag" v-if="it.package">{{ it.package }}</span>
              </div>
              <div class="row-foot">
                <span v-if="it.location" class="loc">
                  <MapPin :size="12" style="display: inline-flex; flex-shrink: 0" />{{ it.location }}
                </span>
                <span class="price">¥{{ formatPrice(it.price) }}</span>
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
    </PullRefresh>

    <!-- 添加物料 FAB（悬浮在 tabbar 上方） -->
    <button class="fab" title="添加物料" @click="openAdd">
      <Plus :size="22" style="display: inline-flex; flex-shrink: 0" />
    </button>

    <!-- 新增物料表单（复用桌面弹窗；编辑在详情页） -->
    <MaterialFormDialog v-model="showAdd" :categories="categories" :material="null" @saved="onSaved" />

    <!-- 筛选面板（库位 → 大类 → 小类 → 扩展参数） -->
    <MaterialFilterPanel :open="panelOpen" :tree="tree"
      :cat-id="catId" :params="paramSel" :location="location"
      @apply="onFilterApply" @close="panelOpen = false" />
  </section>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import { useRouter } from 'vue-router'
import PullRefresh from '../../components/mobile/PullRefresh.vue'
import { Search, Plus, Box, Image as ImageIcon, X, SlidersHorizontal, Grid3x3, List, MapPin } from 'lucide-vue-next'
import {
  listMaterials, countMaterials, listCategories,
  imagePublicUrl, buildCategoryTree, descendantCategoryIds, getCategoryParams,
} from '../../lib/db'
import { filterFieldParams } from '../../lib/paramFields'
import type { Category, MaterialRow, CategoryParam } from '../../lib/types'
import type { CategoryNode } from '../../lib/db'
import type { ListMaterialsOpts } from '../../lib/storage'
import { withAuthRetry } from '../../lib/authRetry'
import MaterialFormDialog from '../../components/business/MaterialFormDialog.vue'
import MaterialFilterPanel from '../../components/mobile/MaterialFilterPanel.vue'
import { useToast } from '../../composables/toast'

/**
 * 移动端物料库 Tab（电商橱窗式）：搜索 + 立创式筛选面板 + 双列大图卡片流。
 * 筛选层级：大类 → 小类 → 小类扩展参数（面板内逐级出现）。
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
/** 扩展参数筛选 { 参数 key: 值 }，仅选中小类时有意义 */
const paramSel = ref<Record<string, string>>({})
/** 库位筛选（精确匹配，来自库位字典） */
const location = ref<string | null>(null)
/** 当前小类参数模板（已选条件 tag 显示名称用） */
const leafParams = ref<CategoryParam[]>([])

const panelOpen = ref(false)

const loading = ref(false)
const error = ref('')
const limit = ref(20)
const offset = ref(0)
const total = ref(0)
const hasMore = ref(false)
const loadingMore = ref(false)

const showAdd = ref(false)

/** 视图模式：双列橱窗卡片（默认，电商浏览） / 行卡（信息密集） */
type ViewMode = 'grid' | 'list'
const VIEW_KEY = 'llb.m.view.materials'
const viewMode = ref<ViewMode>((localStorage.getItem(VIEW_KEY) as ViewMode) || 'grid')
function toggleView() {
  viewMode.value = viewMode.value === 'list' ? 'grid' : 'list'
  localStorage.setItem(VIEW_KEY, viewMode.value)
}

function isLow(it: MaterialRow) {
  const t = it.threshold || it.categories?.threshold || 5
  return it.qty <= t
}
function formatPrice(v: number) { return Number(v || 0).toFixed(2) }

/** 分类是否为大类（树顶层） */
function isTopCategory(id: string) {
  return tree.value.some(n => n.cat.id === id)
}

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

/** 组合查询参数：搜索 + 分类范围 + 参数 + 库位 */
function buildOpts(): ListMaterialsOpts {
  const opts: ListMaterialsOpts = { search: search.value, ...categoryScope() }
  const p: Record<string, string> = {}
  for (const [k, v] of Object.entries(paramSel.value)) if (v) p[k] = v
  if (Object.keys(p).length) opts.params = p
  if (location.value) opts.location = location.value
  return opts
}

/** 已选分类名称（tag 文案） */
function catName(id: string): string {
  for (const n of tree.value) {
    if (n.cat.id === id) return n.cat.name
    const c = n.children.find(x => x.cat.id === id)
    if (c) return c.cat.name
  }
  return '分类'
}

/** 参数行（与 PC Home 卡片同口径）：排除与品牌/型号/封装字段重复的参数值，前 3 个 join */
function specLine(it: MaterialRow): string {
  return filterFieldParams(it.params, { fieldValues: [it.model, it.brand, it.package] })
    .map(([, v]) => v)
    .slice(0, 3)
    .join(' · ')
}

/** 已选条件 chips：库位 + 1 个分类 + 若干参数 */
const selectedTags = computed(() => {
  const tags: { key: string; label: string }[] = []
  if (location.value) tags.push({ key: '__loc', label: '库位:' + location.value })
  if (catId.value) tags.push({ key: '__cat', label: catName(catId.value) })
  for (const p of leafParams.value) {
    if (paramSel.value[p.key]) tags.push({ key: p.key, label: `${p.name}:${paramSel.value[p.key]}` })
  }
  return tags
})

/** 已选条件数（筛选按钮红点） */
const filterCount = computed(() =>
  (location.value ? 1 : 0) + (catId.value ? 1 : 0) + Object.values(paramSel.value).filter(Boolean).length)

const hasFilters = computed(() => !!search.value || filterCount.value > 0)

let debounce: ReturnType<typeof setTimeout> | undefined
function scheduleLoad() {
  clearTimeout(debounce); debounce = setTimeout(load, 250)
}
watch(search, scheduleLoad)
// 分类变化：拉参数模板（小类才有）并重置旧参数，再查询
watch(catId, async (id) => {
  paramSel.value = {}
  leafParams.value = []
  if (id && !isTopCategory(id)) {
    try { leafParams.value = await getCategoryParams(id) } catch { /* 静默 */ }
  }
  scheduleLoad()
})
watch(paramSel, scheduleLoad, { deep: true })
watch(location, scheduleLoad)

async function load() {
  loading.value = true; error.value = ''
  offset.value = 0
  try {
    const opts = buildOpts()
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

/** 下拉刷新：回到第一页重拉（保留当前筛选条件），并顺带同步一次分类树 */
async function onRefresh(done: () => void) {
  await Promise.all([load(), loadCategories()])
  done()
}

async function loadMore() {
  if (loading.value || loadingMore.value || !hasMore.value || error.value) return
  loadingMore.value = true
  try {
    offset.value += limit.value
    const page = await withAuthRetry(() =>
      listMaterials({ ...buildOpts(), limit: limit.value, offset: offset.value }))
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
}

function openAdd() { showAdd.value = true }

/** 点卡片 → 全屏详情页（操作都集中在那里） */
function openDetail(it: MaterialRow) {
  router.push(`/m/material/${it.id}`)
}

/** 筛选面板确定：赋值即可，实际变化由下方 watch 触发查询（未变化则无需重查） */
function onFilterApply(payload: { catId: string | null; params: Record<string, string>; location: string | null }) {
  catId.value = payload.catId
  paramSel.value = payload.params
  location.value = payload.location
}

/** 移除单个已选条件 tag */
function removeTag(key: string) {
  if (key === '__cat') catId.value = null
  else if (key === '__loc') location.value = null
  else delete paramSel.value[key]
}

/** 清空全部筛选条件（保留搜索） */
function clearAll() {
  catId.value = null
  paramSel.value = {}
  location.value = null
}

/** 新增保存后：刷新列表 */
async function onSaved() {
  showAdd.value = false
  await load()
  toast.success('物料已添加')
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

/* PullRefresh 在 section 内部：把 flex 链传下去，否则 .list-wrap 的 flex:1 失效 */
.mpage :deep(.pr-wrap),
.mpage :deep(.pr-content) {
  display: flex;
  flex-direction: column;
  flex: 1;
}

/* ===== 吸顶工具区：搜索 + 筛选 =====
   水平负外边距吃掉 .content 的 16px 侧 padding 实现全宽吸顶；
   顶部 padding 本就是 0，不能再用负 margin（会把 topbar 拽出可视区） */
.topbar {
  position: sticky;
  top: 0;
  z-index: 10;
  margin: 0 -16px;
  padding: 12px 16px 10px;
  background: var(--c-bg);
  border-bottom: 1px solid var(--c-border-hairline);
}

.search-row {
  display: flex;
  gap: 8px;
  align-items: center;
}

.search {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  background: var(--c-surface);
  border: 1px solid var(--c-border);
  border-radius: var(--r-md);
  padding: 0 10px;
  height: 34px;
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
  font-size: var(--fs-sm);
}

.search input:focus {
  box-shadow: none;
  outline: none;
}

.s-ico {
  color: var(--c-text-3);
  flex-shrink: 0;
}

/* 筛选按钮 */
.filter-btn {
  position: relative;
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 34px;
  padding: 0 10px;
  border: 1px solid var(--c-border);
  border-radius: var(--r-md);
  background: var(--c-surface);
  color: var(--c-text-2);
  font-family: inherit;
  font-size: var(--fs-xs);
  font-weight: 600;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}

.filter-btn.on {
  border-color: transparent;
  background: var(--c-primary-soft);
  color: var(--c-primary);
}

/* 纯图标小按钮（视图切换） */
.icon-btn {
  flex-shrink: 0;
  width: 34px;
  height: 34px;
  border: 1px solid var(--c-border);
  border-radius: var(--r-md);
  background: var(--c-surface);
  color: var(--c-text-2);
  display: grid;
  place-items: center;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}

.icon-btn:active {
  background: var(--c-surface-hover);
}

.f-badge {
  position: absolute;
  top: -5px;
  right: -5px;
  min-width: 16px;
  height: 16px;
  padding: 0 4px;
  border-radius: 999px;
  background: var(--c-danger);
  color: #fff;
  font-size: 10px;
  font-style: normal;
  font-weight: 700;
  line-height: 16px;
  text-align: center;
}

/* 已选条件 chips */
.sel-tags {
  display: flex;
  gap: 6px;
  margin-top: 8px;
  overflow-x: auto;
  scrollbar-width: none;
}

.sel-tags::-webkit-scrollbar {
  display: none;
}

.sel-tag {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 26px;
  padding: 0 9px;
  border: none;
  border-radius: var(--r-pill);
  background: var(--c-primary-soft);
  color: var(--c-primary);
  font-family: inherit;
  font-size: var(--fs-xs);
  font-weight: 600;
  white-space: nowrap;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}

.sel-tag.clear {
  background: var(--c-bg-2);
  color: var(--c-text-2);
}

/* ===== 列表区 ===== */
.list-wrap {
  margin-top: 6px;
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

/* ===== 单列行卡列表（信息密集型） ===== */
.list {
  display: flex;
  flex-direction: column;
  gap: 0;
}

.row-item {
  display: flex;
  gap: 12px;
  padding: 12px 0;
  border-bottom: 1px solid var(--c-border-hairline);
  background: transparent;
}

.row-item:last-child {
  border-bottom: none;
}

.row-thumb {
  position: relative;
  flex-shrink: 0;
  width: 88px;
  height: 88px;
  border-radius: var(--r-md);
  background: var(--c-glass);
  overflow: hidden;
}

.row-thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.low-tag.sm {
  top: 4px;
  left: 4px;
  padding: 1px 6px;
  font-size: 10px;
}

.row-body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.row-head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 8px;
}

.row-name {
  margin: 0;
  font-size: var(--fs-md);
  font-weight: 600;
  line-height: 1.35;
  display: -webkit-box;
  -webkit-line-clamp: 1;
  -webkit-box-orient: vertical;
  overflow: hidden;
  flex: 1;
  min-width: 0;
  word-break: break-all;
}

/* 编号跟随名称（与 PC 卡片一致） */
.row-name .row-pn {
  margin-left: 6px;
  font-size: var(--fs-xs);
  font-weight: 400;
  color: var(--c-text-3);
}

.row-qty {
  flex-shrink: 0;
  font-size: var(--fs-sm);
  font-weight: 700;
  color: var(--c-text-2);
  font-variant-numeric: tabular-nums;
}

.row-qty.low {
  color: var(--c-danger);
}

.row-line2,
.row-specs {
  margin: 0;
  font-size: var(--fs-xs);
  color: var(--c-text-2);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* 小类 + 封装 tag（与双列卡片同一套） */
.row-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 2px;
}

.row-tag {
  padding: 1px 7px;
  border-radius: var(--r-pill);
  background: var(--c-bg-2);
  color: var(--c-text-2);
  font-size: 11px;
  font-weight: 500;
  line-height: 1.5;
  white-space: nowrap;
}

.row-foot {
  margin-top: auto;
  padding-top: 4px;
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 6px;
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

/* ===== 卡片公共 ===== */
.item {
  cursor: pointer;
  transition: transform 120ms ease-out;
  -webkit-tap-highlight-color: transparent;
}

/* 触屏按压反馈 */
.item:active {
  transform: scale(0.98);
}

/* ===== 电商橱窗双列卡片 ===== */
.grid-item {
  position: relative;
  background: var(--c-surface);
  border: 1px solid var(--c-border);
  border-radius: var(--r-lg);
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

/* 4:3 图（比 1:1 矮，给信息区让空间） */
.thumb {
  position: relative;
  aspect-ratio: 4 / 3;
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

/* 双列卡片内容 */
.body {
  padding: 8px 10px 10px;
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
}

/* 名称 + 编号同行（与 PC 卡片一致：名称主显，编号小号灰字跟随） */
.body h3 {
  margin: 0;
  font-size: var(--fs-md);
  font-weight: 600;
  line-height: 1.35;
  display: -webkit-box;
  -webkit-line-clamp: 1;
  -webkit-box-orient: vertical;
  overflow: hidden;
  word-break: break-all;
}

.body h3 .part-no {
  margin-left: 6px;
  font-size: var(--fs-xs);
  font-weight: 400;
  color: var(--c-text-3);
}

.meta {
  margin: 3px 0 0;
  font-size: var(--fs-xs);
  color: var(--c-text-2);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* 参数行（与 PC 卡片一致） */
.specs {
  margin: 3px 0 0;
  font-size: var(--fs-xs);
  color: var(--c-text-2);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* 小类 + 封装 tag（与 PC 卡片一致的胶囊 tag） */
.tags {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 5px;
}

.tag {
  padding: 1px 7px;
  border-radius: var(--r-pill);
  background: var(--c-bg-2);
  color: var(--c-text-2);
  font-size: 11px;
  font-weight: 500;
  line-height: 1.5;
  white-space: nowrap;
}

.body .row {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  margin-top: auto;
  padding-top: 6px;
  gap: 6px;
}

.body .row .qty {
  font-size: var(--fs-sm);
  font-weight: 700;
  color: var(--c-text-2);
  font-variant-numeric: tabular-nums;
}

.body .row .qty.low {
  color: var(--c-danger);
}

.row-r {
  display: inline-flex;
  align-items: baseline;
  gap: 6px;
  min-width: 0;
}

/* 库位（与 PC 卡片一致：图标 + 文本，紧贴价格左侧） */
.loc {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  font-size: var(--fs-xs);
  color: var(--c-text-3);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
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
