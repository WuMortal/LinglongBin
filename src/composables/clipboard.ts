/**
 * 复制文本到剪贴板。
 * 优先用异步 Clipboard API；在无安全上下文（如 Tauri webview / http 访问）下会失败，
 * 此时回退到 textarea + execCommand，保证各端都能复制成功。
 */
export async function copyText(text: string | null | undefined): Promise<boolean> {
  const t = (text ?? '').toString()
  if (!t.trim()) return false
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(t)
      return true
    }
  } catch {
    /* 走下面的回退方案 */
  }
  try {
    const ta = document.createElement('textarea')
    ta.value = t
    ta.setAttribute('readonly', '')
    // 脱离文档流、不可见，避免复制时页面滚动跳动
    ta.style.position = 'fixed'
    ta.style.top = '-1000px'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(ta)
    return ok
  } catch {
    return false
  }
}
