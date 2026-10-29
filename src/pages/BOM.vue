<template>
  <section class="page">
    <header class="head">
      <div>
        <h1>BOM</h1>
        <p>导入立创 EDA / 报价单 BOM，自动匹配库存、校验缺料、一键领料出库</p>
      </div>
      <div class="head-actions">
        <button class="btn btn-primary" @click="openCreateBom">
          <Plus :size="16" style="display: inline-flex; flex-shrink: 0" />新建 BOM
        </button>
        <button class="btn btn-ghost" @click="wizardOpen = true">
          <FileText :size="16" style="display: inline-flex; flex-shrink: 0" />导入 BOM
        </button>
      </div>
    </header>

    <!-- ===== 项目列表 ===== -->
    <div class="pane card">
      <div class="pane-head">
        <span class="pane-title">
          <List :size="16" style="display: inline-flex; flex-shrink: 0" />BOM 项目
        </span>
        <span v-if="projects.length" class="pane-count">{{ projects.length }}</span>
      </div>
      <div class="pane-list">
        <div v-if="projLoading" class="hint">
          <div class="spinner-lg" />
        </div>
        <div v-else-if="!projects.length" class="empty">
          <div class="empty-ico">
            <FileText :size="40" style="display: inline-flex; flex-shrink: 0" />
          </div>
          <h3>暂无 BOM 项目</h3>
          <p>点击「新建/导入 BOM」导入第一份</p>
        </div>
        <ul v-else class="proj-list">
          <li v-for="p in projects" :key="p.id" class="proj-item" @click="openProject(p)">
            <div class="proj-ico">
              <List :size="20" style="display: inline-flex; flex-shrink: 0" />
            </div>
            <div class="proj-info">
              <div class="proj-line">
                <strong>{{ p.name }}</strong>
                <div class="proj-stats">
                  <span class="stat-total">{{ p.stats.total }} 项</span>
                  <span class="stat ok"><span class="dot" />已匹配 {{ p.stats.matched }}</span>
                  <span class="stat warn"><span class="dot" />缺料 {{ p.stats.short }}</span>
                  <span class="stat bad"><span class="dot" />未匹配 {{ p.stats.unmatched }}</span>
                </div>
              </div>
              <small>{{ fmtFull(p.created_at) }}</small>
            </div>
            <div class="proj-ops">
              <button class="btn btn-ghost mini" title="领料记录" @click.stop="openRecords(p)">
                <History :size="13" style="display: inline-flex; flex-shrink: 0" />领料记录
              </button>
            </div>
            <ChevronRight :size="16" class="proj-arrow" style="display: inline-flex; flex-shrink: 0" />
          </li>
        </ul>
      </div>
    </div>

    <!-- ===== 项目详情：右侧抽屉 ===== -->
    <Teleport to="body">
      <Transition name="bomdrawer">
        <div v-if="curProject" class="dw-mask" @click.self="closeDrawer">
          <aside class="dw">
            <header class="dw-head">
              <div class="dw-title">
                <h2>{{ curProject.name }}</h2>
                <p>{{ fmtFull(curProject.created_at) }} · {{ curProject.items.length }} 项</p>
              </div>
              <button class="dw-close" title="关闭" @click="closeDrawer">
                <X :size="16" style="display: inline-flex; flex-shrink: 0" />
              </button>
            </header>
            <div class="dw-scroll">
              <div class="dh-bar">
                <div class="dh-stats">
                  <button class="stat-chip" :class="{ on: detailFilter === 'all' }" @click="detailFilter = 'all'">
                    <span class="stat-total">{{ curProject.items.length }} 项</span>
                  </button>
                  <button class="stat-chip" :class="{ on: detailFilter === 'matched' }"
                    @click="detailFilter = 'matched'">
                    <span class="stat ok"><span class="dot" />已匹配 {{ detailMatched }}</span>
                  </button>
                  <button class="stat-chip" :class="{ on: detailFilter === 'short' }" @click="detailFilter = 'short'">
                    <span class="stat warn"><span class="dot" />缺料 {{ detailShort }}</span>
                  </button>
                  <button class="stat-chip" :class="{ on: detailFilter === 'unmatched' }"
                    @click="detailFilter = 'unmatched'">
                    <span class="stat bad"><span class="dot" />未匹配 {{ detailUnmatched }}</span>
                  </button>
                </div>
                <div class="dh-actions">
                  <button class="btn btn-ghost" @click="openEditBom">
                    <ArrowUpFromLine :size="16" style="display: inline-flex; flex-shrink: 0" />编辑明细
                  </button>
                  <button class="btn btn-primary" :disabled="issuing" @click="openPickDialog">
                    <ArrowUpFromLine :size="16" style="display: inline-flex; flex-shrink: 0" />
                    <span v-if="issuing" class="spinner-sm" />{{ issuing ? '领料中…' : '领料出库' }}
                  </button>
                  <button class="btn btn-ghost" @click="confirmDelete">
                    <Trash2 :size="16" style="display: inline-flex; flex-shrink: 0" />删除
                  </button>
                </div>
              </div>
              <DataTable :columns="detailCols" :rows="filteredItems" row-key="id" :clickable="false">
                <template #cell-raw="{ row }">
                  <span class="mono" :title="row.raw || ''">{{ row.raw || '—' }}</span>
                </template>
                <template #cell-matched="{ row }">
                  <!-- 只认「能反查到物料」，因此没绑 / 绑了但物料已失效都落到同一态：未匹配 -->
                  <span v-if="isMatched(row)" class="pill ok">
                    <Check :size="12" style="display: inline-flex; flex-shrink: 0" />{{ row.materials?.name }}
                  </span>
                  <span v-else class="pill bad">
                    <X :size="12" style="display: inline-flex; flex-shrink: 0" />未匹配
                  </span>
                </template>
                <template #cell-category="{ row }">
                  <!-- 小类即物料所属分类名；未匹配 / 无分类时留空占位 -->
                  <span class="dt-sub" :title="row.materials?.categories?.name || ''">
                    {{ row.materials?.categories?.name || '—' }}
                  </span>
                </template>
                <template #cell-brand="{ row }">
                  <span class="dt-sub" :title="row.materials?.brand || ''">{{ row.materials?.brand || '—' }}</span>
                </template>
                <template #cell-part_no="{ row }">
                  <span class="mono dt-sub" :title="row.materials?.part_no || ''">{{ row.materials?.part_no || '—'
                    }}</span>
                </template>
                <template #cell-qty="{ row }">
                  <!-- 需求数量超过物料库存 → 标红（已匹配才可比；未匹配标灰） -->
                  <span class="qty-cell" :class="isMatched(row) ? (isShort(row) ? 'bad' : 'ok') : 'dim'">{{ row.qty
                    }}</span>
                </template>
                <template #cell-stock="{ row }">
                  <span v-if="!row.materials" class="qty-cell dim">—</span>
                  <span v-else class="qty-cell" :class="row.materials.qty >= row.qty ? 'ok' : 'bad'">{{
                    row.materials.qty
                  }}</span>
                </template>
                <template #cell-status="{ row }">
                  <span v-if="!isMatched(row)" class="pill bad">未匹配</span>
                  <span v-else-if="(row.materials?.qty ?? 0) < row.qty" class="pill warn">缺料 {{ row.qty -
                    (row.materials?.qty ?? 0) }}</span>
                  <span v-else class="pill ok">充足</span>
                </template>
                <template #cell-ops="{ row }">
                  <div class="ops">
                    <button class="btn btn-ghost mini" @click.stop="openPickerFor(row)">
                      {{ row.materials ? '改选' : '选择' }}
                    </button>
                    <!-- <button v-if="row.materials" class="btn btn-ghost mini" @click.stop="openEditMaterial(row)">编辑</button> -->
                  </div>
                </template>
              </DataTable>
            </div>
          </aside>
        </div>
      </Transition>
    </Teleport>

    <!-- ===== 领料出库：选套数 + 逐项预览 ===== -->
    <Teleport to="body">
      <div v-if="pickOpen" class="modal-mask" @click.self="pickOpen = false">
        <div class="modal pick-modal">
          <div class="modal-head">
            <h3>领料出库 · {{ curProject?.name }}</h3>
            <p class="pick-sub">按「每套用量 × 套数」从库存扣减，并生成一条领料记录</p>
          </div>
          <div class="modal-body">
            <div class="pick-sets">
              <span class="pick-label">套数</span>
              <input v-model.number="pickSets" type="number" min="1" class="pick-input" @keyup.enter="onConfirmPick" />
              <span class="pick-unit">套</span>
              <span class="pick-sum">
                共 {{ pickRows.length }} 项 · 合计出库 {{ pickTotalNeed }} 件
                <b v-if="pickLackCount" class="txt-bad"> · {{ pickLackCount }} 项缺料</b>
              </span>
            </div>
            <div class="pick-list">
              <DataTable :columns="pickCols" :rows="pickRows" row-key="id" :clickable="false">
                <template #cell-name="{ row }">
                  <span class="pick-name" :title="row.name">{{ row.name }}</span>
                  <small v-if="row.model" class="pick-model mono">{{ row.model }}</small>
                </template>
                <template #cell-unit="{ row }">
                  <span class="qty-cell">×{{ row.unit }}</span>
                </template>
                <template #cell-stock="{ row }">
                  <span class="qty-cell">{{ row.stock }}</span>
                </template>
                <template #cell-need="{ row }">
                  <span class="qty-cell">{{ row.need }}</span>
                </template>
                <template #cell-status="{ row }">
                  <span v-if="row.lack > 0" class="pill warn">缺料 {{ row.lack }}</span>
                  <span v-else class="pill ok">充足</span>
                </template>
              </DataTable>
            </div>
          </div>
          <div class="modal-foot">
            <span class="foot-hint">
              {{ pickLackCount ? `${pickLackCount} 项库存不足，请调小套数或先补货` : reduceTip }}
            </span>
            <button class="btn btn-ghost" @click="pickOpen = false">取消</button>
            <button class="btn btn-danger" :disabled="issuing || !canIssue" @click="onConfirmPick">
              <span v-if="issuing" class="spinner-sm" />{{ issuing ? '出库中…' : `确认出库 ${pickTotalNeed} 件` }}
            </button>
          </div>
        </div>
      </div>
    </Teleport>

    <!-- ===== 领料记录 ===== -->
    <Teleport to="body">
      <div v-if="recordsOpen" class="modal-mask" @click.self="recordsOpen = false">
        <div class="modal" style="max-width: 460px">
          <div class="modal-head">
            <h3>领料记录 · {{ recordsProjName }}</h3>
          </div>
          <div class="modal-body">
            <div v-if="recordsLoading" class="hint">
              <div class="spinner-sm" />加载中…
            </div>
            <div v-else-if="!records.length" class="hint">暂无领料记录</div>
            <ul v-else class="rec-list">
              <li v-for="r in records" :key="r.id" class="rec-item">
                <span class="rec-sets">{{ r.sets }} 套</span>
                <span class="rec-time">{{ fmtFull(r.created_at) }}</span>
              </li>
            </ul>
          </div>
          <div class="modal-foot">
            <button class="btn btn-ghost" @click="recordsOpen = false">关闭</button>
          </div>
        </div>
      </div>
    </Teleport>

    <!-- ===== 改选 / 选择物料（自身库 + 立创商城 + 新建物料） ===== -->
    <MaterialBindDialog :model-value="!!pickerFor" :keyword="pickerFor?.raw || ''"
      :desc="pickerFor ? `为「${pickerFor.raw || '该行'}」挑选或新建物料` : ''" allow-new :categories="categories"
      @update:model-value="pickerFor = $event ? pickerFor : null" @select="onPicked" />

    <!-- ===== 编辑已绑定物料 / 立创选品建料 ===== -->
    <MaterialFormDialog v-model="editOpen" :categories="categories" :material="editMaterial" :lcsc="formLcsc"
      :lcsc-price="formLcscPrice" @saved="onMaterialSaved" />

    <!-- ===== 新建 BOM（多步骤导入，导入态全部内聚在组件内） ===== -->
    <BomImport v-model="wizardOpen" @saved="loadProjects" />

    <!-- ===== 空白 BOM：新建 / 编辑明细（逐行选物料，数量超库存实时标红） ===== -->
    <Teleport to="body">
      <Transition name="bm-fade">
        <div v-if="bmOpen" class="bm-mask" @click.self="closeBomDrawer">
          <aside class="bm-drawer">
            <header class="bm-head">
              <h3>{{ bmMode === 'create' ? '新建 BOM' : '编辑明细' }}</h3>
              <button class="bm-close" title="关闭" @click="closeBomDrawer">
                <X :size="16" style="display: inline-flex; flex-shrink: 0" />
              </button>
            </header>

            <div class="bm-body">
              <!-- BOM 基本信息 -->
              <div class="bm-section">
                <span class="bm-label">BOM 基本信息</span>
                <div class="bm-field">
                  <label>名称<span class="req">*</span></label>
                  <input v-model="bmName" :disabled="bmMode === 'edit'" placeholder="如：主控板 V2" maxlength="60" />
                </div>
              </div>

              <!-- BOM 明细 -->
              <div class="bm-section">
                <div class="bm-sec-head">
                  <span class="bm-label">BOM 明细</span>
                  <button class="btn btn-ghost mini" @click="addBomRow">
                    <Plus :size="13" style="display: inline-flex; flex-shrink: 0" />添加物料
                  </button>
                </div>

                <table v-if="bmRows.length" class="bm-table">
                  <thead>
                    <tr>
                      <th class="c-item">物料</th>
                      <th class="c-qty">数量</th>
                      <th class="c-stock">库存</th>
                      <th class="c-ops"></th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="r in bmRows" :key="r.key" :class="{ 'is-bad': rowShort(r) }">
                      <td class="c-item">
                        <button class="pick-btn" :class="{ empty: !r.material }" :title="r.material?.name || ''"
                          @click="pickRowMaterial(r)">
                          <Search v-if="!r.material" :size="13" style="display: inline-flex; flex-shrink: 0" />
                          <span class="pick-txt">{{ r.material ? r.material.name : '选择物料' }}</span>
                        </button>
                        <small v-if="r.material?.model" class="row-sub mono">{{ r.material.model }}</small>
                      </td>
                      <td class="c-qty">
                        <input v-model.number="r.qty" type="number" min="1" step="1" class="qty-in"
                          :class="{ bad: rowShort(r) }" :title="rowShort(r) ? '数量超出库存' : ''" />
                      </td>
                      <td class="c-stock">
                        <span class="bm-stock" :class="{ bad: rowShort(r) }">
                          {{ r.material ? r.material.qty : '—' }}
                        </span>
                      </td>
                      <td class="c-ops">
                        <button class="btn btn-icon mini" title="移除" @click="removeBomRow(r)">
                          <Trash2 :size="13" style="display: inline-flex; flex-shrink: 0" />
                        </button>
                      </td>
                    </tr>
                  </tbody>
                </table>
                <p v-else class="bm-empty">还没有明细，点「添加物料」加入 BOM 需要的物料</p>
                <p v-if="bmErr" class="bm-err">{{ bmErr }}</p>
              </div>
            </div>

            <footer class="bm-foot">
              <span class="bm-sum">共 {{ bmValidCount }} 项 · 合计 {{ bmTotalQty }} 件</span>
              <button class="btn btn-ghost" :disabled="bmSaving" @click="closeBomDrawer">取消</button>
              <button class="btn btn-primary" :disabled="bmSaving" @click="saveBom">
                <span v-if="bmSaving" class="spinner-sm" />{{ bmSaving ? '保存中…' : '保存' }}
              </button>
            </footer>
          </aside>
        </div>
      </Transition>
    </Teleport>

    <!-- ===== 编辑明细时给行挑物料（复用同一个绑定弹窗） ===== -->
    <MaterialBindDialog :model-value="!!pickerDraft" :keyword="pickerDraft?.material?.model || ''"
      :desc="pickerDraft ? `为第 ${pickerDraftIdx + 1} 行挑选或新建物料` : ''" allow-new :categories="categories"
      @update:model-value="pickerDraft = $event ? pickerDraft : null" @select="onDraftPicked" />
  </section>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import {
  Plus, ChevronRight, List, FileText, ArrowUpFromLine, Trash2, Check, X, History, Search,
} from 'lucide-vue-next'
import {
  listBomProjects, listBomItems, deleteBomProject, stockInOrder, updateBomItem, deleteBomItem,
  createMaterial, createBomPickRecord, listBomPickRecords, listCategories,
  createBomProject, createBomItems,
} from '../lib/db'
import type {
  BomProject, BomItem, BomPickRecord, MaterialRow, MaterialDraft, Category, MaterialFormResult,
} from '../lib/types'
import { lcscLookup, type LcscHit, type LcscComponent } from '../lib/lcscApi'
import DataTable from '../components/DataTable.vue'
import type { DtColumn } from '../components/DataTable.vue'
import BomImport from '../components/business/BomImport.vue'
import MaterialBindDialog from '../components/business/MaterialBindDialog.vue'
import MaterialFormDialog from '../components/business/MaterialFormDialog.vue'
import { useToast } from '../composables/toast'
import { confirm } from '../composables/confirm'

const toast = useToast()

/** 新建 BOM 导入弹框开关（打开时组件自动重置导入态） */
const wizardOpen = ref(false)

// ===== 项目列表（含每项统计） =====
interface ProjWithStats extends BomProject {
  items: BomItem[]
  stats: { total: number; matched: number; short: number; unmatched: number }
}
const projects = ref<ProjWithStats[]>([])
const projLoading = ref(false)

/**
 * 是否算「已匹配」。
 * 只看 material_id 是不够的：物料被删除后 bom_items.material_id 仍留着（悬空引用），
 * 而 listBomItems 是 left join（sqlite 还带 c.deleted_at is null），查不到就会 materials = null。
 * 此时必须判成未匹配，否则库存都空了还能数出「已匹配 N」。
 */
function isMatched(i: BomItem): boolean { return !!i.material_id && !!i.materials }

/** 由明细行计算项目统计 */
function statsOf(items: BomItem[]) {
  const matched = items.filter(isMatched).length
  return {
    total: items.length,
    matched,
    short: items.filter(i => isMatched(i) && (i.materials?.qty ?? 0) < i.qty).length,
    // 未匹配 = 压根没绑 + 绑了但物料已不存在
    unmatched: items.length - matched,
  }
}

async function loadProjects() {
  projLoading.value = true
  try {
    const list = await listBomProjects()
    projects.value = await Promise.all(list.map(async p => {
      const items = await listBomItems(p.id)
      return { ...p, items, stats: statsOf(items) }
    }))
  } catch (e: unknown) { toast.error('加载失败：' + ((e as Error).message || e)) }
  finally { projLoading.value = false }
}

// ===== 项目详情（右侧抽屉） =====
// 关键：抽屉只记 id，数据由 projects 派生。
// 之前存的是 projects 里那个对象的引用，而 loadProjects() 会整体重建 projects，
// 于是抽屉留在旧快照上：卡片已刷新、抽屉还停在绑定前 → 出现「统计已匹配、列表全未匹配」。
const curProjectId = ref<string | null>(null)
const curProject = computed<ProjWithStats | null>(
  () => projects.value.find(p => p.id === curProjectId.value) ?? null,
)
const issuing = ref(false)

/** 明细变更的唯一入口：写回 projects，卡片统计与抽屉列表共用同一份数据 */
function patchProjectItems(projectId: string, nextItems: BomItem[]) {
  const idx = projects.value.findIndex(p => p.id === projectId)
  if (idx < 0) return
  projects.value[idx] = { ...projects.value[idx], items: nextItems, stats: statsOf(nextItems) }
}

// ===== 领料出库：套数选择 + 逐项预览 =====
const pickOpen = ref(false)
const pickSets = ref(1)

/** 领料预览行：一行 BOM 明细对应一条 */
interface PickRow {
  id: string
  name: string
  model: string | null
  /** 每套用量（BOM 行 qty） */
  unit: number
  stock: number
  /** 本次出库 = unit × 套数 */
  need: number
  /** 缺口 = max(0, need − 库存) */
  lack: number
}

const pickCols: DtColumn[] = [
  { key: 'name', label: '物料', minWidth: '160px' },
  { key: 'unit', label: '每套用量', align: 'right', width: '88px' },
  { key: 'stock', label: '当前库存', align: 'right', width: '88px' },
  { key: 'need', label: '本次出库', align: 'right', width: '92px' },
  { key: 'status', label: '状态', width: '100px' },
]

/** 套数取整、下限 1，避免手输小数导致预览与实际不一致 */
const pickSetsSafe = computed(() => Math.max(1, Math.floor(Number(pickSets.value) || 1)))

const pickRows = computed<PickRow[]>(() => {
  const s = pickSetsSafe.value
  return (curProject.value?.items ?? [])
    .filter(isMatched)
    .map(i => {
      const unit = i.qty
      const need = unit * s
      const stock = i.materials?.qty ?? 0
      return {
        id: i.id,
        name: i.materials?.name ?? '—',
        model: i.materials?.model ?? null,
        unit, stock, need,
        lack: Math.max(0, need - stock),
      }
    })
})

const pickLackCount = computed(() => pickRows.value.filter(r => r.lack > 0).length)
const pickTotalNeed = computed(() => pickRows.value.reduce((n, r) => n + r.need, 0))
const canIssue = computed(() =>
  pickSets.value >= 1 && pickRows.value.length > 0 && pickLackCount.value === 0)
/** 领料后低于预警阈值的项数，扣减后提醒补货 */
const reduceTip = computed(() => {
  const n = pickRows.value.filter(r => {
    const it = curProject.value?.items.find(i => i.id === r.id)
    const th = it?.materials?.threshold || it?.materials?.categories?.threshold || 5
    return r.stock - r.need <= th
  }).length
  return n ? `出库后 ${n} 项将低于预警阈值` : '库存充足，可直接出库'
})

/** 回车 / 点按钮统一走这里：预览有缺料时不允许提交 */
function onConfirmPick() {
  if (!canIssue.value) return
  void issueStock(pickSets.value)
}

// ===== 抽屉内改选 / 编辑物料 =====
const pickerFor = ref<BomItem | null>(null)
const categories = ref<Category[]>([])
const editOpen = ref(false)
const editMaterial = ref<MaterialRow | null>(null)
// 立创选品后交给「新增物料」表单确认建料（与导入向导一致），保存后回填绑定到目标行
const formLcsc = ref<LcscComponent | null>(null)
const formLcscPrice = ref<number | null>(null)
const pendingBindRow = ref<BomItem | null>(null)
/** 立创建料后回填绑定的目标（编辑明细抽屉里的草稿行） */
const pendingBindDraft = ref<BmRow | null>(null)

// ===== 领料记录 =====
const recordsOpen = ref(false)
const recordsLoading = ref(false)
const records = ref<BomPickRecord[]>([])
const recordsProjName = ref('')

const detailMatched = computed(() => curProject.value?.stats.matched ?? 0)
const detailUnmatched = computed(() => curProject.value?.stats.unmatched ?? 0)
const detailShort = computed(() => curProject.value?.stats.short ?? 0)

// 详情内按状态过滤明细
type DetailFilter = 'all' | 'matched' | 'short' | 'unmatched'
const detailFilter = ref<DetailFilter>('all')
const filteredItems = computed(() => {
  const items = curProject.value?.items ?? []
  switch (detailFilter.value) {
    case 'matched': return items.filter(isMatched)
    case 'short': return items.filter(i => isMatched(i) && (i.materials?.qty ?? 0) < i.qty)
    case 'unmatched': return items.filter(i => !isMatched(i))
    default: return items
  }
})

function openProject(p: ProjWithStats) {
  detailFilter.value = 'all'
  curProjectId.value = p.id
}

function closeDrawer() {
  curProjectId.value = null
}

// ===== 空白 BOM：新建 / 编辑明细（参照待采单抽屉：内存编辑 → 保存时落库） =====
/** 草稿行：先在内存里编辑，点保存才落库 */
interface BmRow {
  key: string
  /** 明细 id（编辑模式下的已有行）；null = 新增行 */
  id: string | null
  material: MaterialRow | null
  qty: number
}

const bmOpen = ref(false)
const bmMode = ref<'create' | 'edit'>('create')
const bmName = ref('')
const bmRows = ref<BmRow[]>([])
const bmSaving = ref(false)
const bmErr = ref('')
/** 打开时的已有明细，保存时用于求差集（删除被移除的行） */
const bmOriginal = ref<BomItem[]>([])

let bmSeq = 0
function bmBlank(): BmRow { return { key: `bm${++bmSeq}`, id: null, material: null, qty: 1 } }

/** 需求数量 > 物料库存（仅已匹配可比） */
function isShort(i: BomItem): boolean { return isMatched(i) && (i.materials?.qty ?? 0) < i.qty }
/** 草稿行：数量超过所选物料库存 → 标红 */
function rowShort(r: BmRow): boolean { return !!r.material && r.qty > 0 && r.material.qty < r.qty }

const bmValidCount = computed(() => bmRows.value.filter(r => r.material && r.qty > 0).length)
const bmTotalQty = computed(() =>
  bmRows.value.reduce((s, r) => s + (r.material && r.qty > 0 ? r.qty : 0), 0))

function openCreateBom() {
  bmMode.value = 'create'
  bmName.value = `BOM ${new Date().toLocaleDateString('zh-CN')}`
  bmRows.value = [bmBlank()]
  bmOriginal.value = []
  bmErr.value = ''
  bmOpen.value = true
}

async function openEditBom() {
  const proj = curProject.value
  if (!proj) return
  bmMode.value = 'edit'
  bmName.value = proj.name
  // 编辑态下名称不可改（没有改项目名的接口），改名需另建项目
  bmRows.value = (proj.items.length ? proj.items : await listBomItems(proj.id)).map(i => ({
    key: `bm${++bmSeq}`,
    id: i.id,
    // 悬空引用（物料已删）视为未绑定，避免显示一个查不到的物料
    material: isMatched(i) ? (i.materials as MaterialRow) : null,
    qty: i.qty,
  }))
  if (!bmRows.value.length) bmRows.value = [bmBlank()]
  bmOriginal.value = proj.items
  bmErr.value = ''
  bmOpen.value = true
}

function closeBomDrawer() {
  if (bmSaving.value) return
  bmOpen.value = false
}
function addBomRow() { bmRows.value.push(bmBlank()); bmErr.value = '' }
function removeBomRow(r: BmRow) {
  // 至少保留一行，删完自动留一个空行
  if (bmRows.value.length <= 1) { bmRows.value = [bmBlank()] }
  else { bmRows.value = bmRows.value.filter(x => x.key !== r.key) }
  bmErr.value = ''
}

/** 行上选物料：复用同一个绑定弹窗（自身库 / 新建 / 立创） */
const pickerDraft = ref<BmRow | null>(null)
const pickerDraftIdx = computed(() => bmRows.value.findIndex(r => r.key === pickerDraft.value?.key))

function pickRowMaterial(r: BmRow) {
  void ensureCategories()
  pickerDraft.value = r
}

async function onDraftPicked(
  p: { kind: 'material'; item: MaterialRow }
    | { kind: 'lcsc'; item: unknown }
    | { kind: 'draft'; draft: MaterialDraft },
) {
  const r = pickerDraft.value
  if (!r) return
  pickerDraft.value = null
  try {
    if (p.kind === 'material') {
      r.material = p.item
    } else if (p.kind === 'draft') {
      r.material = await createMaterial(p.draft as Partial<MaterialRow>)
    } else {
      // 立创：拉详情后交给「新增物料」表单确认建料，保存时回填绑定到该草稿行
      const hit = p.item as LcscHit
      const detail = await lcscLookup(hit.part_no)
      pendingBindDraft.value = r
      formLcsc.value = detail
      formLcscPrice.value = hit.price ?? null
      editMaterial.value = null
      editOpen.value = true
    }
    bmErr.value = ''
  } catch (e: unknown) {
    toast.error('绑定失败：' + ((e as Error).message || e))
  }
}

/** 保存：create 模式先建项目；然后按差集 新建 / 更新 / 删除 明细 */
async function saveBom() {
  if (bmSaving.value) return
  bmErr.value = ''
  if (!bmName.value.trim()) { bmErr.value = '请填写 BOM 名称'; return }
  const valid = bmRows.value.filter(r => r.material && r.qty > 0)
  if (!valid.length) { bmErr.value = '至少一行要选择物料且数量大于 0'; return }

  bmSaving.value = true
  try {
    let projId: string
    if (bmMode.value === 'create') {
      const p = await createBomProject(bmName.value.trim())
      projId = p.id
    } else {
      const cur = curProject.value
      if (!cur) throw new Error('项目已不存在')
      projId = cur.id
    }

    // 1) 删除被移除的行（仅编辑模式：原明细 id 不在当前行里）
    const keepIds = new Set(bmRows.value.map(r => r.id).filter(Boolean) as string[])
    for (const i of bmOriginal.value) {
      if (i.id && !keepIds.has(i.id)) await deleteBomItem(i.id)
    }
    // 2) 更新已有行（改了物料 / 数量才发请求）
    for (const r of bmRows.value) {
      if (!r.id) continue
      const before = bmOriginal.value.find(i => i.id === r.id)
      if (!before) continue
      const patch: Partial<BomItem> = {}
      const mid = r.material?.id ?? null
      if ((before.material_id ?? null) !== mid) { patch.material_id = mid; patch.matched = !!mid }
      if (before.qty !== r.qty) patch.qty = r.qty
      if (Object.keys(patch).length) await updateBomItem(r.id, patch)
    }
    // 3) 新建本轮新增的行
    const news = bmRows.value.filter(r => !r.id && r.material && r.qty > 0)
    if (news.length) {
      await createBomItems(projId, news.map(r => ({
        material_id: r.material!.id, qty: r.qty, raw: null, matched: true,
      })))
    }

    // 刷新整表：卡片统计与抽屉列表共用同一份数据
    await loadProjects()
    if (bmMode.value === 'create') {
      // 新建后直接打开新项目，方便继续补充
      const created = projects.value.find(p => p.id === projId)
      if (created) curProjectId.value = created.id
    }
    bmOpen.value = false
    toast.success(bmMode.value === 'create' ? '已创建 BOM 项目' : '明细已保存')
  } catch (e: unknown) {
    toast.error('保存失败：' + ((e as Error).message || e))
  } finally {
    bmSaving.value = false
  }
}

async function confirmDelete() {
  const proj = curProject.value
  if (!proj) return
  const n = proj.items.length
  const ok = await confirm({
    title: '删除 BOM 项目',
    content: `确认删除「${proj.name}」？将同时删除其下 ${n} 条物料明细，且不可恢复！`,
    danger: true,
    confirmText: '删除',
  })
  if (!ok) return
  try {
    await deleteBomProject(proj.id)
    toast.success(`已删除项目「${proj.name}」`)
    // 项目已从库中移除，派生出来的 curProject 自然为 null；这里再置一次以防本地删除失败
    curProjectId.value = null
    await loadProjects()
  } catch (e: unknown) { toast.error('删除失败：' + ((e as Error).message || e)) }
}

// ===== 一键领料出库 =====
async function issueStock(sets: number) {
  const proj = curProject.value
  if (!proj) return
  const s = Math.max(1, Math.floor(Number(sets) || 1))
  // 必须全部匹配且物料仍在库中：悬空引用的行同样不能出库
  const unmatched = proj.items.filter(i => !isMatched(i))
  if (unmatched.length) {
    toast.error(`还有 ${unmatched.length} 项未匹配，请先「选择」补全后再领料`)
    return
  }
  const items = proj.items
  if (!items.length) { toast.error('无可出库的物料项'); return }
  // 按套数校验库存：每行需求 = 行数量 × 套数
  const shortItems = items.filter(i => isMatched(i) && (i.materials?.qty ?? 0) < i.qty * s)
  if (shortItems.length) {
    const names = shortItems.slice(0, 3).map(i => i.materials?.name || '').filter(Boolean).join('、')
    toast.error(`${shortItems.length} 项缺料（${names}…），按 ${s} 套出库库存不足`)
    return
  }
  issuing.value = true
  try {
    const pickNote = `BOM 领料：${proj.name}（${s} 套）`
    // 一次领料 = 一张出库单（source=bom，source_id 指向 BOM 项目）
    const { finals } = await stockInOrder({
      type: 'out', source: 'bom', source_id: proj.id,
      title: pickNote, note: `BOM 领料：${proj.name}`,
      items: items
        .filter(i => i.material_id && i.materials)
        .map(i => ({ material_id: i.material_id!, qty: i.qty * s, note: pickNote })),
    })
    let ok = 0
    // 本地扣减（以出库后终值为准）
    for (const it of items) {
      if (!it.material_id || !it.materials) continue
      it.materials = { ...it.materials, qty: finals.get(it.material_id) ?? it.materials.qty - it.qty * s }
      ok++
    }
    // 记一条领料记录（含套数）
    await createBomPickRecord(proj.id, s, `BOM 领料：${proj.name}`)
    toast.success(`已出库 ${ok} 项 × ${s} 套`)
    // 库存已在上面就地扣减，这里重算缺料统计（卡片与抽屉同步）
    patchProjectItems(proj.id, proj.items)
    pickOpen.value = false
  } catch (e: unknown) { toast.error('出库失败：' + ((e as Error).message || e)) }
  finally { issuing.value = false }
}

// ===== 改选 / 编辑：抽屉内对单行重新绑定物料 =====
async function ensureCategories() {
  if (categories.value.length) return
  try { categories.value = await listCategories() } catch { /* 静默 */ }
}

/** 领料前校验：全部匹配 + 无缺料，才允许打开套数弹框 */
function openPickDialog() {
  const proj = curProject.value
  if (!proj) return
  const unmatched = proj.items.filter(i => !isMatched(i))
  if (unmatched.length) {
    toast.error(`还有 ${unmatched.length} 项未匹配，请先「选择」补全后再领料`)
    return
  }
  const shortItems = proj.items.filter(i => isMatched(i) && (i.materials?.qty ?? 0) < i.qty)
  if (shortItems.length) {
    const names = shortItems.slice(0, 3).map(i => i.materials?.name || '').filter(Boolean).join('、')
    toast.error(`${shortItems.length} 项缺料（${names}…），库存不足无法出库`)
    return
  }
  pickSets.value = 1
  pickOpen.value = true
}

function openPickerFor(it: BomItem) {
  void ensureCategories()
  pickerFor.value = it
}

/** 改选回调：自身库命中直接绑定；新建草稿先落库再绑定 */
async function onPicked(
  p: { kind: 'material'; item: MaterialRow } | { kind: 'lcsc'; item: unknown } | { kind: 'draft'; draft: MaterialDraft },
) {
  const it = pickerFor.value
  if (!it) return
  pickerFor.value = null
  const proj = curProject.value
  if (!proj) return
  try {
    let mat: MaterialRow
    if (p.kind === 'material') {
      mat = p.item
    } else if (p.kind === 'draft') {
      mat = await createMaterial(p.draft as Partial<MaterialRow>)
    } else {
      // 立创选中：拉详情后交给「新增物料」表单确认建料，保存时回填绑定该行
      const hit = p.item as LcscHit
      const detail = await lcscLookup(hit.part_no)
      pendingBindRow.value = it
      editMaterial.value = null
      formLcsc.value = detail
      formLcscPrice.value = hit.price ?? null
      editOpen.value = true
      return
    }
    await updateBomItem(it.id, { material_id: mat.id, matched: true })
    patchProjectItems(proj.id, proj.items.map(i => i.id === it.id
      ? { ...i, material_id: mat.id, matched: true, materials: mat }
      : i))
    toast.success(`已绑定到「${mat.name}」`)
  } catch (e: unknown) { toast.error('改选失败：' + ((e as Error).message || e)) }
}

/** 编辑已绑定物料的信息 */
function openEditMaterial(it: BomItem) {
  if (!it.materials) { toast.error('该行未绑定物料，请先「选择」'); return }
  void ensureCategories()
  editMaterial.value = it.materials
  editOpen.value = true
}

async function onMaterialSaved(res: MaterialFormResult) {
  // 立创选品后新建的物料：回填绑定到「编辑明细」抽屉里的草稿行
  if (pendingBindDraft.value && res.material) {
    pendingBindDraft.value.material = res.material
    pendingBindDraft.value = null
    formLcsc.value = null
    formLcscPrice.value = null
    toast.success(`已新建并绑定「${res.material.name}」`)
    return
  }
  // 立创选品后新建的物料：回填绑定到目标 BOM 行
  if (pendingBindRow.value && res.material) {
    const it = pendingBindRow.value
    const mat = res.material
    pendingBindRow.value = null
    formLcsc.value = null
    formLcscPrice.value = null
    await updateBomItem(it.id, { material_id: mat.id, matched: true })
    const proj = curProject.value
    if (proj) {
      patchProjectItems(proj.id, proj.items.map(i => i.id === it.id
        ? { ...i, material_id: mat.id, matched: true, materials: mat }
        : i))
    }
    toast.success(`已新建并绑定「${mat.name}」`)
    return
  }
  formLcsc.value = null
  formLcscPrice.value = null
  // 重新整表加载即可，抽屉数据由 projects 派生，无需再手动对齐引用
  await loadProjects()
  toast.success('物料已更新')
}

// ===== 领料记录 =====
async function openRecords(p: ProjWithStats) {
  recordsProjName.value = p.name
  recordsOpen.value = true
  recordsLoading.value = true
  records.value = []
  try { records.value = await listBomPickRecords(p.id) }
  catch (e: unknown) { toast.error('加载领料记录失败：' + ((e as Error).message || e)) }
  finally { recordsLoading.value = false }
}

// ===== 表格列 =====
const detailCols: DtColumn[] = [
  { key: 'raw', label: '原始行', minWidth: '120px', maxWidth: '200px', cls: 'dt-raw' },
  { key: 'matched', label: '匹配物料', minWidth: '110px', maxWidth: '150px' },
  { key: 'category', label: '小类', minWidth: '70px', maxWidth: '110px' },
  { key: 'brand', label: '品牌', minWidth: '60px', maxWidth: '100px' },
  { key: 'part_no', label: '商品编号', minWidth: '90px', maxWidth: '140px', cls: 'mono' },
  { key: 'qty', label: '数量', align: 'right', width: '40px' },
  { key: 'stock', label: '当前库存', align: 'right', width: '40px' },
  { key: 'status', label: '状态', width: '155px' },
  { key: 'ops', label: '操作', width: '150px' },
]

function fmtFull(t: string) {
  if (!t) return ''
  const d = new Date(t)
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

onMounted(loadProjects)
</script>

<style scoped>
.page {
  height: 100%;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
}

.head h1 {
  margin: 0;
  font-size: var(--fs-xl);
  font-weight: 700;
  letter-spacing: -0.02em;
}

.head p {
  margin: 4px 0 0;
  color: var(--c-text-2);
  font-size: var(--fs-sm);
}

.head-actions {
  display: flex;
  gap: 8px;
}

/* ===== 面板（与 Categories / 基础数据一致） ===== */
.pane {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.pane-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 14px 18px;
  border-bottom: 1px solid var(--c-border-hairline);
  background: var(--c-glass);
  flex-shrink: 0;
  flex-wrap: wrap;
}

.pane-title {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: var(--fs-sm);
  font-weight: 600;
  color: var(--c-text);
}

.pane-count {
  font-size: var(--fs-xs);
  color: var(--c-text-2);
  font-weight: 600;
  background: var(--c-surface);
  padding: 2px 8px;
  border-radius: 999px;
}

.pane-list {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 6px;
}

/* ===== 项目列表 ===== */
.proj-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.proj-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 16px;
  border-radius: var(--r-md);
  border: 1px solid var(--c-border-hairline);
  background: var(--c-elevated);
  cursor: pointer;
  transition: all var(--motion);
}

.proj-item:hover {
  background: var(--c-surface-active);
  border-color: var(--c-border);
  box-shadow: var(--shadow-sm, 0 1px 4px rgba(0, 0, 0, 0.06));
}

.proj-ico {
  width: 40px;
  height: 40px;
  border-radius: var(--r-md);
  background: var(--c-primary-soft);
  color: var(--c-primary);
  display: grid;
  place-items: center;
  flex-shrink: 0;
}

.proj-info {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 12px;
}

.proj-info strong {
  font-size: var(--fs-md);
  font-weight: 600;
}

.proj-info small {
  color: var(--c-text-3);
  font-size: var(--fs-xs);
  flex-shrink: 0;
}

.proj-arrow {
  color: var(--c-text-3);
  transition: all var(--motion);
}

.proj-item:hover .proj-arrow {
  transform: translateX(2px);
  color: var(--c-primary);
}

/* ===== 详情 ===== */
.dh-info {
  display: flex;
  align-items: center;
  gap: 14px;
  flex-wrap: wrap;
}

.dh-stats {
  display: flex;
  gap: 14px;
  align-items: center;
  flex-wrap: wrap;
}

.dh-actions {
  display: flex;
  gap: 8px;
  flex-shrink: 0;
}

/* ===== 通用 ===== */
.hint {
  display: grid;
  place-items: center;
  flex: 1;
  padding: 24px 0;
}

.spinner-lg {
  width: 28px;
  height: 28px;
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
  animation: spin 0.6s linear infinite;
  display: inline-block;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.stat-total {
  font-size: var(--fs-xs);
  color: var(--c-text-2);
  font-weight: 600;
  background: var(--c-surface);
  padding: 2px 10px;
  border-radius: 999px;
  /* border: 1px solid var(--c-border-hairline); */
}

.stat {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: var(--fs-xs);
  font-weight: 500;
}

.stat .dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
}

.stat.ok {
  color: var(--c-accent);
}

.stat.ok .dot {
  background: var(--c-accent);
}

.stat.bad {
  color: var(--c-danger);
}

.stat.bad .dot {
  background: var(--c-danger);
}

.stat.warn {
  color: var(--c-warning);
}

.stat.warn .dot {
  background: var(--c-warning);
}

.mono {
  font-family: ui-monospace, 'SF Mono', Menlo, Consolas, monospace;
  font-size: var(--fs-xs);
}

.qty-cell {
  font-weight: 700;
  font-size: var(--fs-md);
}

.qty-cell.ok {
  color: var(--c-accent);
}

.qty-cell.bad {
  color: var(--c-danger);
}

.qty-cell.dim {
  color: var(--c-text-3);
  font-weight: 500;
}

.pill {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 10px;
  border-radius: 999px;
  font-size: var(--fs-xs);
  font-weight: 600;
}

.pill.ok {
  background: rgba(52, 218, 191, 0.12);
  color: var(--c-accent);
}

.pill.bad {
  background: rgba(255, 107, 107, 0.12);
  color: var(--c-danger);
}

.pill.warn {
  background: rgba(245, 158, 11, 0.12);
  color: var(--c-warning);
}

.empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  color: var(--c-text-2);
  text-align: center;
  padding: 24px;
}

.empty-ico {
  width: 72px;
  height: 72px;
  border-radius: var(--r-xl);
  background: var(--c-glass);
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

/* ===== 列表卡片统计（名称行内：左右结构） ===== */
.proj-line {
  display: flex;
  align-items: center;
  gap: 10px;
  flex: 1;
  min-width: 0;
}

.proj-info strong {
  flex: 1;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.proj-stats {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 10px;
  align-items: center;
  flex-shrink: 0;
}

/* ===== 详情抽屉（视觉令牌与 MaterialDetailDrawer 一致） ===== */
.dw-mask {
  position: fixed;
  inset: 0;
  z-index: 120;
  background: rgba(0, 0, 0, 0.5);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  display: flex;
  justify-content: flex-end;
}

.dw {
  width: min(740px, 100vw);
  height: 100%;
  background: var(--c-elevated, #fff);
  border-left: 1px solid var(--c-border);
  box-shadow: var(--shadow-lg, 0 8px 30px rgba(0, 0, 0, 0.18));
  display: flex;
  flex-direction: column;
}

.dw-head {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 18px 22px;
  border-bottom: 1px solid var(--c-border-hairline, var(--c-border));
  flex-shrink: 0;
}

.dw-title {
  flex: 1;
  min-width: 0;
}

.dw-title h2 {
  margin: 0;
  font-size: var(--fs-xl);
  font-weight: 700;
  letter-spacing: -0.01em;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.dw-title p {
  margin: 4px 0 0;
  font-size: var(--fs-sm);
  color: var(--c-text-2);
}

.dw-close {
  width: 30px;
  height: 30px;
  border: none;
  border-radius: 50%;
  background: var(--c-surface);
  color: var(--c-text-2);
  display: grid;
  place-items: center;
  cursor: pointer;
  flex-shrink: 0;
  transition: all var(--motion);
}

.dw-close:hover {
  background: var(--c-surface-hover);
  color: var(--c-text);
}

.dw-scroll {
  flex: 1;
  overflow-y: auto;
  padding: 16px 18px 24px;
}

/* ===== 空白 BOM：新建 / 编辑明细 =====
   布局与视觉令牌抄自采购单抽屉（StockPurchase.vue 的 .po-mask / .pd-*），
   两处必须保持一致：遮罩、标题、分节表单、明细表、底部操作栏。 */

/* z-index 必须低于「选择物料」弹窗（200），否则抽屉会盖住二级弹窗 */
.bm-mask {
  position: fixed;
  inset: 0;
  z-index: 120;
  background: rgba(0, 0, 0, 0.5);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  display: flex;
  justify-content: flex-end;
}

/* 不透明实体面：--c-surface 是半透明玻璃，直接用作抽屉底会透出背后列表 */
.bm-drawer {
  width: min(620px, 100vw);
  height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--c-elevated);
  border-left: 1px solid var(--c-border);
  box-shadow: var(--shadow-lg);
}

.bm-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 20px 22px 16px;
  border-bottom: 1px solid var(--c-border);
  flex-shrink: 0;
}

.bm-head h3 {
  margin: 0;
  font-size: var(--fs-lg);
  font-weight: 600;
}

.bm-close {
  width: 30px;
  height: 30px;
  border: none;
  border-radius: 50%;
  background: var(--c-surface);
  color: var(--c-text-2);
  display: grid;
  place-items: center;
  cursor: pointer;
  flex-shrink: 0;
  transition: all var(--motion);
}

.bm-close:hover {
  background: var(--c-surface-hover);
  color: var(--c-text);
}

.bm-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 16px 18px;
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.bm-section {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.bm-label {
  font-size: var(--fs-sm);
  font-weight: 600;
  color: var(--c-text-2);
}

.bm-sec-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.bm-field {
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.bm-field label {
  font-size: var(--fs-xs);
  color: var(--c-text-2);
}

.bm-field label .req {
  margin-left: 3px;
  color: var(--c-danger);
}

.bm-field input,
.bm-field textarea {
  width: 100%;
  padding: 7px 10px;
  font-size: var(--fs-sm);
  background: var(--c-glass);
  border: 1px solid var(--c-border);
  border-radius: var(--r-md);
  color: var(--c-text);
  font-family: inherit;
  resize: vertical;
}

.bm-field input:focus,
.bm-field textarea:focus {
  outline: none;
  border-color: var(--c-primary);
  background: var(--c-surface);
  box-shadow: 0 0 0 3px var(--c-primary-glow);
}

.bm-field input:disabled,
.bm-field textarea:disabled {
  opacity: 0.75;
  cursor: default;
}

/* 明细表（表头沿用 DataTable 的玻璃质感 + 吸顶） */
.bm-table {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--fs-sm);
}

.bm-table th {
  text-align: left;
  font-weight: 500;
  font-size: var(--fs-xs);
  color: var(--c-text-3);
  padding: 8px 10px;
  border-bottom: 1px solid var(--c-border-hairline);
  background: var(--c-glass-strong);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  position: sticky;
  top: 0;
  z-index: 1;
  white-space: nowrap;
}

.bm-table td {
  padding: 8px 10px;
  border-bottom: 1px solid var(--c-border-hairline);
  vertical-align: middle;
}

/* 数量超出库存：整行淡红底，与采购单校验反馈一致 */
.bm-table tr.is-bad td {
  background: color-mix(in srgb, var(--c-danger) 8%, transparent);
}

.c-item {
  min-width: 140px;
}

.c-qty {
  width: 70px;
}

.c-stock {
  width: 50px;
  text-align: right;
}

.c-ops {
  width: 34px;
}

/* 行内「选择物料」按钮 */
.pick-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  max-width: 100%;
  height: var(--ctrl-h-sm);
  padding: 0 8px;
  font-size: var(--fs-xs);
  background: var(--c-glass);
  border: 1px dashed var(--c-border);
  border-radius: var(--r-sm);
  color: var(--c-text);
  cursor: pointer;
  flex-direction: row;
}

.pick-btn.empty {
  color: var(--c-text-3);
}

.pick-btn:hover {
  border-color: var(--c-primary);
  color: var(--c-primary);
}

.pick-txt {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.row-sub {
  display: block;
  font-size: var(--fs-xs);
  color: var(--c-text-3);
}

.qty-in {
  width: 100%;
  height: var(--ctrl-h-sm);
  padding: 0 6px;
  font-size: var(--fs-xs);
  font-family: inherit;
  text-align: right;
  background: var(--c-glass);
  border: 1px solid var(--c-border);
  border-radius: var(--r-sm);
  color: var(--c-text);
}

.qty-in:focus {
  outline: none;
  border-color: var(--c-primary);
  background: var(--c-surface);
  box-shadow: 0 0 0 3px var(--c-primary-glow);
}

/* 录入数量超出库存 → 数字与边框标红 */
.qty-in.bad {
  border-color: var(--c-danger);
  color: var(--c-danger);
  font-weight: 700;
}

/* 数量超出库存 → 库存标红，与详情页一致 */
.bm-stock {
  font-size: var(--fs-xs);
  font-weight: 600;
  color: var(--c-text-2);
}

.bm-stock.bad {
  color: var(--c-danger);
}

.bm-empty {
  margin: 0;
  padding: 18px;
  text-align: center;
  font-size: var(--fs-xs);
  color: var(--c-text-3);
  border: 1px dashed var(--c-border);
  border-radius: var(--r-md);
}

.bm-err {
  margin: 0;
  font-size: var(--fs-xs);
  color: var(--c-danger);
}

.bm-foot {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  padding: 12px 18px;
  border-top: 1px solid var(--c-border-hairline);
  flex-shrink: 0;
}

.bm-sum {
  margin-right: auto;
  font-size: var(--fs-xs);
  color: var(--c-text-3);
}

/* 抽屉动画（与 .drawer-* 同一组时长曲线） */
.bm-fade-enter-active,
.bm-fade-leave-active {
  transition: opacity 220ms ease;
}

.bm-fade-enter-from,
.bm-fade-leave-to {
  opacity: 0;
}

.bm-fade-enter-active .bm-drawer,
.bm-fade-leave-active .bm-drawer {
  transition: transform 260ms cubic-bezier(0.22, 1, 0.36, 1);
}

.bm-fade-enter-from .bm-drawer,
.bm-fade-leave-to .bm-drawer {
  transform: translateX(40px);
}

/* 统计条 + 操作按钮同一行：两端对齐 */
.dh-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  margin: 14px 0 16px;
}

.dh-stats {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}

/* 可点击切换过滤的统计 chip */
.stat-chip {
  border: 1px solid var(--c-border-hairline, var(--c-border));
  background: var(--c-surface);
  border-radius: 999px;
  padding: 3px 10px;
  cursor: pointer;
  font: inherit;
  color: var(--c-text);
  transition: all var(--motion);
}

.stat-chip:hover {
  border-color: var(--c-border);
  background: var(--c-surface-hover);
}

.stat-chip.on {
  border-color: var(--c-primary);
  background: var(--c-primary-soft);
  color: var(--c-primary);
}

.stat-chip .stat-total {
  background: none;
  padding: 0;
}

.stat-chip.on .stat-total {
  color: var(--c-primary);
}

/* ===== 列表项操作按钮 ===== */
.proj-ops {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-right: 6px;
  flex-shrink: 0;
}

.btn.mini {
  height: 26px;
  padding: 0 8px;
  font-size: var(--fs-xs);
  gap: 4px;
}

/* 纯图标小按钮：覆盖全局 .btn-icon 的固定宽度，适配明细行网格 */
.btn-icon.mini {
  width: 26px;
  min-width: 26px;
  padding: 0;
}

.btn-icon.mini.danger:hover {
  color: var(--c-danger);
  border-color: var(--c-danger);
}

.ops {
  display: flex;
  gap: 4px;
}

/* 抽屉层级为 120，从抽屉内弹出的弹框需更高才能浮在上层 */
.modal-mask {
  z-index: 200;
}

/* 原始行：内容超长时省略，完整内容由 td 上的 title 悬浮显示（宽度由列 maxWidth 控制） */
:deep(.dt-raw) {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 小类 / 品牌 / 商品编号：次要信息，单行截断 */
:deep(.dt-sub) {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--c-text-2);
}

/* ===== 领料出库弹框 ===== */
.pick-modal {
  max-width: 620px;
}

.pick-sub {
  margin: 4px 0 0;
  font-size: var(--fs-sm);
  color: var(--c-text-2);
}

/* 套数行：标签 + 输入 + 右侧汇总 */
.pick-sets {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  padding-bottom: 10px;
  border-bottom: 1px solid var(--c-border-hairline);
}

.pick-label {
  font-size: var(--fs-sm);
  font-weight: 600;
}

.pick-input {
  width: 82px;
  height: var(--ctrl-h);
  text-align: center;
}

.pick-unit {
  font-size: var(--fs-sm);
  color: var(--c-text-2);
}

.pick-sum {
  margin-left: auto;
  font-size: var(--fs-xs);
  color: var(--c-text-2);
}

.txt-bad {
  color: var(--c-danger);
}

/* 明细表：定高滚动区，表头吸顶交由 DataTable 自身的 sticky th */
.pick-list {
  margin-top: 10px;
  max-height: 42vh;
  overflow: auto;
  border: 1px solid var(--c-border);
  border-radius: var(--r-md);
}

/* 让 th 的 sticky 相对 .pick-list 生效（否则卡在 DataTable 自己的 .dt-wrap 上） */
.pick-list :deep(.dt-wrap) {
  overflow: visible;
}

.pick-name {
  font-size: var(--fs-sm);
}

.pick-model {
  display: block;
  font-size: var(--fs-xs);
  color: var(--c-text-3);
}

.foot-hint {
  margin-right: auto;
  font-size: var(--fs-xs);
  color: var(--c-text-3);
}

/* ===== 领料记录 ===== */
.rec-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-height: 320px;
  overflow: auto;
}

.rec-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  border: 1px solid var(--c-border-hairline, var(--c-border));
  border-radius: var(--r-sm);
  background: var(--c-surface);
}

.rec-sets {
  font-weight: 600;
  color: var(--c-primary);
}

.rec-time {
  margin-left: auto;
  font-size: var(--fs-xs);
  color: var(--c-text-2);
}

.dh-actions {
  display: flex;
  gap: 8px;
  flex-shrink: 0;
}

/* 移动端（/m/bom 的标题由 SubPage 的 NavBar 提供）：
   页头文案与 NavBar 重复，隐藏标题与副标题，只保留「导入 BOM」等操作并右对齐 */
@media (max-width: 820px) {
  .head>div:first-child {
    display: none;
  }

  .head {
    justify-content: flex-end;
  }
}

/* 抽屉滑入 / 淡出动画 */
.bomdrawer-enter-active,
.bomdrawer-leave-active {
  transition: opacity 0.2s ease;
}

.bomdrawer-enter-from,
.bomdrawer-leave-to {
  opacity: 0;
}

.bomdrawer-enter-active .dw,
.bomdrawer-leave-active .dw {
  transition: transform 0.22s ease;
}

.bomdrawer-enter-from .dw,
.bomdrawer-leave-to .dw {
  transform: translateX(100%);
}
</style>
