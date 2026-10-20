<template>
  <SubPage title="盘点">
    <PullRefresh @refresh="onRefresh">
      <div class="mpage">
        <p v-if="error" class="error">
          {{ error }}
          <button class="retry-link" @click="load">重试</button>
        </p>

        <div v-if="loading" class="hint"><div class="spinner-lg" /></div>

        <div v-else-if="!takes.length" class="empty">
          <div class="empty-ico"><ClipboardCheck :size="40" style="display: inline-flex; flex-shrink: 0" /></div>
          <h3>还没有盘点单</h3>
          <p>点右下角「新建盘点」，按分类逐项录入实盘数量</p>
        </div>

        <template v-else>
          <article v-for="t in takes" :key="t.id" class="tcard" @click="openView(t)">
            <div class="t-main">
              <h3>{{ t.name }}</h3>
              <p class="t-sub">{{ fmtFull(t.created_at) }} · {{ t.item_count ?? 0 }} 项</p>
            </div>
            <div class="t-right">
              <span class="t-diff" :class="diffClass(t)">{{ diffText(t) }}</span>
              <button class="t-del" title="删除" @click.stop="askDelete(t)">
                <Trash2 :size="15" style="display: inline-flex; flex-shrink: 0" />
              </button>
            </div>
          </article>
        </template>

        <!-- 新建盘点 FAB（浮在 tabbar 上方） -->
        <button class="fab" title="新建盘点" @click="goNew">
          <Plus :size="22" style="display: inline-flex; flex-shrink: 0" />
        </button>

        <!-- 盘点明细（底部弹层，替代桌面居中弹窗） -->
        <BottomSheet :open="viewOpen" :title="view?.take.name || ''" tall @close="viewOpen = false">
          <ul v-if="view" class="v-list">
            <li v-for="it in view.items" :key="it.id">
              <div class="v-main">
                <span class="v-name">{{ it.material_name || '（物料已删除）' }}</span>
                <span class="v-book">账面 {{ it.book_qty }}</span>
              </div>
              <div class="v-nums">
                <span class="v-actual">实盘 {{ it.actual_qty }}</span>
                <span class="v-diff" :class="{ plus: it.diff > 0, minus: it.diff < 0 }">
                  {{ it.diff > 0 ? '+' : '' }}{{ it.diff }}
                </span>
              </div>
            </li>
            <li v-if="view && !view.items.length" class="v-empty">该盘点单没有明细</li>
          </ul>
        </BottomSheet>
      </div>
    </PullRefresh>
  </SubPage>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { ClipboardCheck, Plus, Trash2 } from 'lucide-vue-next'
import SubPage from '../../../components/mobile/SubPage.vue'
import PullRefresh from '../../../components/mobile/PullRefresh.vue'
import BottomSheet from '../../../components/mobile/BottomSheet.vue'
import { listStocktakes, getStocktake, deleteStocktake } from '../../../lib/db'
import { withAuthRetry } from '../../../lib/authRetry'
import { confirm } from '../../../composables/confirm'
import { useToast } from '../../../composables/toast'
import { useStockData } from '../../../composables/useStockData'
import type { StockTake, StockTakeItem } from '../../../lib/types'

/**
 * 移动端盘点列表：卡片流 + 底部弹层看明细 + FAB 新建（独立路由页）。
 * 与桌面 StockTake 的差异（见 demo/MOBILE_STOCK_PLAN.md）：
 * - DataTable / 居中弹窗 → 卡片 + 底部弹层
 * - 删除沿用 confirm()（桌面同款），但删除不回滚库存，文案已提示
 */
const router = useRouter()
const toast = useToast()
const { refreshList, refreshSummary, refreshLogs } = useStockData()

const takes = ref<StockTake[]>([])
const loading = ref(false)
const error = ref('')
const view = ref<{ take: StockTake; items: StockTakeItem[] } | null>(null)
const viewOpen = ref(false)

const pad = (n: number) => String(n).padStart(2, '0')
function fmtFull(iso: string) {
  const d = new Date(iso)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function diffText(t: StockTake) {
  const n = t.diff_count ?? 0
  if (!n) return '无差异'
  return n > 0 ? `盘盈 +${n}` : `盘亏 ${n}`
}
function diffClass(t: StockTake) {
  const n = t.diff_count ?? 0
  return { plus: n > 0, minus: n < 0 }
}

async function load() {
  loading.value = true
  error.value = ''
  try { takes.value = await withAuthRetry(() => listStocktakes()) }
  catch (e: unknown) { error.value = '加载失败：' + ((e as Error).message || e) }
  finally { loading.value = false }
}

async function openView(t: StockTake) {
  try {
    view.value = await withAuthRetry(() => getStocktake(t.id))
    viewOpen.value = true
  } catch (e: unknown) {
    toast.error('加载明细失败：' + ((e as Error).message || e))
  }
}

async function askDelete(t: StockTake) {
  const ok = await confirm({
    title: `删除盘点单「${t.name}」？`,
    content: '仅删除盘点记录，不会回滚已入账的盘盈/盘亏库存差异。',
    confirmText: '删除',
    cancelText: '取消',
    danger: true,
  })
  if (!ok) return
  try {
    await withAuthRetry(() => deleteStocktake(t.id))
    toast.success('已删除')
    await Promise.all([refreshList(), refreshSummary(), refreshLogs()])
    await load()
  } catch (e: unknown) {
    toast.error('删除失败：' + ((e as Error).message || e))
  }
}

function goNew() { router.push('/m/stock/take/new') }

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
  padding-top: 12px;
}

.tcard {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 14px;
  background: var(--c-surface);
  border: 1px solid var(--c-border);
  border-radius: var(--r-xl);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  transition: background var(--motion-fast);
}

.tcard:active {
  background: var(--c-surface-hover);
}

.t-main {
  flex: 1;
  min-width: 0;
}

.t-main h3 {
  margin: 0;
  font-size: var(--fs-md);
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.t-sub {
  margin: 3px 0 0;
  font-size: var(--fs-xs);
  color: var(--c-text-3);
}

.t-right {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-shrink: 0;
}

.t-diff {
  font-size: var(--fs-sm);
  font-weight: 700;
  color: var(--c-text-3);
}

.t-diff.plus {
  color: var(--c-accent);
}

.t-diff.minus {
  color: var(--c-danger);
}

.t-del {
  width: 32px;
  height: 32px;
  display: grid;
  place-items: center;
  border: 1px solid var(--c-border);
  border-radius: var(--r-md);
  background: transparent;
  color: var(--c-text-3);
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}

.t-del:active {
  color: var(--c-danger);
  border-color: var(--c-danger);
}

/* FAB */
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
  box-shadow: var(--shadow-pop);
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  transition: transform var(--motion-fast);
}

.fab:active {
  transform: scale(0.92);
}

/* 明细弹层 */
.v-list {
  list-style: none;
  margin: 0;
  padding: 0;
}

.v-list li {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  min-height: 42px;
  padding: 6px 0;
  border-bottom: 1px solid var(--c-border-hairline);
}

.v-list li:last-child {
  border-bottom: none;
}

.v-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.v-name {
  font-size: var(--fs-sm);
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.v-book {
  font-size: var(--fs-xs);
  color: var(--c-text-3);
}

.v-nums {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-shrink: 0;
}

.v-actual {
  font-size: var(--fs-xs);
  color: var(--c-text-2);
  font-variant-numeric: tabular-nums;
}

.v-diff {
  min-width: 42px;
  text-align: right;
  font-size: var(--fs-md);
  font-weight: 800;
  color: var(--c-text-3);
  font-variant-numeric: tabular-nums;
}

.v-diff.plus {
  color: var(--c-accent);
}

.v-diff.minus {
  color: var(--c-danger);
}

.v-empty {
  justify-content: center;
  color: var(--c-text-3);
  font-size: var(--fs-sm);
}

/* 状态 */
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
  margin: 0;
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

.spinner-lg {
  width: 26px;
  height: 26px;
  border: 3px solid var(--c-border);
  border-top-color: var(--c-primary);
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}
</style>
