<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { Inbox, ArrowUpFromDot } from 'lucide-vue-next'
import Segmented from '../form/Segmented.vue'
import AppSelect from '../form/AppSelect.vue'
import { applyStock, listSuppliers, listDictItems } from '../../lib/db'
import type { MaterialRow, SupplierRow } from '../../lib/types'
import { useToast } from '../../composables/toast'

/**
 * 卡片 ⇄ 出入库弹窗：入库可记供应商，出库可记用途（并入备注）。
 * 父页面只传 material（null 即隐藏）；提交成功经 done 事件回传最新库存。
 */
const props = defineProps<{ material: MaterialRow | null }>()
const emit = defineEmits<{
  /** 提交成功：回传物料 id 与出入库后的最新库存，父页面据此同步卡片 */
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

// 供应商 / 出库用途字典（设置 → 基础数据维护），首次打开时加载
const suppliers = ref<SupplierRow[]>([])
let suppliersLoaded = false
const purposes = ref<string[]>([])
let purposesLoaded = false

const supplierOptions = computed(() => [
  { value: null as string | null, label: '不记录供应商' },
  ...suppliers.value.map(s => ({ value: s.id, label: s.name })),
])

const purposeOptions = computed(() => [
  { value: null as string | null, label: '不记录用途' },
  ...purposes.value.map(p => ({ value: p, label: p })),
])

/** 换目标物料即重置表单，并惰性加载字典 */
watch(() => props.material, async (m) => {
  if (!m) return
  type.value = 'in'
  qty.value = 1
  note.value = ''
  supplierId.value = null
  purpose.value = null
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
    const fresh = await applyStock({
      material_id: m.id, type: type.value, qty: n, currentQty: m.qty,
      supplier_id: type.value === 'in' ? supplierId.value : null,
      // 出库时把用途并入备注（用途优先，手动备注跟在后面）
      note: type.value === 'out'
        ? [purpose.value, note.value.trim()].filter(Boolean).join('：') || null
        : (note.value.trim() || null),
    })
    toast.success(type.value === 'in' ? `入库 +${n}` : `出库 -${n}`)
    emit('done', { materialId: m.id, qty: fresh.qty, type: type.value })
    emit('close')
  } catch (e: unknown) {
    toast.error('操作失败：' + ((e as Error).message || e))
  } finally { busy.value = false }
}
</script>

<template>
  <Teleport to="body">
    <div v-if="material" class="modal-mask" @click.self="emit('close')">
      <div class="modal" style="max-width: 440px">
        <div class="modal-head">
          <h3>出入库 · {{ material.name }}</h3>
          <p class="qk-sub">当前库存 ×{{ material.qty }}<template v-if="material.model || material.brand"> · {{ [material.model, material.brand].filter(Boolean).join(' ') }}</template></p>
        </div>
        <div class="modal-body">
          <Segmented v-model="type" full class="qk-seg"
            :options="[
              { value: 'in', label: '入库', icon: Inbox },
              { value: 'out', label: '出库', icon: ArrowUpFromDot },
            ]" />
          <div class="qk-grid">
            <label class="field">
              <label>数量</label>
              <input v-model.number="qty" type="number" min="1" @keyup.enter="submit" />
            </label>
            <!-- AppSelect 不用 label 包裹（避免二次点击触发下拉反复弹出） -->
            <div class="field" v-if="type === 'in'">
              <label>供应商</label>
              <AppSelect v-model="supplierId" :options="supplierOptions" :min-width="0" />
            </div>
            <div class="field" v-else>
              <label>用途</label>
              <AppSelect v-model="purpose" :options="purposeOptions" :min-width="0" />
            </div>
            <label class="field qk-note-field">
              <label>备注</label>
              <input v-model="note" :placeholder="type === 'in' ? '如 采购到货' : '如 焊接消耗'" @keyup.enter="submit" />
            </label>
          </div>
        </div>
        <div class="modal-foot">
          <button class="btn btn-ghost" @click="emit('close')">取消</button>
          <button class="btn" :class="type === 'in' ? 'btn-primary' : 'btn-danger'" :disabled="busy" @click="submit">
            <span v-if="busy" class="spinner-sm" />{{ busy ? '处理中…' : (type === 'in' ? '确认入库' : '确认出库') }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
/* 结构用全局 .modal-mask/.modal/.seg，此处只做布局微调 */
.qk-sub {
  margin: 4px 0 0;
  font-size: var(--fs-sm);
  color: var(--c-text-2);
}

.qk-seg {
  margin-bottom: 14px;
}

.qk-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 14px;
}

/* 字段样式与 MaterialFormDialog 一致 */
.qk-grid .field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.qk-grid .field > label {
  font-size: var(--fs-xs);
  color: var(--c-text-2);
  font-weight: 500;
}

.qk-grid .field input {
  height: var(--ctrl-h);
  padding: 0 var(--ctrl-px);
  font-size: var(--fs-sm);
  background: var(--c-surface);
  border: 1px solid var(--c-border);
  border-radius: var(--r-md);
  color: var(--c-text);
  transition: border-color var(--motion);
}

.qk-grid .field input:focus {
  outline: none;
  border-color: var(--c-primary);
  box-shadow: 0 0 0 3px var(--c-primary-glow);
}

/* 备注整行 */
.qk-grid .qk-note-field {
  grid-column: 1 / -1;
}
</style>
