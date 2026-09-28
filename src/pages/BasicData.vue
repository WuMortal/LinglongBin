<template>
  <section class="page" :class="{ embedded }">
    <header class="head" :class="{ embedded }">
      <div v-if="!embedded" class="head-left">
        <div>
          <h1>基础数据</h1>
          <p>维护下拉选项集，如库位、出库用途</p>
        </div>
      </div>
      <div class="head-actions">
        <!-- <button class="btn btn-primary" @click="openNewType">
          <Plus :size="14" style="display: inline-flex; flex-shrink: 0" />新建选项集
        </button> -->
      </div>
    </header>

    <div v-if="loading" class="page-loading">
      <div class="spinner-lg" />
      <span>加载基础数据中…</span>
    </div>

    <div v-else class="split">
      <!-- 左侧：选项集类型 -->
      <div class="card pane pane-types">
        <div class="pane-head">
          <span class="pane-title"><BookText :size="14" style="display: inline-flex; flex-shrink: 0" />选项集</span>
          <span class="pane-count">{{ types.length }}</span>
        </div>
        <div class="pane-list">
          <button
            v-for="t in types" :key="t.id"
            class="type-item" :class="{ active: selected?.id === t.id }"
            @click="selectType(t)"
          >
            <span class="type-ico"><BookText :size="14" style="display: inline-flex; flex-shrink: 0" /></span>
            <span class="type-name">{{ t.name }}</span>
            <span v-if="t.builtin" class="type-builtin">内置</span>
            <span class="type-meta">{{ itemCountOf(t.key) }} 项</span>
            <span class="type-ops" @click.stop>
              <button v-if="!t.builtin" class="icon-btn danger" @click="delType(t)" title="删除选项集">
                <Trash2 :size="12" style="display: inline-flex; flex-shrink: 0" />
              </button>
            </span>
          </button>
          <div v-if="!types.length" class="pane-empty">暂无选项集</div>
        </div>
      </div>

      <!-- 右侧：选项 -->
      <div class="card pane pane-items">
        <div class="pane-head">
          <span class="pane-title">
            <Tag :size="14" style="display: inline-flex; flex-shrink: 0" />
            {{ selected ? selected.name + ' · 选项' : '选项' }}
          </span>
          <span class="pane-count">{{ items.length }}</span>
        </div>
        <div v-if="selected" class="item-add">
          <div class="input-wrap">
            <Plus :size="13" class="inp-ico" style="display: inline-flex; flex-shrink: 0" />
            <input
              :value="newLabel" @input="onLabelInput"
              :placeholder="`新增 ${selected.name} 选项，回车添加`"
              @compositionstart="onCompositionStart" @compositionend="onCompositionEnd"
              @keyup.enter="onAddKey"
            />
          </div>
          <button class="btn btn-primary item-add-btn" :disabled="!newLabel.trim() || adding" @click="addItem">添加</button>
        </div>
        <div class="pane-list">
          <template v-if="items.length">
            <div v-for="(it, i) in items" :key="it.id" class="item-row">
              <span class="item-idx mono">{{ i + 1 }}</span>
              <template v-if="editingId === it.id">
                <input
                  ref="editInput" :value="editLabel" @input="onEditInput" class="item-edit-input"
                  @compositionstart="onCompositionStart" @compositionend="onCompositionEnd"
                  @keyup.enter="onSaveEditKey(it)" @keyup.escape="editingId = null" @blur="saveEdit(it)"
                />
              </template>
              <template v-else>
                <span class="item-label" @dblclick="startEdit(it)">{{ it.label }}</span>
              </template>
              <span class="item-ops">
                <button class="icon-btn" :disabled="i === 0" title="上移" @click="move(it, -1)">
                  <ChevronUp :size="12" style="display: inline-flex; flex-shrink: 0" />
                </button>
                <button class="icon-btn" :disabled="i === items.length - 1" title="下移" @click="move(it, 1)">
                  <ChevronDown :size="12" style="display: inline-flex; flex-shrink: 0" />
                </button>
                <button class="icon-btn" title="编辑" @click="startEdit(it)">
                  <Pencil :size="12" style="display: inline-flex; flex-shrink: 0" />
                </button>
                <button class="icon-btn danger" title="删除" @click="delItem(it)">
                  <Trash2 :size="12" style="display: inline-flex; flex-shrink: 0" />
                </button>
              </span>
            </div>
          </template>
          <div v-else class="pane-empty">
            <Tag :size="28" style="display: inline-flex; flex-shrink: 0" />
            <p>暂无选项，在上方输入后回车添加</p>
          </div>
        </div>
      </div>
    </div>

    <!-- 新建选项集弹窗 -->
    <div v-if="showNewType" class="modal-mask" @click.self="showNewType = false">
      <div class="modal" style="max-width: 420px">
        <div class="modal-head"><h3>新建选项集</h3></div>
        <div class="modal-body">
          <div class="field">
            <label>选项集名称</label>
            <input :value="newTypeName" @input="onTypeNameInput" placeholder="如 采购渠道"
              @compositionstart="onCompositionStart" @compositionend="onCompositionEnd"
              @keyup.enter="onSaveTypeKey" />
          </div>
          <p v-if="typeErr" class="form-err">
            <TriangleAlert :size="12" style="display: inline-flex; flex-shrink: 0" />{{ typeErr }}
          </p>
        </div>
        <div class="modal-foot">
          <button class="btn btn-ghost" @click="showNewType = false">取消</button>
          <button class="btn btn-primary" :disabled="!newTypeName.trim()" @click="saveNewType">创建</button>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { ref, computed, nextTick, onMounted } from 'vue'
import { Plus, BookText, Tag, Trash2, Pencil, ChevronUp, ChevronDown, TriangleAlert } from 'lucide-vue-next'
import {
  listDictTypes, listDictItems, countDictItems, createDictType, deleteDictType,
  createDictItem, updateDictItem, deleteDictItem,
} from '../lib/db'
import type { DictType, DictItem } from '../lib/types'
import { useToast } from '../composables/toast'
import { confirm } from '../composables/confirm'

const toast = useToast()

/** 嵌入模式：在设置弹窗内使用时隐藏页面标题 */
withDefaults(defineProps<{ embedded?: boolean }>(), { embedded: false })

const loading = ref(false)
const types = ref<DictType[]>([])
const items = ref<DictItem[]>([])
const selected = ref<DictType | null>(null)
const counts = ref<Record<string, number>>({})

// 新增项
const newLabel = ref('')
const adding = ref(false)

// 输入法组合输入状态（中文输入），见 addItem 前的处理函数
const composing = ref(false)

// 行内编辑
const editingId = ref<string | null>(null)
const editLabel = ref('')
const editInput = ref<HTMLInputElement[]>([])

// 新建选项集
const showNewType = ref(false)
const newTypeName = ref('')
const typeErr = ref('')

const selectedKey = computed(() => selected.value?.key ?? '')

function itemCountOf(key: string) {
  return counts.value[key] ?? 0
}

async function loadTypes(keepKey?: string) {
  loading.value = true
  try {
    const [ts, cnt] = await Promise.all([listDictTypes(), countDictItems()])
    types.value = ts
    counts.value = cnt
    const hit = keepKey
      ? types.value.find(t => t.key === keepKey) || null
      : types.value[0] || null
    selected.value = hit
    if (hit) await loadItems(hit.key)
    else items.value = []
  } catch (e: unknown) { toast.error('加载选项集失败：' + ((e as Error).message || e)) }
  finally { loading.value = false }
}

async function refreshCounts() {
  try { counts.value = await countDictItems() }
  catch { /* 忽略，避免干扰主流程 */ }
}

async function loadItems(key: string) {
  try { items.value = await listDictItems(key) }
  catch (e: unknown) { toast.error('加载选项失败：' + ((e as Error).message || e)) }
}

async function selectType(t: DictType) {
  if (selected.value?.id === t.id) return
  selected.value = t
  newLabel.value = ''
  editingId.value = null
  await loadItems(t.key)
}

// ===== 选项集类型 =====
function openNewType() {
  newTypeName.value = ''
  typeErr.value = ''
  showNewType.value = true
}
async function saveNewType() {
  const name = newTypeName.value.trim()
  if (!name) return
  if (types.value.some(t => t.name === name)) { typeErr.value = '同名选项集已存在'; return }
  // 自定义选项集 key 自动生成（仅内置选项集有固定 key 供下拉集成引用）
  const key = `dict_${Date.now().toString(36)}`
  try {
    const created = await createDictType({ key, name, builtin: false })
    showNewType.value = false
    await loadTypes(created.key)
    toast.success(`选项集「${name}」已创建`)
  } catch (e: unknown) { typeErr.value = '创建失败：' + ((e as Error).message || e) }
}
async function delType(t: DictType) {
  if (!await confirm({
    title: '删除选项集',
    content: `删除选项集「${t.name}」及其全部 ${itemCountOf(t.key)} 个选项？`,
    danger: true, confirmText: '删除',
  })) return
  try {
    await deleteDictType(t.id)
    await loadTypes()
    toast.success('已删除')
  } catch (e: unknown) { toast.error('删除失败：' + ((e as Error).message || e)) }
}

// ===== 输入法组合输入（中文）支持 =====
// Vue 3 的 v-model 在 composition（如中文输入法）期间不更新 input 事件，导致输入时按钮一直禁用。
// 这里改用手动绑定 :value + @input 实时同步输入内容；组合确认的回车不触发提交，避免拿到空值/半成品。
function onLabelInput(e: Event) { newLabel.value = (e.target as HTMLInputElement).value }
function onEditInput(e: Event) { editLabel.value = (e.target as HTMLInputElement).value }
function onTypeNameInput(e: Event) { newTypeName.value = (e.target as HTMLInputElement).value }
function onCompositionStart() { composing.value = true }
function onCompositionEnd() { composing.value = false }
function onAddKey() {
  if (composing.value) return
  addItem()
}
function onSaveEditKey(it: DictItem) {
  if (composing.value) return
  saveEdit(it)
}
function onSaveTypeKey() {
  if (composing.value) return
  saveNewType()
}

// ===== 选项 =====
async function addItem() {
  const label = newLabel.value.trim()
  if (!label || !selectedKey.value || adding.value) return
  if (items.value.some(i => i.label === label)) { toast.warning('该选项已存在'); return }
  adding.value = true
  try {
    await createDictItem({ dict_key: selectedKey.value, label })
    newLabel.value = ''
    await loadItems(selectedKey.value)
    await refreshCounts()
  } catch (e: unknown) { toast.error('添加失败：' + ((e as Error).message || e)) }
  finally { adding.value = false }
}

async function startEdit(it: DictItem) {
  editingId.value = it.id
  editLabel.value = it.label
  await nextTick()
  editInput.value?.[0]?.focus()
}
async function saveEdit(it: DictItem) {
  if (editingId.value !== it.id) return
  const label = editLabel.value.trim()
  editingId.value = null
  if (!label || label === it.label) return
  if (items.value.some(i => i.label === label)) { toast.warning('该选项已存在'); return }
  try {
    await updateDictItem(it.id, { label })
    await loadItems(it.dict_key)
  } catch (e: unknown) { toast.error('保存失败：' + ((e as Error).message || e)) }
}

/** 上移/下移：与相邻项交换 sort_order */
async function move(it: DictItem, dir: -1 | 1) {
  const idx = items.value.findIndex(i => i.id === it.id)
  const other = items.value[idx + dir]
  if (!other) return
  const a = it.sort_order
  let b = other.sort_order
  try {
    if (a === b) {
      // 序号相同（异常数据）时先错开，避免交换后顺序不变
      b = a + 1000
      await updateDictItem(other.id, { sort_order: b })
    }
    await updateDictItem(it.id, { sort_order: b })
    await updateDictItem(other.id, { sort_order: a })
    await loadItems(it.dict_key)
  } catch (e: unknown) { toast.error('移动失败：' + ((e as Error).message || e)) }
}

async function delItem(it: DictItem) {
  try {
    await deleteDictItem(it.id)
    if (editingId.value === it.id) editingId.value = null
    await loadItems(it.dict_key)
    await refreshCounts()
  } catch (e: unknown) { toast.error('删除失败：' + ((e as Error).message || e)) }
}

onMounted(() => loadTypes())
</script>

<style scoped>
.page { height: 100%; overflow: auto; display: flex; flex-direction: column; gap: 16px; }
/* 嵌入设置弹窗时：去除页面级滚动与标题 */
.page.embedded { height: auto; overflow: visible; gap: 10px; }
.head.embedded { justify-content: flex-end; padding: 0; }

.head { display: flex; justify-content: space-between; align-items: flex-end; gap: 16px; flex-wrap: wrap; }
.head-left { display: flex; align-items: center; gap: 14px; }
.head h1 { margin: 0; font-size: var(--fs-xl); font-weight: 700; letter-spacing: -0.02em; }
.head p { margin: 4px 0 0; color: var(--c-text-2); font-size: var(--fs-sm); }
.head-actions { display: flex; gap: 8px; }

/* 左右分栏（与分类管理一致的比例） */
.split { display: grid; grid-template-columns: 1.3fr 1.5fr; gap: 16px; flex: 1; min-height: 0; }

.pane { display: flex; flex-direction: column; overflow: hidden; }
.pane-head {
  display: flex; align-items: center; justify-content: space-between;
  padding: 14px 18px; border-bottom: 1px solid var(--c-border-hairline);
  background: var(--c-glass);
}
.pane-title { display: inline-flex; align-items: center; gap: 8px; font-size: var(--fs-sm); font-weight: 600; color: var(--c-text); }
.pane-count {
  font-size: var(--fs-xs); color: var(--c-text-2); font-weight: 600;
  background: var(--c-surface); padding: 2px 8px; border-radius: 999px;
}
.pane-list { flex: 1; overflow: auto; padding: 6px; }
.pane-empty {
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 8px; padding: 40px 16px; color: var(--c-text-3); font-size: var(--fs-sm);
  text-align: center;
}

/* 选项集类型项 */
.type-item {
  display: flex; align-items: center; gap: 10px;
  width: 100%; padding: 10px 12px;
  border-radius: var(--r-md); border: none; background: transparent;
  color: var(--c-text); cursor: pointer; text-align: left;
  transition: all var(--motion);
}
.type-item:hover { background: var(--c-surface-hover); }
.type-item.active { background: var(--c-primary-soft); color: var(--c-primary); }
.type-item.active .type-ico { background: var(--c-primary); color: #fff; }
.type-ico {
  width: 28px; height: 28px; border-radius: var(--r-sm); flex-shrink: 0;
  background: var(--c-glass); color: var(--c-text-2);
  display: grid; place-items: center; transition: all var(--motion);
}
.type-name { font-size: var(--fs-sm); font-weight: 500; flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.type-builtin {
  font-size: var(--fs-xs); color: var(--c-primary);
  background: var(--c-primary-soft); padding: 1px 6px; border-radius: 4px; flex-shrink: 0;
  margin-left: auto;
}
.type-meta { font-size: var(--fs-xs); color: var(--c-text-2); flex-shrink: 0; }
.type-ops { display: flex; gap: 2px; opacity: 0; transition: opacity var(--motion); }
.type-item:hover .type-ops { opacity: 1; }

/* 新增项输入行 */
.item-add {
  display: flex; gap: 8px; align-items: center;
  padding: 10px 12px; border-bottom: 1px solid var(--c-border-hairline);
}
.item-add .input-wrap { flex: 1; }
.item-add input {
  width: 100%; height: var(--ctrl-h-sm); padding-left: 28px; font-size: var(--fs-xs);
  background: var(--c-surface); border: 1px solid var(--c-border); border-radius: var(--r-sm);
}
.item-add input:focus { border-color: var(--c-primary); }
.item-add .inp-ico { left: 8px; }
.item-add-btn { height: var(--ctrl-h-sm); padding: 0 12px; font-size: var(--fs-xs); flex-shrink: 0; }

/* 选项行 */
.item-row {
  display: flex; align-items: center; gap: 10px;
  padding: 8px 12px; border-radius: var(--r-md);
  transition: background var(--motion);
}
.item-row:hover { background: var(--c-surface-hover); }
.item-idx { font-size: var(--fs-xs); color: var(--c-text-3); width: 20px; text-align: right; flex-shrink: 0; }
.item-label { font-size: var(--fs-sm); font-weight: 500; flex: 1; min-width: 0; cursor: default; }
.item-edit-input {
  flex: 1; min-width: 0; height: 28px; padding: 0 8px;
  font-size: var(--fs-sm);
  background: var(--c-surface); border: 1px solid var(--c-primary); border-radius: var(--r-sm);
  color: var(--c-text);
}
.item-ops { display: flex; gap: 2px; opacity: 0; transition: opacity var(--motion); }
.item-row:hover .item-ops { opacity: 1; }

/* 图标按钮 */
.icon-btn {
  width: 26px; height: 26px; border-radius: var(--r-sm); border: none; background: transparent;
  color: var(--c-text-2); cursor: pointer; display: grid; place-items: center;
  transition: all var(--motion);
}
.icon-btn:hover { background: var(--c-surface-active); color: var(--c-primary); }
.icon-btn:disabled { opacity: 0.3; cursor: default; }
.icon-btn:disabled:hover { background: transparent; color: var(--c-text-2); }
.icon-btn.danger:hover { background: rgba(255,107,107,0.1); color: var(--c-danger); }

.field { display: flex; flex-direction: column; gap: 6px; }
</style>
