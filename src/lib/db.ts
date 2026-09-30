// db.ts —— 数据访问门面
//
// 所有页面/组件统一从这里 import，内部委托给 storage 层（Supabase / SQLite）。
// 切换在线/离线模式只需改 .env 的 VITE_DATA_MODE，调用方无感知。
import { getStore, type DataStore } from './storage'
import type {
  Category, CategoryParam, SupplierRow, MaterialRow, StockLog, BomProject, BomItem,
  BomPickRecord, PurchaseOrder, PurchaseItem, MaterialFile, DictType, DictItem, LabelTemplate,
  LabelCatConfig, LabelSheetLayout,
  StockTake, StockTakeItem, StagnantRow,
} from './types'
import type {
  ListMaterialsOpts, StockInput, ApplyStockInput, VoidStockLogInput,
  VoidStockLogsInput, VoidStockLogsResult,
  UploadResult, StatsOverview, StatsCategoryRow, LowStockRow, TrendRow, StockSummaryRow,
  PageResult, StockLogPageOpts, PurchaseOrderPageOpts,
} from './storage'
import { LCSC_CATEGORIES } from './lcscCategories'
import type { LcscParam } from './lcscCategories'
import { log } from 'console'

// ===== 纯工具函数（不涉及存储，两个模式共用） =====

export interface CategoryNode {
  cat: Category
  children: CategoryNode[]
}

// 把扁平分类列表组装成「大类 → 小类」二级树（parent=null 视为大类）
// 排序：同层级按 sort_order 升序，缺失时按 name 兜底
export function buildCategoryTree(flat: Category[]): CategoryNode[] {
  const byId = new Map<string, CategoryNode>()
  for (const c of flat) byId.set(c.id, { cat: c, children: [] })
  const roots: CategoryNode[] = []
  for (const node of byId.values()) {
    const p = node.cat.parent
    if (p && byId.has(p)) byId.get(p)!.children.push(node)
    else roots.push(node)
  }
  const sortNodes = (nodes: CategoryNode[]) => {
    nodes.sort((a, b) => {
      const sa = a.cat.sort_order ?? 0
      const sb = b.cat.sort_order ?? 0
      if (sa !== sb) return sa - sb
      return a.cat.name.localeCompare(b.cat.name, 'zh')
    })
    nodes.forEach(n => sortNodes(n.children))
  }
  sortNodes(roots)
  return roots
}

// 取某大类（含其下所有小类）的 id 集合，用于按大类聚合筛选
export function descendantCategoryIds(flat: Category[], majorId: string): string[] {
  const ids = [majorId]
  for (const c of flat) if (c.parent === majorId) ids.push(c.id)
  return ids
}

// ===== importLcsc 编排（两个 store 共用，通过 store 原语实现） =====

export interface ImportProgress {
  phase: 'prepare' | 'major' | 'minor' | 'done'
  majorName: string
  minorName: string
  majorIdx: number
  majorTotal: number
  minorDone: number
  minorTotal: number
}

// 一键导入立创分类（大类 + 小类），按 owner+name+parent 去重，可重复执行不重复建。
// 大类 parent=null；小类挂到大类下，并写入嘉立创 lcsc_id 与参数(params)。
// sort_order 按循环顺序写入：大类=mi，小类=si。
//
// 性能优化：先一次性把数据库里「已有的立创分类」按 lcsc_id 建索引（lcsc_id 是嘉立创
// 分类的唯一稳定主键），再只插入缺失的，不再逐个匹配、也不再为已存在的分类回写参数
// （重复导入会覆盖用户手动调整，故跳过；新导入时参数已落库，无需回补）。
export async function importLcscCategories(
  onProgress?: (p: ImportProgress) => void
): Promise<{ majors: number; minors: number; skipped: number; templateCreated: boolean }> {
  const store = getStore()
  const owner = await store.getOwnerId()

  onProgress?.({ phase: 'prepare', majorName: '', minorName: '', majorIdx: 0, majorTotal: LCSC_CATEGORIES.length, minorDone: 0, minorTotal: 0 })

  const paramsMod = await import('./lcscParams')
  const PARAMS = paramsMod.LCSC_PARAMS as Record<number, LcscParam[]>

  // 1) 一次性查出已有分类，按 lcsc_id 建索引；lcsc_id 为 null 的聚合分类用 name+parent 兜底
  const existing = await store.listCategories()
  const byLcsc = new Map<number, Category>()
  const byNameParent = new Map<string, Category>()
  for (const c of existing) {
    if (c.lcsc_id != null) byLcsc.set(c.lcsc_id, c)
    byNameParent.set(`${c.name} ${c.parent ?? ''}`, c)
  }

  let majors = 0, minors = 0, skipped = 0

  const minorTotal = LCSC_CATEGORIES.reduce((s, m) => s + m.children.length, 0)
  let minorDone = 0

  for (let mi = 0; mi < LCSC_CATEGORIES.length; mi++) {
    const m = LCSC_CATEGORIES[mi]
    onProgress?.({
      phase: 'major', majorName: m.name, minorName: '',
      majorIdx: mi + 1, majorTotal: LCSC_CATEGORIES.length,
      minorDone, minorTotal,
    })

    // 大类：优先按 lcsc_id 命中（稳定唯一），其次按 name+null 父级兜底
    let majorId: string
    const majorHit = (m.id != null ? byLcsc.get(m.id) : undefined)
      ?? byNameParent.get(`${m.name} `)
    if (majorHit) {
      majorId = majorHit.id
      skipped++
    } else {
      const created = await store.createCategory({
        owner, name: m.name, parent: null, lcsc_id: m.id ?? null,
        params: '[]', sort_order: mi,
      } as Partial<Category>)
      majorId = created.id
      majors++
      if (m.id != null) byLcsc.set(m.id, created)
      byNameParent.set(`${m.name} `, created)
    }

    for (let si = 0; si < m.children.length; si++) {
      const sub = m.children[si]
      onProgress?.({
        phase: 'minor', majorName: m.name, minorName: sub.name,
        majorIdx: mi + 1, majorTotal: LCSC_CATEGORIES.length,
        minorDone, minorTotal,
      })
      // 小类：优先按 lcsc_id 命中，其次按 name+大类id 兜底
      const minorHit = (sub.id != null ? byLcsc.get(sub.id) : undefined)
        ?? byNameParent.get(`${sub.name} ${majorId}`)
      if (minorHit) {
        skipped++
        minorDone++
        continue
      }
      const params = sub.id != null ? (PARAMS[sub.id] ?? []) : []
      const created = await store.createCategory({
        owner, name: sub.name, parent: majorId, lcsc_id: sub.id ?? null,
        params: JSON.stringify(params), sort_order: si,
      } as Partial<Category>)
      minors++
      minorDone++
      if (sub.id != null) byLcsc.set(sub.id, created)
    }
  }
  onProgress?.({ phase: 'done', majorName: '', minorName: '', majorIdx: LCSC_CATEGORIES.length, majorTotal: LCSC_CATEGORIES.length, minorDone: minorTotal, minorTotal })

  // 2) 导入完成后确保存在一份默认模板（SQL 种子覆盖已建库用户，这里兜底新用户 / 被删场景）
  const templateCreated = await ensureDefaultLabelTemplate()

  return { majors, minors, skipped, templateCreated }
}

// 默认模板种子：内容与 script/0001_init.sql（第 11 段 Supabase）内置模板一致，两处需同步。
// category_id 用占位符 {{分类名称_Id}}：SQL 无法预知导入后的 uuid，故 App 层在导入分类后
// 按分类名解析为实际分类 id（见 ensureDefaultLabelTemplate）。category_id 为空 = 兜底格式。
const BUILTIN_TPL_LAYOUT: LabelSheetLayout = {
  paper: 'A4', paper_w: 210, paper_h: 297, sheet_w: 210, sheet_h: 297,
  cols: 8, rows: 26, pad: 2, gap_w: 2, gap_h: 2, pos_mode: 'custom',
  off_x: 0, off_y: 0, scale_fix: 1, guides: true, auto_fill: false,
}

// 占位符 → 实际立创分类名（导入后按名查 id 替换）
const BUILTIN_TPL_CAT_NAMES: Record<string, string> = {
  '{{贴片电阻_Id}}': '贴片电阻',
  '{{贴片电容(MLCC)_Id}}': '贴片电容(MLCC)',
}

const BUILTIN_TPL_CATS_SEED: LabelCatConfig[] = [
  {
    category_id: '{{贴片电阻_Id}}',
    blocks: [
      { id: 'b-name', type: 'field', field: 'model', x: 0, y: 0, w: 4, h: 1, align: 'center', valign: 'middle', auto_shrink: true, font_pt: 6 },
      { id: 'bmu83ihi61', type: 'field', field: 'brand', x: 0, y: 1, w: 2, h: 1, align: 'left', valign: 'middle', auto_shrink: true, font_pt: 6 },
      { id: 'bmu83iiry3', type: 'field', field: 'param:param_10835_n', x: 2, y: 1, w: 1, h: 1, align: 'right', valign: 'middle', auto_shrink: true, font_pt: 6 },
      { id: 'bmu83ij2v4', type: 'field', field: 'param:param_10836_s', x: 3, y: 1, w: 1, h: 1, align: 'left', valign: 'middle', auto_shrink: true, font_pt: 6 },
      { id: 'bmu83vz1y5', type: 'field', field: 'param:queryProductStandard', x: 0, y: 2, w: 2, h: 1, align: 'left', valign: 'middle', auto_shrink: true, font_pt: 6, prefix: '封装:' },
      { id: 'bmu83we9n6', type: 'field', field: 'param:param_10837_n', x: 2, y: 2, w: 1, h: 1, align: 'left', valign: 'middle', auto_shrink: true, font_pt: 6, text: ' ' },
      { id: 'bmu8de09v1', type: 'field', field: 'param:param_11155_n', x: 3, y: 2, w: 1, h: 1, align: 'left', valign: 'middle', auto_shrink: true, font_pt: 6 },
    ],
    sort_mode: 'field', sort_field: 'param_10835_n', sort_dir: 'asc',
  },
  {
    category_id: '{{贴片电容(MLCC)_Id}}',
    blocks: [
      { id: 'b-name', type: 'field', field: 'model', x: 0, y: 0, w: 4, h: 1, align: 'center', valign: 'middle', auto_shrink: true, font_pt: 6 },
      { id: 'bmu83pkfb1', type: 'field', field: 'brand', x: 0, y: 1, w: 2, h: 1, align: 'left', valign: 'middle', auto_shrink: true, empty_behavior: 'keep', font_pt: 6 },
      { id: 'bmu83plbn3', type: 'field', field: 'param:param_10951_n', x: 2, y: 1, w: 1, h: 1, align: 'right', valign: 'middle', auto_shrink: true, empty_behavior: 'keep', font_pt: 6 },
      { id: 'bmu83pljz4', type: 'field', field: 'param:param_10952_s', x: 3, y: 1, w: 1, h: 1, align: 'left', valign: 'middle', auto_shrink: true, empty_behavior: 'keep', font_pt: 6 },
      { id: 'bmu846b011', type: 'field', field: 'param:queryProductStandard', x: 0, y: 2, w: 2, h: 1, align: 'left', valign: 'middle', auto_shrink: true, font_pt: 6, prefix: '封装:' },
      { id: 'bmu846l282', type: 'field', field: 'param:param_10953_n', x: 2, y: 2, w: 1, h: 1, align: 'left', valign: 'middle', auto_shrink: true, text: ' ', font_pt: 6 },
      { id: 'bmu8ddgoh3', type: 'field', field: 'param:param_10954', x: 3, y: 2, w: 1, h: 1, align: 'left', valign: 'middle', auto_shrink: true, font_pt: 6 },
    ],
    sort_mode: 'field', sort_field: 'param_10951_n', sort_dir: 'asc',
  },
  {
    category_id: '',
    blocks: [
      { id: 'bmu8fiyzh1', type: 'field', field: 'name', x: 0, y: 0, w: 4, h: 1, align: 'center', valign: 'middle', auto_shrink: true, font_pt: 6 },
      { id: 'bmu8fje6j2', type: 'field', field: 'brand', x: 0, y: 1, w: 2, h: 1, align: 'left', valign: 'middle', auto_shrink: true, font_pt: 6 },
      { id: 'bmu8fjlkp4', type: 'field', field: 'model', x: 2, y: 1, w: 2, h: 1, align: 'left', valign: 'middle', auto_shrink: true, prefix: '', font_pt: 6 },
      { id: 'bmu8fkber5', type: 'field', field: 'part_no', x: 0, y: 2, w: 2, h: 1, align: 'left', valign: 'middle', auto_shrink: true, prefix: '', font_pt: 6 },
      { id: 'bmu8fkp1w6', type: 'field', field: 'location', x: 2, y: 2, w: 2, h: 1, align: 'left', valign: 'middle', auto_shrink: true, prefix: '', font_pt: 6 },
    ],
    sort_mode: 'cat', sort_field: null, sort_dir: 'asc',
  },
]

/** 把模板 cats 里的 {{名称_Id}} 占位符按当前导入的分类名替换为实际 id；未导入的占位配置丢弃 */
function resolveBuiltinCats(cats: LabelCatConfig[], nameToId: Map<string, string>): LabelCatConfig[] {
  return cats
    .map(c => {
      const ph = c.category_id
      if (ph && BUILTIN_TPL_CAT_NAMES[ph]) {
        const id = nameToId.get(BUILTIN_TPL_CAT_NAMES[ph])
        return id ? { ...c, category_id: id } : null
      }
      return c
    })
    .filter((c): c is LabelCatConfig => c != null)
}

/**
 * 合并 / 升级已有默认模板：保留用户已有的分类配置，解析残留占位符，
 * 并补齐缺失的电阻 / 电容内置配置（针对仅含兜底格式的老种子）。
 */
function mergeBuiltinCats(
  existing: LabelCatConfig[],
  nameToId: Map<string, string>,
  idToName: Map<string, string>,
): LabelCatConfig[] {
  const out: LabelCatConfig[] = []
  const coveredNames = new Set<string>()
  for (const c of existing) {
    const ph = c.category_id
    if (ph && BUILTIN_TPL_CAT_NAMES[ph]) {
      const name = BUILTIN_TPL_CAT_NAMES[ph]
      const id = nameToId.get(name)
      if (id) { out.push({ ...c, category_id: id }); coveredNames.add(name) }
      continue
    }
    if (c.category_id) {
      const name = idToName.get(c.category_id)
      if (name && Object.values(BUILTIN_TPL_CAT_NAMES).includes(name)) coveredNames.add(name)
    }
    out.push(c)
  }
  for (const seed of BUILTIN_TPL_CATS_SEED) {
    if (seed.category_id && BUILTIN_TPL_CAT_NAMES[seed.category_id]) {
      const name = BUILTIN_TPL_CAT_NAMES[seed.category_id]
      if (!coveredNames.has(name)) {
        const id = nameToId.get(name)
        if (id) out.push({ ...seed, category_id: id })
      }
    }
  }
  return out
}

function builtinCatsEqual(a: LabelCatConfig[], b: LabelCatConfig[]): boolean {
  const key = (arr: LabelCatConfig[]) => arr
    .map(c => JSON.stringify({
      category_id: c.category_id, blocks: c.blocks,
      sort_mode: c.sort_mode, sort_field: c.sort_field, sort_dir: c.sort_dir,
    }))
    .sort()
    .join('|')
  return key(a) === key(b)
}

/**
 * 确保当前用户存在一份「含贴片电阻 / 贴片电容(MLCC) 布局」的默认标签模板。
 * - 没有任何模板：创建一份完整内置默认模板（占位符按已导入分类名解析为实际 id）。
 * - 已有默认模板：保留用户配置，仅解析残留占位符、补齐缺失的电阻 / 电容布局（幂等）。
 * 返回 true 表示模板被创建或更新过。
 */
export async function ensureDefaultLabelTemplate(): Promise<boolean> {
  const store = getStore()
  const templates = await store.listLabelTemplates()
  const categories = await store.listCategories()
  const nameToId = new Map(categories.map(c => [c.name, c.id]))
  const idToName = new Map(categories.map(c => [c.id, c.name]))

  const def = templates.find(t => t.is_default) ?? templates[0]
  if (def) {
    const merged = mergeBuiltinCats(def.cats ?? [], nameToId, idToName)
    if (builtinCatsEqual(def.cats ?? [], merged)) return false
    await store.updateLabelTemplate(def.id, { cats: merged } as Partial<LabelTemplate>)
    return true
  }
  await store.createLabelTemplate({
    name: '默认模板',
    width_mm: 24,
    height_mm: 9,
    grid_rows: 3,
    grid_cols: 4,
    default_font_pt: 6,
    is_default: true,
    cats: resolveBuiltinCats(BUILTIN_TPL_CATS_SEED, nameToId),
    layout: BUILTIN_TPL_LAYOUT,
  } as Partial<LabelTemplate>)
  return true
}

// ===== 委托给 store 的方法（保持原有 API 不变） =====

// 注意：不要在此处用 `const s = getStore()` 一次性固定实例——模块导入早于
// initAppSettings() 填充缓存，那时拿到的是默认 sqlite 实例，在线模式下会导致
// 所有读/写走向本地库（导入能成功、查询却查不出）。改为“每次访问时解析”的代理，
// 始终取当前在线/离线 store，并在配置变更后自动重建。
const s = new Proxy({} as DataStore, {
  get: (_t, prop) => {
    const store = getStore()
    const v = (store as unknown as Record<string, unknown>)[prop as string]
    return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(store) : v
  },
})

export const getOwnerId = (): Promise<string> => s.getOwnerId()

export const listCategories = (): Promise<Category[]> => s.listCategories()
export const getCategoryParams = (id: string): Promise<CategoryParam[]> => s.getCategoryParams(id)
export const createCategory = (payload: Partial<Category>): Promise<Category> => s.createCategory(payload)
export const updateCategory = (id: string, patch: Partial<Category>): Promise<Category> => s.updateCategory(id, patch)
export const deleteCategory = (id: string): Promise<void> => s.deleteCategory(id)

export const listMaterials = (opts?: ListMaterialsOpts): Promise<MaterialRow[]> => s.listMaterials(opts)
export const countMaterials = (opts?: ListMaterialsOpts): Promise<number> => s.countMaterials(opts)

/** 物料分页查询：复用 store 的 limit/offset + countMaterials 得到总数（筛选在服务端完成） */
export interface MaterialPageOpts extends ListMaterialsOpts {
  /** 0 基页码 */
  page?: number
  /** 每页条数 */
  pageSize?: number
}
export async function listMaterialsPage(opts: MaterialPageOpts = {}): Promise<PageResult<MaterialRow>> {
  const pageSize = Math.max(1, opts.pageSize ?? 20)
  const page = Math.max(0, opts.page ?? 0)
  const [rows, total] = await Promise.all([
    s.listMaterials({ ...opts, limit: pageSize, offset: page * pageSize }),
    s.countMaterials(opts),
  ])
  return { rows, total }
}
export const createMaterial = (payload: Partial<MaterialRow>): Promise<MaterialRow> => s.createMaterial(payload)
export const deleteMaterial = (id: string): Promise<void> => s.deleteMaterial(id)
export const deleteMaterials = (ids: string[]): Promise<void> => s.deleteMaterials(ids)
export const updateMaterial = (id: string, patch: Partial<MaterialRow>): Promise<MaterialRow> => s.updateMaterial(id, patch)
export const getMaterial = (id: string): Promise<MaterialRow> => s.getMaterial(id)

// ===== 物料附件（数据手册 / 认证资料 / 行业资讯，一个物料多个） =====
export const listMaterialFiles = (materialId: string): Promise<MaterialFile[]> => s.listMaterialFiles(materialId)
export const createMaterialFiles = (material_id: string, items: Partial<MaterialFile>[]): Promise<MaterialFile[]> => s.createMaterialFiles(material_id, items)
export const deleteMaterialFile = (id: string): Promise<void> => s.deleteMaterialFile(id)

export const listSuppliers = (): Promise<SupplierRow[]> => s.listSuppliers()
export const createSupplier = (payload: Partial<SupplierRow>): Promise<SupplierRow> => s.createSupplier(payload)
export const updateSupplier = (id: string, patch: Partial<SupplierRow>): Promise<SupplierRow> => s.updateSupplier(id, patch)
export const deleteSupplier = (id: string): Promise<void> => s.deleteSupplier(id)

// ===== 基础数据（字典） =====

/** 内置字典（首次访问时自动种入，两种存储共用同一套种子逻辑） */
const BUILTIN_DICTS: Array<{ key: string; name: string; items: string[] }> = [
  { key: 'location', name: '库位', items: ['货架 A', '货架 B', '货架 C', '样品柜', '周转箱'] },
  { key: 'out_purpose', name: '出库用途', items: ['生产领料', '样品制作', '维修替换', '报废', '损耗'] },
]

let dictsSeeded = false

/**
 * 确保内置字典存在（幂等）：
 * - 字典类型不存在则新建并种入全部内置项；
 * - 类型已存在但内置项缺失（如老用户已有空的「库位」字典）则仅补齐缺失项，避免重复。
 */
async function ensureBuiltinDicts(): Promise<void> {
  if (dictsSeeded) return
  dictsSeeded = true
  const types = await s.listDictTypes()
  const byKey = new Map(types.map(t => [t.key, t]))
  for (const b of BUILTIN_DICTS) {
    let type = byKey.get(b.key)
    if (!type) {
      const owner = await s.getOwnerId()
      type = await s.createDictType({ owner, key: b.key, name: b.name, builtin: true })
    }
    if (!b.items.length) continue
    const existing = await s.listDictItems(b.key)
    const have = new Set(existing.map(i => i.label))
    for (let i = 0; i < b.items.length; i++) {
      if (have.has(b.items[i])) continue
      await s.createDictItem({ owner: type.owner, dict_key: b.key, label: b.items[i], sort_order: i })
    }
  }
}

export async function listDictTypes(): Promise<DictType[]> {
  await ensureBuiltinDicts()
  return s.listDictTypes()
}
export const createDictType = (payload: Partial<DictType>): Promise<DictType> => s.createDictType(payload)
export const deleteDictType = (id: string): Promise<void> => s.deleteDictType(id)

/** 按字典 key 取项列表；未种入内置字典时先补种 */
export async function listDictItems(dictKey: string): Promise<DictItem[]> {
  await ensureBuiltinDicts()
  return s.listDictItems(dictKey)
}
export async function countDictItems(): Promise<Record<string, number>> {
  await ensureBuiltinDicts()
  return s.countDictItems()
}
export const createDictItem = (payload: Partial<DictItem>): Promise<DictItem> => s.createDictItem(payload)
export const updateDictItem = (id: string, patch: Partial<DictItem>): Promise<DictItem> => s.updateDictItem(id, patch)
export const deleteDictItem = (id: string): Promise<void> => s.deleteDictItem(id)

export const uploadImage = (file: File, userId: string): Promise<UploadResult> => s.uploadImage(file, userId)
export const uploadFile = (file: File, userId: string): Promise<UploadResult> => s.uploadFile(file, userId)
export const imagePublicUrl = (path: string | null): string | undefined => s.imagePublicUrl(path)

/** 用系统默认程序打开数据手册：http 外链→默认浏览器；本地文件→资源管理器定位选中；storage 路径→公网 URL */
export async function openDatasheet(path: string): Promise<void> {
  // http(s) 外链：浏览器打开
  if (/^https?:/i.test(path)) {
    await openExternal(path, false)
    return
  }
  // 离线模式：resource 目录下的本地文件，在资源管理器中定位并选中
  const local = s.localFilePath?.(path)
  if (local) {
    await revealInFolder(local)
    return
  }
  // 在线模式：storage 路径 → 公网 URL
  const url = s.imagePublicUrl(path)
  if (!url) throw new Error('无法解析手册地址')
  await openExternal(url, false)
}

/** 在资源管理器中定位文件（Tauri revealItemInDir；浏览器环境不可用） */
async function revealInFolder(filePath: string): Promise<void> {
  if ('__TAURI_INTERNALS__' in window) {
    const { revealItemInDir } = await import('@tauri-apps/plugin-opener')
    await revealItemInDir(filePath)
    return
  }
  throw new Error('当前环境无法打开本地文件')
}

/** Tauri opener 打开；纯浏览器环境回退 window.open（仅 URL） */
export async function openExternal(target: string, isPath: boolean): Promise<void> {
  // Tauri webview：用 opener 插件（系统默认程序）
  if ('__TAURI_INTERNALS__' in window) {
    const opener = await import('@tauri-apps/plugin-opener')
    if (isPath) await opener.openPath(target)
    else await opener.openUrl(target)
    return
  }
  // 浏览器环境：本地绝对路径无法打开
  if (isPath) throw new Error('当前环境无法打开本地文件')
  window.open(target, '_blank', 'noopener')
}

export const addStockLog = (input: StockInput): Promise<StockLog> => s.addStockLog(input)
export const listStockLog = (opts?: { limit?: number; materialId?: string; type?: 'in' | 'out' }): Promise<StockLog[]> => s.listStockLog(opts)
export const listStockLogPage = (opts?: StockLogPageOpts): Promise<PageResult<StockLog>> => s.listStockLogPage(opts)
export const applyStock = (input: ApplyStockInput): Promise<MaterialRow> => s.applyStock(input)
export const voidStockLog = (input: VoidStockLogInput): Promise<StockLog> => s.voidStockLog(input)
export const voidStockLogs = (input: VoidStockLogsInput): Promise<VoidStockLogsResult> => s.voidStockLogs(input)
export const stockSummary = (): Promise<StockSummaryRow[]> => s.stockSummary()

export const createBomProject = (name: string): Promise<BomProject> => s.createBomProject(name)
export const listBomProjects = (): Promise<BomProject[]> => s.listBomProjects()
export const deleteBomProject = (id: string): Promise<void> => s.deleteBomProject(id)
export const createBomItems = (project_id: string, items: Partial<BomItem>[]): Promise<BomItem[]> => s.createBomItems(project_id, items)
export const listBomItems = (projectId: string): Promise<BomItem[]> => s.listBomItems(projectId)
export const updateBomItem = (id: string, patch: Partial<BomItem>): Promise<BomItem> => s.updateBomItem(id, patch)
export const createBomPickRecord = (project_id: string, sets: number, note: string | null): Promise<BomPickRecord> => s.createBomPickRecord(project_id, sets, note)
export const listBomPickRecords = (projectId: string): Promise<BomPickRecord[]> => s.listBomPickRecords(projectId)

// ===== 待采购单 =====
export const createPurchaseOrder = (payload: Partial<PurchaseOrder>): Promise<PurchaseOrder> => s.createPurchaseOrder(payload)
export const listPurchaseOrders = (): Promise<PurchaseOrder[]> => s.listPurchaseOrders()
export const listPurchaseOrdersPage = (opts?: PurchaseOrderPageOpts): Promise<PageResult<PurchaseOrder>> => s.listPurchaseOrdersPage(opts)
export const countPurchaseOrders = (status?: 'pending' | 'done' | null): Promise<number> => s.countPurchaseOrders(status)
export const updatePurchaseOrder = (id: string, patch: Partial<PurchaseOrder>): Promise<PurchaseOrder> => s.updatePurchaseOrder(id, patch)
export const deletePurchaseOrder = (id: string): Promise<void> => s.deletePurchaseOrder(id)
export const createPurchaseItems = (order_id: string, items: Partial<PurchaseItem>[]): Promise<PurchaseItem[]> => s.createPurchaseItems(order_id, items)
export const listPurchaseItems = (orderId: string): Promise<PurchaseItem[]> => s.listPurchaseItems(orderId)
export const updatePurchaseItem = (id: string, patch: Partial<PurchaseItem>): Promise<PurchaseItem> => s.updatePurchaseItem(id, patch)
export const deletePurchaseItem = (id: string): Promise<void> => s.deletePurchaseItem(id)

export const getMaterialsByIds = (ids: string[]): Promise<MaterialRow[]> => s.getMaterialsByIds(ids)
export const matchMaterialByModel = (model: string): Promise<MaterialRow[]> => s.matchMaterialByModel(model)

export const statsOverview = (): Promise<StatsOverview> => s.statsOverview()
export const statsByCategory = (): Promise<StatsCategoryRow[]> => s.statsByCategory()
export const lowStockMaterials = (globalThreshold?: number): Promise<LowStockRow[]> => s.lowStockMaterials(globalThreshold)
/** 呆滞料：最近一次出入库距今天数超过 days 的物料（默认 180 天） */
export const stagnantMaterials = (days?: number): Promise<StagnantRow[]> => s.stagnantMaterials(days)
export const stockTrend = (days?: number): Promise<TrendRow[]> => s.stockTrend(days)

// ===== 库存盘点 =====
// 建盘点单 + 明细；差异在提交时按行通过 applyStock 入账（盘盈=in / 盘亏=out，note='盘点调整'），
// 因此完整复用在线模式审核逻辑与库存更新。
export async function createStocktake(take: StockTake, items: StockTakeItem[]): Promise<void> {
  await s.createStocktake(take, items)
  for (const it of items) {
    if (it.material_id && it.diff !== 0) {
      await s.applyStock({
        material_id: it.material_id,
        type: it.diff > 0 ? 'in' : 'out',
        qty: Math.abs(it.diff),
        note: '盘点调整',
        currentQty: it.book_qty,
      })
    }
  }
}
export const listStocktakes = (): Promise<StockTake[]> => s.listStocktakes()
export const getStocktake = (id: string): Promise<{ take: StockTake; items: StockTakeItem[] }> => s.getStocktake(id)
export const deleteStocktake = (id: string): Promise<void> => s.deleteStocktake(id)

// ===== 标签打印模板 =====
export const listLabelTemplates = (): Promise<LabelTemplate[]> => s.listLabelTemplates()
export const createLabelTemplate = (payload: Partial<LabelTemplate>): Promise<LabelTemplate> => s.createLabelTemplate(payload)
export const updateLabelTemplate = (id: string, patch: Partial<LabelTemplate>): Promise<LabelTemplate> => s.updateLabelTemplate(id, patch)
export const deleteLabelTemplate = (id: string): Promise<void> => s.deleteLabelTemplate(id)

// re-export 类型供调用方使用
export type { Category, CategoryParam, SupplierRow, MaterialRow, StockLog, BomProject, BomItem, BomPickRecord, PurchaseOrder, PurchaseItem, MaterialFile, DictType, DictItem, StockTake, StockTakeItem } from './types'
