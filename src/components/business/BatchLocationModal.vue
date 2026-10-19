<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import AppSelect from '../form/AppSelect.vue'
import { listDictItems, createDictItem, updateMaterial } from '../../lib/db'
import { useToast } from '../../composables/toast'

/**
 * 一键库位（批量模式）弹窗：为选中的物料统一设置库位。
 * 库位主用字典下拉（带搜索），搜索无结果时可「新增」——新值在保存时自动写入「库位」字典。
 */
const props = defineProps<{ ids: string[] }>()
const emit = defineEmits<{
  /** 应用成功：父页面退出多选并刷新 */
  applied: [loc: string]
  close: []
}>()

const toast = useToast()

const loc = ref<string | null>(null)
const busy = ref(false)

/** 库位字典（设置 → 基础数据维护），首次打开时加载 */
const locations = ref<string[]>([])
let locationsLoaded = false

const locOptions = computed(() => locations.value.map(l => ({ value: l, label: l })))

/** 本次搜索新造、尚未写入字典的库位（保存时统一入字典） */
const pendingNew = new Set<string>()

watch(() => props.ids, (ids) => {
  loc.value = null
  pendingNew.clear()
  if (ids.length && !locationsLoaded) {
    locationsLoaded = true
    listDictItems('location')
      .then(items => { locations.value = items.map(i => i.label) })
      .catch(() => { locations.value = [] })
  }
}, { immediate: true })

/** 下拉里选择了「新增」项：先补进选项保证回显，写字典推迟到保存 */
function onCreateLoc(val: string) {
  if (!locations.value.some(l => l === val)) locations.value.push(val)
  pendingNew.add(val)
}

async function apply() {
  const v = (loc.value ?? '').trim()
  if (!v) { toast.error('请选择或新增库位'); return }
  const ids = props.ids
  busy.value = true
  try {
    await Promise.all(ids.map(id => updateMaterial(id, { location: v })))
    // 新造的库位写入「库位」字典，后续表单 / 弹窗可直接选用
    if (pendingNew.has(v)) {
      try { await createDictItem({ dict_key: 'location', label: v }) } catch { /* 静默 */ }
      pendingNew.delete(v)
    }
    toast.success(`已为 ${ids.length} 个物料设置库位「${v}」`)
    emit('applied', v)
    emit('close')
  } catch (e: unknown) {
    toast.error('批量设置库位失败：' + ((e as Error).message || e))
  } finally { busy.value = false }
}
</script>

<template>
  <Teleport to="body">
    <div v-if="ids.length" class="modal-mask" @click.self="emit('close')">
      <div class="modal" style="max-width: 440px">
        <div class="modal-head">
          <h3>批量设置库位</h3>
          <p class="bl-sub">将为已选的 {{ ids.length }} 个物料统一设置库位</p>
        </div>
        <div class="modal-body">
          <!-- AppSelect 不用 label 包裹（避免二次点击触发下拉反复弹出） -->
          <div class="bl-field">
            <label>库位</label>
            <AppSelect v-model="loc" :options="locOptions" searchable creatable :min-width="0"
              search-placeholder="搜索库位，无结果可新增" placeholder="选择库位" @create="onCreateLoc" />
          </div>
          <p class="bl-hint">下拉选择常用库位；搜索无结果时可新增，保存后自动加入「库位」字典</p>
        </div>
        <div class="modal-foot">
          <button class="btn btn-ghost" @click="emit('close')">取消</button>
          <button class="btn btn-primary" :disabled="busy" @click="apply">
            <span v-if="busy" class="spinner-sm" />{{ busy ? '处理中…' : '保存' }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.bl-sub {
  margin: 4px 0 0;
  font-size: var(--fs-sm);
  color: var(--c-text-2);
}

.bl-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 10px;
}

.bl-field > label {
  font-size: var(--fs-xs);
  color: var(--c-text-2);
  font-weight: 500;
}

.bl-hint {
  margin: 0;
  font-size: var(--fs-xs);
  color: var(--c-text-3);
}
</style>
