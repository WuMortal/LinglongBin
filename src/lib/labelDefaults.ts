// 标签模板的默认值与归一化工具。
// 放在 lib 下（而非某个 store 内），供 SQLite / Supabase 两套 store 共用——
// 两边对同一条记录必须算出同样的结果，否则切换数据源后模板会变形。
import type { LabelTemplate, LabelBlock, LabelSheetLayout } from './types'

/**
 * 默认纸张 / 排版参数：A4 纸 + 88×116mm 不干胶，3 列 × 8 行 24×12mm 小卡。
 * 取自贴纸打印工具的出厂设置。
 */
export function DEFAULT_LABEL_LAYOUT(): LabelSheetLayout {
  return {
    paper: 'A4', paper_w: 210, paper_h: 297,
    sheet_w: 88, sheet_h: 116,
    cols: 3, rows: 8,
    pad: 3, gap_w: 5, gap_h: 2,
    pos_mode: 'center', off_x: 0, off_y: 0,
    scale_fix: 1, guides: false, auto_fill: false,
  }
}

/** 缺省模板：一个 2×2 栅格，「名称」占上整行，型号 / 封装各占下半行左右 */
export function DEFAULT_LABEL_BLOCKS(): LabelBlock[] {
  return [
    { id: 'b-name', type: 'field', x: 0, y: 0, w: 2, h: 1, field: 'name', align: 'left', valign: 'middle', auto_shrink: true },
    { id: 'b-model', type: 'field', x: 0, y: 1, w: 1, h: 1, field: 'model', prefix: '型号 ', align: 'left', valign: 'middle', auto_shrink: true },
    { id: 'b-pkg', type: 'field', x: 1, y: 1, w: 1, h: 1, field: 'package', prefix: ' ', align: 'right', valign: 'middle', auto_shrink: true },
  ]
}

/** 归一化：补齐 JSON 列缺失字段（旧数据 / 手工编辑 / 跨端同步都可能缺） */
export function normalizeTemplate(t: Partial<LabelTemplate>): LabelTemplate {
  return {
    id: t.id || '',
    owner: t.owner || '',
    name: t.name || '未命名模板',
    width_mm: num(t.width_mm, 24),
    height_mm: num(t.height_mm, 12),
    grid_rows: Math.max(1, Math.round(num(t.grid_rows, 2))),
    grid_cols: Math.max(1, Math.round(num(t.grid_cols, 2))),
    cats: Array.isArray(t.cats) ? t.cats : [],
    default_font_pt: num(t.default_font_pt, 6),
    layout: { ...DEFAULT_LABEL_LAYOUT(), ...(t.layout || {}) },
    is_default: !!t.is_default,
    created_at: t.created_at || '',
    deleted_at: t.deleted_at ?? null,
  }
}

function num(v: unknown, fallback: number): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}

/** 主表可用字段（块取值字段的固定选项；分类参数用 param:<key> 表示） */
export const FIXED_FIELDS: Array<{ value: string; label: string }> = [
  { value: 'name', label: '名称' },
  { value: 'model', label: '型号' },
  { value: 'brand', label: '品牌' },
  { value: 'package', label: '封装' },
  { value: 'part_no', label: '商品编号' },
  { value: 'location', label: '库位' },
  { value: 'category_minor', label: '分类' },
  { value: 'qty', label: '库存数量' },
  { value: 'price', label: '单价' },
  { value: 'id', label: '物料 ID' },
]
