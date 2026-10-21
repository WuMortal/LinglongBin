<template>
  <section class="mpage" :class="{ readonly }" v-if="m">
    <!-- 返回栏：通用吸顶组件（只读弹窗模式不渲染，外层由调用方提供关闭 X） -->
    <NavBar v-if="!readonly" :title="m.name" @back="onNavBack" />

    <div class="detail">
      <!-- 头部卡片：缩略图 + 名称/标签 + 价格库存 -->
      <div class="title-card">
        <div class="hd">
          <div class="thumb" @click="openViewer">
            <img v-if="previewUrl" :src="previewUrl" alt="" />
            <ImageIcon v-else :size="26" style="display: inline-flex; flex-shrink: 0" />
            <span v-if="isLow" class="low-tag">低库存</span>
          </div>
          <div class="hd-main">
            <h2>{{ m.name }}</h2>
            <p class="sub">{{ m.brand || '—' }} · {{ m.model || '—' }}</p>
            <div class="t-tags">
              <span class="ttag" v-if="catLine">{{ catLine }}</span>
              <span class="ttag" v-if="m.package">{{ m.package }}</span>
              <span class="ttag loc" v-if="m.location">
                <MapPin :size="11" style="display: inline-flex; flex-shrink: 0" />{{ m.location }}
              </span>
            </div>
          </div>
        </div>
        <div class="price-row">
          <div class="price-main">
            <span class="cur">¥</span><span class="num">{{ fmtPrice(m.price) }}</span>
            <span class="unit">/ 件</span>
          </div>
          <div class="price-side">
            <span class="stk" :class="{ low: isLow }">库存 ×{{ m.qty }}</span>
            <span class="val">总值 ¥{{ fmtPrice(m.qty * m.price) }}</span>
          </div>
        </div>
      </div>

      <!-- 基本信息 -->
      <section class="sec">
        <h3>基本信息</h3>
        <div class="kv-grid">
          <div class="kv"><span>商品编号</span><b class="mono">{{ m.part_no || '—' }}</b></div>
          <div class="kv"><span>预警阈值</span><b>{{ effThreshold }}</b></div>
          <div class="kv"><span>创建时间</span><b>{{ fmtTime(m.created_at) }}</b></div>
          <div class="kv">
            <span>物料链接</span>
            <a v-if="m.link" class="link" href="#" @click.prevent="openDs(m.link!)">打开
              <ArrowUpRight :size="12" style="display: inline-flex; flex-shrink: 0" />
            </a>
            <b v-else>—</b>
          </div>
        </div>
      </section>

      <!-- 扩展参数 -->
      <section class="sec" v-if="paramList.length">
        <h3>扩展参数</h3>
        <div class="kv-grid">
          <div class="kv" v-for="p in paramList" :key="p.key">
            <span>{{ p.name }}</span><b>{{ p.value }}</b>
          </div>
        </div>
      </section>

      <!-- 附件 -->
      <section class="sec" v-if="fileRows.length">
        <h3>数据手册 / 附件</h3>
        <div class="file-list">
          <button v-for="f in fileRows" :key="f.key" type="button" class="file" @click="openDs(f.url)">
            <FileText :size="16" class="f-ico" style="display: inline-flex; flex-shrink: 0" />
            <span class="f-name">{{ f.name }}</span>
            <span v-if="f.tag" class="f-tag">{{ f.tag }}</span>
          </button>
        </div>
      </section>

      <!-- 替代料 -->
      <section class="sec" v-if="m.alternates?.length">
        <h3>替代料</h3>
        <div class="alt-list">
          <code v-for="a in m.alternates" :key="a" class="alt">{{ a }}</code>
        </div>
      </section>

      <!-- 出入库记录 -->
      <section class="sec">
        <h3>出入库记录</h3>
        <div v-if="logLoading" class="sec-hint">
          <div class="spinner-sm" />
        </div>
        <p v-else-if="!logs.length" class="sec-empty">暂无记录</p>
        <ul v-else class="log-list">
          <li v-for="r in logs" :key="r.id" :class="[r.type, { 'is-void': r.status === 'void' }]">
            <span class="tag">{{ r.type === 'in' ? '入' : '出' }}</span>
            <div class="info">
              <small class="who">{{ fmtTime(r.created_at) }}</small>
              <small class="note" v-if="r.order_no || r.note || r.suppliers?.name">
                {{ [r.order_no, r.suppliers?.name, r.note].filter(Boolean).join(' · ') }}
              </small>
              <small v-if="r.status === 'void'" class="note void-note">
                已撤销<template v-if="r.void_reason">：{{ r.void_reason }}</template>
              </small>
            </div>
            <span class="q">{{ r.type === 'in' ? '+' : '-' }}{{ r.qty }}</span>
          </li>
        </ul>
      </section>
    </div>

    <!-- 底部操作栏：编辑 / 删除 + 入库 / 出库（只读弹窗模式隐藏） -->
    <div class="actbar" v-if="!readonly">
      <div class="act-ico">
        <button class="ibtn" title="编辑" @click="openEdit">
          <Pencil :size="19" style="display: inline-flex; flex-shrink: 0" />
        </button>
        <button class="ibtn danger" title="删除" @click="remove">
          <Trash2 :size="19" style="display: inline-flex; flex-shrink: 0" />
        </button>
      </div>
      <button class="abtn in" @click="sheetOpen = 'in'">
        <ArrowDownToLine :size="17" style="display: inline-flex; flex-shrink: 0" />入库
      </button>
      <button class="abtn out" @click="sheetOpen = 'out'">
        <ArrowUpFromLine :size="17" style="display: inline-flex; flex-shrink: 0" />出库
      </button>
    </div>

    <!-- 编辑表单（复用桌面弹窗） -->
    <MaterialFormDialog v-model="showEdit" :categories="categories" :material="m" @saved="reload" />

    <!-- 出入库（移动端 bottom sheet，按钮决定初始入/出） -->
    <QuickStockSheet :material="sheetOpen ? m : null" :initial-type="sheetOpen ?? undefined" @done="onQuickDone"
      @close="sheetOpen = null" />

    <!-- 大图预览 -->
    <ImageViewer v-model:open="showViewer" :src="previewUrl" />
  </section>

  <!-- 加载 / 错误态 -->
  <section v-else class="mpage">
    <div v-if="loadError" class="load-state">
      <p>{{ loadError }}</p>
      <button class="btn btn-primary" @click="load">重试</button>
    </div>
    <div v-else class="load-state">
      <div class="spinner-lg" />
    </div>
  </section>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  Image as ImageIcon, MapPin, ArrowUpRight, FileText, Pencil, Trash2,
  ArrowDownToLine, ArrowUpFromLine,
} from 'lucide-vue-next'
import {
  getMaterial, getCategoryParams, listStockLog, listMaterialFiles,
  listCategories, deleteMaterial, imagePublicUrl, openDatasheet,
} from '../../lib/db'
import type { Category, MaterialRow, CategoryParam, StockLog, MaterialFile } from '../../lib/types'
import { filterFieldParams } from '../../lib/paramFields'
import MaterialFormDialog from '../../components/business/MaterialFormDialog.vue'
import NavBar from '../../components/mobile/NavBar.vue'
import QuickStockSheet from '../../components/mobile/QuickStockSheet.vue'
import ImageViewer from '../../components/ImageViewer.vue'
import { useToast } from '../../composables/toast'
import { confirm } from '../../composables/confirm'

/**
 * 移动端物料详情（全屏页，电商商详式）：
 * 大图 + 价格区 + 信息区 + 出入库记录 + 底部操作栏（编辑/删除 + 入库/出库）。
 * 替代桌面的 MaterialDetailDrawer。
 */
const route = useRoute()
const router = useRouter()
const toast = useToast()

/**
 * 支持两种用法：
 * 1. 作为路由页 /m/material/:id（默认，route.params.id 驱动）；
 * 2. 作为只读弹窗被其它页嵌入（传 id + readonly，去掉底部操作，返回关闭弹窗）。
 */
const props = withDefaults(defineProps<{ id?: string; readonly?: boolean }>(), {
  id: undefined,
  readonly: false,
})
const emit = defineEmits<{ close: [] }>()

const m = ref<MaterialRow | null>(null)
const catParams = ref<CategoryParam[]>([])
const logs = ref<StockLog[]>([])
const logLoading = ref(false)
const files = ref<MaterialFile[]>([])
const categories = ref<Category[]>([])
const loadError = ref('')

const showEdit = ref(false)
/** 出入库 sheet：null=关，'in'/'out'=以对应模式打开 */
const sheetOpen = ref<'in' | 'out' | null>(null)
const showViewer = ref(false)

const previewUrl = computed(() => imagePublicUrl(m.value?.image_path || '') || null)

/** 生效阈值：物料自身（>0）→ 分类（>0）→ 默认 5 */
const effThreshold = computed(() => {
  const v = m.value
  if (!v) return 0
  return (v.threshold || 0) > 0 ? v.threshold : (v.categories?.threshold || 0) > 0 ? v.categories!.threshold as number : 5
})
const isLow = computed(() => !!m.value && m.value.qty <= effThreshold.value)

const catLine = computed(() => {
  const c = m.value?.categories
  return c ? [c.parent_name, c.name].filter(Boolean).join(' / ') : ''
})

/** 扩展参数（过滤型号/品牌/封装等主表字段，与抽屉口径一致） */
const paramList = computed(() => {
  const v = m.value
  if (!v) return []
  return filterFieldParams(v.params, {
    template: catParams.value,
    fieldValues: [v.model, v.brand, v.package],
  }).map(([k, val]) => ({
    key: k,
    name: catParams.value.find(p => p.key === k)?.name || k,
    value: val,
  }))
})

/** 附件行：material_files + 旧数据主手册兼容 */
const fileRows = computed(() => {
  const v = m.value
  const rows = files.value.map(f => {
    const tag = fileTag(f.file_type)
    const name = (f.name || '').trim() || tag
    return { key: f.id, name, url: f.url, tag: name.startsWith(`(${tag})`) ? '' : tag }
  })
  const mainUrl = v?.datasheet_path || ''
  if (mainUrl && !rows.some(r => r.url === mainUrl)) {
    rows.unshift({ key: 'main', name: '数据手册', url: mainUrl, tag: '' })
  }
  return rows
})

function fileTag(t: string | null | undefined): string {
  switch (t) {
    case 'pdf_property': return '数据手册'
    case 'certification_data_property': return '认证资料'
    case 'industry_information': return '行业资讯'
    default: return '附件'
  }
}

function fmtTime(iso: string) {
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}
function fmtPrice(v: number) { return Number(v || 0).toFixed(2) }

async function openDs(path: string) {
  try { await openDatasheet(path) }
  catch (e: unknown) {
    toast.error('打开失败：' + ((e as Error).message || e))
  }
}

function openViewer() { if (previewUrl.value) showViewer.value = true }
function openEdit() { showEdit.value = true }

/** 返回：只读弹窗模式交给父组件关闭；否则沿用 NavBar 默认（有历史退、无历史去物料库） */
function onNavBack() {
  if (props.readonly) { emit('close'); return }
  if (window.history.length > 1) router.back()
  else router.replace('/m/materials')
}

async function load() {
  const id = (props.id ?? route.params.id) as string
  if (!id) return
  loadError.value = ''
  m.value = null
  try {
    const [fresh, cats] = await Promise.all([
      getMaterial(id),
      categories.value.length ? Promise.resolve(categories.value) : listCategories(),
    ])
    m.value = fresh
    categories.value = cats
    // 参数模板 / 记录 / 附件并行
    const ps: Promise<unknown>[] = []
    if (fresh.category_id) ps.push(getCategoryParams(fresh.category_id).then(p => { catParams.value = p }).catch(() => { }))
    ps.push(loadLogs(id))
    ps.push(loadFiles(id))
    await Promise.all(ps)
  } catch (e: unknown) {
    loadError.value = '加载失败：' + ((e as Error).message || e)
  }
}

async function loadLogs(materialId: string) {
  logLoading.value = true
  try { logs.value = await listStockLog({ materialId, limit: 100 }) }
  catch { logs.value = [] }
  finally { logLoading.value = false }
}

async function loadFiles(materialId: string) {
  try { files.value = await listMaterialFiles(materialId) }
  catch { files.value = [] }
}

/** 编辑保存 / 出入库成功后刷新（分类可能被改，参数模板与附件一并刷新） */
async function reload() {
  const id = route.params.id as string
  try {
    const fresh = await getMaterial(id)
    m.value = fresh
    if (fresh.category_id) {
      getCategoryParams(fresh.category_id).then(p => { catParams.value = p }).catch(() => { })
    } else {
      catParams.value = []
    }
  } catch { /* 静默 */ }
  void loadLogs(id)
  void loadFiles(id)
}

/** 出入库成功：刷新物料与记录 */
function onQuickDone() {
  void reload()
}

async function remove() {
  const v = m.value
  if (!v) return
  if (!await confirm({
    title: '删除物料',
    content: `确定删除「${v.name}」？此操作不可恢复。`,
    danger: true,
    confirmText: '删除',
  })) return
  try {
    await deleteMaterial(v.id)
    toast.success('删除成功')
    router.replace('/m/materials')
  }
  catch (e: unknown) { toast.error('删除失败：' + ((e as Error).message || e)) }
}

// id 优先（弹窗模式），其次路由页；route 非 m-material 且无 id 时不加载
watch(
  () => props.id ?? (route.name === 'm-material' ? (route.params.id as string) : null),
  (id) => { if (id) load() },
  { immediate: true },
)
</script>

<style scoped>
.mpage {
  display: flex;
  flex-direction: column;
  min-height: 100%;
}

/* ===== 详情内容 ===== */
.detail {
  /* 给底部操作栏留空间 */
  padding-bottom: calc(84px + env(safe-area-inset-bottom));
}

/* 只读弹窗模式（嵌入扫码页详情弹窗）：无操作栏，去掉底部留白 */
.mpage.readonly .detail {
  padding-bottom: 12px;
}

/* ===== 头部缩略图 ===== */
.thumb {
  position: relative;
  width: 92px;
  height: 92px;
  flex-shrink: 0;
  display: grid;
  place-items: center;
  padding: 6px;
  background: var(--c-glass);
  border: 1px solid var(--c-border);
  border-radius: var(--r-lg);
  overflow: hidden;
  color: var(--c-text-3);
  cursor: zoom-in;
}

.thumb img {
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.low-tag {
  position: absolute;
  top: 4px;
  left: 4px;
  padding: 1px 6px;
  border-radius: 999px;
  background: var(--c-danger);
  color: #fff;
  font-size: 10px;
  font-weight: 600;
}

/* ===== 价格 / 库存区：单行紧凑，库存与总值不另起一列 ===== */
.price-row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
  margin-top: 8px;
}

.price-main {
  display: inline-flex;
  align-items: baseline;
  color: var(--c-danger);
  min-width: 0;
}

.price-main .cur {
  font-size: var(--fs-sm);
  font-weight: 700;
}

.price-main .num {
  font-size: 18px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.01em;
}

.price-main .unit {
  font-size: var(--fs-xs);
  color: var(--c-text-3);
  margin-left: 2px;
}

.price-side {
  display: flex;
  align-items: baseline;
  gap: 8px;
  flex-shrink: 0;
}

.stk {
  font-size: var(--fs-sm);
  font-weight: 700;
  color: var(--c-accent);
  font-variant-numeric: tabular-nums;
}

.stk.low {
  color: var(--c-danger);
}

.val {
  font-size: var(--fs-xs);
  color: var(--c-text-3);
}

/* ===== 标题区（缩略图 + 名称，与价格同一张卡） ===== */
.title-card {
  margin-top: 12px;
  padding: 10px 12px;
  background: var(--c-surface);
  border: 1px solid var(--c-border);
  border-radius: var(--r-xl);
}

.hd {
  display: flex;
  align-items: flex-start;
  gap: 12px;
}

.hd-main {
  flex: 1;
  min-width: 0;
}

.title-card h2 {
  margin: 0;
  font-size: var(--fs-lg);
  font-weight: 700;
  line-height: 1.35;
  /* 名称最多两行，避免长名称把卡片顶高 */
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  overflow: hidden;
}

.sub {
  margin: 3px 0 0;
  font-size: var(--fs-sm);
  color: var(--c-text-2);
}

.t-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  margin-top: 6px;
}

.ttag {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 2px 9px;
  border-radius: 999px;
  background: var(--c-bg-2);
  color: var(--c-text-2);
  font-size: var(--fs-xs);
  font-weight: 500;
}

.ttag.loc {
  font-family: var(--font-mono);
}

/* ===== 通用信息区 ===== */
.sec {
  margin-top: 10px;
  padding: 10px 12px;
  background: var(--c-surface);
  border: 1px solid var(--c-border);
  border-radius: var(--r-xl);
}

.sec h3 {
  margin: 0 0 8px;
  font-size: var(--fs-md);
  font-weight: 700;
}

.kv-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px 12px;
}

.kv {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}

.kv span {
  font-size: var(--fs-xs);
  color: var(--c-text-3);
}

.kv b {
  font-size: var(--fs-sm);
  font-weight: 600;
  color: var(--c-text);
  word-break: break-all;
}

.mono {
  font-family: var(--font-mono);
}

.link {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  color: var(--c-primary);
  font-size: var(--fs-sm);
  font-weight: 600;
  text-decoration: none;
}

/* ===== 附件 ===== */
.file-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.file {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 42px;
  padding: 0 10px;
  border: 1px solid var(--c-border);
  border-radius: var(--r-md);
  background: var(--c-glass);
  color: var(--c-text);
  font-family: inherit;
  text-align: left;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}

.file:active {
  background: var(--c-surface-hover);
}

.f-ico {
  color: var(--c-text-3);
  flex-shrink: 0;
}

.f-name {
  flex: 1;
  min-width: 0;
  font-size: var(--fs-sm);
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.f-tag {
  flex-shrink: 0;
  padding: 1px 7px;
  border-radius: 999px;
  background: var(--c-bg-2);
  color: var(--c-text-2);
  font-size: var(--fs-xs);
}

/* ===== 替代料 ===== */
.alt-list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.alt {
  padding: 3px 9px;
  border-radius: var(--r-sm);
  background: var(--c-bg-2);
  border: 1px solid var(--c-border);
  color: var(--c-text-2);
  font-size: var(--fs-xs);
  font-family: var(--font-mono);
}

/* ===== 出入库记录 ===== */
.sec-hint {
  display: grid;
  place-items: center;
  padding: 16px 0;
}

.sec-empty {
  margin: 0;
  padding: 8px 0;
  font-size: var(--fs-sm);
  color: var(--c-text-3);
}

.log-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.log-list li {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  border-radius: var(--r-md);
  background: var(--c-glass);
}

.log-list li.is-void {
  opacity: 0.5;
}

.log-list .tag {
  flex-shrink: 0;
  width: 22px;
  height: 22px;
  display: grid;
  place-items: center;
  border-radius: 6px;
  font-size: var(--fs-xs);
  font-weight: 700;
}

.log-list li.in .tag {
  background: var(--c-primary-soft);
  color: var(--c-primary);
}

.log-list li.out .tag {
  background: rgba(255, 107, 107, 0.12);
  color: var(--c-danger);
}

.log-list .info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.log-list .who {
  font-size: var(--fs-xs);
  color: var(--c-text-2);
  font-variant-numeric: tabular-nums;
}

.log-list .note {
  font-size: var(--fs-xs);
  color: var(--c-text-3);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.void-note {
  color: var(--c-warning) !important;
}

.log-list .q {
  flex-shrink: 0;
  font-size: var(--fs-md);
  font-weight: 800;
  font-variant-numeric: tabular-nums;
}

.log-list li.in .q {
  color: var(--c-primary);
}

.log-list li.out .q {
  color: var(--c-danger);
}

/* ===== 底部操作栏 ===== */
.actbar {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 40;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 14px calc(12px + env(safe-area-inset-bottom));
  background: var(--c-glass-strong);
  backdrop-filter: blur(24px);
  -webkit-backdrop-filter: blur(24px);
  border-top: 1px solid var(--c-border);
  box-shadow: var(--shadow-lg);
  border-radius: var(--r-md);
}

.act-ico {
  display: flex;
  gap: 4px;
  flex-shrink: 0;
}

.ibtn {
  width: 42px;
  height: 42px;
  border: 1px solid var(--c-border);
  border-radius: var(--r-md);
  background: var(--c-surface);
  color: var(--c-text-2);
  display: grid;
  place-items: center;
  cursor: pointer;
  padding: 0;
  -webkit-tap-highlight-color: transparent;
}

.ibtn:active {
  color: var(--c-primary);
  border-color: var(--c-primary);
}

.ibtn.danger:active {
  color: var(--c-danger);
  border-color: var(--c-danger);
}

.abtn {
  flex: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  height: 40px;
  border: none;
  border-radius: var(--r-md);
  font-family: inherit;
  font-size: var(--fs-md);
  font-weight: 700;
  color: #fff;
  cursor: pointer;
  transition: transform 120ms ease-out, opacity var(--motion-fast);
  -webkit-tap-highlight-color: transparent;
}

.abtn.in {
  background: var(--c-primary);
}

.abtn.out {
  background: var(--c-danger);
}

.abtn:active {
  transform: scale(0.97);
  opacity: 0.9;
}

/* ===== 加载 / 错误态 ===== */
.load-state {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 80px 20px;
  color: var(--c-text-2);
  font-size: var(--fs-sm);
}

.spinner-lg {
  width: 32px;
  height: 32px;
  border: 3px solid var(--c-border);
  border-top-color: var(--c-primary);
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
}

.spinner-sm {
  width: 14px;
  height: 14px;
  border: 2px solid var(--c-border);
  border-top-color: var(--c-primary);
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
