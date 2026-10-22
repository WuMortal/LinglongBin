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
      <div id="scan-reader" class="scan-cam" />

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
import { X, Flashlight, Check } from 'lucide-vue-next'

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

  // switch (name) {
  //   case 'NotAllowedError':
  //   case 'PermissionDeniedError':
  //   case 'SecurityError':
  //     return '相机权限被拒绝：请在浏览器弹窗允许，或在系统设置里给浏览器/本应用开启摄像头'
  //   case 'NotFoundError':
  //   case 'DevicesNotFoundError':
  //     return '没找到可用摄像头'
  //   case 'OverconstrainedError':
  //     return '没有后置摄像头，或不满足后置摄像头的约束'
  //   case 'NotReadableError':
  //   case 'TrackStartError':
  //     return '摄像头被其它应用占用，请关闭其它相机应用后重试'
  //   case 'AbortError':
  //     return '摄像头启动被中断，请重试'
  //   default:
  //     return `无法启动相机（${name || '未知错误'}）：${(e as { message?: string })?.message || ''}`
  // }
  return `无法启动相机（${e})`;
}

/**
 * 启动相机扫码（html5-qrcode，动态加载；无相机/无权限时优雅降级）。
 * 注意：getUserMedia 只在安全上下文可用 —— Tauri 安卓包的源是 http://tauri.localhost，
 * 属非安全上下文，浏览器会直接挡掉；手机浏览器用局域网 IP（http://192.168.x.x）同理。
 * 若在包内不可用，需另走原生相机（见历史实现：tauri-plugin-barcode-scanner）。
 */
async function start() {
  try {
    const mod: any = await import('html5-qrcode')
    const Html5Qrcode = mod.Html5Qrcode
    await nextTick()
    scanner = new Html5Qrcode('scan-reader')
    await scanner.start(
      { facingMode: 'environment' },
      {
        fps: 10,
        qrbox: (vw: number, vh: number) => {
          const s = Math.floor(Math.min(vw, vh) * 0.8)
          return { width: s, height: s }
        },
      },
      (decoded: string) => onDetected(decoded),
      () => { /* 每帧未识别，忽略 */ },
    )
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
  try { if (scanner) { await scanner.stop(); await scanner.clear() } } catch { /* */ }
  scanner = null
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
