<template>
  <SubPage title="扫码入库(立创)">
    <div class="scan-page">
      <!-- 录入区：扫码相机 + 手动粘贴（相机在 WebView/桌面可能不可用，手动是可靠路径） -->
      <section class="card in-card">
        <button class="scan-btn" :class="{ on: cameraOn }" @click="toggleCamera">
          <ScanLine :size="18" style="display: inline-flex; flex-shrink: 0" />
          {{ cameraOn ? '关闭相机' : '扫码' }}
        </button>
        <textarea v-model="rawInput" class="raw" rows="3"
          placeholder="粘贴扫码内容（可多行，每行一条）：{on:SO..,pc:C50313803,pm:AMS1117-3.3OE,qty:20,...}" />
        <button class="add-btn" @click="addFromText">添加</button>
      </section>

      <!-- 相机预览（条件渲染，元素存在后才会初始化扫码器） -->
      <section v-if="cameraOn" class="cam-wrap">
        <div id="scan-reader" class="cam" />
        <p class="cam-tip">将立创物料条码对准取景框，可连续扫码</p>
      </section>

      <!-- 已扫列表 -->
      <section v-if="items.length" class="list">
        <article v-for="it in items" :key="it.pc" class="item" :class="{ pending: it.pending }">
          <div class="i-top">
            <span class="pc">{{ it.pc }}</span>
            <button class="rm" title="移除" @click="remove(it.pc)">
              <X :size="14" style="display: inline-flex; flex-shrink: 0" />
            </button>
          </div>
          <p class="pm">{{ it.pm || '（无型号）' }}</p>
          <div class="i-bottom">
            <label class="qty">
              <span>数量</span>
              <input v-model.number="it.qty" type="number" min="1" inputmode="numeric" />
            </label>
            <span class="tag" :class="it.pending ? 'warn' : 'ok'">
              {{ it.pending ? '待新建' : '已存在' }}
            </span>
          </div>
          <p v-if="!it.pending" class="mname">{{ it.materialName }}</p>
        </article>
      </section>

      <p v-else class="empty">
        <ScanLine :size="26" style="display: inline-flex; flex-shrink: 0" />
        <span>还没有扫码记录，扫码或粘贴内容后点「添加」</span>
      </p>

      <!-- 底部确认（始终可见，非 fixed，避免页面过渡 transform 跳动） -->
      <div class="footbar">
        <span class="sum">共 {{ items.length }} 项 · 待新建 {{ pendingCount }}</span>
        <button class="submit" :disabled="!items.length || busy" @click="confirmIn">
          <span v-if="busy" class="spinner-sm" />
          {{ busy ? '入库中…' : '确认入库' }}
        </button>
      </div>
    </div>
  </SubPage>
</template>

<script setup lang="ts">
import { ref, computed, nextTick, onBeforeUnmount } from 'vue'
import { useRouter } from 'vue-router'
import { ScanLine, X } from 'lucide-vue-next'
import SubPage from '../../../components/mobile/SubPage.vue'
import { useToast } from '../../../composables/toast'
import {
  matchMaterialsByKeys, createMaterial, createMaterialFiles, stockInOrder, listCategories,
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

/** 批量添加（粘贴多行 / 一次多码）：按 pc 合并，已存在则累加数量 */
async function addItems(text: string) {
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean)
  if (!lines.length) return
  let added = 0
  for (const line of lines) {
    const p = parseCode(line)
    if (!p) continue
    const exist = items.value.find(i => i.pc === p.pc)
    if (exist) { exist.qty += p.qty; added++ }
    else items.value.push({ ...p, material_id: null, materialName: '', pending: false })
  }
  if (!added && !items.value.length) { toast.error('没有解析出有效物料编号(pc)'); return }
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
        it.pending = false
      } else {
        it.material_id = null
        it.materialName = ''
        it.pending = true
      }
    }
  } catch {
    // 匹配失败不阻塞：统一先标待新建，确认时再按立创查（查不到也能用最小信息建料）
    for (const it of items.value) { it.material_id = null; it.pending = true }
  }
}

function remove(pc: string) {
  items.value = items.value.filter(i => i.pc !== pc)
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
        // 待新建：查立创补全，失败降级为最小信息建料
        let lcsc: LcscComponent | null = null
        try { lcsc = await lcscLookup(it.pc) } catch { /* 无网络/未收录，降级 */ }
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
          if (lcsc.files?.length) await createMaterialFiles(created.id, lcscFileSeeds(lcsc.files)).catch(() => {})
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

/* ===== 相机扫码（html5-qrcode，按需动态加载；无相机/无权限时优雅降级） ===== */
const cameraOn = ref(false)
// eslint 风格：html5-qrcode 动态加载，运行期对象用 any 避免其类型与调用点摩擦
let scanner: any = null

async function toggleCamera() {
  if (cameraOn.value) { await stopCamera(); return }
  try {
    const mod: any = await import('html5-qrcode')
    const Html5Qrcode = mod.Html5Qrcode
    cameraOn.value = true
    await nextTick()
    scanner = new Html5Qrcode('scan-reader')
    await scanner.start(
      { facingMode: 'environment' },
      { fps: 10, qrbox: { width: 240, height: 240 } },
      (decoded: string) => { void addItems(decoded) },
      () => { /* 每帧未识别，忽略 */ },
    )
  } catch {
    cameraOn.value = false
    scanner = null
    toast.error('无法启动相机，请手动粘贴内容')
  }
}

async function stopCamera() {
  try { if (scanner) { await scanner.stop(); await scanner.clear() } } catch { /* 忽略 */ }
  scanner = null
  cameraOn.value = false
}

onBeforeUnmount(stopCamera)
</script>

<style scoped>
.scan-page {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 12px 14px;
}

.card {
  background: var(--c-surface);
  border: 1px solid var(--c-border);
  border-radius: var(--r-lg);
  padding: 12px;
}

/* ===== 录入区 ===== */
.in-card {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.scan-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  align-self: flex-start;
  height: 38px;
  padding: 0 16px;
  border: 1px solid var(--c-border);
  border-radius: var(--r-md);
  background: var(--c-bg-2);
  color: var(--c-text);
  font-family: inherit;
  font-size: var(--fs-sm);
  font-weight: 600;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}
.scan-btn.on { color: var(--c-primary); border-color: var(--c-primary); }

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
.raw:focus { outline: none; border-color: var(--c-primary); }

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
.add-btn:active { transform: scale(0.97); }

/* ===== 相机 ===== */
.cam-wrap { display: flex; flex-direction: column; gap: 6px; }
.cam {
  width: 100%;
  height: 240px;
  border-radius: var(--r-lg);
  overflow: hidden;
  background: #000;
}
.cam-tip {
  margin: 0;
  font-size: var(--fs-xs);
  color: var(--c-text-3);
  text-align: center;
}

/* ===== 列表 ===== */
.list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.item {
  background: var(--c-surface);
  border: 1px solid var(--c-border);
  border-radius: var(--r-lg);
  padding: 10px 12px;
}
.item.pending { border-color: rgba(255, 178, 0, 0.45); }

.i-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.pc {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: var(--fs-md);
  font-weight: 700;
  color: var(--c-text);
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
.pm {
  margin: 4px 0 8px;
  font-size: var(--fs-sm);
  color: var(--c-text-2);
}

.i-bottom {
  display: flex;
  align-items: center;
  gap: 12px;
}
.qty {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: var(--fs-xs);
  color: var(--c-text-3);
}
.qty input {
  width: 72px;
  height: 32px;
  padding: 0 10px;
  border: 1px solid var(--c-border);
  border-radius: var(--r-md);
  background: var(--c-bg-2);
  color: var(--c-text);
  font-family: inherit;
  font-size: var(--fs-md);
  font-variant-numeric: tabular-nums;
}
.qty input:focus { outline: none; border-color: var(--c-primary); }

.tag {
  margin-left: auto;
  padding: 3px 8px;
  border-radius: 999px;
  font-size: var(--fs-xs);
  font-weight: 600;
}
.tag.ok { background: var(--c-primary-soft); color: var(--c-primary); }
.tag.warn { background: rgba(255, 178, 0, 0.16); color: #d99000; }

.mname {
  margin: 8px 0 0;
  font-size: var(--fs-xs);
  color: var(--c-text-3);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
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

/* ===== 底部确认 ===== */
.footbar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding-top: 4px;
}
.sum {
  font-size: var(--fs-xs);
  color: var(--c-text-2);
  flex: 1;
  min-width: 0;
}
.submit {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  height: 44px;
  padding: 0 22px;
  border: none;
  border-radius: var(--r-lg);
  background: var(--c-primary);
  color: #fff;
  font-family: inherit;
  font-size: var(--fs-md);
  font-weight: 700;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}
.submit:disabled { opacity: 0.5; cursor: not-allowed; }

.spinner-sm {
  width: 15px;
  height: 15px;
  border: 2px solid rgba(255, 255, 255, 0.5);
  border-top-color: #fff;
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg) } }
</style>
