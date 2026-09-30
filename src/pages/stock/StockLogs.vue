<template>
  <section class="tab">
    <div class="filters">
      <Segmented v-model="logType" :options="[
        { value: 'all', label: '全部' },
        { value: 'in', label: '入库' },
        { value: 'out', label: '出库' },
      ]" />
      <div class="f-cat">
        <AppSelect v-model="logRange" :options="rangeOptions" :min-width="0" />
      </div>
      <div class="f-cat">
        <AppSelect v-model="logStatus" :options="statusOptions" :min-width="0" />
      </div>
      <div class="f-search">
        <Search :size="15" class="s-ico" style="display: inline-flex; flex-shrink: 0" />
        <input v-model="logKw" placeholder="搜索物料名称 / 备注" />
      </div>

      <!-- 多选操作：固定在筛选行右侧 -->
      <div class="sel-group">
        <label class="sel-all">
          <input class="row-check" type="checkbox" :checked="allPageChecked" :indeterminate="pageIndeterminate"
            @change="toggleAllPage" />
          全选本页
        </label>
        <template v-if="selected.length">
          <span class="sel-count">已选 <b>{{ selected.length }}</b> 条</span>
          <button class="btn btn-ghost btn-sm" @click="clearSelection">清空</button>
          <button class="btn btn-danger btn-sm" :disabled="voidBusy" @click="openVoidSelected">
            <Undo2 :size="13" style="display: inline-flex; flex-shrink: 0" /> 批量撤销
          </button>
        </template>
      </div>
    </div>

    <div class="logs-wrap">
      <EmptyState v-if="!logRows.length" :icon="Inbox" title="暂无出入库记录" />
      <ul v-else class="log-list">
        <li v-for="r in logRows" :key="r.id"
          :class="[r.type, { 'is-void': r.status === 'void', 'is-sel': isSelected(r.id) }]">
          <div class="cb">
            <input class="row-check" type="checkbox" :checked="isSelected(r.id)" :disabled="r.status === 'void'"
              :title="r.status === 'void' ? '已撤销的记录无需再撤销' : '选择该记录'" @change="toggleRow(r.id)" />
          </div>
          <div class="tag-wrap"><span class="tag">{{ r.type === 'in' ? '入' : '出' }}</span></div>
          <div class="info">
            <strong>{{ r.materials?.name || '已删除物料' }}</strong>
            <small><template v-if="r.type === 'in' && r.suppliers?.name">{{ r.suppliers.name }} · </template>{{
              r.materials?.model || '' }}<template v-if="r.note"> · {{ r.note }}</template></small>
            <small v-if="r.status === 'void'" class="void-reason">
              <Ban :size="11" style="display: inline-flex; flex-shrink: 0" />
              已撤销<template v-if="r.void_reason">：{{ r.void_reason }}</template>
            </small>
          </div>
          <span class="q">{{ r.type === 'in' ? '+' : '-' }}{{ r.qty }}</span>
          <time>{{ fmtFull(r.created_at) }}</time>
          <div class="op">
            <button v-if="r.status !== 'void'" class="btn btn-ghost btn-sm void-btn" :disabled="voidBusy"
              title="撤销该记录（库存同步回滚）" @click="openVoid(r)">
              <Undo2 :size="13" style="display: inline-flex; flex-shrink: 0" /> 撤销
            </button>
            <span v-else class="void-chip">已撤销</span>
          </div>
        </li>
      </ul>
    </div>

    <Pager :page="logPage" :page-size="logPageSize" :total="logTotal" @change="onLogPage"
      @update:page-size="onLogSize" />

    <!-- 撤销出入库：填写撤销原因后确认，流水保留、库存回滚 -->
    <Teleport to="body">
      <div v-if="voidTargets.length" class="modal-mask" @click.self="closeVoid">
        <div class="modal void-modal">
          <div class="modal-head">
            <h3>撤销出入库<template v-if="voidTargets.length > 1">（{{ voidTargets.length }} 条）</template></h3>
            <button class="modal-x" @click="closeVoid">
              <X :size="16" style="display: inline-flex; flex-shrink: 0" />
            </button>
          </div>
          <div class="modal-body">
            <!-- 单条：展示物料详情；多条：展示条数概览 -->
            <p v-if="voidTargets.length === 1" class="vd-sum">
              {{ voidTargets[0].materials?.name || '已删除物料' }}
              <template v-if="voidTargets[0].materials?.model">· {{ voidTargets[0].materials.model }}</template>
              · {{ voidTargets[0].type === 'in' ? '入库' : '出库' }} <b>{{ voidTargets[0].qty }}</b>
              · {{ fmtFull(voidTargets[0].created_at) }}
            </p>
            <p v-else class="vd-sum">
              共 <b>{{ voidTargets.length }}</b> 条
              <template v-if="voidInCount">（入库 {{ voidInCount }} 条）</template>
              <template v-if="voidOutCount">（出库 {{ voidOutCount }} 条）</template>
            </p>
            <p class="vd-tip">
              撤销后这些记录保留并标记「已撤销」，库存将按各条流水反向回滚
              <template v-if="voidTargets.length === 1">
                （{{ voidTargets[0].type === 'in' ? '扣回' : '加回' }} <b>{{ voidTargets[0].qty }}</b>）
              </template>
              <template v-else>
                （入库扣回、出库加回 <b>{{ voidTotalQty }}</b>）
              </template>
              。
            </p>
            <label class="field">
              <span>撤销原因 <em>*</em></span>
              <textarea v-model="voidReason" rows="3" placeholder="如：录入有误 / 数量填错 / 退货至供应商"
                @keydown.ctrl.enter.prevent="submitVoid" />
            </label>
            <p v-if="voidErr" class="vd-err">{{ voidErr }}</p>
          </div>
          <div class="modal-foot">
            <button class="btn btn-ghost" @click="closeVoid">取消</button>
            <button class="btn btn-danger" :disabled="voidBusy || !voidReason.trim()" @click="submitVoid">
              <span v-if="voidBusy" class="spinner-sm" />
              <Undo2 v-else :size="15" style="display: inline-flex; flex-shrink: 0" />
              确认撤销<template v-if="voidTargets.length > 1">（{{ voidTargets.length }} 条）</template>
            </button>
          </div>
        </div>
      </div>
    </Teleport>
  </section>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onActivated } from 'vue'
import { Inbox, Search, Undo2, Ban, X } from 'lucide-vue-next'
import type { StockLog } from '../../lib/types'
import AppSelect from '../../components/form/AppSelect.vue'
import Segmented from '../../components/form/Segmented.vue'
import EmptyState from '../../components/EmptyState.vue'
import Pager from '../../components/Pager.vue'
import { listStockLogPage, voidStockLog, voidStockLogs } from '../../lib/db'
import { useToast } from '../../composables/toast'
import { useStockData } from '../../composables/useStockData'

const toast = useToast()
const { refreshList, refreshSummary, refreshLogs } = useStockData()

const logType = ref<'all' | 'in' | 'out'>('all')
const logRange = ref<'all' | 'today' | '7d' | '30d'>('all')
const logStatus = ref<'all' | 'normal' | 'void'>('all')
const logKw = ref('')

const logPage = ref(1)
const logPageSize = ref(20)
const logTotal = ref(0)
const logRows = ref<StockLog[]>([])
const logLoading = ref(false)

const rangeOptions = [
  { value: 'all', label: '全部时间' },
  { value: 'today', label: '今天' },
  { value: '7d', label: '近7天' },
  { value: '30d', label: '近30天' },
]

const statusOptions = [
  { value: 'all', label: '全部状态' },
  { value: 'normal', label: '有效' },
  { value: 'void', label: '已撤销' },
]

/** 时间范围 → 查询用的起止 ISO 时间 */
function rangeBounds(): { from?: string; to?: string } {
  if (logRange.value === 'all') return {}
  const end = new Date()
  let start: Date
  if (logRange.value === 'today') { start = new Date(); start.setHours(0, 0, 0, 0) }
  else { const days = logRange.value === '7d' ? 7 : 30; start = new Date(Date.now() - days * 86400000) }
  return { from: start.toISOString(), to: end.toISOString() }
}

let kwTimer: ReturnType<typeof setTimeout> | null = null

async function loadLogs() {
  logLoading.value = true
  try {
    const { from, to } = rangeBounds()
    const res = await listStockLogPage({
      type: logType.value === 'all' ? undefined : logType.value,
      status: logStatus.value === 'all' ? undefined : logStatus.value,
      keyword: logKw.value.trim(),
      from, to,
      limit: logPageSize.value,
      offset: (logPage.value - 1) * logPageSize.value,
    })
    logRows.value = res.rows
    logTotal.value = res.total
    // 清掉已不在当前结果里的选中项（分页 / 筛选后残留）
    const ids = new Set(res.rows.map(r => r.id))
    selected.value = selected.value.filter(id => ids.has(id))
  } catch { /* 静默 */ }
  finally { logLoading.value = false }
}

// 类型 / 时间范围 / 状态变化 → 回到第 1 页并重新查询
watch([logType, logRange, logStatus], () => { logPage.value = 1; void loadLogs() })
// 关键词输入做 300ms 防抖，避免逐字触发查询
watch(logKw, () => {
  if (kwTimer) clearTimeout(kwTimer)
  kwTimer = setTimeout(() => { logPage.value = 1; void loadLogs() }, 300)
})
// 切到本 tab 时自动重拉（keep-alive 不会重新挂载，故用 onActivated 而非 onMounted）
onActivated(() => { logPage.value = 1; void loadLogs() })

// 供父级「刷新」按钮调用：回到第 1 页重查
defineExpose({ refresh: () => { logPage.value = 1; return loadLogs() } })

function onLogPage(p: number) { logPage.value = p; void loadLogs() }
function onLogSize(s: number) { logPageSize.value = s; logPage.value = 1; void loadLogs() }

// ===== 多选 =====
const selected = ref<string[]>([])
/** 本页可撤销（未撤销）的流水 id */
const pageSelectableIds = computed(() => logRows.value.filter(r => r.status !== 'void').map(r => r.id))
const pageSelectedCount = computed(() => pageSelectableIds.value.filter(id => selected.value.includes(id)).length)
const allPageChecked = computed(() =>
  pageSelectableIds.value.length > 0 && pageSelectedCount.value === pageSelectableIds.value.length)
const pageIndeterminate = computed(() => pageSelectedCount.value > 0 && !allPageChecked.value)

function isSelected(id: string) { return selected.value.includes(id) }

function toggleRow(id: string) {
  const i = selected.value.indexOf(id)
  if (i >= 0) selected.value.splice(i, 1)
  else selected.value.push(id)
}

function toggleAllPage() {
  const ids = pageSelectableIds.value
  if (!ids.length) return
  if (allPageChecked.value) {
    // 取消本页：从选中列表里剔除本页 id
    selected.value = selected.value.filter(id => !ids.includes(id))
  } else {
    selected.value = [...new Set([...selected.value, ...ids])]
  }
}

function clearSelection() { selected.value = [] }

// ===== 撤销出入库（单条 / 批量共用） =====
const voidTargets = ref<StockLog[]>([])
const voidReason = ref('')
const voidErr = ref('')
const voidBusy = ref(false)

const voidInCount = computed(() => voidTargets.value.filter(r => r.type === 'in').length)
const voidOutCount = computed(() => voidTargets.value.length - voidInCount.value)
const voidTotalQty = computed(() => voidTargets.value.reduce((s, r) => s + (Number(r.qty) || 0), 0))

function openVoid(r: StockLog) {
  voidTargets.value = [r]
  voidReason.value = ''
  voidErr.value = ''
}

/** 批量撤销：按选中项在当前页的顺序组装 */
function openVoidSelected() {
  const targets = logRows.value.filter(r => selected.value.includes(r.id) && r.status !== 'void')
  if (!targets.length) { toast.warning('没有可撤销的记录'); return }
  voidTargets.value = targets
  voidReason.value = ''
  voidErr.value = ''
}

function closeVoid() {
  if (voidBusy.value) return
  voidTargets.value = []
  voidReason.value = ''
  voidErr.value = ''
}

async function submitVoid() {
  const targets = [...voidTargets.value]
  if (!targets.length) return
  const reason = voidReason.value.trim()
  if (!reason) { voidErr.value = '请填写撤销原因'; return }
  voidBusy.value = true
  voidErr.value = ''
  try {
    if (targets.length === 1) {
      const t = targets[0]
      await voidStockLog({ id: t.id, reason })
      toast.success(t.type === 'in' ? '入库已撤销，库存已扣回' : '出库已撤销，库存已加回')
      voidTargets.value = []
      voidReason.value = ''
      selected.value = selected.value.filter(id => id !== t.id)
    } else {
      const res = await voidStockLogs({ ids: targets.map(t => t.id), reason })
      if (res.done) toast.success(`已撤销 ${res.done} 条记录，库存已回滚`)
      if (res.errors.length) {
        // 失败的保留在选中项里，弹窗保留并提示原因，便于修正后重试
        voidErr.value = `${res.errors.length} 条撤销失败：${res.errors.slice(0, 3).join('；')}`
        voidTargets.value = targets.filter(t => res.failedIds.includes(t.id))
        selected.value = [...res.failedIds]
        void Promise.all([refreshList(), refreshSummary(), refreshLogs()]).catch(() => { })
        await loadLogs()
        return
      }
      voidTargets.value = []
      voidReason.value = ''
      selected.value = []
    }
    // 库存与汇总已变化：同步刷新共享的物料列表 / 汇总 / 流水，避免其它 tab 与 KPI 看到旧值
    void Promise.all([refreshList(), refreshSummary(), refreshLogs()]).catch(() => { })
    await loadLogs()
  } catch (e: unknown) {
    voidErr.value = (e as Error)?.message || '撤销失败，请重试'
  } finally { voidBusy.value = false }
}

function fmtFull(t: string) {
  if (!t) return ''
  const d = new Date(t)
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}
</script>

<style scoped>
.tab {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.filters {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  padding: 12px 16px;
  border-bottom: 1px solid var(--c-border-hairline);
  flex-shrink: 0;
}

.f-cat {
  min-width: 95px;
}

.f-search {
  position: relative;
  display: flex;
  align-items: center;
}

.s-ico {
  position: absolute;
  left: 10px;
  color: var(--c-text-3);
  pointer-events: none;
}

.f-search input {
  height: var(--ctrl-h);
  width: 220px;
  padding: 0 var(--ctrl-px) 0 32px;
  font-size: var(--fs-sm);
  background: var(--c-glass);
  border: 1px solid var(--c-border);
  border-radius: var(--r-md);
  color: var(--c-text);
  transition: all var(--motion);
}

.f-search input:focus {
  border-color: var(--c-primary);
  background: var(--c-surface);
  box-shadow: 0 0 0 3px var(--c-primary-glow);
}

/* ===== 出入库记录 ===== */
.logs-wrap {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  padding: 8px 16px 16px;
}

.log-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
  overflow-y: auto;
  flex: 1;
  padding-right: 4px;
}

/* ===== 多选操作（筛选行右侧） ===== */
.sel-group {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.sel-all {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: var(--fs-xs);
  color: var(--c-text-2);
  cursor: pointer;
}

.sel-count {
  font-size: var(--fs-xs);
  color: var(--c-text-2);
}

.sel-count b {
  color: var(--c-text);
}

/* 复选框：与物料选择弹窗（.pick-check）一致 */
.row-check {
  width: 14px;
  height: 14px;
  flex-shrink: 0;
  accent-color: var(--c-primary);
  cursor: pointer;
}

.row-check:disabled {
  cursor: not-allowed;
  opacity: 0.4;
}

.cb {
  display: flex;
  align-items: center;
  justify-content: center;
}

.log-list li {
  display: grid;
  grid-template-columns: 20px 32px minmax(0, 1fr) auto auto auto;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  border-radius: var(--r-md);
  border: 1px solid transparent;
  transition: all var(--motion);
}

/* 选中行 */
.log-list li.is-sel {
  background: var(--c-primary-soft);
  border-color: var(--c-primary);
}

/* 已撤销：整行弱化 */
.log-list li.is-void {
  opacity: 0.55;
}

.log-list li.is-void .info strong,
.log-list li.is-void .info small,
.log-list li.is-void .q {
  text-decoration: line-through;
  text-decoration-thickness: 1px;
}

.log-list li:hover {
  background: var(--c-surface-hover);
  border-color: var(--c-border-hairline);
}

.tag-wrap {
  display: flex;
  align-items: center;
  justify-content: center;
}

.log-list .tag {
  width: 24px;
  height: 24px;
  border-radius: 6px;
  display: grid;
  place-items: center;
  font-size: var(--fs-xs);
  font-weight: 700;
  flex-shrink: 0;
}

.log-list li.in .tag {
  background: rgba(52, 218, 191, 0.15);
  color: #34DABF;
}

.log-list li.out .tag {
  background: rgba(255, 107, 107, 0.15);
  color: #FF6B6B;
}

/* 撤销原因（紧跟在型号 / 备注下一行） */
.void-reason {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: var(--c-danger) !important;
  text-decoration: none !important;
}

/* 操作列：悬停前留白占位，避免行高跳动 */
.op {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  min-width: 62px;
}

.void-btn {
  height: var(--ctrl-h-sm);
  padding: 0 8px;
  font-size: var(--fs-xs);
  transition: opacity var(--motion), color var(--motion), border-color var(--motion);
}

/* 支持悬停的设备（桌面端）上默认隐藏，行悬停时才出现；触屏设备常显 */
@media (hover: hover) {
  .void-btn {
    opacity: 0;
  }

  .log-list li:hover .void-btn {
    opacity: 1;
  }
}

.void-btn:hover:not(:disabled) {
  color: var(--c-danger);
  border-color: var(--c-danger);
}

.void-chip {
  font-size: var(--fs-xs);
  color: var(--c-danger);
  background: rgba(255, 92, 114, 0.12);
  border: 1px solid rgba(255, 92, 114, 0.25);
  border-radius: var(--r-pill);
  padding: 2px 8px;
  white-space: nowrap;
}

.info {
  display: flex;
  flex-direction: column;
  min-width: 0;
  gap: 2px;
}

.info strong {
  font-size: var(--fs-sm);
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.info small {
  color: var(--c-text-2);
  font-size: var(--fs-xs);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.q {
  font-weight: 700;
  font-size: var(--fs-md);
}

.log-list li.in .q {
  color: var(--c-accent);
}

.log-list li.out .q {
  color: var(--c-danger);
}

.log-list time {
  font-size: var(--fs-xs);
  color: var(--c-text-3);
}

/* ===== 撤销弹窗（沿用全局 .modal-mask / .modal 主题） ===== */
.modal-mask .void-modal {
  max-width: 440px;
}

.modal-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.modal-x {
  border: none;
  background: transparent;
  font-size: 18px;
  line-height: 1;
  color: var(--c-text-3);
  cursor: pointer;
}

.modal-x:hover {
  color: var(--c-text);
}

.vd-sum {
  margin: 0 0 8px;
  font-size: var(--fs-sm);
  color: var(--c-text-2);
}

.vd-sum b {
  color: var(--c-text);
}

.vd-tip {
  margin: 0 0 14px;
  padding: 8px 10px;
  font-size: var(--fs-xs);
  line-height: 1.6;
  color: var(--c-text-2);
  background: var(--c-glass);
  border: 1px solid var(--c-border);
  border-radius: var(--r-md);
}

.vd-tip b {
  color: var(--c-danger);
}

.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: 0;
}

.field>span {
  font-size: var(--fs-xs);
  color: var(--c-text-2);
  font-weight: 500;
}

.field>span em {
  color: var(--c-danger);
  font-style: normal;
}

.vd-err {
  margin: 8px 0 0;
  font-size: var(--fs-xs);
  color: var(--c-danger);
}



@media (max-width: 820px) {
  .filters {
    flex-direction: column;
    align-items: stretch;
  }

  .f-search {
    flex: 1;
  }

  .f-search input {
    width: 100%;
  }

  .f-cat {
    flex: 1;
  }

  /* 竖排后取消右侧推挤，改为靠右排列 */
  .sel-group {
    margin-left: 0;
    justify-content: flex-end;
  }
}
</style>
