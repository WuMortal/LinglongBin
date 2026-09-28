<template>
  <section class="page" :class="{ embedded }">
    <header class="head" :class="{ embedded }">
      <div v-if="!embedded" class="head-left">
        <!-- <PageBackButton /> -->
        <div>
          <h1>分类管理</h1>
          <p>大类 → 小类 二级结构，物料挂在叶子小类上</p>
        </div>
      </div>
      <div class="head-actions">
        <button class="btn btn-ghost" :disabled="importing" @click="importLcsc"
          title="导入立创商城全部分类（大类 / 小类 / 参数模板），已存在的自动跳过">
          <Download :size="14" style="display: inline-flex; flex-shrink: 0" />{{ importing ? '导入中…' : '导入立创分类' }}
        </button>
        <button class="btn btn-primary" @click="openNew">
          <Plus :size="14" style="display: inline-flex; flex-shrink: 0" />新建分类
        </button>
      </div>
    </header>

    <div v-if="loading" class="page-loading">
      <div class="spinner-lg" />
      <span>加载分类中…</span>
    </div>

    <div v-else-if="!cats.length" class="card empty-card">
      <div class="empty-ico">
        <Folder :size="36" style="display: inline-flex; flex-shrink: 0" />
      </div>
      <h3>暂无分类</h3>
      <p>点击「导入立创分类」一键建库，或手动新建</p>
      <button class="btn btn-primary" @click="importLcsc" :disabled="importing">
        <Download :size="14" style="display: inline-flex; flex-shrink: 0" />一键导入立创分类
      </button>
    </div>

    <div v-else class="split">
      <!-- 左侧：大类列表 -->
      <div class="card pane pane-major">
        <div class="pane-head">
          <span class="pane-title">
            <Folder :size="14" style="display: inline-flex; flex-shrink: 0" />大类
          </span>
          <span class="pane-count">{{ filteredMajors.length }}/{{ majors.length }}</span>
          <div class="input-wrap">
            <Search :size="13" class="inp-ico" style="display: inline-flex; flex-shrink: 0" />
            <input v-model="majorKw" placeholder="搜索大类…" />
          </div>
        </div>
        <div class="pane-list">
          <button v-for="m in filteredMajors" :key="m.id" class="major-item"
            :class="{ active: selectedMajorId === m.id }" @click="selectMajor(m.id)">
            <span class="major-ico">
              <Folder :size="14" style="display: inline-flex; flex-shrink: 0" />
            </span>
            <span class="major-name">{{ m.name }}</span>
            <span class="major-meta">
              <span class="minor-cnt">{{ minorCountOf(m.id) }} 小类</span>
            </span>
            <span class="major-ops" @click.stop>
              <button class="icon-btn" @click="edit(m)" title="编辑">
                <Pencil :size="12" style="display: inline-flex; flex-shrink: 0" />
              </button>
              <button class="icon-btn danger" @click="del(m)" title="删除">
                <Trash2 :size="12" style="display: inline-flex; flex-shrink: 0" />
              </button>
            </span>
          </button>
          <div v-if="!filteredMajors.length" class="pane-empty">无匹配大类</div>
        </div>
      </div>

      <!-- 右侧：小类列表 -->
      <div class="card pane pane-minor">
        <div class="pane-head">
          <span class="pane-title">
            <Tag :size="14" style="display: inline-flex; flex-shrink: 0" />
            {{ selectedMajor ? selectedMajor.name + ' · 小类' : '小类' }}
          </span>
          <span class="pane-count">{{ displayMinors.length }}/{{ currentMinorTotal }}</span>
          <div class="input-wrap">
            <Search :size="13" class="inp-ico" style="display: inline-flex; flex-shrink: 0" />
            <input v-model="minorKw" :placeholder="selectedMajor ? '在「' + selectedMajor.name + '」中搜索…' : '搜索小类…'" />
          </div>
        </div>
        <div class="pane-list">
          <template v-if="displayMinors.length">
            <div v-for="mi in displayMinors" :key="mi.id" class="minor-row">
              <span class="minor-ico">
                <Tag :size="12" style="display: inline-flex; flex-shrink: 0" />
              </span>
              <span class="minor-name">{{ mi.name }}</span>
              <span v-if="mi.location_prefix" class="minor-prefix mono">
                <MapPin :size="10" style="display: inline-flex; flex-shrink: 0" />{{ mi.location_prefix }}
              </span>
              <span class="minor-threshold">
                <TriangleAlert :size="10" style="display: inline-flex; flex-shrink: 0" />阈值 {{ mi.threshold ?? 0 }}
              </span>
              <span class="minor-ops">
                <button class="icon-btn" @click="edit(mi)" title="编辑">
                  <Pencil :size="12" style="display: inline-flex; flex-shrink: 0" />
                </button>
                <button class="icon-btn danger" @click="del(mi)" title="删除">
                  <Trash2 :size="12" style="display: inline-flex; flex-shrink: 0" />
                </button>
              </span>
            </div>
          </template>
          <div v-else class="pane-empty">
            <Tag :size="28" style="display: inline-flex; flex-shrink: 0" />
            <p v-if="minorKw">无匹配小类</p>
            <p v-else-if="selectedMajor">该大类下暂无小类</p>
            <p v-else>请从左侧选择大类</p>
          </div>
        </div>
      </div>
    </div>

    <!-- 编辑弹窗 -->
    <div v-if="showEdit" class="modal-mask" @click.self="showEdit = false">
      <div class="modal">
        <div class="modal-head">
          <h3>{{ editing.id ? '编辑分类' : '新建分类' }}</h3>
        </div>
        <div class="modal-body">
          <div class="field">
            <label>名称</label>
            <input v-model="editing.name" placeholder="如 电阻 / 贴片电阻" />
          </div>
          <div class="field">
            <label>上级分类</label>
            <AppSelect v-model="editing.parent" :options="parentOptions" placeholder="（无 · 作为大类）" :min-width="0" />
          </div>
          <div class="field-row">
            <div class="field">
              <label>位置前缀</label>
              <input v-model="editing.location_prefix" placeholder="如 A01" />
            </div>
            <div class="field">
              <label>预警阈值</label>
              <input v-model.number="editing.threshold" type="number" min="0" placeholder="0" />
            </div>
          </div>

          <!-- 小类参数模板（仅小类显示） -->
          <div v-if="isMinor" class="field">
            <label>参数模板 <small class="hint-text">（物料挂在该小类下时可选的参数项）</small></label>
            <CategoryParamsEditor v-model="paramsDraft" :loading="paramsLoading" />
          </div>

          <p v-if="formErr" class="form-err">
            <TriangleAlert :size="12" style="display: inline-flex; flex-shrink: 0" />{{ formErr }}
          </p>
        </div>
        <div class="modal-foot">
          <button class="btn btn-ghost" @click="showEdit = false">取消</button>
          <button class="btn btn-primary" :disabled="saving" @click="saveCat">
            <span v-if="saving" class="spinner-sm" />{{ saving ? '保存中…' : '保存' }}
          </button>
        </div>
      </div>
    </div>

    <!-- 导入进度浮层 -->
    <ProgressOverlay :visible="importing && !!importProgress" :title="importMsg" :progress="importPct">
      <div class="import-meta">
        <span v-if="importProgress?.phase !== 'prepare' && importProgress?.phase !== 'done'">
          大类 {{ importProgress?.majorIdx }}/{{ importProgress?.majorTotal }}
          · 小类 {{ importProgress?.minorDone }}/{{ importProgress?.minorTotal }}
        </span>
        <span v-else-if="importProgress?.phase === 'prepare'">正在加载参数模板…</span>
        <span v-else>已导入 {{ importProgress?.minorTotal }} 个小类</span>
      </div>
    </ProgressOverlay>
  </section>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { Download, Plus, Folder, Search, Tag, MapPin, TriangleAlert, Pencil, Trash2 } from 'lucide-vue-next'
import { listCategories, createCategory, updateCategory, deleteCategory, importLcscCategories, getCategoryParams } from '../lib/db'
import type { ImportProgress } from '../lib/db'
import type { Category, CategoryParam } from '../lib/types'
import AppSelect from '../components/form/AppSelect.vue'
import CategoryParamsEditor from '../components/business/CategoryParamsEditor.vue'
import ProgressOverlay from '../components/ProgressOverlay.vue'
import PageBackButton from '../components/PageBackButton.vue'
import { useToast } from '../composables/toast'
import { confirm } from '../composables/confirm'

const toast = useToast()

/** 嵌入模式：在设置弹窗内使用时隐藏页面标题与返回按钮 */
withDefaults(defineProps<{ embedded?: boolean }>(), { embedded: false })

const cats = ref<Category[]>([])
const showEdit = ref(false)
const saving = ref(false)
const importing = ref(false)
const loading = ref(false)
const formErr = ref('')
const majorKw = ref('')
const minorKw = ref('')
const selectedMajorId = ref<string | null>(null)

interface EditForm { id: string | null; name: string; location_prefix: string | null; threshold: number; parent: string | null }
const editing = ref<EditForm>({ id: null, name: '', location_prefix: '', threshold: 0, parent: null })

// 参数模板：编辑小类时按需加载
const paramsDraft = ref<CategoryParam[]>([])
const paramsLoading = ref(false)
// 是否小类（有 parent）→ 显示参数模板区
const isMinor = computed(() => !!editing.value.parent)

const majors = computed(() => cats.value.filter(c => !c.parent))
const minors = computed(() => cats.value.filter(c => c.parent))

const selectedMajor = computed(() => majors.value.find(m => m.id === selectedMajorId.value) || null)

const majorKwLower = computed(() => majorKw.value.trim().toLowerCase())
const minorKwLower = computed(() => minorKw.value.trim().toLowerCase())

const filteredMajors = computed(() => {
  if (!majorKwLower.value) return majors.value
  return majors.value.filter(m => m.name.toLowerCase().includes(majorKwLower.value))
})

// 当前选中大类下的全部小类（未过滤）
const currentMinors = computed(() => {
  if (!selectedMajorId.value) return []
  return minors.value.filter(m => m.parent === selectedMajorId.value)
})

// 当前选中大类下的全部小类数量（用于显示 x/y）
const currentMinorTotal = computed(() => currentMinors.value.length)

const displayMinors = computed(() => {
  if (!selectedMajorId.value) return []
  if (!minorKwLower.value) return currentMinors.value
  return currentMinors.value.filter(m => m.name.toLowerCase().includes(minorKwLower.value))
})

const parentOptions = computed(() => [
  { value: null, label: '（无 · 作为大类）' },
  ...cats.value
    .filter(c => !c.parent && c.id !== editing.value.id)
    .map(c => ({ value: c.id, label: c.name }))
])

function minorCountOf(majorId: string) {
  return minors.value.filter(m => m.parent === majorId).length
}

function selectMajor(id: string) {
  selectedMajorId.value = id
  // 切换大类时清空小类搜索，避免残留数据
  minorKw.value = ''
}

function openNew() {
  editing.value = { id: null, name: '', location_prefix: '', threshold: 0, parent: null }
  paramsDraft.value = []
  formErr.value = ''
  showEdit.value = true
}
async function edit(c: Category) {
  editing.value = { ...c }
  formErr.value = ''
  showEdit.value = true
  // 小类才异步加载参数模板
  if (c.parent && c.id) {
    paramsLoading.value = true
    paramsDraft.value = []
    try {
      paramsDraft.value = await getCategoryParams(c.id)
    } catch (e: unknown) {
      toast.error('加载参数失败：' + ((e as Error).message || e))
    } finally {
      paramsLoading.value = false
    }
  } else {
    paramsDraft.value = []
  }
}
async function saveCat() {
  formErr.value = ''
  if (!editing.value.name.trim()) { formErr.value = '名称必填'; return }
  saving.value = true
  try {
    const payload: Record<string, unknown> = {
      name: editing.value.name.trim(),
      location_prefix: (editing.value.location_prefix ?? '').trim() || null,
      threshold: Number(editing.value.threshold) || 0,
      parent: editing.value.parent || null
    }
    // 小类才写回 params（大类保持 []）
    if (editing.value.parent) payload.params = paramsDraft.value
    if (editing.value.id) await updateCategory(editing.value.id, payload)
    else await createCategory(payload)
    showEdit.value = false
    await loadCats()
  } catch (e: unknown) { formErr.value = '保存失败：' + ((e as Error).message || e) }
  finally { saving.value = false }
}
async function del(c: Category) {
  if (!c.parent && cats.value.some(x => x.parent === c.id)) {
    toast.warning(`大类「${c.name}」下还有小类，请先删除其下小类后再删除大类`)
    return
  }
  if (!await confirm({
    title: '删除分类',
    content: `删除分类「${c.name}」？该分类下物料将变为未分类。`,
    danger: true,
    confirmText: '删除',
  })) return
  try { await deleteCategory(c.id); await loadCats(); toast.success('删除成功') } catch (e: unknown) { toast.error('删除失败：' + (e as Error).message) }
}

// 导入进度状态
const importProgress = ref<ImportProgress | null>(null)
const importPct = computed(() => {
  const p = importProgress.value
  if (!p || !p.minorTotal) return 0
  return Math.min(100, Math.round((p.minorDone / p.minorTotal) * 100))
})
const importMsg = computed(() => {
  const p = importProgress.value
  if (!p) return ''
  if (p.phase === 'prepare') return '正在准备数据…'
  if (p.phase === 'done') return '导入完成'
  if (p.phase === 'major') return `正在导入大类：${p.majorName}`
  return `正在导入 ${p.majorName} / ${p.minorName}`
})

async function importLcsc() {
  if (!await confirm({
    title: '导入立创分类',
    content: '将导入立创商城全部分类到当前账户，已存在的分类会自动跳过。继续？',
    variant: 'warning',
    confirmText: '开始导入',
  })) return
  importing.value = true
  importProgress.value = { phase: 'prepare', majorName: '', minorName: '', majorIdx: 0, majorTotal: 0, minorDone: 0, minorTotal: 0 }
  try {
    const r = await importLcscCategories(p => { importProgress.value = { ...p } })
    await loadCats()
    const tplTip = r.templateCreated ? '，已生成默认模板（含贴片电阻/电容布局）' : ''
    toast.success(`导入完成：大类 ${r.majors} 个，新增小类 ${r.minors} 个，跳过重复 ${r.skipped} 个${tplTip}`)
  } catch (e: unknown) { toast.error('导入失败：' + (e as Error).message) }
  finally {
    importing.value = false
    // 稍延迟清除进度，让用户看到 100%
    setTimeout(() => { importProgress.value = null }, 600)
  }
}

async function loadCats() {
  loading.value = true
  try { cats.value = await listCategories() } catch { /* 忽略 */ }
  finally { loading.value = false }
}

onMounted(async () => {
  await loadCats()
  // 默认选中第一个大类
  if (majors.value.length) selectedMajorId.value = majors.value[0].id
})
</script>

<style scoped>
.page {
  height: 100%;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

/* 嵌入设置弹窗时：去除页面级滚动与间距 */
.page.embedded {
  height: auto;
  overflow: visible;
  gap: 10px;
}

.head.embedded {
  justify-content: flex-end;
  padding: 0;
}

.head {
  display: flex;
  justify-content: space-between;
  align-items: flex-end;
  gap: 16px;
  flex-wrap: wrap;
}

.head-left {
  display: flex;
  align-items: center;
  gap: 14px;
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

/* 搜索框（置于面板标题行右侧） */
.pane-head .input-wrap {
  position: relative;
  width: 130px;
  margin-left: auto;
  flex-shrink: 0;
}

.pane-head input {
  width: 100%;
  height: var(--ctrl-h-sm);
  padding-left: 28px;
  font-size: var(--fs-xs);
  background: var(--c-surface);
  border: 1px solid var(--c-border);
  border-radius: var(--r-sm);
}

.pane-head input:focus {
  border-color: var(--c-primary);
}

.pane-head .inp-ico {
  position: absolute;
  left: 8px;
  top: 50%;
  transform: translateY(-50%);
  color: var(--c-text-3);
}

/* 空状态 */
.empty-card {
  padding: 48px 24px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  text-align: center;
}

.empty-ico {
  width: 72px;
  height: 72px;
  border-radius: 50%;
  background: var(--c-glass);
  display: grid;
  place-items: center;
  color: var(--c-text-3);
  margin-bottom: 8px;
}

.empty-card h3 {
  margin: 0;
  font-size: var(--fs-lg);
  font-weight: 600;
}

.empty-card p {
  margin: 0;
  color: var(--c-text-2);
  font-size: var(--fs-sm);
}

/* 左右分栏 */
.split {
  display: grid;
  grid-template-columns: 1.3fr 1.5fr;
  gap: 16px;
  flex: 1;
  min-height: 0;
}

.pane {
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.pane-head {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  border-bottom: 1px solid var(--c-border-hairline);
  background: var(--c-glass);
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
  flex: 0 0 400px;
  overflow-y: scroll;
  padding: 6px;
}

.pane-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 40px 16px;
  color: var(--c-text-3);
  font-size: var(--fs-sm);
  text-align: center;
}

/* 大类项 */
.major-item {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 10px 12px;
  border-radius: var(--r-md);
  border: none;
  background: transparent;
  color: var(--c-text);
  cursor: pointer;
  text-align: left;
  transition: all var(--motion);
}

.major-item:hover {
  background: var(--c-surface-hover);
}

.major-item.active {
  background: var(--c-primary-soft);
  color: var(--c-primary);
}

.major-item.active .major-ico {
  background: var(--c-primary);
  color: #fff;
}

.major-item.active .minor-cnt {
  color: var(--c-primary);
}

.major-ico {
  width: 28px;
  height: 28px;
  border-radius: var(--r-sm);
  flex-shrink: 0;
  background: var(--c-glass);
  color: var(--c-text-2);
  display: grid;
  place-items: center;
  transition: all var(--motion);
}

.major-name {
  font-size: var(--fs-sm);
  font-weight: 500;
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.major-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.minor-cnt {
  font-size: var(--fs-xs);
  color: var(--c-text-2);
  font-weight: 500;
}

.major-ops {
  display: flex;
  gap: 2px;
  opacity: 0;
  transition: opacity var(--motion);
}

.major-item:hover .major-ops {
  opacity: 1;
}

/* 小类行 */
.minor-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 12px;
  border-radius: var(--r-md);
  transition: background var(--motion);
}

.minor-row:hover {
  background: var(--c-surface-hover);
}

.minor-ico {
  width: 24px;
  height: 24px;
  border-radius: var(--r-sm);
  flex-shrink: 0;
  background: var(--c-glass);
  color: var(--c-text-3);
  display: grid;
  place-items: center;
}

.minor-name {
  font-size: var(--fs-sm);
  font-weight: 500;
  flex: 1;
  min-width: 0;
}

.minor-prefix {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: var(--fs-xs);
  color: var(--c-primary);
  background: var(--c-primary-soft);
  padding: 2px 7px;
  border-radius: 4px;
}

.minor-threshold {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: var(--fs-xs);
  color: var(--c-text-2);
}

.minor-ops {
  display: flex;
  gap: 2px;
  opacity: 0;
  transition: opacity var(--motion);
}

.minor-row:hover .minor-ops {
  opacity: 1;
}

/* 图标按钮 */
.icon-btn {
  width: 26px;
  height: 26px;
  border-radius: var(--r-sm);
  border: none;
  background: transparent;
  color: var(--c-text-2);
  cursor: pointer;
  display: grid;
  place-items: center;
  transition: all var(--motion);
}

.icon-btn:hover {
  background: var(--c-surface-active);
  color: var(--c-primary);
}

.icon-btn.danger:hover {
  background: rgba(255, 107, 107, 0.1);
  color: var(--c-danger);
}

/* Modal（仅保留 max-width 覆盖，其余用全局样式） */
.modal {
  max-width: 560px;
}

.modal-body {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.field label {
  font-size: var(--fs-xs);
  color: var(--c-text-2);
  font-weight: 500;
}

.field label .hint-text {
  color: var(--c-text-3);
  font-weight: 400;
  margin-left: 4px;
}

.field input {
  height: var(--ctrl-h);
  padding: 0 var(--ctrl-px);
  font-size: var(--fs-xs);
  background: var(--c-surface);
  border: 1px solid var(--c-border);
  border-radius: var(--r-md);
  color: var(--c-text);
  transition: border-color var(--motion);
}

.field input:focus {
  outline: none;
  border-color: var(--c-primary);
}

.field-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}

.form-err {
  margin: 0;
  padding: 8px 12px;
  background: rgba(255, 107, 107, 0.08);
  color: var(--c-danger);
  border-radius: var(--r-sm);
  font-size: var(--fs-xs);
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.spinner-sm {
  width: 14px;
  height: 14px;
  border: 2px solid rgba(255, 255, 255, 0.3);
  border-top-color: #fff;
  border-radius: 50%;
  animation: spin 0.6s linear infinite;
  display: inline-block;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

@media (max-width: 768px) {
  .split {
    grid-template-columns: 1fr;
  }

  .pane-major {
    max-height: 300px;
  }

  .minor-prefix,
  .minor-threshold {
    display: none;
  }

  .field-row {
    grid-template-columns: 1fr;
  }
}

/* 导入浮层 meta 信息（ProgressOverlay 内 slot） */
.import-meta {
  font-size: var(--fs-xs);
  color: var(--c-text-2);
  margin-bottom: 10px;
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 200ms ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
