<template>
  <section class="page" :class="{ embedded }">
    <header class="head" :class="{ embedded }">
      <div v-if="!embedded" class="head-left">
        <!-- <PageBackButton /> -->
        <div>
          <h1>供应商管理</h1>
          <p>扁平列表，物料通过下拉框关联</p>
        </div>
      </div>
      <div class="head-actions">
        <button class="btn btn-primary" @click="openNew">
          <Plus :size="14" style="display: inline-flex; flex-shrink: 0" />新建供应商
        </button>
      </div>
    </header>

    <div class="toolbar">
      <input v-model="kw" class="search-input" placeholder="搜索名称 / 联系人 / 电话" />
      <span class="count">共 {{ filtered.length }} / {{ list.length }} 条</span>
    </div>

    <div v-if="loading" class="empty"><span class="spinner" /> 加载中…</div>
    <div v-else-if="!filtered.length" class="empty">暂无供应商，点击右上角「新建供应商」开始</div>
    <div v-else class="table-wrap">
      <table class="table">
        <thead>
          <tr>
            <th style="width: 22%">名称</th>
            <th style="width: 26%">地址</th>
            <th style="width: 14%">联系人</th>
            <th style="width: 14%">电话</th>
            <th>备注</th>
            <th style="width: 110px" class="ta-right">操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="s in filtered" :key="s.id">
            <td><b>{{ s.name }}</b></td>
            <td class="muted">{{ s.addr || '—' }}</td>
            <td>{{ s.contact || '—' }}</td>
            <td class="mono">{{ s.phone || '—' }}</td>
            <td class="muted">{{ s.note || '—' }}</td>
            <td class="ta-right">
              <button class="btn btn-icon mini" @click="edit(s)" title="编辑">
                <Pencil :size="13" style="display: inline-flex; flex-shrink: 0" />
              </button>
              <button class="btn btn-icon mini danger" @click="del(s)" title="删除">
                <Trash2 :size="13" style="display: inline-flex; flex-shrink: 0" />
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- 编辑弹窗 -->
    <div v-if="showEdit" class="modal-mask" @click.self="showEdit = false">
      <div class="modal">
        <div class="modal-head">
          <h3>{{ editing.id ? '编辑供应商' : '新建供应商' }}</h3>
        </div>
        <div class="modal-body">
          <div class="field">
            <label>名称 <span class="req">*</span></label>
            <input v-model="editing.name" placeholder="如 淘宝 / 嘉立创" />
          </div>
          <div class="field">
            <label>地址</label>
            <input v-model="editing.addr" placeholder="详细地址 / 店铺地址" />
          </div>
          <div class="field-row">
            <div class="field">
              <label>联系人</label>
              <input v-model="editing.contact" placeholder="联系人姓名" />
            </div>
            <div class="field">
              <label>电话</label>
              <input v-model="editing.phone" placeholder="联系电话" />
            </div>
          </div>
          <div class="field">
            <label>备注</label>
            <input v-model="editing.note" placeholder="付款方式 / 合作等级等" />
          </div>
          <p v-if="formErr" class="form-err"><TriangleAlert :size="12" style="display: inline-flex; flex-shrink: 0" />{{ formErr }}</p>
        </div>
        <div class="modal-foot">
          <button class="btn btn-ghost" @click="showEdit = false">取消</button>
          <button class="btn btn-primary" :disabled="saving" @click="save">
            <span v-if="saving" class="spinner-sm" />{{ saving ? '保存中…' : '保存' }}
          </button>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { Plus, Pencil, Trash2, TriangleAlert } from 'lucide-vue-next'
import { listSuppliers, createSupplier, updateSupplier, deleteSupplier } from '../lib/db'
import type { SupplierRow } from '../lib/types'
import { useToast } from '../composables/toast'
import { confirm } from '../composables/confirm'
import PageBackButton from '../components/PageBackButton.vue'

const toast = useToast()

/** 嵌入模式：在设置弹窗内使用时隐藏页面标题与返回按钮 */
withDefaults(defineProps<{ embedded?: boolean }>(), { embedded: false })

const list = ref<SupplierRow[]>([])
const loading = ref(false)
const kw = ref('')

const filtered = computed(() => {
  const k = kw.value.trim().toLowerCase()
  if (!k) return list.value
  return list.value.filter(s =>
    s.name.toLowerCase().includes(k)
    || (s.contact || '').toLowerCase().includes(k)
    || (s.phone || '').toLowerCase().includes(k)
  )
})

const showEdit = ref(false)
const saving = ref(false)
const formErr = ref('')
interface EditForm { id: string | null; name: string; addr: string | null; contact: string | null; phone: string | null; note: string | null }
const editing = ref<EditForm>({ id: null, name: '', addr: '', contact: '', phone: '', note: '' })

async function load() {
  loading.value = true
  try { list.value = await listSuppliers() }
  catch (e: unknown) { toast.error('加载失败：' + (e as Error).message) }
  finally { loading.value = false }
}

function openNew() {
  editing.value = { id: null, name: '', addr: '', contact: '', phone: '', note: '' }
  formErr.value = ''
  showEdit.value = true
}

function edit(s: SupplierRow) {
  editing.value = { id: s.id, name: s.name, addr: s.addr, contact: s.contact, phone: s.phone, note: s.note }
  formErr.value = ''
  showEdit.value = true
}

async function save() {
  formErr.value = ''
  if (!editing.value.name.trim()) { formErr.value = '名称必填'; return }
  saving.value = true
  try {
    const payload = {
      name: editing.value.name.trim(),
      addr: (editing.value.addr || '').trim() || null,
      contact: (editing.value.contact || '').trim() || null,
      phone: (editing.value.phone || '').trim() || null,
      note: (editing.value.note || '').trim() || null,
    }
    if (editing.value.id) await updateSupplier(editing.value.id, payload)
    else await createSupplier(payload)
    showEdit.value = false
    await load()
    toast.success('保存成功')
  } catch (e: unknown) { formErr.value = '保存失败：' + ((e as Error).message || e) }
  finally { saving.value = false }
}

async function del(s: SupplierRow) {
  if (!await confirm({
    title: '删除供应商',
    content: `删除供应商「${s.name}」？已关联该供应商的物料将变为未设置供应商。`,
    danger: true,
    confirmText: '删除',
  })) return
  try { await deleteSupplier(s.id); await load(); toast.success('删除成功') }
  catch (e: unknown) { toast.error('删除失败：' + (e as Error).message) }
}

onMounted(load)
</script>

<style scoped>
.page { padding: 0; }
/* 嵌入设置弹窗时：头部仅保留新建按钮 */
.head.embedded { justify-content: flex-end; padding: 0; }

.head { display: flex; justify-content: space-between; align-items: flex-end; gap: 16px; flex-wrap: wrap; margin-bottom: 16px; }
.head-left { display: flex; align-items: center; gap: 14px; }
.head h1 { margin: 0; font-size: var(--fs-xl); font-weight: 700; letter-spacing: -0.02em; }
.head p { margin: 4px 0 0; color: var(--c-text-2); font-size: var(--fs-sm); }
.head-actions { display: flex; gap: 8px; }

.toolbar {
  display: flex; align-items: center; gap: 12px;
  margin-bottom: 12px;
}
.search-input {
  flex: 1; max-width: 360px;
  height: var(--ctrl-h);
  padding: 0 12px;
  background: var(--c-glass);
  border: 1px solid var(--c-border);
  border-radius: var(--r-md);
  color: var(--c-text);
  font-size: var(--fs-md);
}
.search-input:focus { outline: none; border-color: var(--c-primary); }
.count { font-size: var(--fs-sm); color: var(--c-text-2); }

.empty {
  text-align: center; color: var(--c-text-2);
  padding: 48px 0; font-size: var(--fs-sm);
  display: flex; align-items: center; justify-content: center; gap: 8px;
}

.table-wrap {
  background: var(--c-surface);
  border: 1px solid var(--c-border-hairline);
  border-radius: var(--r-lg);
  overflow: hidden;
}

.table { width: 100%; border-collapse: collapse; font-size: var(--fs-md); }
.table th {
  text-align: left; padding: 10px 12px;
  font-size: var(--fs-xs); font-weight: 600;
  color: var(--c-text-2);
  background: var(--c-glass);
  border-bottom: 1px solid var(--c-border-hairline);
  text-transform: uppercase; letter-spacing: 0.04em;
}
.table td {
  padding: 10px 12px;
  border-bottom: 1px solid var(--c-border-hairline);
  color: var(--c-text);
}
.table tr:last-child td { border-bottom: none; }
.table tr:hover td { background: var(--c-surface-hover); }
.muted { color: var(--c-text-2); }
.mono { font-family: var(--font-mono); font-size: var(--fs-sm); }
.ta-right { text-align: right; }

.btn-icon.mini {
  width: 28px; height: 28px; padding: 0;
  display: inline-flex; align-items: center; justify-content: center;
  margin-left: 4px;
}
.btn-icon.mini.danger:hover { color: var(--c-danger); }

/* Modal */
.modal-mask {
  position: fixed; inset: 0;
  background: rgba(0,0,0,0.45);
  backdrop-filter: blur(6px);
  display: flex; align-items: center; justify-content: center;
  z-index: 100;
}
.modal {
  width: min(520px, 92vw);
  background: var(--c-elevated);
  border: 1px solid var(--c-border);
  border-radius: var(--r-xl);
  box-shadow: var(--shadow-pop);
  overflow: hidden;
}
.modal-head {
  padding: 14px 18px;
  border-bottom: 1px solid var(--c-border-hairline);
}
.modal-head h3 { margin: 0; font-size: var(--fs-lg); font-weight: 600; }
.modal-body { padding: 16px 18px; display: flex; flex-direction: column; gap: 12px; }
.modal-foot {
  padding: 12px 18px;
  border-top: 1px solid var(--c-border-hairline);
  display: flex; justify-content: flex-end; gap: 8px;
}

.field { display: flex; flex-direction: column; gap: 6px; }
.field label {
  font-size: var(--fs-xs); color: var(--c-text-2);
  font-weight: 500; text-transform: uppercase; letter-spacing: 0.04em;
}
.field input {
  height: var(--ctrl-h);
  padding: 0 12px;
  background: var(--c-glass);
  border: 1px solid var(--c-border);
  border-radius: var(--r-md);
  color: var(--c-text);
  font-size: var(--fs-md);
}
.field input:focus { outline: none; border-color: var(--c-primary); }
.field-row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.req { color: var(--c-danger); }

.form-err {
  margin: 0; padding: 8px 10px;
  background: rgba(255, 92, 114, 0.1);
  border: 1px solid rgba(255, 92, 114, 0.25);
  border-radius: var(--r-sm);
  color: var(--c-danger);
  font-size: var(--fs-sm);
  display: flex; align-items: center; gap: 6px;
}

.spinner {
  width: 14px; height: 14px;
  border: 2px solid var(--c-border);
  border-top-color: var(--c-primary);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}
.spinner-sm {
  width: 12px; height: 12px;
  border: 2px solid rgba(255,255,255,0.3);
  border-top-color: #fff;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
  display: inline-block;
  vertical-align: middle;
  margin-right: 6px;
}
@keyframes spin { to { transform: rotate(360deg); } }
</style>
