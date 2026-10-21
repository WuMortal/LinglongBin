<template>
  <SubPage title="扫码入库(立创)" bare>
    <!-- 内容区顶部右侧统计：图标 + 数字（不进 header） -->
    <div class="content-stat">
      <span class="ts">
        <Boxes :size="13" style="display: inline-flex; flex-shrink: 0" />共 {{ items.length }}
      </span>
      <span class="ts warn">
        <PackagePlus :size="13" style="display: inline-flex; flex-shrink: 0" />待新建 {{ pendingCount }}
      </span>
    </div>

    <!-- 录入区：手动粘贴（相机在 WebView/桌面可能不可用，手动是可靠路径；相机开关在底部栏） -->
    <section class="in-card">
      <textarea v-model="rawInput" class="raw" rows="3"
        placeholder="粘贴扫码内容（可多行，每行一条；立创码为 C+数字，如 C50313803）：{on:SO..,pc:C50313803,pm:AMS1117-3.3OE,qty:20,...}" />
      <button class="add-btn" @click="addFromText">添加</button>
    </section>

    <!-- 全屏扫码组件（点击底部「扫码」打开，参考微信扫码页） -->
    <ScanCamera v-if="cameraOn" @detected="onScan" @close="cameraOn = false" @error="onScanError" />

    <!-- 已扫列表（行卡样式，参考移动端物料库列表模式） -->
    <section v-if="items.length" class="list">
      <article v-for="it in items" :key="it.pc" class="item row-item"
        :class="{ pending: it.pending, tap: it.material_id }" @click="openDetail(it)">
        <div class="row-thumb">
          <img v-if="thumbOf(it)" :src="thumbOf(it)" alt="" loading="lazy" />
          <div v-else class="thumb-ph">
            <ImageIcon :size="22" style="display: inline-flex; flex-shrink: 0" />
          </div>
          <span v-if="it.pending" class="low-tag sm">新建</span>
        </div>
        <div class="row-body">
          <div class="row-head">
            <h3 class="row-name">
              {{ it.material?.name || it.pc }}
              <span v-if="it.material?.name" class="row-pn">{{ it.pc }}</span>
            </h3>
            <span class="status" :class="it.pending ? 'warn' : 'ok'">{{ it.pending ? '新建' : '存在' }}</span>
            <span class="row-qty">×{{ it.qty }}</span>
          </div>
          <p class="row-line2">{{ (it.material?.brand || it.pm || '—') }} · {{ it.material?.model || '—' }}</p>
          <div v-if="it.material?.categories?.name || it.material?.package || it.material?.location" class="row-tags">
            <span v-if="it.material.categories?.name" class="row-tag">{{ it.material.categories.name }}</span>
            <span v-if="it.material.package" class="row-tag">{{ it.material.package }}</span>
            <span v-if="it.material?.location" class="loc">
              <MapPin :size="12" style="display: inline-flex; flex-shrink: 0" />{{ it.material.location }}
            </span>
          </div>
        </div>
        <div class="row-side">
          <button class="rm" title="移除" @click.stop="remove(it.pc)">
            <X :size="14" style="display: inline-flex; flex-shrink: 0" />
          </button>
          <NumberStepper v-model="it.qty" :min="1" @click.stop />
        </div>
      </article>
    </section>

    <p v-else class="empty">
      <ScanLine :size="26" style="display: inline-flex; flex-shrink: 0" />
      <span>还没有扫码记录，点底部「扫码」</span>
    </p>

    <!-- 底部固定操作栏：最左重置 + 扫码 + 确认入库（参考物料详情 actbar） -->
    <div class="actbar">
      <button class="ibtn" title="重置" @click="resetAll">
        <RotateCcw :size="19" style="display: inline-flex; flex-shrink: 0" />
      </button>
      <button class="abtn scan" @click="cameraOn = true">
        <ScanLine :size="17" style="display: inline-flex; flex-shrink: 0" />
        扫码
      </button>
      <button class="abtn in" :disabled="!items.length || busy" @click="confirmIn">
        <span v-if="busy" class="spinner-sm" />
        {{ busy ? '入库中…' : '确认入库' }}
      </button>
    </div>

    <!-- 已存在物料：点击弹出只读详情（复用物料详情页，去掉操作与 NavBar，外层 X 关闭） -->
    <Teleport to="body">
      <Transition name="detail">
        <div v-if="selId" class="detail-mask" @click="closeDetail">
          <div class="detail-sheet" @click.stop>
            <div class="sheet-head">
              <span class="grab" />
              <button class="sheet-x" type="button" @click="closeDetail">
                <X :size="18" style="display: inline-flex; flex-shrink: 0" />
              </button>
            </div>
            <MaterialDetail :id="selId ?? undefined" readonly @close="closeDetail" />
          </div>
        </div>
      </Transition>
    </Teleport>
  </SubPage>
</template>

<script setup lang="ts">
import { ref, computed, watch, onBeforeUnmount } from 'vue'
import { useRouter } from 'vue-router'
import { ScanLine, X, RotateCcw, MapPin, Boxes, PackagePlus, Image as ImageIcon } from 'lucide-vue-next'
import SubPage from '../../../components/mobile/SubPage.vue'
import ScanCamera from '../../../components/mobile/ScanCamera.vue'
import NumberStepper from '../../../components/mobile/NumberStepper.vue'
import MaterialDetail from '../MaterialDetail.vue'
import { useToast } from '../../../composables/toast'
import { confirm } from '../../../composables/confirm'
import {
  matchMaterialsByKeys, createMaterial, createMaterialFiles, stockInOrder, listCategories,
  imagePublicUrl,
} from '../../../lib/db'
import {
  lcscLookup, lcscFetchImage, lcscFileSeeds,
  type LcscComponent,
} from '../../../lib/lcscApi'
import { ensureLcscCategory } from '../../../lib/lcscDraft'
import type { MaterialRow, Category } from '../../../lib/types'
import type { StockOrderItem } from '@/lib/storage/types'

const router = useRouter()
const toast = useToast()

interface ScanItem {
  pc: string
  pm: string
  on: string
  qty: number
  material_id: string | null
  materialName: string
  pending: boolean
  /** 匹配的既有物料整行（用于列表行卡展示缩略图/分类/库存等，参考物料库列表） */
  material?: MaterialRow
  /** 立创商城查得的预览/创建数据：待新建项用于列表展示，并复用到入库建料 */
  lcsc?: LcscComponent
  lcscLoading?: boolean
  lcscErr?: boolean
}

const rawInput = ref('')
const items = ref<ScanItem[]>([])
const busy = ref(false)

const pendingCount = computed(() => items.value.filter(i => i.pending).length)

/** 解析单条扫码串：{on:..,pc:..,pm:..,qty:..} → 字段表（键无引号、值可能为空） */
function parseCode(raw: string): { pc: string; pm: string; on: string; qty: number } | null {
  let s = raw.trim()
  if (s.startsWith('{')) s = s.slice(1)
  if (s.endsWith('}')) s = s.slice(0, -1)
  const map: Record<string, string> = {}
  for (const part of s.split(',')) {
    const idx = part.indexOf(':')
    if (idx < 0) continue
    const k = part.slice(0, idx).trim()
    const v = part.slice(idx + 1).trim()
    if (k) map[k] = v
  }
  const pc = (map.pc || '').trim().toUpperCase()
  if (!pc) return null
  const qty = Number(map.qty)
  return { pc, pm: map.pm || '', on: map.on || '', qty: Number.isFinite(qty) && qty > 0 ? qty : 1 }
}

/** 立创物料编号：C + 纯数字（如 C50313803），用来区分其它平台的条码 */
function isLcscCode(pc: string): boolean {
  return /^C\d+$/.test(pc)
}

/** 批量添加（粘贴多行 / 一次多码）：按 pc 合并，已存在则累加数量；非立创码报错跳过 */
async function addItems(text: string) {
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean)
  if (!lines.length) return
  let added = 0
  let skipped = 0
  for (const line of lines) {
    const p = parseCode(line)
    if (!p) { skipped++; continue }
    if (!isLcscCode(p.pc)) { skipped++; continue }
    const exist = items.value.find(i => i.pc === p.pc)
    if (exist) { exist.qty += p.qty; added++ }
    else items.value.push({ ...p, material_id: null, materialName: '', pending: false })
  }
  if (!added && !items.value.length) {
    toast.error(skipped ? '未识别到有效立创物料编号（应为 C+数字，如 C50313803）' : '没有解析出有效物料编号(pc)')
    return
  }
  if (skipped) toast.warning(`已跳过 ${skipped} 条非立创码`)
  rawInput.value = ''
  await resolveMatches()
}

function addFromText() {
  if (!rawInput.value.trim()) { toast.error('请先粘贴扫码内容'); return }
  void addItems(rawInput.value)
}

/** 用既有物料按 pc 精确匹配，命中则填 material_id/名称，否则标记为待新建 */
async function resolveMatches() {
  const pcs = [...new Set(items.value.map(i => i.pc))]
  if (!pcs.length) return
  const norm = (v?: string | null) => (v || '').trim().toLowerCase()
  try {
    const pool = await matchMaterialsByKeys(pcs)
    const byPc = new Map<string, MaterialRow>()
    for (const m of pool) {
      const nk = norm(m.part_no)
      if (nk) byPc.set(nk, m)
    }
    for (const it of items.value) {
      const hit = byPc.get(norm(it.pc))
      if (hit) {
        it.material_id = hit.id
        it.materialName = hit.name
        it.material = hit
        it.pending = false
      } else {
        it.material_id = null
        it.materialName = ''
        it.material = undefined
        it.pending = true
      }
    }
  } catch {
    // 匹配失败不阻塞：统一先标待新建，确认时再按立创查（查不到也能用最小信息建料）
    for (const it of items.value) { it.material_id = null; it.pending = true }
  }
  // 待新建项：异步拉立创商城数据做列表预览（不阻塞录入）
  void enrichLcsc()
}

/** 立创数据转列表预览行（仅取展示字段；不含本地 id/库存等） */
function lcscPreview(c: LcscComponent): MaterialRow {
  return {
    id: '',
    name: c.name,
    model: c.model,
    brand: c.brand,
    package: c.package,
    part_no: c.part_no,
    image_path: null,
    location: undefined,
    threshold: 0,
    price: 0,
    remark: null,
    categories: c.category ? ({ name: c.category } as any) : undefined,
  } as MaterialRow
}

/**
 * 待新建项：按 pc 拉立创商城数据（复用 PC「导入立创」同一接口 lcscLookup，带缓存），
 * 填到 item 上做列表预览，并缓存供入库建料复用；失败标 lcscErr 走降级最小建料。
 */
async function enrichLcsc() {
  const targets = items.value.filter(i => i.pending && !i.lcsc && !i.lcscErr && !i.lcscLoading)
  if (!targets.length) return
  await Promise.allSettled(targets.map(async it => {
    it.lcscLoading = true
    try {
      const c = await lcscLookup(it.pc)
      it.lcsc = c
      it.material = lcscPreview(c)
    } catch {
      it.lcscErr = true
    } finally {
      it.lcscLoading = false
    }
  }))
}

function remove(pc: string) {
  items.value = items.value.filter(i => i.pc !== pc)
}

/** 行卡缩略图：待新建项用立创远程图，既有物料用本地图 */
function thumbOf(it: ScanItem): string | undefined {
  if (it.lcsc?.image_url) return it.lcsc.image_url
  const p = it.material?.image_path
  return p ? imagePublicUrl(p) : undefined
}

/** 点击已存在物料 → 弹出只读详情（复用 MaterialDetail） */
const selId = ref<string | null>(null)
function openDetail(it: ScanItem) {
  if (it.material_id) selId.value = it.material_id
}
function closeDetail() { selId.value = null }

// 弹窗打开时锁背景滚动（与 ConfirmDialog 一致，避免遮罩上滑动带动底层列表）
watch(selId, v => { document.body.style.overflow = v ? 'hidden' : '' })
onBeforeUnmount(() => { document.body.style.overflow = '' })

/** 重置：清空全部已扫记录（二次确认，避免误触清掉一整批） */
async function resetAll() {
  if (!items.value.length) return
  if (!await confirm({ title: '重置扫码', content: '确定清空当前所有已扫物料？', danger: true, confirmText: '清空' })) return
  items.value = []
  rawInput.value = ''
}

/**
 * 确认入库：已存在走 material_id；待新建先按 pc 查立创建料（查不到用扫码字段最小建料），
 * 再统一 stockInOrder 一张入库单。逻辑对齐导入入库（StockImport.vue）。
 */
async function confirmIn() {
  if (!items.value.length || busy.value) return
  busy.value = true
  try {
    const uniq = [...new Set(items.value.map(i => i.pc))]
    const pool = await matchMaterialsByKeys(uniq)
    const norm = (v?: string | null) => (v || '').trim().toLowerCase()
    const byPc = new Map<string, MaterialRow>()
    for (const m of pool) { const nk = norm(m.part_no); if (nk) byPc.set(nk, m) }

    const cats = await listCategories().catch(() => [] as Category[])
    const orderItems: StockOrderItem[] = []

    for (const it of items.value) {
      let mid = byPc.get(norm(it.pc))?.id ?? null
      if (!mid) {
        // 待新建：复用列表已拉取的立创数据（it.lcsc），无则按 pc 再查；失败降级为最小信息建料
        let lcsc: LcscComponent | null = it.lcsc ?? null
        if (!lcsc) { try { lcsc = await lcscLookup(it.pc) } catch { /* 无网络/未收录，降级 */ } }
        let created: MaterialRow
        if (lcsc) {
          const { major, minor } = await ensureLcscCategory(lcsc, cats)
          let image_path: string | null = null
          if (lcsc.image_url) { try { image_path = await lcscFetchImage(lcsc.image_url) } catch { /* 图片缺失不影响 */ } }
          created = await createMaterial({
            name: lcsc.name || it.pm || it.pc,
            model: lcsc.model || it.pm || null,
            brand: lcsc.brand || null,
            package: lcsc.package || null,
            part_no: it.pc,
            category_id: minor ?? major ?? null,
            threshold: 0,
            price: 0,
            image_path,
            remark: it.on ? `立创订单 ${it.on}` : null,
          })
          if (lcsc.files?.length) await createMaterialFiles(created.id, lcscFileSeeds(lcsc.files)).catch(() => { })
        } else {
          created = await createMaterial({
            name: it.pm || it.pc,
            model: it.pm || null,
            part_no: it.pc,
            threshold: 0,
            remark: it.on ? `立创订单 ${it.on}` : null,
          })
        }
        mid = created.id
      }
      orderItems.push({ material_id: mid, qty: Number(it.qty) || 1 })
    }

    const { order } = await stockInOrder({
      type: 'in',
      source: 'scan_lcsc',
      title: '扫码入库(立创)',
      items: orderItems,
    })
    toast.success(`入库成功（${order.id.slice(0, 8)}）`)
    items.value = []
    rawInput.value = ''
    router.back()
  } catch (e) {
    toast.error('入库失败：' + ((e as Error)?.message || String(e)))
  } finally {
    busy.value = false
  }
}

/* ===== 相机扫码：抽成全屏组件 ScanCamera（参考微信扫码页） ===== */
const cameraOn = ref(false)
function onScan(code: string) { void addItems(code) }
function onScanError(msg: string) { toast.error(msg); cameraOn.value = false }
</script>

<style scoped>
.scan-page {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
  /* 底部固定操作栏占位（重置 + 扫码 + 确认入库） */
  padding: 12px 14px calc(76px + env(safe-area-inset-bottom));
}

/* ===== 录入区（无卡片背景，输入框自身带浅色底） ===== */
.in-card {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.raw {
  width: 100%;
  resize: none;
  border: 1px solid var(--c-border);
  border-radius: var(--r-md);
  background: var(--c-bg-2);
  color: var(--c-text);
  font-family: inherit;
  font-size: var(--fs-sm);
  padding: 10px;
  line-height: 1.5;
}

.raw:focus {
  outline: none;
  border-color: var(--c-primary);
}

.add-btn {
  align-self: flex-end;
  height: 36px;
  padding: 0 20px;
  border: none;
  border-radius: var(--r-md);
  background: var(--c-primary);
  color: #fff;
  font-family: inherit;
  font-size: var(--fs-sm);
  font-weight: 700;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}

.add-btn:active {
  transform: scale(0.97);
}

/* ===== 列表（行卡，参考移动端物料库列表模式） ===== */
.list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 0;
}

/* 与物料库列表同一套：行式布局、点击反馈、底部 hairline 分隔 */
.item.row-item {
  display: flex;
  gap: 10px;
  padding: 8px 0;
  border-bottom: 1px solid var(--c-border-hairline);
  background: transparent;
  cursor: default;
}

.item.row-item.tap {
  cursor: pointer;
}

.item.row-item:last-child {
  border-bottom: none;
}

.item.row-item:active.tap {
  transform: scale(0.99);
}

/* 点在数量步进器/移除按钮等内部控件时，不要触发整行按压缩放 */
.item.row-item:active.tap:has(.stepper:active, .rm:active) {
  transform: none;
}

/* 缩略图（沿用物料库尺寸语言） */
.row-thumb {
  position: relative;
  flex-shrink: 0;
  width: 65px;
  height: 65px;
  border-radius: var(--r-md);
  background: var(--c-glass);
  overflow: hidden;
}

.row-thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.thumb-ph {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  color: var(--c-text-3);
}

.low-tag.sm {
  position: absolute;
  top: 4px;
  left: 4px;
  z-index: 1;
  padding: 1px 6px;
  border-radius: 999px;
  background: var(--c-warning);
  color: #1a1205;
  font-size: 10px;
  font-weight: 600;
  pointer-events: none;
}

.row-body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.row-head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 8px;
}

.row-name {
  margin: 0;
  font-size: var(--fs-sm);
  font-weight: 600;
  line-height: 1.3;
  display: -webkit-box;
  -webkit-line-clamp: 1;
  line-clamp: 1;
  -webkit-box-orient: vertical;
  overflow: hidden;
  flex: 1;
  min-width: 0;
  word-break: break-all;
}

.row-name .row-pn {
  margin-left: 6px;
  font-size: var(--fs-xs);
  font-weight: 400;
  color: var(--c-text-3);
}

.row-qty {
  flex-shrink: 0;
  font-size: var(--fs-sm);
  font-weight: 700;
  color: var(--c-text-2);
  font-variant-numeric: tabular-nums;
}

.row-line2 {
  margin: 0;
  font-size: var(--fs-xs);
  color: var(--c-text-2);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.row-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 2px;
}

.row-tag {
  padding: 1px 7px;
  border-radius: var(--r-pill);
  background: var(--c-bg-2);
  color: var(--c-text-2);
  font-size: 11px;
  font-weight: 500;
  line-height: 1.5;
  white-space: nowrap;
}

.status {
  flex-shrink: 0;
  padding: 2px 8px;
  border-radius: 999px;
  font-size: var(--fs-xs);
  font-weight: 600;
}

.status.ok {
  background: var(--c-primary-soft);
  color: var(--c-primary);
}

.status.warn {
  background: rgba(255, 178, 0, 0.16);
  color: #d99000;
}

.loc {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  font-size: var(--fs-xs);
  color: var(--c-text-3);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
}

/* 右侧：移除 + 数量编辑 */
.row-side {
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  justify-content: space-between;
  gap: 6px;
}

.rm {
  width: 26px;
  height: 26px;
  display: grid;
  place-items: center;
  border: none;
  border-radius: var(--r-sm);
  background: var(--c-bg-2);
  color: var(--c-text-3);
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}

.rm:active {
  color: var(--c-danger);
}

.empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  color: var(--c-text-3);
  font-size: var(--fs-sm);
  text-align: center;
}

/* ===== 底部固定操作栏（参考物料详情 actbar） ===== */
.actbar {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 40;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 14px calc(12px + env(safe-area-inset-bottom));
  background: var(--c-glass-strong);
  backdrop-filter: blur(24px);
  -webkit-backdrop-filter: blur(24px);
  border-top: 1px solid var(--c-border);
  box-shadow: var(--shadow-lg);
}

/* 最左侧重置图标 */
.ibtn {
  flex-shrink: 0;
  width: 42px;
  height: 42px;
  border: 1px solid var(--c-border);
  border-radius: var(--r-md);
  background: var(--c-surface);
  color: var(--c-text-2);
  display: grid;
  place-items: center;
  cursor: pointer;
  padding: 0;
  -webkit-tap-highlight-color: transparent;
}

.ibtn:active {
  color: var(--c-danger);
  border-color: var(--c-danger);
}

/* 内容区顶部右侧统计：图标 + 数字，不进 header */
.content-stat {
  display: flex;
  justify-content: flex-end;
  align-items: center;
  gap: 8px;
  padding: 4px 10px 0;
}

.ts {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  font-size: var(--fs-xs);
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  color: var(--c-text-2);
  white-space: nowrap;
}

.ts svg {
  color: var(--c-text-3);
}

.ts.warn {
  color: #d99000;
}

.ts.warn svg {
  color: #d99000;
}

.abtn {
  flex: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  height: 42px;
  border: none;
  border-radius: var(--r-md);
  font-family: inherit;
  font-size: var(--fs-md);
  font-weight: 700;
  color: #fff;
  cursor: pointer;
  transition: transform 120ms ease-out, opacity var(--motion-fast);
  -webkit-tap-highlight-color: transparent;
}

.abtn.scan {
  background: var(--c-bg-2);
  color: var(--c-text);
  border: 1px solid var(--c-border);
  flex: 1 1 0;
  min-width: 0;
}

.abtn.scan.on {
  color: var(--c-primary);
  border-color: var(--c-primary);
}

.abtn.in {
  flex: 1.8 1 0;
  background: var(--c-primary);
}

.abtn:active {
  transform: scale(0.97);
  opacity: 0.9;
}

.abtn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* ===== 只读详情弹窗（复用物料详情页，风格对齐 ConfirmDialog 移动端 sheet） ===== */
.detail-mask {
  position: fixed;
  inset: 0;
  z-index: 1000;
  background: rgba(0, 0, 0, 0.6);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  display: flex;
  align-items: flex-end;
  justify-content: center;
  padding: 0;
}

.detail-sheet {
  width: 100%;
  max-width: 560px;
  max-height: 90vh;
  display: flex;
  flex-direction: column;
  background: var(--c-elevated);
  border-radius: var(--r-2xl) var(--r-2xl) 0 0;
  border-top: 1px solid var(--c-border-hairline);
  box-shadow: var(--shadow-pop);
  overflow: hidden;
  padding: 0px 6px;
}

/* 顶部把手 + 右上角关闭 X（对齐 ConfirmDialog 视觉语言） */
.sheet-head {
  position: relative;
  flex-shrink: 0;
  height: 30px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.grab {
  width: 36px;
  height: 4px;
  border-radius: 999px;
  background: var(--c-border-strong);
}

.sheet-x {
  position: absolute;
  top: 8px;
  right: 8px;
  width: 28px;
  height: 28px;
  border: none;
  background: transparent;
  color: var(--c-text-3);
  border-radius: var(--r-sm);
  display: grid;
  place-items: center;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  transition: background-color var(--motion-fast), color var(--motion-fast);
}

.sheet-x:active {
  background: var(--c-glass);
  color: var(--c-text);
}

/* 弹窗内物料详情整页占满 sheet 并可滚动 */
.detail-sheet :deep(.mpage) {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}

/* 过渡：遮罩淡入 + 底部上滑（与 ConfirmDialog 同套） */
.detail-enter-active,
.detail-leave-active {
  transition: opacity 200ms ease;
}

.detail-enter-active .detail-sheet,
.detail-leave-active .detail-sheet {
  transition: transform 240ms cubic-bezier(0.22, 1, 0.36, 1);
}

.detail-enter-from,
.detail-leave-to {
  opacity: 0;
}

.detail-enter-from .detail-sheet,
.detail-leave-to .detail-sheet {
  transform: translateY(100%);
}

.spinner-sm {
  width: 15px;
  height: 15px;
  border: 2px solid rgba(255, 255, 255, 0.5);
  border-top-color: #fff;
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg)
  }
}
</style>
