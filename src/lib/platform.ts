// 判断运行平台：桌面（PC/Mac/Linux）→ 侧栏；移动（Android/iOS）→ 底部 Tab
// 不依赖 @tauri-apps/plugin-os（需额外安装），改用 Tauri 注入标志 + UA 判断。
// 浏览器开发环境用视口宽度兜底。

export interface PlatformInfo {
  kind: 'desktop' | 'mobile'
  os: string
  isTauri: boolean
}

let cached: PlatformInfo | null = null

/** 桌面浏览器强制预览移动端的开关键（真机由 UA 判定，无需设置） */
const FORCE_MOBILE_KEY = 'llb.force-mobile'

function forceMobile(): boolean {
  try { return localStorage.getItem(FORCE_MOBILE_KEY) === '1' } catch { return false }
}

/**
 * npm script 用 `vite --mode mobile|desktop` 指定的外壳（见 package.json 的 dev:mobile / dev:desktop），
 * 优先级高于自动探测，方便在桌面浏览器里直接预览移动端而不用改窗口宽度。
 * 只在显式指定时生效：默认的 development / production 模式返回 null，真机与打包都不受影响。
 */
function modeOverride(): 'desktop' | 'mobile' | null {
  const mode: string = import.meta.env.MODE
  if (mode === 'mobile') return 'mobile'
  if (mode === 'desktop') return 'desktop'
  return null
}

/**
 * 开关「桌面浏览器内预览移动端」：写入 localStorage 后刷新生效，并清掉探测缓存。
 * 必须是唯一判定来源 —— Shell 选择（App.vue）与路由镜像（router.ts 守卫）都读 getPlatformSync，
 * 之前在 App.vue 里写死 isDesktop 会让外壳走移动、路由仍按桌面放行，从而渲染出桌面页面。
 */
export function setMobilePreview(on: boolean): void {
  try {
    if (on) localStorage.setItem(FORCE_MOBILE_KEY, '1')
    else localStorage.removeItem(FORCE_MOBILE_KEY)
  }
  catch { /* 隐私模式下 localStorage 不可写，忽略 */ }
  cached = null
}

/** 同步探测（UA / 注入标志 / 视口均为同步可得）。App 首帧渲染前使用，避免移动端先闪桌面壳。 */
export function getPlatformSync(): PlatformInfo {
  if (cached) return cached
  const ua = navigator.userAgent || ''
  const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
  const mobileUA = /Android|iPhone|iPad|iPod/i.test(ua)

  // 优先级：npm script 的 --mode > Tauri 真机 UA > 浏览器 localStorage 开关 / 视口宽度
  const forced = modeOverride()
  const kind: 'desktop' | 'mobile' = forced
    ?? (isTauri
      ? (mobileUA ? 'mobile' : 'desktop')
      : (forceMobile() || window.matchMedia('(max-width: 820px)').matches ? 'mobile' : 'desktop'))

  cached = { kind, os: isTauri ? (mobileUA ? 'android/ios' : 'desktop') : 'web', isTauri }
  return cached
}

export async function getPlatform(): Promise<PlatformInfo> {
  return getPlatformSync()
}
