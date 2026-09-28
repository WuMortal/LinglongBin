<template>
  <section class="tab">
    <!-- 顶部工具条（与库存其它页面的 .filters / .po-bar 一致） -->
    <div class="take-bar">
      <div class="take-bar-right">
        <button class="btn btn-primary take-btn" :disabled="loading" @click="openNew">
          <Plus :size="14" style="display: inline-flex; flex-shrink: 0" /> 新建盘点单
        </button>
      </div>
    </div>

    <DataTable :columns="takeCols" :rows="takes" row-key="id" @row-click="openView">
      <template #cell-created_at="{ row }">
        <span class="muted">{{ fmtTime(row.created_at) }}</span>
      </template>
      <template #cell-diff_count="{ row }">
        <span class="diff" :class="(row.diff_count || 0) > 0 ? 'pos' : ((row.diff_count || 0) < 0 ? 'neg' : '')">{{ row.diff_count || 0 }}</span>
      </template>
      <template #cell-op="{ row }">
        <button class="btn btn-icon mini" title="查看明细" @click.stop="openView(row)">
          <Eye :size="14" style="display: inline-flex; flex-shrink: 0" />
        </button>
        <button class="btn btn-icon mini danger" title="删除" @click.stop="askDelete(row)">
          <Trash2 :size="14" style="display: inline-flex; flex-shrink: 0" />
        </button>
      </template>
      <template #empty>
        <EmptyState :icon="ClipboardCheck" title="暂无盘点单" subtitle="点击「新建盘点」开始一次实物盘点" />
      </template>
    </DataTable>

    <!-- 新建盘点 -->
    <Teleport to="body">
      <div v-if="creating" class="modal-mask" @click.self="closeNew">
        <div class="modal take-modal">
          <div class="modal-head">
            <h3>新建盘点</h3>
            <button class="modal-x" @click="closeNew"><X :size="16" style="display: inline-flex; flex-shrink: 0" /></button>
          </div>
          <div class="modal-body">
            <label class="field">
              <span>盘点单名称</span>
              <input v-model="newName" placeholder="如 2026-09 月度盘点" />
            </label>
            <div class="new-filters">
              <AppSelect v-model="newMajor" :options="majorOptions" :width="120" searchable search-placeholder="搜索大类" placeholder="全部大类" class="cat" />
              <AppSelect v-model="newMinor" :options="minorOptions" :width="120" searchable search-placeholder="搜索小类" placeholder="全部小类" :disabled="!newMajor" class="cat" />
              <div class="f-search">
                <Search :size="15" class="s-ico" style="display: inline-flex; flex-shrink: 0" />
                <input v-model="newSearch" placeholder="搜索名称 / 型号" @input="onNewSearch" />
              </div>
              <span class="new-count">共 {{ pickMats.length }} 项物料</span>
            </div>
            <div v-if="pickLoading" class="pick-area pick-loading">
              <div class="spinner-lg" /><span>加载物料…</span>
            </div>
            <div v-else-if="pickMats.length" class="pick-area pick-list">
              <div v-for="m in pickMats" :key="m.id" class="pick-row">
                <div class="pick-name">
                  <strong>{{ m.name }}</strong>
                  <small class="mono">{{ [m.model, m.brand].filter(Boolean).join(' · ') || '—' }}</small>
                </div>
                <div class="pick-book">账面 {{ m.qty }}</div>
                <input v-model="actualMap[m.id]" class="pick-input" type="number" min="0" placeholder="实盘" />
              </div>
            </div>
            <div v-else class="pick-area pick-empty">
              <EmptyState :icon="ClipboardCheck" title="暂无物料" subtitle="当前筛选条件下没有可盘点的物料" />
            </div>
            <p v-if="newErr" class="form-err">{{ newErr }}</p>
          </div>
          <div class="modal-foot">
            <button class="btn btn-ghost" @click="closeNew">取消</button>
            <button class="btn btn-primary" :disabled="submitting || !newName.trim() || pickMats.length === 0" @click="submitNew">
              <Save :size="15" style="display: inline-flex; flex-shrink: 0" /> 提交盘点（差异自动入账）
            </button>
          </div>
        </div>
      </div>
    </Teleport>

    <!-- 查看明细 -->
    <Teleport to="body">
      <div v-if="view" class="modal-mask" @click.self="view = null">
        <div class="modal">
          <div class="modal-head">
            <h3>盘点明细 · {{ view.take.name }}</h3>
            <button class="modal-x" @click="view = null"><X :size="16" style="display: inline-flex; flex-shrink: 0" /></button>
          </div>
          <div class="modal-body">
            <p class="view-sub">时间 {{ fmtTime(view.take.created_at) }} · 物料 {{ view.take.item_count || 0 }} · 差异 {{ view.take.diff_count || 0 }}</p>
            <DataTable :columns="itemCols" :rows="view.items" row-key="id">
              <template #cell-name="{ row }">
                <div class="pick-name"><strong>{{ row.material_name || '—' }}</strong></div>
              </template>
              <template #cell-diff="{ row }">
                <span class="diff" :class="row.diff > 0 ? 'pos' : (row.diff < 0 ? 'neg' : '')">{{ row.diff > 0 ? '+' : '' }}{{ row.diff }}</span>
              </template>
            </DataTable>
          </div>
          <div class="modal-foot">
            <button class="btn btn-ghost" @click="view = null">关闭</button>
          </div>
        </div>
      </div>
    </Teleport>
  </section>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onActivated } from 'vue'
import { ClipboardCheck, Plus, Trash2, Eye, Search, X, Save } from 'lucide-vue-next'
import {
  listStocktakes, createStocktake, getStocktake, deleteStocktake,
  listMaterials, listCategories, getOwnerId,
  buildCategoryTree, descendantCategoryIds,
} from '../../lib/db'
import type { StockTake, StockTakeItem, MaterialRow, Category } from '../../lib/types'
import DataTable from '../../components/DataTable.vue'
import type { DtColumn } from '../../components/DataTable.vue'
import AppSelect from '../../components/form/AppSelect.vue'
import EmptyState from '../../components/EmptyState.vue'
import { confirm } from '../../composables/confirm'

const takes = ref<StockTake[]>([])
const loading = ref(false)
const creating = ref(false)
const submitting = ref(false)
const newName = ref('')
const newMajor = ref<string | null>(null)
const newMinor = ref<string | null>(null)
const categories = ref<Category[]>([])
/** 大类（parent 为空）→ 小类 的二级树 */
const tree = computed(() => buildCategoryTree(categories.value))
/** 大类下拉：一级分类 */
const majorOptions = computed(() => [
  { value: null as string | null, label: '全部大类' },
  ...tree.value.map(n => ({ value: n.cat.id as string | null, label: n.cat.name })),
])
/** 小类下拉：所选大类下的子分类（未选大类时禁用） */
const minorOptions = computed(() => {
  const rows: Array<{ value: string | null; label: string }> = [{ value: null, label: '全部小类' }]
  const node = tree.value.find(n => n.cat.id === newMajor.value)
  for (const c of node?.children ?? []) rows.push({ value: c.cat.id as string | null, label: c.cat.name })
  return rows
})
const newSearch = ref('')
const pickMats = ref<MaterialRow[]>([])
const actualMap = ref<Record<string, string>>({})
const pickLoading = ref(false)
const newErr = ref('')
const view = ref<{ take: StockTake; items: StockTakeItem[] } | null>(null)


const takeCols: DtColumn[] = [
  { key: 'name', label: '盘点单', sortable: true },
  { key: 'created_at', label: '时间', sortable: true },
  { key: 'item_count', label: '物料数' },
  { key: 'diff_count', label: '差异数' },
  { key: 'op', label: '操作' },
]
const itemCols: DtColumn[] = [
  { key: 'name', label: '物料' },
  { key: 'book_qty', label: '账面' },
  { key: 'actual_qty', label: '实盘' },
  { key: 'diff', label: '差异' },
]

function fmtTime(iso?: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return iso
  return d.toLocaleString('zh-CN', { hour12: false })
}

async function load() {
  loading.value = true
  try { takes.value = await listStocktakes() } finally { loading.value = false }
}

async function loadCats() {
  try { categories.value = await listCategories() } catch { /* 分类可选，失败不影响 */ }
}

async function openNew() {
  creating.value = true
  newName.value = ''
  newMajor.value = null
  newMinor.value = null
  newSearch.value = ''
  actualMap.value = {}
  newErr.value = ''
  await loadPick()
}

// 切换大类：清空已选小类，避免残留上一个大类的子类
watch(newMajor, () => { newMinor.value = null })
// 分类变化 → 重新拉取可盘点物料（仅弹框打开时）
watch([newMajor, newMinor], () => { if (creating.value) loadPick() })

let searchTimer: number | undefined
function onNewSearch() {
  clearTimeout(searchTimer)
  searchTimer = window.setTimeout(loadPick, 300)
}

async function loadPick() {
  pickLoading.value = true
  try {
    const mats: MaterialRow[] = []
    let off = 0
    // 循环分页拉全量（兼容 Supabase 默认 1000 上限），上限保护
    while (mats.length < 50000) {
      const page = await listMaterials({
        categoryId: newMinor.value ?? undefined,
        categoryIds: newMinor.value ? undefined : (newMajor.value ? descendantCategoryIds(categories.value, newMajor.value) : undefined),
        search: newSearch.value || undefined,
        limit: 1000,
        offset: off,
      })
      mats.push(...page)
      if (page.length < 1000) break
      off += 1000
    }
    pickMats.value = mats
  } catch {
    pickMats.value = []
  } finally { pickLoading.value = false }
}

function closeNew() { creating.value = false }

async function submitNew() {
  if (!newName.value.trim()) { newErr.value = '请填写盘点单名称'; return }
  if (!pickMats.value.length) { newErr.value = '没有可盘点的物料'; return }
  submitting.value = true
  newErr.value = ''
  try {
    const owner = await getOwnerId()
    const now = new Date().toISOString()
    const takeId = crypto.randomUUID()
    const items: StockTakeItem[] = pickMats.value.map(m => {
      const raw = actualMap.value[m.id]
      const actual = raw === '' || raw == null ? m.qty : (Number(raw) || 0)
      return {
        id: crypto.randomUUID(),
        take_id: takeId,
        material_id: m.id,
        material_name: m.name,
        book_qty: m.qty,
        actual_qty: actual,
        diff: actual - m.qty,
        created_at: now,
      }
    })
    await createStocktake({
      id: takeId, owner, name: newName.value.trim(), note: null, status: 'done', created_at: now,
    }, items)
    creating.value = false
    await load()
  } catch (e: any) {
    newErr.value = e?.message || '提交失败'
  } finally { submitting.value = false }
}

async function openView(row?: StockTake) {
  const t = row ?? view.value?.take
  if (!t) return
  view.value = await getStocktake(t.id)
}

async function askDelete(row: StockTake) {
  const ok = await confirm({
    title: '删除盘点单',
    content: `确认删除「${row.name}」？该操作仅删除盘点记录，不会回滚已入账的库存差异。`,
    danger: true,
  })
  if (!ok) return
  await deleteStocktake(row.id)
  await load()
}

// 切到本 tab 时自动重拉（keep-alive 不会重新挂载，故用 onActivated 而非 onMounted）
onActivated(() => { load(); loadCats() })

// 供父级「刷新」按钮调用
defineExpose({ refresh: () => { void load() } })
</script>

<style scoped>
.tab {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

/* ===== 顶部工具条（与库存其它页面的 .filters / .po-bar 一致） ===== */
.take-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  padding: 10px 14px;
  border-bottom: 1px solid var(--c-border-hairline);
  background: var(--c-glass);
  flex-shrink: 0;
}
.take-bar-right { margin-left: auto; display: flex; align-items: center; gap: 8px; }
.take-btn { height: var(--ctrl-h-sm); padding: 0 12px; font-size: var(--fs-xs); }

.muted { color: var(--c-text-2); }
.diff { font-variant-numeric: tabular-nums; font-weight: 600; }
.diff.pos { color: var(--c-success); }
.diff.neg { color: var(--c-danger); }

/* ===== 弹框：沿用全局 .modal-mask / .modal / .modal-head / .modal-body / .modal-foot 主题样式 ===== */
.modal-mask .take-modal { max-width: 640px; width: 640px; height: 80vh; max-height: 80vh; display: flex; flex-direction: column; }

.modal-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; }

/* 关闭按钮：与通用弹框（MaterialPickDialog 等）一致 */
.modal-x {
  border: none;
  background: transparent;
  font-size: 18px;
  line-height: 1;
  color: var(--c-text-3);
  cursor: pointer;
}
.modal-x:hover { color: var(--c-text); }

/* 新建盘点弹框：内容纵向排布（基础外观由全局 .modal-body 提供）；覆盖全局 body 的 overflow，改由内部列表滚动 */
.modal-mask .take-modal .modal-body { display: flex; flex-direction: column; gap: 14px; overflow: hidden; min-height: 0; }

/* ===== 表单字段（与库存表单 .pd-field / .qk-grid .field 一致） ===== */
.field { display: flex; flex-direction: column; gap: 6px; margin: 0; min-width: 0; }
.field > span { font-size: var(--fs-xs); color: var(--c-text-2); font-weight: 500; }
.field input {
  height: var(--ctrl-h);
  padding: 0 var(--ctrl-px);
  font-size: var(--fs-sm);
  background: var(--c-surface);
  border: 1px solid var(--c-border);
  border-radius: var(--r-md);
  color: var(--c-text);
  transition: border-color var(--motion), box-shadow var(--motion);
}
.field input:focus {
  outline: none;
  border-color: var(--c-primary);
  box-shadow: 0 0 0 3px var(--c-primary-glow);
}

/* ===== 新建盘点内的筛选与录入 ===== */
.new-filters {
  display: flex; align-items: center; gap: 12px; flex-wrap: wrap;
}
.cat { flex-shrink: 0; }
.new-count { color: var(--c-text-2); font-size: var(--fs-sm); }
.f-search {
  display: flex; align-items: center; gap: 6px;
  background: var(--c-glass);
  border: 1px solid var(--c-border);
  border-radius: var(--r-md);
  padding: 0 10px; height: var(--ctrl-h); flex: 1; min-width: 180px;
  transition: border-color var(--motion), box-shadow var(--motion);
}
.f-search:focus-within { border-color: var(--c-primary); box-shadow: 0 0 0 3px var(--c-primary-glow); }
.f-search input { border: none; background: transparent; outline: none; width: 100%; font-size: var(--fs-sm); color: var(--c-text); }
.s-ico { color: var(--c-text-3); }
.pick-area { flex: 1 1 auto; min-height: 0; }
.pick-loading {
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px;
  color: var(--c-text-2); padding: 30px 0;
}
.spinner-lg {
  width: 26px; height: 26px; border: 3px solid var(--c-border);
  border-top-color: var(--c-primary); border-radius: 50%;
  animation: spin 0.7s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }
.pick-list {
  border: 1px solid var(--c-border-hairline);
  border-radius: var(--r-md);
  flex: 1 1 auto; min-height: 0; overflow: auto;
}
.pick-empty { display: flex; align-items: center; justify-content: center; min-height: 0; }
.pick-row {
  display: grid;
  grid-template-columns: 1fr auto 110px;
  align-items: center;
  gap: 12px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--c-border-hairline);
}
.pick-row:last-child { border-bottom: none; }
.pick-name { display: flex; flex-direction: column; min-width: 0; }
.pick-name strong { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pick-name small { color: var(--c-text-2); }
.mono { font-family: var(--font-mono); font-size: var(--fs-sm); }
.pick-book { color: var(--c-text-2); font-size: var(--fs-sm); white-space: nowrap; }
.pick-input {
  width: 100%; height: var(--ctrl-h); padding: 0 var(--ctrl-px);
  font-size: var(--fs-sm);
  background: var(--c-surface);
  border: 1px solid var(--c-border);
  border-radius: var(--r-md);
  color: var(--c-text);
  outline: none;
  transition: border-color var(--motion), box-shadow var(--motion);
}
.pick-input:focus { border-color: var(--c-primary); box-shadow: 0 0 0 3px var(--c-primary-glow); }
.view-sub { margin: 0; color: var(--c-text-2); font-size: var(--fs-sm); }
.form-err { margin: 0; color: var(--c-danger); font-size: var(--fs-sm); }

@media (prefers-reduced-motion: reduce) {
  .spinner-lg { animation: none; }
}
</style>
