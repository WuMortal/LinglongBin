<script setup lang="ts">
import { ref, watch } from 'vue'
import { X, Undo2, Ban, Boxes, Package, User, Clock, Hash } from 'lucide-vue-next'
import type { StockOrder, StockLog } from '../../lib/types'
import { listStockLogsByOrder } from '../../lib/db'

/**
 * 出入库单抽屉：展示单据概要（单号 / 来源 / 供应商 / 数量）+ 全部明细。
 * 父页面传 order（null 即隐藏）；明细在打开时按需加载。
 * 撤销整单经 void 事件交由父页面接管（弹原因确认框），本组件只读。
 */
const props = defineProps<{ order: StockOrder | null }>()
const emit = defineEmits<{
  void: []
  close: []
}>()

const logs = ref<StockLog[]>([])
const loading = ref(false)

watch(() => props.order, async (o) => {
  if (!o) { logs.value = []; return }
  loading.value = true
  logs.value = []
  try {
    logs.value = await listStockLogsByOrder(o.id)
  } catch {
    logs.value = []
  } finally {
    loading.value = false
  }
}, { immediate: true })

const SOURCE_LABELS: Record<string, string> = {
  manual: '手工', init: '初始入库', import: '订单导入', bom: 'BOM 领料',
  purchase: '待采入库', stocktake: '盘点', legacy: '历史数据',
}
function sourceLabel(s: string) { return SOURCE_LABELS[s] ?? s }

function fmtTime(t: string | null) {
  if (!t) return ''
  const d = new Date(t)
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}
</script>

<template>
  <Teleport to="body">
    <Transition name="drawer">
      <div v-if="order" class="dw-mask" @click.self="emit('close')">
        <aside class="dw">
          <!-- 头部：单据识别 -->
          <header class="dw-head">
            <span class="tag" :class="order.type">{{ order.type === 'in' ? '入' : '出' }}</span>
            <div class="dw-title">
              <h2>{{ order.title || order.note || (order.type === 'in' ? '入库单' : '出库单') }}</h2>
              <p>
                <span class="cat">{{ order.order_no || '无单号' }}</span>
                · {{ sourceLabel(order.source) }}
                <template v-if="order.suppliers?.name"> · {{ order.suppliers.name }}</template>
              </p>
            </div>
            <button class="dw-close" title="关闭" @click="emit('close')">
              <X :size="16" style="display: inline-flex; flex-shrink: 0" />
            </button>
          </header>

          <div class="dw-scroll">
            <!-- 概要指标 -->
            <div class="dw-stats">
              <div class="stat">
                <span class="lbl">
                  <Boxes :size="13" style="display: inline-flex; flex-shrink: 0" />明细项
                </span>
                <b>{{ order.item_count }}</b>
              </div>
              <div class="stat">
                <span class="lbl">
                  <Package :size="13" style="display: inline-flex; flex-shrink: 0" />总数量
                </span>
                <b :class="order.type">{{ order.type === 'in' ? '+' : '-' }}{{ order.total_qty }}</b>
              </div>
              <div class="stat">
                <span class="lbl">
                  <User :size="13" style="display: inline-flex; flex-shrink: 0" />供应商
                </span>
                <b class="loc">{{ order.suppliers?.name || '—' }}</b>
              </div>
              <div class="stat">
                <span class="lbl">
                  <Clock :size="13" style="display: inline-flex; flex-shrink: 0" />单据时间
                </span>
                <b class="loc">{{ fmtTime(order.created_at) }}</b>
              </div>
            </div>

            <!-- 单据备注 / 撤销说明 -->
            <section v-if="order.status === 'void'" class="void-banner">
              <Ban :size="13" style="display: inline-flex; flex-shrink: 0" />
              已撤销<template v-if="order.void_reason">：{{ order.void_reason }}</template>
            </section>
            <section v-else-if="order.note" class="order-note">
              <Hash :size="12" style="display: inline-flex; flex-shrink: 0" />{{ order.note }}
            </section>

            <!-- 明细 -->
            <section class="dw-sec">
              <h3>出/入库明细</h3>
              <div v-if="loading" class="log-hint"><div class="spinner-sm" /></div>
              <div v-else-if="!logs.length" class="log-empty">暂无明细</div>
              <ul v-else class="log-list">
                <li v-for="r in logs" :key="r.id" :class="{ 'is-void': r.status === 'void' }">
                  <div class="info">
                    <strong>{{ r.materials?.name || '已删除物料' }}</strong>
                    <small v-if="r.materials?.model">{{ r.materials.model }}</small>
                    <small v-if="r.note || r.suppliers?.name">
                      {{ [r.suppliers?.name, r.note].filter(Boolean).join(' · ') }}
                    </small>
                    <small v-if="r.status === 'void'" class="void-note">
                      已撤销<template v-if="r.void_reason">：{{ r.void_reason }}</template>
                    </small>
                  </div>
                  <span class="q">{{ order.type === 'in' ? '+' : '-' }}{{ r.qty }}</span>
                </li>
              </ul>
            </section>
          </div>

          <!-- 底部操作：整单撤销（父页面接管确认） -->
          <footer v-if="order.status !== 'void'" class="dw-foot">
            <button class="btn btn-danger" @click="emit('void')">
              <Undo2 :size="14" style="display: inline-flex; flex-shrink: 0" /> 撤销整单（库存回滚）
            </button>
          </footer>
        </aside>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
/* 遮罩 + 右侧滑入，视觉令牌与全局 .modal-mask 一致 */
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
  width: min(560px, 100vw);
  height: 100%;
  background: var(--c-elevated);
  border-left: 1px solid var(--c-border);
  box-shadow: var(--shadow-lg);
  display: flex;
  flex-direction: column;
}

/* ===== 头部 ===== */
.dw-head {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 20px 22px 16px;
  border-bottom: 1px solid var(--c-border);
  flex-shrink: 0;
}

.tag {
  width: 40px;
  height: 40px;
  border-radius: var(--r-md);
  display: grid;
  place-items: center;
  font-size: var(--fs-md);
  font-weight: 700;
  flex-shrink: 0;
}

.tag.in {
  background: rgba(52, 218, 191, 0.15);
  color: #34DABF;
}

.tag.out {
  background: rgba(255, 107, 107, 0.15);
  color: #FF6B6B;
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
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.dw-title .cat {
  color: var(--c-text-3);
  font-family: var(--font-mono, monospace);
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

/* ===== 滚动区 ===== */
.dw-scroll {
  flex: 1;
  overflow-y: auto;
  padding-bottom: 24px;
}

/* ===== 指标 ===== */
.dw-stats {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 10px;
  padding: 16px 22px 4px;
}

.stat {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.stat .lbl {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: var(--fs-xs);
  color: var(--c-text-3);
  white-space: nowrap;
}

.stat b {
  font-size: var(--fs-lg);
  font-weight: 700;
  line-height: 1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.stat b.in { color: #34DABF; }
.stat b.out { color: #FF6B6B; }

.stat b.loc {
  font-size: var(--fs-md);
  font-weight: 600;
}

/* ===== 撤销说明 / 单据备注 ===== */
.void-banner {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 12px 22px 0;
  padding: 8px 12px;
  font-size: var(--fs-sm);
  color: var(--c-danger);
  background: rgba(255, 92, 114, 0.1);
  border: 1px solid rgba(255, 92, 114, 0.25);
  border-radius: var(--r-md);
}

.order-note {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 12px 22px 0;
  padding: 8px 12px;
  font-size: var(--fs-sm);
  color: var(--c-text-2);
  background: var(--c-surface);
  border: 1px solid var(--c-border);
  border-radius: var(--r-md);
  word-break: break-all;
}

/* ===== 分节 ===== */
.dw-sec {
  padding: 16px 22px 0;
}

.dw-sec h3 {
  margin: 0 0 10px;
  font-size: var(--fs-sm);
  font-weight: 600;
  color: var(--c-text-2);
}

.log-hint {
  display: grid;
  place-items: center;
  padding: 20px 0;
}

.spinner-sm {
  width: 18px;
  height: 18px;
  border: 2px solid var(--c-border);
  border-top-color: var(--c-primary);
  border-radius: 50%;
  animation: dw-spin 0.7s linear infinite;
}

@keyframes dw-spin {
  to {
    transform: rotate(360deg);
  }
}

.log-empty {
  text-align: center;
  color: var(--c-text-3);
  font-size: var(--fs-sm);
  padding: 16px 0;
}

.log-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.log-list li {
  display: flex;
  align-items: center;
  gap: 10px;
  background: var(--c-surface);
  border: 1px solid var(--c-border);
  border-radius: var(--r-md);
  padding: 8px 12px;
}

.log-list li.is-void {
  opacity: 0.55;
}

.info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
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
  font-size: var(--fs-xs);
  color: var(--c-text-3);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.info small.void-note {
  color: var(--c-danger);
}

.q {
  font-size: var(--fs-md);
  font-weight: 700;
  flex-shrink: 0;
}

/* ===== 底部操作 ===== */
.dw-foot {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 12px 22px;
  border-top: 1px solid var(--c-border);
  flex-shrink: 0;
}
</style>
