// 随心标签：自由编辑内容的贴纸打印工具。
// 与「标签模板 / 标签打印」不同——它不绑定物料字段，每格内容就是用户手打的一段文字，
// 纸张排版参数与 LabelTemplates 的「纸张与排版」保持同一套口径。
// 内容存 localStorage：随手写随打的临时画布，不进业务库、不参与同步。
import type { FreeLabelLayout, FreeLabelState } from './types'

const KEY = 'llv-free-label-v1'

/** 标准纸张尺寸（mm）；CUSTOM 用 layout 里的 paper_w / paper_h */
export const PAPER_SIZES: Record<string, [number, number]> = {
  A4: [210, 297], A5: [148, 210], LETTER: [216, 279],
}

export const PAPER_OPTIONS = [
  { value: 'A4', label: 'A4 210×297' },
  { value: 'A5', label: 'A5 148×210' },
  { value: 'LETTER', label: 'Letter 216×279' },
  { value: 'CUSTOM', label: '自定义' },
]

/** 出厂参数：取自贴纸打印工具的默认设置 */
export function DEFAULT_FREE_LAYOUT(): FreeLabelLayout {
  return {
    paper: 'A4', paper_w: 210, paper_h: 297,
    label_w: 24, label_h: 12,
    cols: 1, rows: 1,
    pad: 3, gap_w: 5, gap_h: 2,
    off_x: 0, off_y: 0,
    scale_fix: 1, guides: false,
    font_pt: 8,
    reflow: 'keep',
    ph_mode: 'hover',
    calib: false,
    zoom: 0.7,
  }
}

export function DEFAULT_FREE_STATE(): FreeLabelState {
  return { pages: [], layout: DEFAULT_FREE_LAYOUT() }
}

/**
 * 每页格子数上限。
 * 每个格子在屏幕上是一个 textarea（打印区还再渲染一份），且要在改动后重算行高；
 * 一旦上千个，重排 + 整体重渲染会把页面卡死（改标签尺寸时尤其明显，输入过程中会经过很小的值）。
 */
export const MAX_CELLS_PER_PAGE = 600

/** 纸张实际尺寸（mm） */
export function paperSize(L: FreeLabelLayout): [number, number] {
  if (L.paper === 'CUSTOM') return [L.paper_w || 210, L.paper_h || 297]
  return PAPER_SIZES[L.paper] ?? [L.paper_w || 210, L.paper_h || 297]
}

/**
 * 每页能放多少 列×行：纸张减去留白，再按「标签尺寸 + 间距」取最大可容纳数。
 * 手工填列行容易超出纸张被裁，所以一律自动算（与标签模板的「纸张与排版」一致）。
 */
export function computeGrid(L: FreeLabelLayout): { cols: number; rows: number } {
  const [pw, ph] = paperSize(L)
  const innerW = Math.max(0, pw - 2 * L.pad)
  const innerH = Math.max(0, ph - 2 * L.pad)
  const dw = (L.label_w || 1) + L.gap_w
  const dh = (L.label_h || 1) + L.gap_h
  return {
    cols: dw > 0 ? Math.max(1, Math.floor((innerW + L.gap_w) / dw)) : 1,
    rows: dh > 0 ? Math.max(1, Math.floor((innerH + L.gap_h) / dh)) : 1,
  }
}

/** 标签区（含四周留白）实际占用尺寸：用于页面居中与校准页虚线框 */
export function usedSize(L: FreeLabelLayout): { w: number; h: number } {
  return {
    w: 2 * L.pad + L.cols * L.label_w + Math.max(0, L.cols - 1) * L.gap_w,
    h: 2 * L.pad + L.rows * L.label_h + Math.max(0, L.rows - 1) * L.gap_h,
  }
}

/**
 * 按每页上限收敛行列：超出时先减行、再减列（保持从左到右的阅读行不被切碎）。
 * 与 computeGrid 分开是有意的 —— 后者是纯粹的几何计算，收敛是性能兜底，只在应用时生效。
 */
export function clampGrid(cols: number, rows: number, max = MAX_CELLS_PER_PAGE): { cols: number; rows: number } {
  let c = Math.max(1, Math.round(cols))
  let r = Math.max(1, Math.round(rows))
  while (c * r > max && r > 1) r--
  while (c * r > max && c > 1) c--
  return { cols: c, rows: r }
}

/** 每页格子数 */
export function perPage(L: FreeLabelLayout): number {
  return Math.max(1, Math.round(L.cols)) * Math.max(1, Math.round(L.rows))
}

/** 把数组补齐 / 截断到指定长度 */
export function padCells(arr: string[], n: number): string[] {
  const out = arr.slice(0, n)
  while (out.length < n) out.push('')
  return out
}

/**
 * 按新的每页格子数重整页面结构（每页格数变化时必须跑一次，否则页面数据与网格错位）。
 * - reflow=keep：内容全部保留且顺序不变，自动增 / 减页；
 * - reflow=trim：页数不变，超出容量的尾部内容丢弃。
 * 返回重整后的页数。
 */
export function reflowPages(state: FreeLabelState, next: number): number {
  const flat = state.pages.flat()
  const per = Math.max(1, next)
  const out: string[][] = []
  if (state.layout.reflow === 'trim') {
    for (let i = 0; i < state.pages.length; i++) {
      out.push(padCells(flat.slice(i * per, i * per + per), per))
    }
  } else {
    for (let i = 0; i < Math.max(flat.length, per); i += per) {
      out.push(padCells(flat.slice(i, i + per), per))
    }
  }
  state.pages = out.length ? out : [Array(per).fill('')]
  return state.pages.length
}

/** 把所有页面拉平成一维文本的起始下标 —— 追加填充时从这里往后写 */
export function firstEmptyIndex(state: FreeLabelState): number {
  const flat = state.pages.flat()
  const i = flat.findIndex(v => !v)
  return i < 0 ? flat.length : i
}

function num(v: unknown, fallback: number): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}

/** 读取本地存档（首次 / 解析失败走出厂参数） */
export function loadFreeState(): FreeLabelState {
  const fallback = DEFAULT_FREE_STATE()
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return fallback
    const s = JSON.parse(raw) as Partial<FreeLabelState>
    const layout: FreeLabelLayout = {
      ...fallback.layout,
      ...(s.layout ?? {}),
    } as FreeLabelLayout
    // 归一化：负值与非法值会让 CSS 尺寸失效，全部夹回可用范围
    ;(['paper_w', 'paper_h', 'label_w', 'label_h', 'cols', 'rows'] as const).forEach(k => {
      layout[k] = Math.max(1, num(layout[k], 1))
    })
    ;(['pad', 'gap_w', 'gap_h'] as const).forEach(k => {
      layout[k] = Math.max(0, num(layout[k], 0))
    })
    layout.font_pt = Math.min(24, Math.max(4, num(layout.font_pt, 8)))
    layout.scale_fix = Math.max(0.5, num(layout.scale_fix, 1))
    layout.zoom = Math.min(1.5, Math.max(0.3, num(layout.zoom, 0.7)))
    layout.off_x = num(layout.off_x, 0)
    layout.off_y = num(layout.off_y, 0)
    if (!PAPER_SIZES[layout.paper] && layout.paper !== 'CUSTOM') layout.paper = 'A4'
    if (!['keep', 'trim'].includes(layout.reflow)) layout.reflow = 'keep'
    if (!['hover', 'always', 'none'].includes(layout.ph_mode)) layout.ph_mode = 'hover'

    const g = computeGrid(layout)
    layout.cols = g.cols
    layout.rows = g.rows

    const per = perPage(layout)
    const pagesRaw = Array.isArray(s.pages) ? s.pages : []
    const pages = pagesRaw.map(p => padCells(Array.isArray(p) ? p.map(v => (v == null ? '' : String(v))) : [], per))
    const state: FreeLabelState = { layout, pages: pages.length ? pages : [Array(per).fill('')] }
    return state
  } catch {
    return fallback
  }
}

/** 写入本地存档（失败不影响使用，仅丢失缓存） */
export function saveFreeState(s: FreeLabelState): void {
  try { localStorage.setItem(KEY, JSON.stringify(s)) } catch (e) { console.warn('[freeLabel] 保存失败', e) }
}

export function clearFreeState(): void {
  try { localStorage.removeItem(KEY) } catch { /* 忽略 */ }
}
