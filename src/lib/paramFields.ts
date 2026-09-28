// 分类参数与主表字段的映射。
// 部分分类模板会配「型号 / 品牌 / 封装」这类参数，它们同时是 materials 表的主表字段：
//   · 写入：两条建料路径（一键匹配立创 / 新增物料表单）共用同一份填充逻辑，
//           保证这些参数一定落库，且与主表列取值一致
//   · 展示：卡片规格行、抽屉扩展参数列表要过滤掉，否则会和已单独展示的
//           型号 / 品牌 / 封装重复
export type MappableField = 'model' | 'brand' | 'package'

/**
 * 参数 → 主表字段。
 * 立创模板按显示名匹配（它的 key 是 queryProductGradePlateId 这类 LCSC 查询键），
 * 自定义模板按键名兜底。
 */
export const PARAM_FIELD_MAP: Record<string, MappableField> = {
  '品牌': 'brand', '封装': 'package', '封装/规格': 'package', '型号': 'model',
  brand: 'brand', package: 'package', model: 'model',
}

/** 取参数对应的主表字段（key 优先、name 兜底）；非主表字段参数返回 undefined */
export function mappedFieldOf(p: { key: string; name?: string | null }): MappableField | undefined {
  return PARAM_FIELD_MAP[p.key] ?? PARAM_FIELD_MAP[(p.name || '').trim()]
}

/**
 * 过滤掉「主表字段参数」，返回 [key, value] 列表（已剔除空值）。
 *
 * - 传 template：按参数的 key / name 精确判断（推荐；立创模板只能靠中文名识别）
 * - 传 fieldValues：按「参数值 == 主表字段值」兜底，用于拿不到模板的场景（如首页卡片）。
 *   写入侧已保证两者一致，所以这个比对是可靠的
 */
/**
 * 物料卡片副行（小字）：品牌 + 前 3 个扩展字段值。
 *
 * 品牌放最前；扩展字段用 filterFieldParams 剔除与「型号 / 品牌 / 封装」重复的主表字段参数
 * （因此品牌不会重复出现）。两者都没有时回退显示 封装 / 库位。
 * 物料库卡片、标签打印的选择弹框与已选列表共用，保证各处显示一致。
 */
export function materialSpecLine(m: {
  params?: Record<string, unknown> | null
  brand?: string | null
  model?: string | null
  package?: string | null
  location?: string | null
}): string {
  const spec = filterFieldParams(m.params, { fieldValues: [m.model, m.brand, m.package] }).map(([, v]) => v)
  const parts = [m.brand ?? '', ...spec].filter(Boolean).slice(0, 4)
  if (parts.length) return parts.join(' · ')
  return [m.package, m.location ? `库位 ${m.location}` : ''].filter(Boolean).join(' · ') || '—'
}

export function filterFieldParams(
  params: Record<string, unknown> | null | undefined,
  ctx: {
    template?: { key: string; name?: string | null }[]
    fieldValues?: (string | null | undefined)[]
  } = {},
): [string, string][] {
  const tpl = ctx.template ? new Map(ctx.template.map(p => [p.key, p])) : null
  const vals = (ctx.fieldValues ?? [])
    .filter(v => v != null && String(v).trim() !== '')
    .map(v => String(v).trim())
  return Object.entries(params || {})
    .filter(([, v]) => v != null && String(v).trim() !== '')
    .map(([k, v]) => [k, String(v).trim()] as [string, string])
    .filter(([k, v]) => {
      if (tpl) {
        const p = tpl.get(k)
        if (p && mappedFieldOf(p)) return false
      }
      if (PARAM_FIELD_MAP[k]) return false
      return !vals.includes(v)
    })
}
