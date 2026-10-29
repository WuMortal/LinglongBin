<template>
  <SubPage title="BOM 项目">
    <PullRefresh @refresh="onRefresh">
      <div class="mpage">
        <p v-if="error" class="error">
          {{ error }}
          <button class="retry-link" @click="load">重试</button>
        </p>

        <div v-if="loading" class="hint">
          <div class="spinner-lg" />
        </div>

        <div v-else-if="!projects.length" class="empty">
          <div class="empty-ico">
            <FileText :size="40" style="display: inline-flex; flex-shrink: 0" />
          </div>
          <h3>还没有 BOM 项目</h3>
          <p>点右下角「+」新建 BOM，逐行挑选物料</p>
        </div>

        <template v-else>
          <article v-for="p in projects" :key="p.id" class="bcard" @click="open(p)">
            <div class="b-head">
              <span class="b-ico">
                <List :size="18" style="display: inline-flex; flex-shrink: 0" />
              </span>
              <h3>{{ p.name }}</h3>
              <ChevronRight :size="16" class="b-arrow" style="display: inline-flex; flex-shrink: 0" />
            </div>
            <p class="b-sub">{{ fmtDate(p.created_at) }} · 共 {{ p.stats.total }} 项</p>
            <div class="b-stats">
              <span class="s ok">已匹配 <b>{{ p.stats.matched }}</b></span>
              <span class="s warn">缺料 <b>{{ p.stats.short }}</b></span>
              <span class="s bad">未匹配 <b>{{ p.stats.unmatched }}</b></span>
            </div>
            <div class="b-ops">
              <button class="op" @click.stop="openRecords(p)">
                <History :size="14" style="display: inline-flex; flex-shrink: 0" />领料记录
              </button>
              <button class="op danger" @click.stop="askDelete(p)">
                <Trash2 :size="14" style="display: inline-flex; flex-shrink: 0" />删除
              </button>
            </div>
          </article>
        </template>

      </div>
    </PullRefresh>

    <!-- 新建 BOM FAB：必须放在 PullRefresh 外 —— 其内容层带 transform，
         会把 position:fixed 变成相对该层定位，FAB 会跑到内容顶部且阴影错乱 -->
    <button class="fab" title="新建 BOM" @click="openCreate">
      <Plus :size="22" style="display: inline-flex; flex-shrink: 0" />
    </button>

    <!-- ===== 明细（底部弹层，替代桌面右侧抽屉） ===== -->
    <BottomSheet :open="!!curProjectId" tall :title="curProject?.name || ''" @close="curProjectId = null">
      <div class="chip-row">
        <button v-for="f in filters" :key="f.value" class="chip" :class="{ on: detailFilter === f.value }"
          @click="detailFilter = f.value">{{ f.label }}</button>
      </div>
      <ul class="i-list">
        <li v-for="i in filteredItems" :key="i.id" class="i-item">
          <div class="i-main">
            <span class="i-name">
              {{ i.materials?.name || i.raw || '未匹配' }}
              <span v-if="i.materials?.model" class="i-model mono">{{ i.materials.model }}</span>
            </span>
            <span class="i-meta">
              {{ i.materials?.brand || '—' }}<template v-if="i.materials?.part_no"> · {{ i.materials.part_no
                }}</template>
              <span v-if="i.materials?.categories?.name" class="i-tag">{{ i.materials.categories.name }}</span>
            </span>
          </div>
          <div class="i-right">
            <span class="i-need" :class="isShort(i) ? 'bad' : ''">×{{ i.qty }}</span>
            <span class="i-stock">库存 {{ i.materials ? i.materials.qty : '—' }}</span>
            <span class="i-pill" :class="pillClass(i)">{{ pillText(i) }}</span>
          </div>
        </li>
        <li v-if="!filteredItems.length" class="i-empty">没有符合条件的明细</li>
      </ul>
      <template #foot>
        <button class="bs-btn" @click="askDelete(curProject)">删除</button>
        <button class="bs-btn primary" :disabled="issuing" @click="openPickDialog">
          <span v-if="issuing" class="spinner-sm" />领料出库
        </button>
      </template>
    </BottomSheet>

    <!-- ===== 领料出库：二级弹层（套数 + 预览） ===== -->
    <BottomSheet :open="pickOpen" top title="领料出库" @close="pickOpen = false">
      <div class="sets-row">
        <span class="sets-label">套数</span>
        <input v-model.number="pickSets" type="number" min="1" class="sets-in" />
        <span class="sets-unit">套</span>
        <span class="sets-sum">共 {{ pickRows.length }} 项 · 出库 {{ pickTotalNeed }} 件<b v-if="pickLackCount" class="bad">
            · {{
              pickLackCount }} 项缺料</b></span>
      </div>
      <ul class="p-list">
        <li v-for="r in pickRows" :key="r.id">
          <span class="p-name">{{ r.name }}<small v-if="r.model" class="mono"> {{ r.model }}</small></span>
          <span class="p-nums">×{{ r.unit }} → {{ r.need }} / 库存 {{ r.stock }}</span>
          <span class="p-pill" :class="r.lack > 0 ? 'warn' : 'ok'">{{ r.lack > 0 ? `缺 ${r.lack}` : '充足' }}</span>
        </li>
      </ul>
      <template #foot>
        <button class="bs-btn" @click="pickOpen = false">取消</button>
        <button class="bs-btn primary" :disabled="!canIssue || issuing" @click="onConfirmPick">
          <span v-if="issuing" class="spinner-sm" />确认出库
        </button>
      </template>
    </BottomSheet>

    <!-- ===== 领料记录 ===== -->
    <BottomSheet :open="recordsOpen" tall :title="`领料记录 · ${recordsProjName}`" @close="recordsOpen = false">
      <div v-if="recordsLoading" class="hint">
        <div class="spinner-lg" />
      </div>
      <ul v-else-if="records.length" class="r-list">
        <li v-for="r in records" :key="r.id" class="r-item">
          <span class="r-sets">×{{ r.sets }} 套</span>
          <span class="r-time">{{ fmtFull(r.created_at) }}</span>
        </li>
      </ul>
      <p v-else class="r-empty">暂无领料记录</p>
    </BottomSheet>

    <!-- ===== 新建空白 BOM：名称 + 逐行选物料（对应桌面编辑抽屉） ===== -->
    <BottomSheet :open="createOpen" tall title="新建 BOM" @close="closeCreate">
      <div class="c-field">
        <label>名称<span class="req">*</span></label>
        <input v-model="createName" placeholder="如：主控板 V2" maxlength="60" />
      </div>
      <ul class="c-list">
        <li v-for="r in createRows" :key="r.key">
          <button class="c-pick" :class="{ empty: !r.material }" @click="pickForRow(r)">
            <Search v-if="!r.material" :size="14" style="display: inline-flex; flex-shrink: 0" />
            <span class="c-pick-txt">
              {{ r.material ? r.material.name : '选择物料' }}
              <small v-if="r.material?.model" class="mono">{{ r.material.model }}</small>
            </span>
          </button>
          <span class="c-stock" :class="{ bad: r.material != null && r.qty > r.material.qty }">
            库存 {{ r.material ? r.material.qty : '-' }}
          </span>
          <NumberStepper v-model="r.qty" :min="1" />
          <button class="c-del" title="移除" @click="removeCreateRow(r)">
            <X :size="14" style="display: inline-flex; flex-shrink: 0" />
          </button>
        </li>
      </ul>
      <button class="c-add" @click="addCreateRow">
        <Plus :size="14" style="display: inline-flex; flex-shrink: 0" />添加物料
      </button>
      <p v-if="createErr" class="c-err">{{ createErr }}</p>
      <template #foot>
        <button class="bs-btn" @click="closeCreate">取消</button>
        <button class="bs-btn primary" :disabled="creating" @click="saveCreate">
          <span v-if="creating" class="spinner-sm" />保存
        </button>
      </template>
    </BottomSheet>

    <!-- ===== 选物料：二级弹层（搜索 + 列表，tap 即选中） ===== -->
    <BottomSheet :open="pickerOpen" top title="选择物料" @close="pickerOpen = false">
      <div class="pk-search">
        <Search :size="14" style="display: inline-flex; flex-shrink: 0" />
        <input v-model="pkKeyword" type="search" placeholder="搜索名称 / 型号 / 编号…" @input="scheduleSearch" />
      </div>
      <ul class="pk-list">
        <li v-for="m in pkResults" :key="m.id" @click="onPicked(m)">
          <span class="pk-name">
            {{ m.name }}<small v-if="m.model" class="mono"> {{ m.model }}</small>
          </span>
          <span class="pk-meta">{{ m.brand || '—' }} · 库存 {{ m.qty }}</span>
        </li>
        <li v-if="!pkResults.length" class="i-empty">没有匹配的物料</li>
      </ul>
    </BottomSheet>
  </SubPage>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { List, ChevronRight, Plus, Trash2, History, FileText, Search, X } from 'lucide-vue-next'
import SubPage from '../../../components/mobile/SubPage.vue'
import PullRefresh from '../../../components/mobile/PullRefresh.vue'
import BottomSheet from '../../../components/mobile/BottomSheet.vue'
import NumberStepper from '../../../components/mobile/NumberStepper.vue'
import {
  listBomProjects, listBomItems, deleteBomProject, listBomPickRecords,
  createBomPickRecord, stockInOrder, createBomProject, createBomItems, listMaterials,
} from '../../../lib/db'
import { withAuthRetry } from '../../../lib/authRetry'
import { confirm } from '../../../composables/confirm'
import { useToast } from '../../../composables/toast'
import type { BomProject, BomItem, BomPickRecord, MaterialRow } from '../../../lib/types'

/**
 * 移动端 BOM：项目卡片流 + FAB 导入，明细 / 领料 / 记录都用底部弹层
 * （对应桌面 BOM.vue 的右侧抽屉 + 居中弹窗，逻辑同款，交互按移动端规范重排）。
 */
const toast = useToast()

interface Proj extends BomProject {
  items: BomItem[]
  stats: { total: number; matched: number; short: number; unmatched: number }
}

const projects = ref<Proj[]>([])
const loading = ref(false)
const error = ref('')

/** 与桌面同口径：只看 material_id 不够，物料被删后 join 不到也算未匹配 */
function isMatched(i: BomItem): boolean { return !!i.material_id && !!i.materials }

function statsOf(items: BomItem[]) {
  const matched = items.filter(isMatched).length
  return {
    total: items.length,
    matched,
    short: items.filter(i => isMatched(i) && (i.materials?.qty ?? 0) < i.qty).length,
    unmatched: items.length - matched,
  }
}

async function load() {
  loading.value = true
  error.value = ''
  try {
    const list = await withAuthRetry(() => listBomProjects())
    projects.value = await Promise.all(list.map(async p => {
      const items = await withAuthRetry(() => listBomItems(p.id))
      return { ...p, items, stats: statsOf(items) }
    }))
  } catch (e: unknown) {
    error.value = '加载失败：' + ((e as Error).message || e)
  } finally {
    loading.value = false
  }
}

// ===== 明细弹层 =====
const curProjectId = ref<string | null>(null)
const curProject = computed(() => projects.value.find(p => p.id === curProjectId.value) ?? null)

type DetailFilter = 'all' | 'matched' | 'short' | 'unmatched'
const detailFilter = ref<DetailFilter>('all')
const filters: { value: DetailFilter; label: string }[] = [
  { value: 'all', label: '全部' },
  { value: 'matched', label: '已匹配' },
  { value: 'short', label: '缺料' },
  { value: 'unmatched', label: '未匹配' },
]

/** 行是否缺料（已匹配才可比） */
function isShort(i: BomItem): boolean { return isMatched(i) && (i.materials?.qty ?? 0) < i.qty }
function pillClass(i: BomItem): string {
  if (!isMatched(i)) return 'bad'
  return isShort(i) ? 'warn' : 'ok'
}
function pillText(i: BomItem): string {
  if (!isMatched(i)) return '未匹配'
  return isShort(i) ? `缺 ${i.qty - (i.materials?.qty ?? 0)}` : '充足'
}

const filteredItems = computed(() => {
  const items = curProject.value?.items ?? []
  switch (detailFilter.value) {
    case 'matched': return items.filter(isMatched)
    case 'short': return items.filter(isShort)
    case 'unmatched': return items.filter(i => !isMatched(i))
    default: return items
  }
})

function open(p: Proj) {
  detailFilter.value = 'all'
  curProjectId.value = p.id
}

// ===== 领料出库 =====
const pickOpen = ref(false)
const pickSets = ref(1)
const issuing = ref(false)

const pickSetsSafe = computed(() => Math.max(1, Math.floor(Number(pickSets.value) || 1)))
const pickRows = computed(() => {
  const s = pickSetsSafe.value
  return (curProject.value?.items ?? []).filter(isMatched).map(i => {
    const need = i.qty * s
    const stock = i.materials?.qty ?? 0
    return {
      id: i.id, name: i.materials?.name ?? '—', model: i.materials?.model ?? null,
      unit: i.qty, stock, need, lack: Math.max(0, need - stock),
    }
  })
})
const pickLackCount = computed(() => pickRows.value.filter(r => r.lack > 0).length)
const pickTotalNeed = computed(() => pickRows.value.reduce((n, r) => n + r.need, 0))
const canIssue = computed(() => pickSets.value >= 1 && pickRows.value.length > 0 && pickLackCount.value === 0)

/** 领料前校验（与桌面一致：全部匹配且不缺料才允许出库） */
function openPickDialog() {
  const proj = curProject.value
  if (!proj) return
  const unmatched = proj.items.filter(i => !isMatched(i))
  if (unmatched.length) {
    toast.error(`还有 ${unmatched.length} 项未匹配，请先在桌面端补全后再领料`)
    return
  }
  if (!proj.items.length) { toast.error('无可出库的物料项'); return }
  pickSets.value = 1
  pickOpen.value = true
}

function onConfirmPick() {
  if (!canIssue.value || issuing.value) return
  void issueStock(pickSets.value)
}

async function issueStock(sets: number) {
  const proj = curProject.value
  if (!proj) return
  const s = Math.max(1, Math.floor(Number(sets) || 1))
  const unmatched = proj.items.filter(i => !isMatched(i))
  if (unmatched.length) { toast.error(`还有 ${unmatched.length} 项未匹配，无法出库`); return }
  const shortItems = proj.items.filter(i => isMatched(i) && (i.materials?.qty ?? 0) < i.qty * s)
  if (shortItems.length) {
    toast.error(`${shortItems.length} 项缺料，按 ${s} 套出库库存不足`)
    return
  }
  issuing.value = true
  try {
    const note = `BOM 领料：${proj.name}（${s} 套）`
    const { finals } = await withAuthRetry(() => stockInOrder({
      type: 'out', source: 'bom', source_id: proj.id,
      title: note, note,
      items: proj.items
        .filter(i => i.material_id && i.materials)
        .map(i => ({ material_id: i.material_id!, qty: i.qty * s, note })),
    }))
    for (const it of proj.items) {
      if (!it.material_id || !it.materials) continue
      it.materials = { ...it.materials, qty: finals.get(it.material_id) ?? it.materials.qty - it.qty * s }
    }
    await withAuthRetry(() => createBomPickRecord(proj.id, s, note))
    // 就地重算统计（库存已在上面扣减）
    const idx = projects.value.findIndex(p => p.id === proj.id)
    if (idx >= 0) projects.value[idx] = { ...projects.value[idx], stats: statsOf(proj.items) }
    pickOpen.value = false
    toast.success(`已出库 ${pickRows.value.length} 项 × ${s} 套`)
  } catch (e: unknown) {
    toast.error('出库失败：' + ((e as Error).message || e))
  } finally {
    issuing.value = false
  }
}

// ===== 领料记录 =====
const recordsOpen = ref(false)
const recordsLoading = ref(false)
const records = ref<BomPickRecord[]>([])
const recordsProjName = ref('')

async function openRecords(p: Proj) {
  recordsProjName.value = p.name
  records.value = []
  recordsOpen.value = true
  recordsLoading.value = true
  try {
    records.value = await withAuthRetry(() => listBomPickRecords(p.id))
  } catch (e: unknown) {
    toast.error('加载失败：' + ((e as Error).message || e))
  } finally {
    recordsLoading.value = false
  }
}

async function askDelete(p: Proj | null) {
  if (!p) return
  const ok = await confirm({
    title: '删除 BOM 项目',
    content: `确认删除「${p.name}」？将同时删除其下 ${p.items.length} 条明细，且不可恢复！`,
    danger: true,
    confirmText: '删除',
  })
  if (!ok) return
  try {
    await withAuthRetry(() => deleteBomProject(p.id))
    toast.success(`已删除「${p.name}」`)
    if (curProjectId.value === p.id) curProjectId.value = null
    await load()
  } catch (e: unknown) {
    toast.error('删除失败：' + ((e as Error).message || e))
  }
}

// ===== 新建空白 BOM（与桌面编辑抽屉同逻辑：内存草稿 → 保存时落库） =====
const createOpen = ref(false)
const createName = ref('')
const creating = ref(false)
const createErr = ref('')

interface CRow { key: string; material: MaterialRow | null; qty: number }
const createRows = ref<CRow[]>([])
let cSeq = 0
const cBlank = (): CRow => ({ key: `c${++cSeq}`, material: null, qty: 1 })

function openCreate() {
  createName.value = `BOM ${new Date().toLocaleDateString('zh-CN')}`
  createRows.value = [cBlank()]
  createErr.value = ''
  createOpen.value = true
}

function closeCreate() {
  if (!creating.value) createOpen.value = false
}

function addCreateRow() { createRows.value.push(cBlank()); createErr.value = '' }

function removeCreateRow(r: CRow) {
  // 至少保留一行，删完自动补一个空行
  createRows.value = createRows.value.length <= 1
    ? [cBlank()]
    : createRows.value.filter(x => x.key !== r.key)
  createErr.value = ''
}

// ---- 选物料（二级弹层，防抖搜索） ----
const pickerOpen = ref(false)
const pkKeyword = ref('')
const pkResults = ref<MaterialRow[]>([])
let pickTarget: CRow | null = null
let searchTimer: ReturnType<typeof setTimeout> | undefined

function pickForRow(r: CRow) {
  pickTarget = r
  pkKeyword.value = ''
  pkResults.value = []
  pickerOpen.value = true
  void runSearch()
}

function scheduleSearch() {
  clearTimeout(searchTimer)
  searchTimer = setTimeout(() => void runSearch(), 250)
}

async function runSearch() {
  try {
    pkResults.value = await withAuthRetry(() => listMaterials({ search: pkKeyword.value, limit: 20 }))
  } catch { /* 搜索失败静默，保留旧结果 */ }
}

function onPicked(m: MaterialRow) {
  if (pickTarget) pickTarget.material = m
  pickerOpen.value = false
  createErr.value = ''
}

async function saveCreate() {
  if (creating.value) return
  createErr.value = ''
  if (!createName.value.trim()) { createErr.value = '请填写 BOM 名称'; return }
  const valid = createRows.value.filter(r => r.material && r.qty > 0)
  if (!valid.length) { createErr.value = '至少一行要选择物料且数量大于 0'; return }
  creating.value = true
  try {
    const p = await withAuthRetry(() => createBomProject(createName.value.trim()))
    await withAuthRetry(() => createBomItems(p.id, valid.map(r => ({
      material_id: r.material!.id, qty: r.qty, raw: null, matched: true,
    }))))
    createOpen.value = false
    toast.success('已创建 BOM 项目')
    await load()
    // 创建后直接打开明细，方便继续查看
    curProjectId.value = p.id
  } catch (e: unknown) {
    createErr.value = '保存失败：' + ((e as Error).message || e)
  } finally {
    creating.value = false
  }
}

const pad = (n: number) => String(n).padStart(2, '0')
function fmtDate(iso: string) {
  const d = new Date(iso)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
function fmtFull(iso: string) {
  const d = new Date(iso)
  return `${fmtDate(iso)} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

async function onRefresh(done: () => void) {
  await load()
  done()
}

onMounted(load)
</script>

<style scoped>
.mpage {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-height: 100%;
}

/* ===== 项目卡片 ===== */
.bcard {
  padding: 12px 14px;
  background: var(--c-surface);
  border: 1px solid var(--c-border);
  border-radius: var(--r-xl);
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  transition: background var(--motion-fast);
}

.bcard:active {
  background: var(--c-surface-hover);
}

.b-head {
  display: flex;
  align-items: center;
  gap: 8px;
}

.b-ico {
  flex-shrink: 0;
  width: 30px;
  height: 30px;
  display: grid;
  place-items: center;
  border-radius: var(--r-md);
  background: var(--c-primary-soft);
  color: var(--c-primary);
}

.b-head h3 {
  flex: 1;
  min-width: 0;
  margin: 0;
  font-size: var(--fs-md);
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.b-arrow {
  flex-shrink: 0;
  color: var(--c-text-3);
}

.b-sub {
  margin: 4px 0 0;
  font-size: var(--fs-xs);
  color: var(--c-text-3);
}

.b-stats {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-top: 8px;
  font-size: var(--fs-xs);
  color: var(--c-text-3);
}

.b-stats b {
  color: var(--c-text);
  font-variant-numeric: tabular-nums;
}

.s.ok b {
  color: var(--c-accent);
}

.s.warn b {
  color: var(--c-warn, #ffb020);
}

.s.bad b {
  color: var(--c-danger);
}

.b-ops {
  display: flex;
  gap: 8px;
  margin-top: 10px;
}

.op {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 32px;
  padding: 0 12px;
  border: 1px solid var(--c-border);
  border-radius: var(--r-md);
  background: transparent;
  color: var(--c-text-2);
  font-family: inherit;
  font-size: var(--fs-xs);
  font-weight: 500;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}

.op.danger {
  margin-left: auto;
  color: var(--c-danger);
}

.op:active {
  background: var(--c-surface-hover);
}

/* ===== 明细弹层 ===== */
.chip-row {
  display: flex;
  gap: 6px;
  overflow-x: auto;
  scrollbar-width: none;
  padding-bottom: 8px;
}

.chip-row::-webkit-scrollbar {
  display: none;
}

.chip {
  flex-shrink: 0;
  height: 28px;
  padding: 0 12px;
  border: 1px solid var(--c-border);
  border-radius: 999px;
  background: var(--c-surface);
  color: var(--c-text-2);
  font-family: inherit;
  font-size: var(--fs-xs);
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}

.chip.on {
  border-color: var(--c-primary);
  background: var(--c-primary-soft);
  color: var(--c-primary);
  font-weight: 600;
}

.i-list {
  list-style: none;
  margin: 0;
  padding: 0;
}

.i-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 0;
  border-bottom: 1px solid var(--c-border-hairline);
}

.i-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.i-name {
  font-size: var(--fs-sm);
  font-weight: 600;
  color: var(--c-text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.i-model {
  margin-left: 6px;
  font-size: var(--fs-xs);
  font-weight: 400;
  color: var(--c-text-3);
}

.i-meta {
  font-size: var(--fs-xs);
  color: var(--c-text-3);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.i-tag {
  margin-left: 6px;
  padding: 0 6px;
  border-radius: var(--r-pill);
  background: var(--c-bg-2);
  font-size: 11px;
}

.i-right {
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 2px;
}

.i-need {
  font-size: var(--fs-sm);
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}

.i-need.bad {
  color: var(--c-danger);
}

.i-stock {
  font-size: 11px;
  color: var(--c-text-3);
  font-variant-numeric: tabular-nums;
}

.i-pill {
  padding: 1px 7px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 600;
}

.i-pill.ok {
  background: rgba(52, 218, 191, 0.12);
  color: var(--c-accent);
}

.i-pill.warn {
  background: rgba(255, 176, 32, 0.14);
  color: var(--c-warn, #ffb020);
}

.i-pill.bad {
  background: rgba(255, 92, 114, 0.14);
  color: var(--c-danger);
}

.i-empty,
.r-empty {
  padding: 28px 0;
  text-align: center;
  font-size: var(--fs-sm);
  color: var(--c-text-3);
}

/* ===== 领料出库弹层 ===== */
.sets-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.sets-label {
  font-size: var(--fs-sm);
  font-weight: 600;
}

.sets-in {
  width: 76px;
  height: 34px;
  text-align: center;
  font-size: var(--fs-sm);
}

.sets-unit {
  font-size: var(--fs-sm);
  color: var(--c-text-2);
}

.sets-sum {
  margin-left: auto;
  font-size: var(--fs-xs);
  color: var(--c-text-2);
}

.sets-sum .bad {
  color: var(--c-danger);
}

.p-list {
  list-style: none;
  margin: 10px 0 0;
  padding: 0;
  max-height: 40vh;
  overflow-y: auto;
}

.p-list li {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 0;
  border-bottom: 1px solid var(--c-border-hairline);
  font-size: var(--fs-xs);
}

.p-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--c-text);
}

.p-name small {
  color: var(--c-text-3);
}

.p-nums {
  flex-shrink: 0;
  color: var(--c-text-2);
  font-variant-numeric: tabular-nums;
}

.p-pill {
  flex-shrink: 0;
  padding: 1px 7px;
  border-radius: 999px;
  font-weight: 600;
}

.p-pill.ok {
  background: rgba(52, 218, 191, 0.12);
  color: var(--c-accent);
}

.p-pill.warn {
  background: rgba(255, 176, 32, 0.14);
  color: var(--c-warn, #ffb020);
}

/* ===== 领料记录 ===== */
.r-list {
  list-style: none;
  margin: 0;
  padding: 0;
}

.r-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 0;
  border-bottom: 1px solid var(--c-border-hairline);
  font-size: var(--fs-sm);
}

.r-sets {
  font-weight: 700;
  color: var(--c-primary);
}

.r-time {
  margin-left: auto;
  font-size: var(--fs-xs);
  color: var(--c-text-3);
}

/* 弹层底部按钮（#foot） */
.bs-btn {
  flex: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  height: 42px;
  border: 1px solid var(--c-border);
  border-radius: var(--r-md);
  background: transparent;
  color: var(--c-text-2);
  font-family: inherit;
  font-size: var(--fs-sm);
  font-weight: 600;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}

.bs-btn.primary {
  border-color: transparent;
  background: var(--c-primary);
  color: #fff;
}

.bs-btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

/* ===== 通用状态 ===== */
.hint {
  display: flex;
  justify-content: center;
  padding: 24px 0;
}

.empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 40px 0;
  text-align: center;
}

.empty-ico {
  color: var(--c-text-3);
}

.empty h3 {
  margin: 6px 0 0;
  font-size: var(--fs-md);
  font-weight: 600;
}

.empty p {
  margin: 4px 0 0;
  font-size: var(--fs-sm);
  color: var(--c-text-3);
}

.error {
  margin: 0;
  padding: 10px 0;
  font-size: var(--fs-sm);
  color: var(--c-danger);
}

.retry-link {
  margin-left: 8px;
  border: none;
  background: transparent;
  color: var(--c-primary);
  font-family: inherit;
  font-size: var(--fs-sm);
  font-weight: 600;
  cursor: pointer;
}

/* ===== 新建 BOM 弹层 ===== */
.c-field {
  display: flex;
  flex-direction: column;
  gap: 5px;
  margin-bottom: 12px;
}

.c-field label {
  font-size: var(--fs-xs);
  color: var(--c-text-2);
}

.c-field .req {
  margin-left: 3px;
  color: var(--c-danger);
}

.c-field input {
  width: 100%;
  height: 38px;
  padding: 0 10px;
  font-size: var(--fs-sm);
  font-family: inherit;
  background: var(--c-surface);
  border: 1px solid var(--c-border);
  border-radius: var(--r-md);
  color: var(--c-text);
}

.c-field input:focus {
  outline: none;
  border-color: var(--c-primary);
}

.c-list {
  list-style: none;
  margin: 0;
  padding: 0;
}

.c-list li {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 0;
}

.c-pick {
  flex: 1;
  min-width: 0;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 34px;
  padding: 0 8px;
  border: 1px dashed var(--c-border);
  border-radius: var(--r-md);
  background: var(--c-surface);
  color: var(--c-text);
  font-family: inherit;
  font-size: var(--fs-xs);
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  flex-direction: row;
}

.c-pick.empty {
  color: var(--c-text-3);
}

.c-pick-txt {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.c-pick-txt small {
  margin-left: 4px;
  color: var(--c-text-3);
}

.c-stock {
  flex-shrink: 0;
  font-size: 11px;
  color: var(--c-text-3);
  font-variant-numeric: tabular-nums;
}

.c-stock.bad {
  color: var(--c-danger);
  font-weight: 700;
}

.c-del {
  flex-shrink: 0;
  width: 30px;
  height: 30px;
  display: grid;
  place-items: center;
  border: 1px solid var(--c-border);
  border-radius: var(--r-md);
  background: transparent;
  color: var(--c-text-3);
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}

.c-del:active {
  color: var(--c-danger);
  border-color: var(--c-danger);
}

.c-add {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  width: 100%;
  height: 36px;
  margin-top: 8px;
  border: 1px dashed var(--c-border);
  border-radius: var(--r-md);
  background: transparent;
  color: var(--c-text-2);
  font-family: inherit;
  font-size: var(--fs-sm);
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}

.c-add:active {
  border-color: var(--c-primary);
  color: var(--c-primary);
}

.c-err {
  margin: 8px 0 0;
  font-size: var(--fs-xs);
  color: var(--c-danger);
}

/* 选物料弹层 */
.pk-search {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 36px;
  padding: 0 10px;
  border: 1px solid var(--c-border);
  border-radius: var(--r-md);
  background: var(--c-surface);
  color: var(--c-text-3);
}

.pk-search input {
  flex: 1;
  min-width: 0;
  height: 100%;
  border: none;
  background: transparent;
  font-size: var(--fs-sm);
}

.pk-search input:focus {
  outline: none;
}

.pk-list {
  list-style: none;
  margin: 8px 0 0;
  padding: 0;
  max-height: 46vh;
  overflow-y: auto;
}

.pk-list li {
  padding: 10px 2px;
  border-bottom: 1px solid var(--c-border-hairline);
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}

.pk-list li:active {
  background: var(--c-surface-hover);
}

.pk-name {
  display: block;
  font-size: var(--fs-sm);
  font-weight: 600;
  color: var(--c-text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pk-name small {
  font-weight: 400;
  color: var(--c-text-3);
}

.pk-meta {
  display: block;
  margin-top: 2px;
  font-size: var(--fs-xs);
  color: var(--c-text-3);
}

/* FAB：浮在 tabbar 上方，避开手势条（阴影用 --shadow-lg，与物料页 FAB 同款） */
.fab {
  position: fixed;
  right: 16px;
  bottom: calc(70px + env(safe-area-inset-bottom));
  z-index: 90;
  width: 52px;
  height: 52px;
  display: grid;
  place-items: center;
  border: none;
  border-radius: 50%;
  background: var(--c-primary);
  color: #fff;
  box-shadow: var(--shadow-lg);
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  transition: transform var(--motion-fast);
}

.fab:active {
  transform: scale(0.92);
}

.spinner-lg {
  width: 26px;
  height: 26px;
  border: 3px solid var(--c-border);
  border-top-color: var(--c-primary);
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
}

.spinner-sm {
  width: 14px;
  height: 14px;
  border: 2px solid rgba(255, 255, 255, 0.4);
  border-top-color: #fff;
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
