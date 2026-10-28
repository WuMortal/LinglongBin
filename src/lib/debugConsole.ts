/**
 * 调试控制台（vConsole）开关管理。
 * 默认关闭；通过「关于」页连点版本号 10 次开启（或手动调用 setDebugMode）。
 * 状态持久化在 localStorage，应用启动时由 loadDebugMode() 读取并据此挂载。
 * vConsole 仅在开启时才动态加载，保证默认（关闭）情况下不引入任何运行时代码。
 */
import { ref } from 'vue'

const DEBUG_KEY = 'llv-debug-console'

/** 响应式调试开关，组件可直接用于模板 */
export const debugMode = ref(false)

let vc: { destroy: () => void } | null = null
let loading: Promise<void> | null = null

/** 应用启动时调用一次：读取持久化开关并据此初始化 vConsole */
export async function loadDebugMode(): Promise<void> {
  const on = localStorage.getItem(DEBUG_KEY) === '1'
  debugMode.value = on
  if (on) await ensureVConsole()
}

async function ensureVConsole(): Promise<void> {
  if (vc || loading) return loading ?? Promise.resolve()
  loading = import('vconsole')
    .then(({ default: VConsole }) => {
      vc = new VConsole()
      loading = null
    })
    .catch(err => {
      loading = null
      console.error('[debug] vConsole 加载失败', err)
    })
  return loading
}

/** 设置调试模式：开 → 动态加载并挂载 vConsole；关 → 销毁 */
export async function setDebugMode(on: boolean): Promise<void> {
  debugMode.value = on
  try {
    localStorage.setItem(DEBUG_KEY, on ? '1' : '0')
  } catch {
    /* localStorage 不可用时忽略，仅影响本次会话记忆 */
  }
  if (on) {
    await ensureVConsole()
  } else if (vc) {
    vc.destroy()
    vc = null
  }
}

/** 取反当前调试开关 */
export function toggleDebugMode(): Promise<void> {
  return setDebugMode(!debugMode.value)
}
