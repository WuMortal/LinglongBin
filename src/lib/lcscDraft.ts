// 立创数据 → 待创建物料草稿。
// 「新增物料表单（立创预填）」与「一键匹配立创」共用这里的逻辑，保证两条路径
// 产出的草稿结构一致（分类定位、参数回填、图片落地、附件排序）。
import { createCategory, getCategoryParams } from './db'
import type { Category, MaterialDraft } from './types'
import { mappedFieldOf } from './paramFields'
import {
  lcscFileSeeds, lcscMainFile, lcscFileTaggedName,
  type LcscComponent,
} from './lcscApi'
import { LCSC_CATEGORIES } from './lcscCategories'
import type { LcscParam } from './lcscCategories'

/**
 * 按立创分类编码定位本地分类。
 * productTypeCode（如 439）即本地分类表的 lcsc_id，命中即可同时得到小类与其大类；
 * 未命中再按分类名匹配小类；都失败则留空由用户手选。
 */
export function matchLcscCategory(
  lcsc: LcscComponent,
  categories: Category[],
): { major: string | null; minor: string | null } {
  const code = Number(lcsc.category_code)
  if (Number.isFinite(code) && code > 0) {
    const hit = categories.find(c => c.lcsc_id === code)
    if (hit) {
      return hit.parent ? { major: hit.parent, minor: hit.id } : { major: hit.id, minor: null }
    }
  }
  const name = (lcsc.category || '').trim()
  if (name) {
    const byName = categories.find(c => c.parent && c.name === name)
    if (byName) return { major: byName.parent, minor: byName.id }
  }
  return { major: null, minor: null }
}

/** 立创参数表体积大，按需动态加载（与「一键导入立创分类」一致，不进主包） */
async function loadLcscParams(): Promise<Record<number, LcscParam[]>> {
  const mod = await import('./lcscParams')
  return mod.LCSC_PARAMS
}

/** 按立创小类编码在立创分类树里定位所属大类与小类 */
function findLcscNode(code: number) {
  for (const m of LCSC_CATEGORIES) {
    const sub = m.children.find(c => c.id === code)
    if (sub) return { majorName: m.name, majorLcscId: m.id, minorName: sub.name }
  }
  return null
}

/** 兜底大类名称：立创分类树查不到时归入此大类 */
const OTHER_MAJOR = '其他'

/**
 * 立创分类树里查不到的分类（新分类 / 数据未覆盖）：统一归入「其他」大类，
 * 「其他」大类不存在则创建；小类用立创返回的分类名（无则「其他」），已存在则复用，
 * 保证同一来源的物料归到一处，不会散落成大量未分类。
 */
async function ensureOtherCategory(
  lcsc: LcscComponent,
  categories: Category[],
): Promise<{ major: string | null; minor: string | null }> {
  // 大类：找已有的「其他」，没有就创建
  let major = categories.find(c => !c.parent && c.name === OTHER_MAJOR)
  if (!major) {
    major = await createCategory({ name: OTHER_MAJOR, parent: null, lcsc_id: null })
    categories.push(major)
  }
  // 小类：优先用立创分类名，没有则叫「其他」；同一大类下同名直接复用
  const minorName = (lcsc.category || '').trim() || OTHER_MAJOR
  let minor = categories.find(c => c.parent === major.id && c.name === minorName)
  if (!minor) {
    const code = Number(lcsc.category_code)
    minor = await createCategory({
      name: minorName,
      parent: major.id,
      // 带上立创编码：后续同编码的物料可直接命中该小类，不再重复建
      lcsc_id: Number.isFinite(code) && code > 0 ? code : null,
    })
    categories.push(minor)
  }
  return { major: major.id, minor: minor.id }
}

/**
 * 本地分类表没有该立创分类时，按立创分类树补齐「大类 + 小类 + 参数模板」，
 * 使原先匹配不上分类的物料也能自动落到正确分类（不必先手动全量导入）。
 * 新建的分类并入传入的 categories，同一批次后续行可直接命中，避免重复创建。
 * 建失败不影响建料，返回原匹配结果由用户手选。
 */
export async function ensureLcscCategory(
  lcsc: LcscComponent,
  categories: Category[],
): Promise<{ major: string | null; minor: string | null }> {
  const hit = matchLcscCategory(lcsc, categories)
  // 已命中（哪怕只是命中到大类）就不再新建，避免同一 lcsc_id 建出重复分类
  if (hit.minor || hit.major) return hit

  const code = Number(lcsc.category_code)
  const hasCode = Number.isFinite(code) && code > 0
  const node = hasCode ? findLcscNode(code) : null
  // 立创分类树里查不到（新分类 / 数据未覆盖）：归入「其他」大类，不再直接放弃
  if (!node) {
    // 既无编码也无分类名，确实无从归类，才保持原行为（留空由用户手选）
    if (!hasCode && !(lcsc.category || '').trim()) return hit
    return await ensureOtherCategory(lcsc, categories)
  }

  // 大类：本地已有同名 / 同编码则复用，否则新建
  let major = categories.find(c => !c.parent && (c.lcsc_id === node.majorLcscId || c.name === node.majorName))
  if (!major) {
    major = await createCategory({ name: node.majorName, parent: null, lcsc_id: node.majorLcscId ?? null })
    categories.push(major)
  }
  // 小类：挂到大类下并写入立创参数模板
  const params = (await loadLcscParams())[code] ?? []
  const minor = await createCategory({
    name: node.minorName, parent: major.id, lcsc_id: code,
    params: JSON.stringify(params),
  })
  categories.push(minor)
  return { major: major.id, minor: minor.id }
}

/**
 * 用立创规格参数填充分类参数模板（两条建料路径共用，保证写入一致）。
 * 立创 params 的 key 是中文显示名（如"阻值"），分类模板的 key 是立创查询键，
 * 故按模板项的 name 优先匹配、key 兜底。
 *
 * 另外补一层「主表字段兜底」：立创的型号 / 品牌 / 封装是独立字段，不在规格表里，
 * 若模板里恰好有对应参数就用它们补齐，否则参数区反写时反而会把主表列清空。
 */
export function fillParamsFromLcsc(
  lcsc: LcscComponent,
  template: { key: string; name: string | null }[],
): Record<string, string> {
  const byKey = new Map(lcsc.params.map(([k, v]) => [k.trim(), v]))
  const out: Record<string, string> = {}
  for (const p of template) {
    const v = byKey.get((p.name || '').trim()) ?? byKey.get(p.key)
    if (v != null && String(v).trim()) out[p.key] = String(v).trim()
  }
  const src: Record<string, string | undefined> = {
    model: lcsc.model || undefined,
    brand: lcsc.brand || undefined,
    package: lcsc.package || undefined,
  }
  for (const p of template) {
    const f = mappedFieldOf(p)
    if (f && !out[p.key] && src[f]) out[p.key] = src[f]!
  }
  return out
}

export interface BuildDraftOptions {
  /** 单价：立创搜索结果带出的阶梯价 */
  price?: number | null
  /** 初始库存（导入场景由入库流程按行数量处理，默认 0） */
  qty?: number
  location?: string | null
  threshold?: number
}

/**
 * 立创详情 → 待创建草稿。
 * 图片优先下载落地（外链会失效），失败则回退远程地址；单价取搜索结果价格。
 */
export async function buildDraftFromLcsc(
  lcsc: LcscComponent,
  categories: Category[],
  opts: BuildDraftOptions = {},
): Promise<MaterialDraft> {
  let { minor } = matchLcscCategory(lcsc, categories)
  // 本地没有对应分类：按立创分类树补齐「大类 + 小类 + 参数」，避免落入未分类
  if (!minor) {
    try {
      minor = (await ensureLcscCategory(lcsc, categories)).minor
    } catch { /* 建分类失败不阻断建料，留空由用户手选 */ }
  }

  // 参数：分类模板存在时按立创规格回填，取不到模板不影响建料
  let params: Record<string, unknown> = {}
  if (minor) {
    try {
      params = fillParamsFromLcsc(lcsc, await getCategoryParams(minor))
    } catch { params = {} }
  }

  // 图片：直接存立创远程链接，不下载落本地（匹配立创时即用原图地址）
  const image_path = lcsc.image_url || null

  // 附件名并入类型前缀，与「新增物料表单」保持一致：(数据手册)xxx.pdf
  const files = lcscFileSeeds(lcsc.files)
    .map(f => ({ ...f, name: lcscFileTaggedName(f.name, f.file_type) }))

  return {
    name: lcsc.name || lcsc.model || lcsc.part_no,
    model: lcsc.model || null,
    brand: lcsc.brand || null,
    package: lcsc.package || null,
    part_no: lcsc.part_no || null,
    category_id: minor,
    params,
    qty: opts.qty ?? 0,
    location: opts.location ?? null,
    price: opts.price ?? 0,
    threshold: opts.threshold ?? 0,
    image_path,
    datasheet_path: lcscMainFile(lcsc.files)?.url ?? null,
    link: lcsc.source_url || null,
    // 立创草稿本身无备注来源（导入场景的来源文件名由入库流程按行写入），留空
    remark: null,
    files: files.length ? files : undefined,
  }
}
