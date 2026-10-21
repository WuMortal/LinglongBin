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

      <!-- 相机取景：html5-qrcode 会把 <video> 注入到这里 -->
      <div id="scan-reader" class="scan-cam" />

      <div class="scan-frame" :class="{ hit: flashOn }">
        <i class="c tl" /><i class="c tr" /><i class="c bl" /><i class="c br" />
        <div class="scan-line" />
      </div>

      <p class="scan-tip">{{ tip }}</p>

      <!-- 启动失败兜底 -->
      <div v-if="failed" class="scan-fail">
        <p>无法启动相机</p>
        <button class="abtn" type="button" @click="close">返回</button>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { X, Flashlight } from 'lucide-vue-next'

const emit = defineEmits<{
  (e: 'detected', code: string): void
  (e: 'close'): void
  (e: 'error', msg: string): void
}>()

// 标题与提示可由外部传入，方便复用在其他扫码场景
const props = withDefaults(defineProps<{
  title?: string
  tip?: string
}>(), {
  title: '扫码入库',
  tip: '将立创物料条码对准取景框，可连续扫码',
})

// 运行期对象，html5-qrcode 动态加载，用 any 避免其类型与调用点摩擦
let scanner: any = null
let resumeTimer: number | undefined
const torchOn = ref(false)
const flashOn = ref(false)
const failed = ref(false)

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
          const s = Math.floor(Math.min(vw, vh) * 0.7)
          return { width: s, height: s }
        },
      },
      (decoded: string) => onDetected(decoded),
      () => { /* 每帧未识别，忽略 */ },
    )
  } catch {
    failed.value = true
    emit('error', '无法启动相机，请手动粘贴内容')
  }
}

/** 命中一条：上报父组件、给个命中反馈，并短暂停顿避免同一条码被连刷计入 */
function onDetected(decoded: string) {
  emit('detected', decoded)
  flashOn.value = true
  window.setTimeout(() => { flashOn.value = false }, 320)
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
  try { if (scanner) { await scanner.stop(); await scanner.clear() } } catch { /* */ }
  scanner = null
}

function close() { emit('close') }

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
}
.scan-cam :deep(video) {
  width: 100% !important;
  height: 100% !important;
  object-fit: cover;
}
/* 隐藏库自带的取景遮罩框，用我们自己的扫描框 */
.scan-cam :deep(.qr-shaded-region) {
  border: none !important;
  box-shadow: none !important;
}

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
.ic.on { color: #ffd54a; }

/* 取景框：四角 + 扫描线 */
.scan-frame {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: 70vw;
  height: 70vw;
  max-width: 320px;
  max-height: 320px;
  z-index: 2;
}
.c {
  position: absolute;
  width: 22px;
  height: 22px;
  border: 0 solid var(--c-primary, #4F8CFF);
}
.tl { top: 0; left: 0; border-top-width: 3px; border-left-width: 3px; border-top-left-radius: 6px; }
.tr { top: 0; right: 0; border-top-width: 3px; border-right-width: 3px; border-top-right-radius: 6px; }
.bl { bottom: 0; left: 0; border-bottom-width: 3px; border-left-width: 3px; border-bottom-left-radius: 6px; }
.br { bottom: 0; right: 0; border-bottom-width: 3px; border-right-width: 3px; border-bottom-right-radius: 6px; }
.scan-frame.hit .c { border-color: #fff; }

.scan-line {
  position: absolute;
  left: 0;
  right: 0;
  top: 0;
  height: 2px;
  background: linear-gradient(90deg, transparent, var(--c-primary, #4F8CFF), transparent);
  box-shadow: 0 0 8px var(--c-primary-glow, rgba(79, 140, 255, 0.35));
  animation: scanMove 2.2s linear infinite;
}
.scan-frame.hit .scan-line {
  background: linear-gradient(90deg, transparent, #fff, transparent);
  box-shadow: 0 0 12px #fff;
}
@keyframes scanMove {
  0% { top: 0; opacity: 0; }
  10% { opacity: 1; }
  90% { opacity: 1; }
  100% { top: 100%; opacity: 0; }
}

.scan-tip {
  position: absolute;
  left: 0;
  right: 0;
  bottom: calc(env(safe-area-inset-bottom, 0px) + 28px);
  z-index: 2;
  margin: 0;
  padding: 0 24px;
  text-align: center;
  font-size: var(--fs-sm, 13px);
  color: rgba(255, 255, 255, 0.85);
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
