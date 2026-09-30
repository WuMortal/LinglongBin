<script setup lang="ts">
// 物料详情抽屉：纯信息展示（含扩展参数、替代料）
// 编辑 / 出入库由卡片上的按钮触发，不在抽屉内
import { ref, computed, watch } from 'vue'
import {
  X, MapPin, Tag, Layers, Package, Image as ImageIcon,
  TriangleAlert, FileText, Hash, Boxes, Clock, User, Link2, Trash2, Info, History,
} from 'lucide-vue-next'
import { imagePublicUrl, getMaterial, getCategoryParams, listStockLog, openDatasheet, listMaterialFiles, deleteMaterialFile } from '../../lib/db'
import type { MaterialRow, CategoryParam, StockLog, MaterialFile } from '../../lib/types'
import { filterFieldParams } from '../../lib/paramFields'
import { useToast } from '../../composables/toast'
import { confirm } from '../../composables/confirm'
import ImageViewer from '../ImageViewer.vue'

const toast = useToast()

const props = defineProps<{
  /** 打开的物料（null=关闭） */
  material: MaterialRow | null
  /** 打开时默认选中的页签：从库存列表点进来直接看出入库记录 */
  initialTab?: 'info' | 'logs'
}>()

const emit = defineEmits<{ close: [] }>()

const current = ref<MaterialRow | null>(null)

/** 当前页签：info=基本信息，logs=出入库记录（打开时按 initialTab 决定，之后可自由切换） */
const tab = ref<'info' | 'logs'>('info')

// 分类参数模板（把 params 的 key 映射为中文名）
const catParams = ref<CategoryParam[]>([])
// 出入库记录
const logs = ref<StockLog[]>([])
const logLoading = ref(false)
// 物料附件（数据手册 / 认证资料 / 行业资讯，一个物料多个）
const files = ref<MaterialFile[]>([])
const fileLoading = ref(false)

/** 附件类型中文名 */
function fileTag(t: string | null | undefined): string {
  switch (t) {
    case 'pdf_property': return '数据手册'
    case 'certification_data_property': return '认证资料'
    case 'industry_information': return '行业资讯'
    default: return '附件'
  }
}

/** 附件行：material_files + 兼容旧数据的主手册（datasheet_path 未入表时也展示） */
const fileRows = computed(() => {
  const m = current.value
  const rows = files.value.map(f => {
    const tag = fileTag(f.file_type)
    const name = (f.name || '').trim() || tag
    return {
      key: f.id,
      name,
      url: f.url,
      // 名称已并入「(数据手册)」前缀时不再重复展示标签
      tag: name.startsWith(`(${tag})`) ? '' : tag,
      deletable: true,
    }
  })
  const mainUrl = m?.datasheet_path || ''
  if (mainUrl && !rows.some(r => r.url === mainUrl)) {
    rows.unshift({ key: 'main', name: '数据手册', url: mainUrl, tag: '', deletable: false })
  }
  return rows
})

async function loadFiles(materialId: string) {
  fileLoading.value = true
  try { files.value = await listMaterialFiles(materialId) }
  catch { files.value = [] }
  finally { fileLoading.value = false }
}

async function removeFile(f: { key: string; name: string; url: string; deletable: boolean }) {
  if (!f.deletable) return
  const ok = await confirm({ content: `删除附件「${f.name}」？仅移除物料上的链接，不影响源文件。`, danger: true })
  if (!ok) return
  try {
    await deleteMaterialFile(f.key)
    files.value = files.value.filter(x => x.id !== f.key)
    toast.success('已删除')
  } catch (e) {
    toast.error(`删除失败：${(e as Error).message}`)
  }
}

const effThreshold = computed(() => {
  const m = current.value
  if (!m) return 0
  return (m.threshold || 0) > 0 ? m.threshold : (m.categories?.threshold || 0) > 0 ? m.categories!.threshold as number : 5
})

/**
 * 扩展参数：key → { name, value }
 * 过滤掉「型号 / 品牌 / 封装」——抽屉里有专门的主表字段区块，不重复展示。
 * 模板异步加载完成前用主表字段值兜底比对，避免闪一下。
 */
const paramList = computed(() => {
  const m = current.value
  if (!m) return []
  return filterFieldParams(m.params, {
    template: catParams.value,
    fieldValues: [m.model, m.brand, m.package],
  }).map(([k, v]) => ({
    key: k,
    name: catParams.value.find(p => p.key === k)?.name || k,
    value: v,
  }))
})

watch(() => props.material, async m => {
  if (m) {
    const prevId = current.value?.id ?? null
    current.value = m
    // 首次打开 / 换物料 → 回到调用方指定的默认页签；同物料刷新数据时不打断当前页签
    if (prevId !== m.id) tab.value = props.initialTab ?? 'info'
    catParams.value = []
    logs.value = []
    // 出入库记录 + 附件（数据手册 / 认证资料 / 行业资讯）
    loadLogs(m.id)
    loadFiles(m.id)
    // 拉最新数据（卡片列表可能是缓存）+ 参数模板
    try {
      const [fresh, cps] = await Promise.all([
        getMaterial(m.id),
        m.category_id ? getCategoryParams(m.category_id) : Promise.resolve([] as CategoryParam[]),
      ])
      if (current.value?.id === m.id) {
        current.value = fresh
        catParams.value = cps
      }
    } catch { /* 保留原值 */ }
  } else {
    current.value = null
    catParams.value = []
    logs.value = []
    files.value = []
  }
})

async function loadLogs(materialId: string) {
  logLoading.value = true
  try { logs.value = await listStockLog({ materialId, limit: 100 }) }
  catch { /* 静默 */ }
  finally { logLoading.value = false }
}

function fmtTime(iso: string) {
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function fmtPrice(v: number) { return Number(v || 0).toFixed(2) }

/** 打开数据手册（系统默认程序/浏览器） */
async function openDs(path: string) {
  try { await openDatasheet(path) }
  catch (e: unknown) {
    console.error('打开手册失败', e)
    const msg = ((e as Error).message || String(e)).toLowerCase()
    if (msg.includes('plugin') || msg.includes('not allowed') || msg.includes('invoke')) {
      toast.error('打开手册失败：请重启应用使新插件生效后重试')
    } else {
      toast.error('打开手册失败：' + ((e as Error).message || e))
    }
  }
}

/* ===== 图片预览：点击头部缩略图弹出大图 ===== */
const showViewer = ref(false)
const previewUrl = computed(() => imagePublicUrl(current.value?.image_path || '') || null)
function openViewer() { if (previewUrl.value) showViewer.value = true }
</script>

<template>
  <Teleport to="body">
    <Transition name="drawer">
      <div v-if="current" class="dw-mask" @click.self="emit('close')">
        <aside class="dw">
          <!-- 头部：物料识别 -->
          <header class="dw-head">
            <div class="dw-thumb">
              <img v-if="previewUrl" :src="previewUrl" alt="" title="点击放大" class="thumb-img" @click="openViewer" />
              <ImageIcon v-else :size="26" style="display: inline-flex; flex-shrink: 0" />
            </div>
            <div class="dw-title">
              <h2>{{ current.name }}</h2>
              <p>
                {{ current.brand || '—' }} · {{ current.model || '—' }}
                <span class="cat" v-if="current.categories?.name">· {{ current.categories.name }}</span>
              </p>
            </div>
            <button class="dw-close" title="关闭" @click="emit('close')">
              <X :size="16" style="display: inline-flex; flex-shrink: 0" />
            </button>
          </header>

          <div class="dw-scroll">
            <!-- 关键指标 -->
            <div class="dw-stats">
              <div class="stat">
                <span class="lbl">
                  <Package :size="13" style="display: inline-flex; flex-shrink: 0" />当前库存
                </span>
                <b :class="{ low: current.qty <= effThreshold }">{{ current.qty }}</b>
              </div>
              <div class="stat">
                <span class="lbl">
                  <TriangleAlert :size="13" style="display: inline-flex; flex-shrink: 0" />预警阈值
                </span>
                <b>{{ effThreshold }}</b>
              </div>
              <div class="stat">
                <span class="lbl">
                  <Tag :size="13" style="display: inline-flex; flex-shrink: 0" />单价
                </span>
                <b>¥{{ fmtPrice(current.price) }}</b>
              </div>
              <div class="stat">
                <span class="lbl">
                  <MapPin :size="13" style="display: inline-flex; flex-shrink: 0" />位置
                </span>
                <b class="loc">{{ current.location || '—' }}</b>
              </div>
            </div>

            <!-- 页签：基本信息 / 出入库记录 -->
            <div class="dw-tabs">
              <button class="dw-tab" :class="{ on: tab === 'info' }" @click="tab = 'info'">
                <Info :size="14" style="display: inline-flex; flex-shrink: 0" />基本信息
              </button>
              <button class="dw-tab" :class="{ on: tab === 'logs' }" @click="tab = 'logs'">
                <History :size="14" style="display: inline-flex; flex-shrink: 0" />出入库记录
                <span class="badge" v-if="logs.length">{{ logs.length }}</span>
              </button>
            </div>

            <template v-if="tab === 'info'">
              <!-- 基础属性 -->
              <section class="dw-sec">
                <h3>基本信息</h3>
                <div class="kv-grid">
                  <div class="kv">
                    <span>
                      <Hash :size="12" style="display: inline-flex; flex-shrink: 0" />商品编号
                    </span>
                    <b>{{ current.part_no || '—' }}</b>
                  </div>
                  <div class="kv">
                    <span>
                      <Boxes :size="12" style="display: inline-flex; flex-shrink: 0" />封装
                    </span>
                    <b>{{ current.package || '—' }}</b>
                  </div>
                  <div class="kv">
                    <span>
                      <Layers :size="12" style="display: inline-flex; flex-shrink: 0" />分类
                    </span>
                    <b>{{ [current.categories?.parent_name, current.categories?.name].filter(Boolean).join(' / ') ||
                      '未分类' }}</b>
                  </div>
                  <div class="kv">
                    <span>
                      <Clock :size="12" style="display: inline-flex; flex-shrink: 0" />创建时间
                    </span>
                    <b>{{ fmtTime(current.created_at) }}</b>
                  </div>
                  <div class="kv">
                    <span>
                      <User :size="12" style="display: inline-flex; flex-shrink: 0" />库存价值
                    </span>
                    <b>¥{{ fmtPrice(current.qty * current.price) }}</b>
                  </div>
                  <div class="kv">
                    <span>
                      <Link2 :size="12" style="display: inline-flex; flex-shrink: 0" />物料链接
                    </span>
                    <a v-if="current.link" class="ds-link" href="#" @click.prevent="openDs(current.link!)">打开</a>
                    <b v-else>—</b>
                  </div>
                </div>
              </section>
              <!-- 扩展参数 -->
              <section class="dw-sec" v-if="paramList.length">
                <h3>扩展参数</h3>
                <div class="kv-grid">
                  <div class="kv" v-for="p in paramList" :key="p.key">
                    <span>{{ p.name }}</span>
                    <b>{{ p.value }}</b>
                  </div>
                </div>
              </section>
              <!-- 数据手册 / 附件（一个物料可有多个：主手册 + 认证资料 / 行业资讯） -->
              <section class="dw-sec" v-if="fileRows.length">
                <h3>
                  数据手册 / 附件
                  <span v-if="fileLoading" class="file-count" style="opacity: .5">加载中…</span>
                  <span v-else class="file-count">{{ fileRows.length }}</span>
                </h3>
                <div class="file-list">
                  <div v-for="f in fileRows" :key="f.key" class="file-item">
                    <FileText :size="15" class="file-ico" />
                    <div class="file-mid">
                      <span class="file-name" :title="f.url">{{ f.name }}</span>
                      <span v-if="f.tag" class="file-tag">{{ f.tag }}</span>
                    </div>
                    <a class="ds-link" href="#" @click.prevent="openDs(f.url)">打开</a>
                    <button v-if="f.deletable" class="file-del" title="移除该附件链接" @click="removeFile(f)">
                      <Trash2 :size="13" />
                    </button>
                  </div>
                </div>
              </section>



              <!-- 替代料 -->
              <section class="dw-sec" v-if="current.alternates?.length">
                <h3>替代料</h3>
                <div class="alt-list">
                  <code v-for="a in current.alternates" :key="a" class="alt">{{ a }}</code>
                </div>
              </section>

            </template>

            <!-- 出入库记录 -->
            <section class="dw-sec" v-else>
              <div v-if="logLoading" class="log-hint">
                <div class="spinner-sm" />
              </div>
              <div v-else-if="!logs.length" class="log-empty">暂无记录</div>
              <ul v-else class="log-list">
                <li v-for="r in logs" :key="r.id" :class="[r.type, { 'is-void': r.status === 'void' }]">
                  <span class="tag">{{ r.type === 'in' ? '入' : '出' }}</span>
                  <div class="info">
                    <small class="who">{{ fmtTime(r.created_at) }}</small>
                    <small class="note" v-if="r.note || r.suppliers?.name">
                      {{ [r.suppliers?.name, r.note].filter(Boolean).join(' · ') }}
                    </small>
                    <small v-if="r.status === 'void'" class="note void-note">
                      已撤销<template v-if="r.void_reason">：{{ r.void_reason }}</template>
                    </small>
                  </div>
                  <span class="q">{{ r.type === 'in' ? '+' : '-' }}{{ r.qty }}</span>
                </li>
              </ul>
            </section>
          </div>
        </aside>
      </div>
    </Transition>
  </Teleport>

  <ImageViewer v-model:open="showViewer" :src="previewUrl" />
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

.dw-thumb {
  width: 64px;
  height: 64px;
  border-radius: var(--r-md);
  background: var(--c-glass);
  border: 1px solid var(--c-border);
  display: grid;
  place-items: center;
  overflow: hidden;
  color: var(--c-text-3);
  flex-shrink: 0;
}

.dw-thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
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
}

.stat .lbl {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: var(--fs-xs);
  color: var(--c-text-3);
}

.stat b {
  font-size: var(--fs-lg);
  font-weight: 700;
  line-height: 1;
}

.stat b.low {
  color: var(--c-danger);
}

.stat b.loc {
  font-size: var(--fs-md);
  font-weight: 600;
}

/* ===== 页签（基本信息 / 出入库记录） ===== */
.dw-tabs {
  display: flex;
  gap: 4px;
  padding: 12px 22px 0;
  border-bottom: 1px solid var(--c-border);
}

.dw-tab {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px 9px;
  border: none;
  border-bottom: 2px solid transparent;
  margin-bottom: -1px;
  background: transparent;
  color: var(--c-text-3);
  font-size: var(--fs-sm);
  font-weight: 600;
  cursor: pointer;
  transition: color var(--motion), border-color var(--motion);
}

.dw-tab:hover {
  color: var(--c-text-2);
}

.dw-tab.on {
  color: var(--c-primary);
  border-bottom-color: var(--c-primary);
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

.kv-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
}

.kv {
  display: flex;
  flex-direction: column;
  gap: 3px;
  background: var(--c-surface);
  border: 1px solid var(--c-border);
  border-radius: var(--r-md);
  padding: 8px 12px;
  min-width: 0;
}

.kv span {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: var(--fs-xs);
  color: var(--c-text-3);
}

.kv b {
  font-size: var(--fs-sm);
  font-weight: 600;
  color: var(--c-text);
  word-break: break-all;
}

.ds-link {
  font-size: var(--fs-sm);
  color: var(--c-primary);
  text-decoration: none;
}

.ds-link:hover {
  text-decoration: underline;
}

/* ===== 数据手册 / 附件 ===== */
.file-count {
  font-size: var(--fs-xs);
  color: var(--c-sub);
  margin-left: 6px;
  font-weight: 400;
}

.file-list {
  display: flex;
  flex-direction: column;
  max-height: 120px;
  overflow-y: auto;
  margin: 0 -6px;
  padding: 0 6px;
}

.file-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 5px 8px;
  border-radius: 6px;
}

.file-item:hover {
  background: var(--c-surface-active);
}

.file-ico {
  color: var(--c-sub);
  flex-shrink: 0;
}

.file-mid {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 6px;
}

.file-name {
  font-size: var(--fs-sm);
  color: var(--c-text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 62%;
}

.file-tag {
  font-size: var(--fs-xs);
  color: var(--c-primary);
  background: rgba(64, 128, 255, 0.1);
  border-radius: 4px;
  padding: 0 6px;
  line-height: 18px;
  flex-shrink: 0;
}

.file-del {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 3px;
  border: none;
  background: transparent;
  border-radius: 5px;
  color: var(--c-sub);
  cursor: pointer;
}

.file-del:hover {
  background: rgba(255, 92, 114, 0.12);
  color: var(--c-danger);
}

/* ===== 替代料 ===== */
.alt-list {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.alt {
  background: var(--c-surface);
  border: 1px solid var(--c-border);
  border-radius: var(--r-md);
  padding: 4px 10px;
  font-size: var(--fs-xs);
  color: var(--c-text-2);
  font-family: var(--font-mono, monospace);
}

/* ===== 出入库记录 ===== */
.badge {
  font-size: var(--fs-xs);
  color: var(--c-text-2);
  background: var(--c-surface);
  border: 1px solid var(--c-border);
  border-radius: 999px;
  padding: 1px 8px;
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

.tag {
  width: 22px;
  height: 22px;
  border-radius: 6px;
  display: grid;
  place-items: center;
  font-size: var(--fs-xs);
  font-weight: 700;
  flex-shrink: 0;
}

li.in .tag {
  background: rgba(52, 218, 191, 0.15);
  color: #34DABF;
}

li.out .tag {
  background: rgba(255, 107, 107, 0.15);
  color: #FF6B6B;
}

.info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.who {
  color: var(--c-text-2);
  font-size: var(--fs-xs);
}

.note {
  color: var(--c-text-3);
  font-size: var(--fs-xs);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* 已撤销记录：行弱化 + 数量划线 */
.log-list li.is-void {
  opacity: 0.6;
}

.log-list li.is-void .who,
.log-list li.is-void .note,
.log-list li.is-void .q {
  text-decoration: line-through;
  text-decoration-thickness: 1px;
}

.void-note {
  color: var(--c-danger) !important;
  text-decoration: none !important;
}

.q {
  font-weight: 700;
  font-size: var(--fs-md);
  flex-shrink: 0;
}

li.in .q {
  color: #34DABF;
}

li.out .q {
  color: #FF6B6B;
}

/* ===== 过渡动画 ===== */
.drawer-enter-active,
.drawer-leave-active {
  transition: opacity 220ms ease;
}

.drawer-enter-active .dw,
.drawer-leave-active .dw {
  transition: transform 260ms cubic-bezier(0.22, 1, 0.36, 1);
}

.drawer-enter-from,
.drawer-leave-to {
  opacity: 0;
}

.drawer-enter-from .dw,
.drawer-leave-to .dw {
  transform: translateX(40px);
}

/* ===== 图片预览：查看器已抽离为 ImageViewer 组件 ===== */

@media (max-width: 560px) {
  .dw-stats {
    grid-template-columns: repeat(2, 1fr);
  }
}
</style>
