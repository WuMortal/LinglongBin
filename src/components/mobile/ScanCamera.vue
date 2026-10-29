<template>
  <Teleport to="body">
    <div class="scan-mask">
      <!-- 顶部工具条：关闭 / 标题 / 闪光灯（悬浮在取景之上） -->
      <div class="scan-top">
        <button class="ic" type="button" @click="close">
          <X :size="24" style="display: inline-flex; flex-shrink: 0" />
        </button>
        <span class="title">{{ title }}</span>
        <button class="ic" type="button" :class="{ on: torchOn }" @click="toggleTorch">
          <Flashlight :size="22" style="display: inline-flex; flex-shrink: 0" />
        </button>
      </div>

      <!-- 顶部统计行：已扫码 n 次 + 调用方传入的业务统计（匹配/待新建…），通用不耦合物料 -->
      <div v-if="scannedCount > 0 || stat" class="scan-stat">
        已扫码 {{ scannedCount }} 次<span v-if="stat">，{{ stat }}</span>
      </div>

      <!-- 相机取景：html5-qrcode 会把 <video> 和它自带的取景遮罩（跟着 qrbox 走）注入到这里 -->
      <div id="scan-reader" class="scan-cam" @click="onCamTap" />

      <!-- 点击对焦的反馈圈：出现在触点，一次脉冲后消失 -->
      <div v-if="focusRing" :key="focusRing.id" class="focus-ring"
        :style="{ left: focusRing.x + 'px', top: focusRing.y + 'px' }" />

      <!-- 命中即时反馈：绿勾 + 文案，约 0.9s 淡出，与解码停顿同步 -->
      <Transition name="scan-flash">
        <div v-if="flash.show" class="scan-flash" :class="`sf-${flash.type}`">
          <Check v-if="flash.type === 'success'" :size="20" style="display: inline-flex; flex-shrink: 0" />
          <span>{{ flash.text }}</span>
        </div>
      </Transition>

      <p class="scan-tip">{{ tip }}</p>

      <!-- 底部圆 X：退出扫码（系统返回键也能退回上一页） -->
      <button class="scan-close" type="button" aria-label="退出扫码" @click="close">
        <X :size="26" style="display: inline-flex; flex-shrink: 0" />
      </button>

      <!-- 右下角：切换摄像头（多摄像头机型才显示） -->
      <button v-if="camList.length > 1" class="cam-switch" type="button" :class="{ on: camPickerOpen }"
        aria-label="切换摄像头" @click="camPickerOpen = !camPickerOpen">
        <SwitchCamera :size="20" style="display: inline-flex; flex-shrink: 0" />
      </button>
      <Transition name="cam-pick">
        <div v-if="camPickerOpen && camList.length" class="cam-picker">
          <button v-for="c in camList" :key="c.id" type="button" class="cam-opt" :class="{ on: c.id === activeCamId }"
            @click="switchCamera(c.id)">
            {{ camFriendly(c.label) }}
          </button>
        </div>
      </Transition>

      <!-- 失败提示带上具体原因（权限 / 被占用 / 无摄像头…），便于照提示处理 -->
      <div v-if="failed" class="scan-fail">
        <p>{{ failMsg || '无法启动相机' }}</p>
        <button class="abtn" type="button" @click="close">返回</button>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { X, Flashlight, Check, SwitchCamera } from 'lucide-vue-next'

const emit = defineEmits<{
  (e: 'detected', code: string): void
  (e: 'close'): void
  (e: 'error', msg: string): void
}>()

// 标题与提示可由外部传入，方便复用在其他扫码场景
const props = withDefaults(defineProps<{
  title?: string
  tip?: string
  /** 业务统计行（取景框上方一行）：如「匹配物料 y 件，待新建物料 x 件」，
   *  由调用方按自身语义传入；组件只负责拼上内部自增的「已扫码 n 次」。 */
  stat?: string
}>(), {
  title: '扫码入库',
  tip: '将立创物料条码对准取景框，可连续扫码',
  stat: '',
})

// 运行期对象，html5-qrcode 动态加载，用 any 避免其类型与调用点摩擦
let scanner: any = null
let resumeTimer: number | undefined
const torchOn = ref(false)
/** 摄像头列表（供右下角切换）与当前激活项、选择器展开态 */
const camList = ref<Array<{ id: string; label: string }>>([])
const activeCamId = ref('')
const camPickerOpen = ref(false)
/** 把 "camera2 4, facing back" 之类翻译成「后置 4」这种可读名 */
function camFriendly(label: string): string {
  if (!label) return '摄像头'
  return label
    .replace(/camera2\s+(\d+)/i, '$1')
    .replace(/facing back/i, '后置')
    .replace(/facing front/i, '前置')
    .replace(/,/g, ' ')
    .trim()
}
const failed = ref(false)
const failMsg = ref('')
/** 累计命中次数（内部自增，与业务无关，任何扫码场景都能用） */
const scannedCount = ref(0)

/** 命中提示：贴着取景框即时反馈（绿勾「识别成功」），与解码停顿同步淡出 */
type FlashType = 'success' | 'error' | 'warning'
const flash = ref<{ show: boolean; text: string; type: FlashType }>({ show: false, text: '', type: 'success' })
let flashTimer: number | undefined
function showFlash(type: FlashType, text: string, ms = 900) {
  flash.value = { show: true, text, type }
  clearTimeout(flashTimer)
  flashTimer = window.setTimeout(() => { flash.value.show = false }, ms)
}

/* ===== 点击对焦 ===== */
/** 对焦反馈圈：出现在触点，一次脉冲后消失（key 变化重放动画） */
const focusRing = ref<{ id: number; x: number; y: number } | null>(null)
let focusRingId = 0
let focusRingTimer: number | undefined
let resumeFocusTimer: number | undefined

function showFocusRing(x: number, y: number) {
  focusRingId++
  focusRing.value = { id: focusRingId, x, y }
  clearTimeout(focusRingTimer)
  focusRingTimer = window.setTimeout(() => { focusRing.value = null }, 650)
}

/** 当前运行轨道的能力：走库自己的接口（与闪光灯同一条路径），比挖 <video>.srcObject 可靠 */
function runningCaps(): { focusMode?: string[]; focusDistance?: { min: number; max: number } } {
  if (!scanner) return {}
  try { return (scanner.getRunningTrackCapabilities?.() ?? {}) } catch { return {} }
}

/** 触点坐标 → 归一化到取景区（0..1），作为对焦兴趣点 */
function norm(v: number, size: number): number {
  return Math.min(1, Math.max(0, v / Math.max(1, size)))
}

/**
 * 探测设备是否「真的」支持网页对焦：切到 manual 后读回 track 设置，看 focusMode 是否生效。
 * 有些安卓 WebView 在 getCapabilities() 里报了 focusMode，但 applyConstraints 后被相机静默忽略，
 * 这种「假支持」才会让点击只剩动画、不清。探测一次并缓存，避免每次点击都探测。
 */
let focusProbed: boolean | null = null
async function probeFocus(): Promise<boolean> {
  if (focusProbed !== null || !scanner) return focusProbed === true
  const set = (c: Record<string, unknown>) => scanner!.applyVideoConstraints({ advanced: [c] })
  try {
    // 先只切 manual 看设置是否生效（不带距离，避免 min 限制造成误判）
    await set({ focusMode: 'manual' })
    let ok = (scanner!.getRunningTrackSettings?.() ?? {} as { focusMode?: string }).focusMode === 'manual'
    if (!ok) {
      // 退一步：带上 focusDistance:0 再试（部分设备手动对焦要求给定距离）
      await set({ focusMode: 'manual', focusDistance: 0 }).catch(() => { })
      ok = (scanner!.getRunningTrackSettings?.() ?? {} as { focusMode?: string }).focusMode === 'manual'
    }
    focusProbed = ok
    // 还原为连续对焦（设备不支持时这步会抛错，忽略即可）
    await set({ focusMode: 'continuous' }).catch(() => { })
    return ok
  } catch {
    focusProbed = false
    return false
  }
}

/** 点击取景区：先探测是否真能对焦，不支持就给诚实提示（不放误导性对焦圈） */
async function onCamTap(e: MouseEvent) {
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
  const ok = await probeFocus()
  if (!ok) {
    showFlash('warning', '当前设备不支持触屏对焦', 1200)
    return
  }
  showFocusRing(e.clientX, e.clientY)
  const caps = runningCaps()
  const modes: string[] = caps.focusMode || []
  void applyFocus(caps, modes, e.clientX - rect.left, e.clientY - rect.top, rect.width, rect.height)
}

/** 逐级退化地对焦：点对焦 → 触发一次自动对焦 → 手动对焦距离（按触点上下映射远近） */
async function applyFocus(
  caps: { focusDistance?: { min: number; max: number } },
  modes: string[], px: number, py: number, w: number, h: number,
) {
  if (!scanner) return
  const poi = [{ x: norm(px, w), y: norm(py, h) }]
  try {
    // 1) 点对焦（支持 pointsOfInterest 的设备）
    await scanner.applyVideoConstraints({ advanced: [{ focusMode: 'single-shot', pointsOfInterest: poi }] })
  } catch {
    try {
      // 2) 退化：不设兴趣点，触发一次自动对焦
      await scanner.applyVideoConstraints({ advanced: [{ focusMode: 'single-shot' }] })
    } catch {
      // 3) 再退化：手动对焦距离（上部=远/下部=近，仅部分设备支持 focusDistance）
      if (caps.focusDistance && modes.includes('manual')) {
        const { min, max } = caps.focusDistance
        const d = min + (py / Math.max(1, h)) * (max - min)
        try { await scanner.applyVideoConstraints({ advanced: [{ focusMode: 'manual', focusDistance: d }] }) }
        catch { return }
      } else {
        return
      }
    }
  }
  // 扫码目标会移动：稍后恢复连续对焦
  clearTimeout(resumeFocusTimer)
  if (modes.includes('continuous')) {
    resumeFocusTimer = window.setTimeout(() => {
      try { void scanner?.applyVideoConstraints({ advanced: [{ focusMode: 'continuous' }] }) } catch { /* */ }
    }, 3000)
  }
}

function fail(msg: string) {
  failed.value = true
  failMsg.value = msg
  emit('error', msg)
}

/**
 * 把相机启动失败翻译成「用户能照着操作」的提示。
 * 不同环境失败原因差别很大（尤其手机），笼统一句话根本没法排查。
 */
function cameraErrorMsg(e: unknown): string {
  // 环境级：优先判断（此时 name 往往也是 NotAllowedError，会误导）
  if (typeof window !== 'undefined' && !window.isSecureContext) {
    return '浏览器禁止在非安全上下文调用摄像头：请用 HTTPS 或 localhost 打开（http + 局域网 IP 不行）'
  }
  if (typeof navigator === 'undefined' || !navigator.mediaDevices) {
    return '当前环境不支持调用摄像头（navigator.mediaDevices 不可用），请换用 Safari / Chrome 原生浏览器'
  }

  if (String(e).indexOf("NotFoundError") >= 0) {
    return '摄像头未找到，请检查设备及权限'
  }

  const name = (e as { name?: string })?.name || ''
  return `无法启动相机（${e})`;
}

/**
 * 启动相机扫码（html5-qrcode，动态加载；无相机/无权限时优雅降级）。
 * 注意：getUserMedia 只在安全上下文可用 —— Tauri 安卓包的源是 http://tauri.localhost，
 * 属非安全上下文，浏览器会直接挡掉；手机浏览器用局域网 IP（http://192.168.x.x）同理。
 * 若在包内不可用，需另走原生相机（见历史实现：tauri-plugin-barcode-scanner）。
 */
async function pickRearCameraId(Html5Qrcode: any): Promise<string | undefined> {
  try {
    const cams: Array<{ id: string; label: string }> = await Html5Qrcode.getCameras()
    if (!cams?.length) return undefined
    const rear = cams
      .map(c => ({
        id: c.id,
        label: c.label || '',
        idx: Number(/camera2\s+(\d+)/.exec(c.label || '')?.[1] ?? 999),
      }))
      .filter(c => /back|rear|environment|后置|背面/i.test(c.label))
      .sort((a, b) => a.idx - b.idx)
    return rear[0]?.id
  } catch {
    return undefined
  }
}

async function start() {
  try {
    const mod: any = await import('html5-qrcode')
    const Html5Qrcode = mod.Html5Qrcode
    await nextTick()
    scanner = new Html5Qrcode('scan-reader')
    // 用确定性后置摄像头 deviceId 启动（取 camera2 序号最大的后置，避免 WebView 挑到广角）
    const camId = await pickRearCameraId(Html5Qrcode)
    await scanner.start(
      camId ?? { facingMode: 'environment' },
      {
        fps: 10,
        qrbox: (vw: number, vh: number) => {
          const s = Math.floor(Math.min(vw, vh) * 0.8)
          return { width: s, height: s }
        },
        aspectRatio: 1.0,
        // 关键：高清视频配置
        videoConstraints: {
          facingMode: { ideal: 'environment' }, // 优先后置摄像头
          width: { min: 720, ideal: 1920, max: 3840 }, // 理想1080P，最高支持4K
          height: { min: 720, ideal: 1080, max: 2160 },
          focusMode: { ideal: 'continuous' }, // 持续自动对焦
          advanced: [{ zoom: 1.2 }] // 光学变焦，放大二维码（移动端支持度较好）
        }
      },
      (decoded: string) => onDetected(decoded),
      () => { /* 每帧未识别，忽略 */ },
    )
    // 填充摄像头列表供右下角切换（只列后置，避免切到前置扫不了码），并记录当前激活项
    try {
      const list = await Html5Qrcode.getCameras()
      camList.value = (list ?? []).filter(c => /back|rear|environment|后置|背面/i.test(c.label || ''))
      if (camId) {
        activeCamId.value = camId
      } else {
        const s = scanner.getRunningTrackSettings?.() as { deviceId?: string } | undefined
        activeCamId.value = s?.deviceId ?? camList.value[0]?.id ?? ''
      }
    } catch { /* 取不到列表就不显示切换按钮 */ }
  } catch (e) {
    fail(cameraErrorMsg(e))
  }
}

/** 切换摄像头：停掉当前流，用新 deviceId 重启（html5-qrcode 重启标准做法） */
async function switchCamera(id: string) {
  camPickerOpen.value = false
  if (!scanner || id === activeCamId.value) return
  try {
    await scanner.stop()
    await scanner.clear()
    await scanner.start(id, {
      fps: 10,
      qrbox: (vw: number, vh: number) => {
        const s = Math.floor(Math.min(vw, vh) * 0.8)
        return { width: s, height: s }
      },
    }, (decoded: string) => onDetected(decoded), () => { /* 每帧未识别，忽略 */ })
    activeCamId.value = id
    focusProbed = null // 不同相机对焦能力可能不同，重置探测缓存
  } catch (e) {
    fail(cameraErrorMsg(e))
  }
}

/**
 * 命中一条：上报父组件，并短暂停顿避免同一条码被连刷计入。
 * 视觉反馈由库自己完成（#qr-shaded-region 的白色角标命中时变绿）。
 */
function onDetected(decoded: string) {
  scannedCount.value++
  showFlash('success', '识别成功')
  emit('detected', decoded)
  if (!scanner) return
  try { scanner.pause(true) } catch { /* */ }
  clearTimeout(resumeTimer)
  resumeTimer = window.setTimeout(() => {
    try { scanner?.resume() } catch { /* */ }
  }, 1200)
}

async function toggleTorch() {
  if (!scanner) return
  const on = !torchOn.value
  try {
    await scanner.applyVideoConstraints({ advanced: [{ torch: on }] })
    torchOn.value = on
  } catch { /* 设备不支持闪光灯，忽略 */ }
}

async function stop() {
  clearTimeout(resumeTimer)
  clearTimeout(flashTimer)
  clearTimeout(focusRingTimer)
  clearTimeout(resumeFocusTimer)
  try { if (scanner) { await scanner.stop(); await scanner.clear() } } catch { /* */ }
  scanner = null
  focusProbed = null
  camList.value = []
  activeCamId.value = ''
  camPickerOpen.value = false
}

function close() {
  emit('close')
}

onMounted(start)
onBeforeUnmount(stop)
</script>

<style scoped>
.scan-mask {
  position: fixed;
  inset: 0;
  z-index: 1000;
  background: #000;
  overflow: hidden;
}

/* 取景层铺满全屏 */
.scan-cam {
  position: absolute;
  inset: 0;
  z-index: 1;
  top: 130px;
}

.scan-cam :deep(video) {
  width: 100% !important;
  height: 100% !important;
  object-fit: cover;
}

/* 点击对焦反馈圈：以触点为中心的一次脉冲（left/top 即视口坐标） */
.focus-ring {
  position: absolute;
  z-index: 2;
  width: 72px;
  height: 72px;
  margin: -36px 0 0 -36px;
  border: 2px solid #ffd54a;
  border-radius: 50%;
  pointer-events: none;
  animation: focus-pulse 0.6s ease-out forwards;
}

@keyframes focus-pulse {
  0% {
    transform: scale(1.5);
    opacity: 0;
  }

  35% {
    transform: scale(1);
    opacity: 1;
  }

  100% {
    transform: scale(0.88);
    opacity: 0;
  }
}

/* 取景遮罩用库自带的（#qr-shaded-region，跟着 qrbox 走，命中时角标会变绿），
   不再自绘框——自绘位置和实际解码区对不上，反而误导 */

/* 顶部工具条 */
.scan-top {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  z-index: 3;
  height: calc(52px + env(safe-area-inset-top, 0px));
  padding: env(safe-area-inset-top, 0px) 12px 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: linear-gradient(180deg, rgba(0, 0, 0, 0.55), transparent);
  color: #fff;
}

.scan-top .title {
  font-size: 15px;
  font-weight: 600;
}

.ic {
  width: 40px;
  height: 40px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.35);
  color: #fff;
}

.ic.on {
  color: #ffd54a;
}

/* 顶部统计行：取景框上方一行，居中显示 */
.scan-stat {
  position: absolute;
  top: calc(52px + env(safe-area-inset-top, 0px));
  left: 0;
  right: 0;
  z-index: 3;
  padding: 6px 16px 0;
  text-align: center;
  font-size: var(--fs-sm, 13px);
  font-weight: 600;
  color: #fff;
  text-shadow: 0 1px 3px rgba(0, 0, 0, 0.6);
  pointer-events: none;
}

.scan-tip {
  position: absolute;
  left: 0;
  right: 0;
  bottom: calc(env(safe-area-inset-bottom, 0px) + 96px);
  z-index: 2;
  margin: 0;
  padding: 0 24px;
  text-align: center;
  font-size: var(--fs-sm, 13px);
  color: rgba(255, 255, 255, 0.85);
}

/* 底部圆 X：退出扫码 */
.scan-close {
  position: absolute;
  left: 50%;
  bottom: calc(env(safe-area-inset-bottom, 0px) + 24px);
  transform: translateX(-50%);
  z-index: 3;
  width: 52px;
  height: 52px;
  display: grid;
  place-items: center;
  border: 1px solid rgba(255, 255, 255, 0.35);
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.4);
  color: #fff;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  transition: transform 120ms ease, background-color 120ms ease;
}

.scan-close:active {
  transform: translateX(-50%) scale(0.92);
  background: rgba(0, 0, 0, 0.6);
}

/* 右下角：切换摄像头 */
.cam-switch {
  position: absolute;
  right: calc(env(safe-area-inset-right, 0px) + 20px);
  bottom: calc(env(safe-area-inset-bottom, 0px) + 24px);
  z-index: 3;
  width: 44px;
  height: 44px;
  display: grid;
  place-items: center;
  border: 1px solid rgba(255, 255, 255, 0.35);
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.4);
  color: #fff;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  transition: transform 120ms ease, background-color 120ms ease;
}

.cam-switch.on,
.cam-switch:active {
  background: rgba(0, 0, 0, 0.6);
  transform: scale(0.92);
}

/* 摄像头列表：锚在右下角按钮上方弹出 */
.cam-picker {
  position: absolute;
  right: calc(env(safe-area-inset-right, 0px) + 20px);
  bottom: calc(env(safe-area-inset-bottom, 0px) + 78px);
  z-index: 4;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 6px;
  border-radius: 14px;
  background: rgba(20, 20, 22, 0.82);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
  max-width: 60vw;
}

.cam-opt {
  flex-shrink: 0;
  padding: 9px 14px;
  border: none;
  border-radius: 9px;
  background: transparent;
  color: rgba(255, 255, 255, 0.82);
  font-size: var(--fs-sm);
  font-family: inherit;
  white-space: nowrap;
  text-align: left;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}

.cam-opt.on {
  background: var(--c-primary);
  color: #fff;
}

.cam-opt:active {
  background: rgba(255, 255, 255, 0.16);
}

.cam-opt.on:active {
  background: var(--c-primary);
  opacity: 0.9;
}

.cam-pick-enter-active,
.cam-pick-leave-active {
  transition: opacity 0.16s ease, transform 0.16s ease;
}

.cam-pick-enter-from,
.cam-pick-leave-to {
  opacity: 0;
  transform: translateY(8px) scale(0.96);
}

/* 命中即时反馈：贴取景框居中的绿勾胶囊，短暂停顿后淡出 */
.scan-flash {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  z-index: 4;
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 10px 18px;
  border-radius: 999px;
  font-size: var(--fs-sm, 13px);
  font-weight: 600;
  color: #fff;
  background: rgba(22, 22, 24, 0.72);
  border: 1px solid rgba(255, 255, 255, 0.14);
  box-shadow: 0 6px 24px rgba(0, 0, 0, 0.35);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  pointer-events: none;
}

.scan-flash.sf-success {
  color: #d6ffe9;
  border-color: rgba(52, 211, 153, 0.45);
}

.scan-flash.sf-success :deep(svg) {
  color: #34d399;
}

.scan-flash.sf-warning {
  color: #ffe9c2;
  border-color: rgba(255, 179, 71, 0.45);
}

.scan-flash.sf-error {
  color: #ffd2d9;
  border-color: rgba(255, 92, 114, 0.45);
}

.scan-flash-enter-active,
.scan-flash-leave-active {
  transition: opacity 0.2s ease, transform 0.2s ease;
}

.scan-flash-enter-from,
.scan-flash-leave-to {
  opacity: 0;
  transform: translate(-50%, -50%) scale(0.9);
}

.scan-fail {
  position: absolute;
  inset: 0;
  z-index: 5;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16px;
  background: #000;
  color: #fff;
}

.scan-fail .abtn {
  padding: 10px 28px;
  border: none;
  border-radius: 999px;
  background: var(--c-primary, #4F8CFF);
  color: #fff;
  font-size: 15px;
  font-weight: 600;
}
</style>
