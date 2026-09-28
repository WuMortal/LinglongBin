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
      <div class="f-search">
        <Search :size="15" class="s-ico" style="display: inline-flex; flex-shrink: 0" />
        <input v-model="logKw" placeholder="搜索物料" />
      </div>
    </div>

    <div class="logs-wrap">
      <EmptyState v-if="!logRows.length" :icon="Inbox" title="暂无出入库记录" />
      <ul v-else class="log-list">
        <li v-for="r in logRows" :key="r.id" :class="r.type">
          <div class="tag-wrap"><span class="tag">{{ r.type === 'in' ? '入' : '出' }}</span></div>
          <div class="info">
            <strong>{{ r.materials?.name || '已删除物料' }}</strong>
            <small><template v-if="r.type === 'in' && r.suppliers?.name">{{ r.suppliers.name }} · </template>{{
              r.materials?.model || '' }}<template v-if="r.note"> · {{ r.note }}</template></small>
          </div>
          <span class="q">{{ r.type === 'in' ? '+' : '-' }}{{ r.qty }}</span>
          <time>{{ fmtFull(r.created_at) }}</time>
        </li>
      </ul>
    </div>

    <Pager :page="logPage" :page-size="logPageSize" :total="logTotal" @change="onLogPage" @update:page-size="onLogSize" />
  </section>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onActivated } from 'vue'
import { Inbox, Search } from 'lucide-vue-next'
import type { StockLog } from '../../lib/types'
import AppSelect from '../../components/form/AppSelect.vue'
import Segmented from '../../components/form/Segmented.vue'
import EmptyState from '../../components/EmptyState.vue'
import Pager from '../../components/Pager.vue'
import { listStockLogPage } from '../../lib/db'

const logType = ref<'all' | 'in' | 'out'>('all')
const logRange = ref<'all' | 'today' | '7d' | '30d'>('all')
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
      keyword: logKw.value.trim(),
      from, to,
      limit: logPageSize.value,
      offset: (logPage.value - 1) * logPageSize.value,
    })
    logRows.value = res.rows
    logTotal.value = res.total
  } catch { /* 静默 */ }
  finally { logLoading.value = false }
}

// 类型 / 时间范围变化 → 回到第 1 页并重新查询
watch([logType, logRange], () => { logPage.value = 1; void loadLogs() })
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
  min-width: 130px;
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

.log-list li {
  display: grid;
  grid-template-columns: 32px 1fr auto auto;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  border-radius: var(--r-md);
  border: 1px solid transparent;
  transition: all var(--motion);
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
}
</style>
