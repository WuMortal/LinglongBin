// 判断运行平台：桌面（PC/Mac/Linux）→ 侧栏；移动（Android/iOS）→ 底部 Tab
// 不依赖 @tauri-apps/plugin-os（需额外安装），改用 Tauri 注入标志 + UA 判断。
// 浏览器开发环境用视口宽度兜底。

export interface PlatformInfo {
  kind: 'desktop' | 'mobile'
  os: string
  isTauri: boolean
}

let cached: PlatformInfo | null = null

export async function getPlatform(): Promise<PlatformInfo> {
  if (cached) return cached
  const ua = navigator.userAgent || ''
  const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
  const mobileUA = /Android|iPhone|iPad|iPod/i.test(ua)

  const kind: 'desktop' | 'mobile' = isTauri
    ? (mobileUA ? 'mobile' : 'desktop')
    : (window.matchMedia('(max-width: 820px)').matches ? 'mobile' : 'desktop')

  cached = { kind, os: isTauri ? (mobileUA ? 'android/ios' : 'desktop') : 'web', isTauri }
  return cached
}
