<template>
  <Teleport to="body">
    <!-- 出入库主弹层（底部滑入） -->
    <Transition name="msheet">
      <div v-if="material" class="qs-mask" @click.self="emit('close')">
        <div class="qs">
          <div class="grab" />
          <header class="qs-head">
            <h3>出入库 · {{ material.name }}</h3>
            <p>当前库存 ×{{ material.qty }}<template v-if="material.model || material.brand"> · {{ [material.model, material.brand].filter(Boolean).join(' ') }}</template></p>
          </header>

          <!-- 入 / 出 切换：触屏大号分段 -->
          <div class="seg">
            <button type="button" :class="{ on: type === 'in' }" @click="type = 'in'">
              <ArrowDownToLine :size="16" style="display: inline-flex; flex-shrink: 0" />入库
            </button>
            <button type="button" :class="{ on: type === 'out' }" @click="type = 'out'">
              <ArrowUpFromLine :size="16" style="display: inline-flex; flex-shrink: 0" />出库
            </button>
          </div>

          <!-- 数量：步进器 + 直输（数字键盘） -->
          <div class="qty-row">
            <span class="lbl">数量</span>
            <div class="stepper">
              <button type="button" class="st-btn" :disabled="qty <= 1" @click="qty = Math.max(1, qty - 1)">
                <Minus :size="18" style="display: inline-flex; flex-shrink: 0" />
              </button>
              <input v-model.number="qty" type="number" inputmode="numeric" min="1" @keyup.enter="submit" />
              <button type="button" class="st-btn" @click="qty += 1">
                <Plus :size="18" style="display: inline-flex; flex-shrink: 0" />
              </button>
            </div>
          </div>

          <!-- 供应商（入）/ 用途（出）：行点击弹 picker，不用下拉 -->
          <button v-if="type === 'in'" type="button" class="pick-row" @click="picker = 'supplier'">
            <span class="lbl">供应商</span>
            <span class="pick-val" :class="{ ph: !supplierId }">
              {{ supplierLabel || '不记录' }}
              <ChevronRight :size="15" style="display: inline-flex; flex-shrink: 0" />
            </span>
          </button>
          <button v-else type="button" class="pick-row" @click="picker = 'purpose'">
            <span class="lbl">用途</span>
            <span class="pick-val" :class="{ ph: !purpose }">
              {{ purpose || '不记录' }}
              <ChevronRight :size="15" style="display: inline-flex; flex-shrink: 0" />
            </span>
          </button>

          <!-- 备注 -->
          <div class="note-row">
            <span class="lbl">备注</span>
            <input v-model="note" :placeholder="type === 'in' ? '如 采购到货' : '如 焊接消耗'"
              enterkeyhint="done" @keyup.enter="submit" />
          </div>

          <button class="submit" :class="type" :disabled="busy" @click="submit">
            <span v-if="busy" class="spinner-sm" />
            {{ busy ? '处理中…' : (type === 'in' ? '确认入库' : '确认出库') }}
          </button>
        </div>
      </div>
    </Transition>

    <!-- 供应商 / 用途选择（二级底部弹层） -->
    <Transition name="msheet">
      <div v-if="picker" class="qs-mask top" @click.self="picker = null">
        <div class="qs picker">
          <div class="grab" />
          <h3 class="pk-title">{{ picker === 'supplier' ? '选择供应商' : '选择用途' }}</h3>
          <div class="pk-list">
            <button v-for="o in pickerOptions" :key="String(o.value)" type="button" class="pk-item"
              :class="{ on: picker === 'supplier' ? supplierId === o.value : purpose === o.value }"
              @click="pickOption(o.value)">
              <span>{{ o.label }}</span>
              <Check v-if="(picker === 'supplier' ? supplierId : purpose) === o.value"
                :size="16" style="display: inline-flex; flex-shrink: 0" />
            </button>
          </div>
          <button type="button" class="pk-cancel" @click="picker = null">取消</button>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { ArrowDownToLine, ArrowUpFromLine, Minus, Plus, ChevronRight, Check } from 'lucide-vue-next'
import { stockInOrder, listSuppliers, listDictItems } from '../../lib/db'
import type { MaterialRow, SupplierRow } from '../../lib/types'
import { useToast } from '../../composables/toast'

/**
 * 移动端快捷出入库（bottom sheet）：数量步进器 + 二级 picker 选供应商/用途。
 * 提交链路与桌面 QuickStockModal 一致（stockInOrder，manual 单据）。
 */
const props = defineProps<{
  material: MaterialRow | null
  /** 打开时默认选中入库 / 出库（详情页两个按钮分别传入） */
  initialType?: 'in' | 'out'
}>()
const emit = defineEmits<{
  done: [payload: { materialId: string; qty: number; type: 'in' | 'out' }]
  close: []
}>()

const toast = useToast()

const type = ref<'in' | 'out'>('in')
const qty = ref(1)
const note = ref('')
const supplierId = ref<string | null>(null)
const purpose = ref<string | null>(null)
const busy = ref(false)
/** 二级 picker：null=关，'supplier'|'purpose'=开 */
const picker = ref<'supplier' | 'purpose' | null>(null)

// 供应商 / 用途字典（首次打开惰性加载）
const suppliers = ref<SupplierRow[]>([])
let suppliersLoaded = false
const purposes = ref<string[]>([])
let purposesLoaded = false

const supplierLabel = computed(() => suppliers.value.find(s => s.id === supplierId.value)?.name || '')

const pickerOptions = computed(() => picker.value === 'supplier'
  ? [{ value: null as string | null, label: '不记录供应商' }, ...suppliers.value.map(s => ({ value: s.id, label: s.name }))]
  : [{ value: null as string | null, label: '不记录用途' }, ...purposes.value.map(p => ({ value: p, label: p }))])

function pickOption(v: string | null) {
  if (picker.value === 'supplier') supplierId.value = v
  else purpose.value = v
  picker.value = null
}

/** 换目标物料即重置表单，并惰性加载字典 */
watch(() => props.material, async (mat) => {
  if (!mat) return
  type.value = props.initialType ?? 'in'
  qty.value = 1
  note.value = ''
  supplierId.value = null
  purpose.value = null
  picker.value = null
  if (!suppliersLoaded) {
    try { suppliers.value = await listSuppliers(); suppliersLoaded = true } catch { /* 静默 */ }
  }
  if (!purposesLoaded) {
    try { purposes.value = (await listDictItems('out_purpose')).map(i => i.label); purposesLoaded = true } catch { /* 静默 */ }
  }
})

async function submit() {
  const m = props.material
  if (!m) return
  const n = Math.floor(Number(qty.value) || 0)
  if (n <= 0) { toast.error('数量需为正整数'); return }
  busy.value = true
  try {
    // 出库时用途并入备注（用途优先，手动备注跟在后面），与桌面一致
    const finalNote = type.value === 'out'
      ? [purpose.value, note.value.trim()].filter(Boolean).join('：') || null
      : (note.value.trim() || null)
    const { finals } = await stockInOrder({
      type: type.value, source: 'manual', source_id: null,
      title: `${type.value === 'in' ? '入库' : '出库'} · ${m.name}`,
      supplier_id: type.value === 'in' ? supplierId.value : null,
      note: finalNote,
      items: [{ material_id: m.id, qty: n, note: finalNote }],
    })
    const freshQty = finals.get(m.id) ?? m.qty + (type.value === 'in' ? n : -n)
    toast.success(type.value === 'in' ? `入库 +${n}` : `出库 -${n}`)
    emit('done', { materialId: m.id, qty: freshQty, type: type.value })
    emit('close')
  } catch (e: unknown) {
    toast.error('操作失败：' + ((e as Error).message || e))
  } finally { busy.value = false }
}
</script>

<style scoped>
/* ===== 底部弹层 ===== */
.qs-mask {
  position: fixed;
  inset: 0;
  z-index: 130;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
}

/* picker 在主 sheet 之上 */
.qs-mask.top {
  z-index: 140;
}

.qs {
  background: var(--c-elevated);
  border-radius: var(--r-2xl) var(--r-2xl) 0 0;
  padding: 8px 16px calc(16px + env(safe-area-inset-bottom));
  box-shadow: var(--shadow-pop);
}

.grab {
  width: 36px;
  height: 4px;
  margin: 4px auto 10px;
  border-radius: 999px;
  background: var(--c-border-strong);
}

.qs-head h3 {
  margin: 0;
  font-size: var(--fs-lg);
  font-weight: 700;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.qs-head p {
  margin: 3px 0 0;
  font-size: var(--fs-sm);
  color: var(--c-text-2);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* ===== 入/出 分段（触屏大号） ===== */
.seg {
  display: flex;
  gap: 6px;
  margin-top: 14px;
  padding: 4px;
  background: var(--c-glass);
  border: 1px solid var(--c-border);
  border-radius: var(--r-md);
}

.seg button {
  flex: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  height: 42px;
  border: none;
  border-radius: var(--r-sm);
  background: transparent;
  color: var(--c-text-2);
  font-family: inherit;
  font-size: var(--fs-md);
  font-weight: 600;
  cursor: pointer;
  transition: background-color 120ms ease-out, color 120ms ease-out;
}

.seg button.on {
  background: var(--c-primary);
  color: #fff;
  box-shadow: var(--shadow-glow);
}

/* ===== 数量步进器 ===== */
.qty-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 14px;
}

.lbl {
  font-size: var(--fs-sm);
  color: var(--c-text-2);
  font-weight: 500;
  flex-shrink: 0;
}

.stepper {
  display: flex;
  align-items: center;
  gap: 6px;
}

.st-btn {
  width: 40px;
  height: 40px;
  border: 1px solid var(--c-border);
  border-radius: var(--r-md);
  background: var(--c-surface);
  color: var(--c-text);
  display: grid;
  place-items: center;
  cursor: pointer;
  padding: 0;
  transition: background-color var(--motion-fast), border-color var(--motion-fast);
  -webkit-tap-highlight-color: transparent;
}

.st-btn:active:not(:disabled) {
  background: var(--c-primary-soft);
  border-color: var(--c-primary);
}

.st-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.stepper input {
  width: 88px;
  height: 40px;
  text-align: center;
  font-size: 18px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  background: var(--c-surface);
  border: 1px solid var(--c-border);
  border-radius: var(--r-md);
  color: var(--c-text);
}

.stepper input:focus {
  outline: none;
  border-color: var(--c-primary);
}

/* 隐藏 number input 自带箭头（用步进器按钮代替） */
.stepper input::-webkit-outer-spin-button,
.stepper input::-webkit-inner-spin-button {
  -webkit-appearance: none;
  margin: 0;
}

.stepper input[type="number"] {
  -moz-appearance: textfield;
  appearance: textfield;
}

/* ===== 供应商 / 用途行 ===== */
.pick-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  margin-top: 12px;
  padding: 0 2px;
  height: 44px;
  border: none;
  border-bottom: 1px solid var(--c-border-hairline);
  background: transparent;
  font-family: inherit;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}

.pick-val {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: var(--fs-md);
  color: var(--c-text);
  max-width: 70%;
}

.pick-val.ph {
  color: var(--c-text-3);
}

/* ===== 备注行 ===== */
.note-row {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 12px;
  height: 44px;
  border-bottom: 1px solid var(--c-border-hairline);
}

.note-row input {
  flex: 1;
  min-width: 0;
  height: 100%;
  border: none;
  background: transparent;
  font-size: var(--fs-md);
  color: var(--c-text);
}

.note-row input:focus {
  outline: none;
}

.note-row input::placeholder {
  color: var(--c-text-3);
}

/* ===== 确认按钮（通栏大按钮） ===== */
.submit {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  width: 100%;
  height: 46px;
  margin-top: 16px;
  border: none;
  border-radius: var(--r-md);
  font-family: inherit;
  font-size: var(--fs-lg);
  font-weight: 700;
  color: #fff;
  cursor: pointer;
  transition: transform 120ms ease-out, opacity var(--motion-fast);
  -webkit-tap-highlight-color: transparent;
}

.submit.in { background: var(--c-primary); }
.submit.out { background: var(--c-danger); }

.submit:active:not(:disabled) {
  transform: scale(0.98);
  opacity: 0.9;
}

.submit:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.spinner-sm {
  width: 14px;
  height: 14px;
  border: 2px solid rgba(255, 255, 255, 0.35);
  border-top-color: #fff;
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

/* ===== 二级 picker ===== */
.pk-title {
  margin: 4px 0 10px;
  font-size: var(--fs-md);
  font-weight: 600;
}

.pk-list {
  max-height: 44vh;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.pk-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 46px;
  padding: 0 4px;
  border: none;
  border-radius: var(--r-sm);
  background: transparent;
  color: var(--c-text);
  font-family: inherit;
  font-size: var(--fs-md);
  text-align: left;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}

.pk-item.on {
  background: var(--c-primary-soft);
  color: var(--c-primary);
  font-weight: 600;
}

.pk-cancel {
  margin-top: 10px;
  width: 100%;
  height: 44px;
  border: 1px solid var(--c-border);
  border-radius: var(--r-md);
  background: var(--c-surface);
  color: var(--c-text-2);
  font-family: inherit;
  font-size: var(--fs-md);
  font-weight: 600;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}

/* ===== 底部滑入动效 ===== */
.msheet-enter-active,
.msheet-leave-active {
  transition: opacity 0.2s ease;
}

.msheet-enter-active .qs,
.msheet-leave-active .qs {
  transition: transform 0.24s cubic-bezier(0.22, 1, 0.36, 1);
}

.msheet-enter-from,
.msheet-leave-to {
  opacity: 0;
}

.msheet-enter-from .qs,
.msheet-leave-to .qs {
  transform: translateY(100%);
}
</style>
