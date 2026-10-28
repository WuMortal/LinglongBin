/**
 * 键盘避让（H5 / Tauri Android WebView 通用）。
 *
 * 背景：Tauri v2 Android 默认 edge-to-edge，系统键盘是浮层盖上来的，
 * 布局视口不会收缩 —— 于是 manifest 的 adjustResize 与 viewport 的
 * interactive-widget=resizes-content 都失效，浏览器不会自动把聚焦的
 * 输入框滚出键盘区，输入框被键盘盖住。
 *
 * 方案：监听 window.visualViewport，键盘弹出（视口高度明显变小）时，
 * 把当前聚焦的 input/textarea 精确滚动到「视觉视口内可见」，只滚
 * 最近的可滚动祖先（.content / 底部弹层的 .bs-body 等都能覆盖）。
 */
const KB_THRESHOLD = 120 // 布局高度与视觉视口高度差超过此值，视为键盘弹出
const GAP = 16 // 输入框与键盘/视口顶部的间距

/** 需要避让的字段：textarea + 文本类 input（跳过勾选/滑块/文件等无键盘控件） */
const NO_KB_TYPES = new Set([
  'checkbox', 'radio', 'range', 'submit', 'button', 'file', 'color',
  'date', 'time', 'month', 'week', 'datetime-local',
])
function isTextField(el: Element | null): el is HTMLElement {
  if (!el) return false
  const tag = el.tagName
  if (tag === 'TEXTAREA') return true
  if (tag !== 'INPUT') return false
  const type = (el as HTMLInputElement).type
  return !NO_KB_TYPES.has(type)
}

function activeField(): HTMLElement | null {
  const el = document.activeElement
  return isTextField(el) ? el : null
}

/** 找最近的可滚动祖先（沿 DOM 向上，直到body）；找不到返回 null（交给页面级滚动） */
function scrollParent(el: HTMLElement): HTMLElement | null {
  let node: HTMLElement | null = el.parentElement
  while (node && node !== document.body && node !== document.documentElement) {
    const style = getComputedStyle(node)
    const oy = style.overflowY
    if ((oy === 'auto' || oy === 'scroll') && node.scrollHeight > node.clientHeight + 1) {
      return node
    }
    node = node.parentElement
  }
  return null
}

/** 键盘高度：布局视口与视觉视口的高度差（0 = 键盘未弹出） */
function keyboardHeight(): number {
  const vv = window.visualViewport
  if (!vv) return 0
  return Math.max(0, window.innerHeight - vv.height)
}

/** 把聚焦字段滚到键盘上方可见区：只滚需要的量，避免整块跳动 */
function ensureFieldVisible() {
  const el = activeField()
  if (!el) return
  // 等一帧，确保键盘已开始、布局稳定
  requestAnimationFrame(() => {
    const vv = window.visualViewport
    const vh = vv ? vv.height : window.innerHeight
    const offsetTop = vv ? vv.offsetTop : 0
    // 可见区下沿（键盘上沿）
    const bottomLimit = offsetTop + vh - GAP
    // 可见区上沿（避开吸顶工具区，给个顶部间距）
    const topLimit = offsetTop + GAP
    const rect = el.getBoundingClientRect()

    const scroller = scrollParent(el)
    if (scroller) {
      // 底部被键盘盖住 → 往下滚；顶部被遮 → 往上滚
      if (rect.bottom > bottomLimit) {
        scroller.scrollTop += rect.bottom - bottomLimit
      } else if (rect.top < topLimit) {
        scroller.scrollTop -= topLimit - rect.top
      }
    } else {
      // 页面级滚动（body 滚动场景）
      const dy = rect.bottom > bottomLimit
        ? rect.bottom - bottomLimit
        : (rect.top < topLimit ? rect.top - topLimit : 0)
      if (dy) window.scrollBy(0, dy)
    }
  })
}

let installed = false

export function installKeyboardAvoid() {
  if (installed) return
  installed = true

  // 聚焦即尝试就位：键盘弹出有 ~250ms 动画，先立即一次（应对键盘已开/再次聚焦），
  // 再延迟一次（应对键盘正在弹出）。
  document.addEventListener('focusin', (e) => {
    if (!isTextField(e.target as Element)) return
    ensureFieldVisible()
    window.setTimeout(ensureFieldVisible, 280)
  }, true)

  const vv = window.visualViewport
  if (vv) {
    let lastOpen = false
    const onResize = () => {
      const open = keyboardHeight() > KB_THRESHOLD
      if (open !== lastOpen) {
        lastOpen = open
        document.body.classList.toggle('kb-open', open)
      }
      // 键盘弹出/高度变化时，若正聚焦输入框，重新就位
      if (open) ensureFieldVisible()
    }
    vv.addEventListener('resize', onResize)
    vv.addEventListener('scroll', onResize)
  }

  // 失焦时若键盘收起，清理状态类
  document.addEventListener('focusout', () => {
    window.setTimeout(() => {
      if (keyboardHeight() <= KB_THRESHOLD) document.body.classList.remove('kb-open')
    }, 120)
  })
}
