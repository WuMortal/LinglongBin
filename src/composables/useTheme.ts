// 主题管理：支持 light / dark / auto（跟随系统）
import { ref, onMounted, onBeforeUnmount } from 'vue'

export type ThemeMode = 'light' | 'dark' | 'auto'
export type ResolvedTheme = 'light' | 'dark'

const STORAGE_KEY = 'llv-theme'
const theme = ref<ThemeMode>('auto')
const resolved = ref<ResolvedTheme>('light')
let media: MediaQueryList | null = null
let mediaHandler: ((e: MediaQueryListEvent) => void) | null = null
let initialized = false

/** 读取系统当前是否深色 */
function systemPrefersDark(): boolean {
  return typeof window !== 'undefined'
    && window.matchMedia
    && window.matchMedia('(prefers-color-scheme: dark)').matches
}

/** 计算实际生效主题 */
function resolve(mode: ThemeMode): ResolvedTheme {
  if (mode === 'auto') return systemPrefersDark() ? 'dark' : 'light'
  return mode
}

/** 将主题应用到 <html data-theme> */
function apply(r: ResolvedTheme) {
  if (typeof document === 'undefined') return
  document.documentElement.setAttribute('data-theme', r)
}

/** 初始化（仅一次）：读取本地存储，应用主题，并监听系统变化 */
function init() {
  if (initialized) return
  initialized = true
  const saved = (localStorage.getItem(STORAGE_KEY) as ThemeMode | null) || 'auto'
  theme.value = saved
  resolved.value = resolve(saved)
  apply(resolved.value)

  if (typeof window !== 'undefined' && window.matchMedia) {
    media = window.matchMedia('(prefers-color-scheme: dark)')
    mediaHandler = () => {
      if (theme.value !== 'auto') return
      resolved.value = systemPrefersDark() ? 'dark' : 'light'
      apply(resolved.value)
    }
    media.addEventListener('change', mediaHandler)
  }
}

/** 切换主题（持久化） */
function setTheme(t: ThemeMode) {
  theme.value = t
  localStorage.setItem(STORAGE_KEY, t)
  resolved.value = resolve(t)
  apply(resolved.value)
}

export function useTheme() {
  onMounted(() => { init() })
  onBeforeUnmount(() => {
    // 组件卸载不取消监听，主题是全局生命周期
  })
  return { theme, resolved, setTheme }
}

/** 供 main/App 早期调用，避免等待组件 mount */
export function initTheme() {
  init()
}
