// 数据存储抽象层接口
// Supabase（在线）与 SQLite（离线）各自实现，db.ts 门面按配置选择
import type {
  Category, CategoryParam, SupplierRow, MaterialRow, StockLog, StockOrder, BomProject, BomItem,
  BomPickRecord, PurchaseOrder, PurchaseItem, MaterialFile, DictType, DictItem,
  LabelTemplate, StockTake, StockTakeItem, StagnantRow,
} from '../types'

/** 列表查询参数 */
export interface ListMaterialsOpts {
  search?: string
  categoryId?: string | null
  categoryIds?: string[]
  /** 参数过滤：{ 参数 key: 值 }，多个条件为 AND（匹配 material_params 表） */
  params?: Record<string, string>
  /** 库位精确匹配（来自库位字典，与物料表单一致） */
  location?: string | null
  /** 分页：每页条数（不传则全量返回，保持旧行为） */
  limit?: number
  /** 分页：偏移量（与 limit 搭配） */
  offset?: number
}

/** 通用分页结果 */
export interface PageResult<T> {
  rows: T[]
  total: number
}

/** 待采购单分页查询参数 */
export interface PurchaseOrderPageOpts {
  status?: 'pending' | 'done' | null
  limit?: number
  offset?: number
}

/** 出入库单分页查询参数 */
export interface StockOrderPageOpts {
  type?: 'in' | 'out'
  source?: import('../types').StockOrderSource
  /** 关键词（模糊匹配单号 / 标题 / 备注 / 明细物料名 / 型号 / 编号） */
  keyword?: string
  status?: 'normal' | 'void'
  from?: string
  to?: string
  limit?: number
  offset?: number
}

/** 出入库单明细 */
export interface StockOrderItem {
  material_id: string
  /** 数量恒为正，方向由单据 type 决定 */
  qty: number
  /** 明细级供应商（导入等场景各行不同）；手工出入库建议放单级 supplier_id */
  supplier_id?: string | null
  note?: string | null
}

/** 建单并批量入账（一次出入库 = 一单 N 明细） */
export interface StockOrderInput {
  type: 'in' | 'out'
  source: import('../types').StockOrderSource
  /** 关联业务单 id（BOM 领料记录 / 待采单 / 盘点单） */
  source_id?: string | null
  /** 摘要标题 */
  title?: string | null
  /** 单级供应商（入库常用） */
  supplier_id?: string | null
  note?: string | null
  /** 单据时间（缺省取当前时间；迁移历史数据时传原始时间） */
  created_at?: string
  items: StockOrderItem[]
}

/** 图片上传结果 */
export interface UploadResult {
  path: string
  url: string
}

/** 统计概览（全部由数据库聚合，前端不拉全表统计） */
export interface StatsOverview {
  totalMaterials: number
  totalQty: number
  totalValue: number
  /** 低库存物料数：生效阈值 = 物料自身(>0) → 分类(>0) → 默认 5 */
  lowStock: number
}

/** 分类统计行 */
export interface StatsCategoryRow {
  id: string
  name: string
  qty: number
  value: number
  low: number
}

/** 低库存物料 */
export interface LowStockRow {
  id: string
  name: string
  model: string | null
  qty: number
  /** 生效阈值：物料自身阈值 > 分类阈值 > 全局默认 */
  threshold: number
  categories: { threshold: number | null } | null
}

/** 趋势行 */
export interface TrendRow {
  date: string
  in: number
  out: number
}

/** 单物料出入库汇总行（库存页用） */
export interface StockSummaryRow {
  material_id: string
  total_in: number
  total_out: number
  last30_in: number
  last30_out: number
}

/**
 * 数据存储接口 —— 所有数据访问的统一抽象
 * 在线模式用 SupabaseStore，离线模式用 SqliteStore
 */
export interface DataStore {
  /** 当前用户 id（用于 owner 字段、图片路径等） */
  getOwnerId(): Promise<string>

  // ===== 分类 =====
  listCategories(): Promise<Category[]>
  getCategoryParams(id: string): Promise<CategoryParam[]>
  createCategory(payload: Partial<Category>): Promise<Category>
  updateCategory(id: string, patch: Partial<Category>): Promise<Category>
  deleteCategory(id: string): Promise<void>

  // ===== 物料 =====
  listMaterials(opts?: ListMaterialsOpts): Promise<MaterialRow[]>
  countMaterials(opts?: ListMaterialsOpts): Promise<number>
  /** 各分类下的物料数量（key = 分类 id），供分类树徽标展示 */
  countMaterialsByCategory(): Promise<Record<string, number>>
  createMaterial(payload: Partial<MaterialRow>): Promise<MaterialRow>
  deleteMaterial(id: string): Promise<void>
  /** 批量软删除（一次操作，供首页多选删除） */
  deleteMaterials(ids: string[]): Promise<void>
  updateMaterial(id: string, patch: Partial<MaterialRow>): Promise<MaterialRow>
  getMaterial(id: string): Promise<MaterialRow>

  // ===== 供应商 =====
  listSuppliers(): Promise<SupplierRow[]>
  createSupplier(payload: Partial<SupplierRow>): Promise<SupplierRow>
  updateSupplier(id: string, patch: Partial<SupplierRow>): Promise<SupplierRow>
  deleteSupplier(id: string): Promise<void>

  // ===== 基础数据（字典） =====
  listDictTypes(): Promise<DictType[]>
  createDictType(payload: Partial<DictType>): Promise<DictType>
  deleteDictType(id: string): Promise<void>
  listDictItems(dictKey: string): Promise<DictItem[]>
  countDictItems(): Promise<Record<string, number>>
  createDictItem(payload: Partial<DictItem>): Promise<DictItem>
  updateDictItem(id: string, patch: Partial<DictItem>): Promise<DictItem>
  deleteDictItem(id: string): Promise<void>

  // ===== 文件（图片/手册） =====
  uploadImage(file: File, userId: string): Promise<UploadResult>
  uploadFile(file: File, userId: string): Promise<UploadResult>
  imagePublicUrl(path: string | null): string | undefined
  /** 本地文件绝对路径（离线模式，用系统默认程序打开）；非本地资源返回 null */
  localFilePath?(path: string): string | null

  // ===== 出入库 =====
  listStockLog(opts?: { limit?: number; materialId?: string; type?: 'in' | 'out' }): Promise<StockLog[]>
  /** 按物料聚合的出入库汇总（累计 + 近30天） */
  stockSummary(): Promise<StockSummaryRow[]>

  // ===== 出入库单（单据化） =====
  /**
   * 建单并批量入账：一次出入库 = 1 单 N 明细。
   * 生成单号、写 stock_orders、流水挂 order_id、按物料聚合更新库存；
   * 任一物料库存不足则整体抛错不落库（失败时清理已写入数据）。
   * 返回单据 + material_id → 入账后最新库存 映射。
   */
  stockInOrder(input: StockOrderInput): Promise<{ order: StockOrder; finals: Map<string, number> }>
  /** 出入库单分页（服务端筛选 + 总数，关键词含明细物料名/型号/编号） */
  pageStockOrders(opts?: StockOrderPageOpts): Promise<PageResult<StockOrder>>
  /** 按 id 取单据（含供应商名） */
  getStockOrder(id: string): Promise<StockOrder>
  /** 某张单的全部明细流水（按时间正序） */
  listStockLogsByOrder(orderId: string): Promise<StockLog[]>
  /** 撤销整单：先全量校验（回滚后不得出现负库存）后执行，任一明细失败则整单报错、不做部分撤销 */
  voidStockOrder(id: string, reason: string): Promise<void>

  // ===== BOM =====
  createBomProject(name: string): Promise<BomProject>
  listBomProjects(): Promise<BomProject[]>
  deleteBomProject(id: string): Promise<void>
  createBomItems(project_id: string, items: Partial<BomItem>[]): Promise<BomItem[]>
  listBomItems(projectId: string): Promise<BomItem[]>
  updateBomItem(id: string, patch: Partial<BomItem>): Promise<BomItem>
  /** 新增一条领料记录（一次领料 = 一条，含套数） */
  createBomPickRecord(project_id: string, sets: number, note: string | null): Promise<BomPickRecord>
  /** 列出某 BOM 项目的全部领料记录（按时间倒序） */
  listBomPickRecords(projectId: string): Promise<BomPickRecord[]>

  // ===== 待采购单 =====
  createPurchaseOrder(payload: Partial<PurchaseOrder>): Promise<PurchaseOrder>
  listPurchaseOrders(): Promise<PurchaseOrder[]>
  /** 待采购单分页（状态筛选 + 总数） */
  listPurchaseOrdersPage(opts?: PurchaseOrderPageOpts): Promise<PageResult<PurchaseOrder>>
  /** 按状态统计待采购单数量（采购中 / 已完成 计数用） */
  countPurchaseOrders(status?: 'pending' | 'done' | null): Promise<number>
  updatePurchaseOrder(id: string, patch: Partial<PurchaseOrder>): Promise<PurchaseOrder>
  deletePurchaseOrder(id: string): Promise<void>
  createPurchaseItems(order_id: string, items: Partial<PurchaseItem>[]): Promise<PurchaseItem[]>
  listPurchaseItems(orderId: string): Promise<PurchaseItem[]>
  updatePurchaseItem(id: string, patch: Partial<PurchaseItem>): Promise<PurchaseItem>
  deletePurchaseItem(id: string): Promise<void>

  // ===== 物料附件（数据手册等，一个物料多个） =====
  listMaterialFiles(materialId: string): Promise<MaterialFile[]>
  createMaterialFiles(material_id: string, items: Partial<MaterialFile>[]): Promise<MaterialFile[]>
  deleteMaterialFile(id: string): Promise<void>
  /** 按物料批量删除附件（删除物料时调用） */
  deleteMaterialFilesOf(materialId: string): Promise<void>

  // ===== 批量查询 =====
  getMaterialsByIds(ids: string[]): Promise<MaterialRow[]>
  matchMaterialByModel(model: string): Promise<MaterialRow[]>
  /** 批量匹配：一次取回命中任意关键词（型号 / 商品编号 / 名称）的候选物料 */
  matchMaterialsByKeys(keys: string[]): Promise<MaterialRow[]>

  // ===== 统计 =====
  statsOverview(): Promise<StatsOverview>
  statsByCategory(): Promise<StatsCategoryRow[]>
  lowStockMaterials(globalThreshold?: number): Promise<LowStockRow[]>
  /** 呆滞料：最近一次出入库距今天数超过 days 的物料（默认 180 天） */
  stagnantMaterials(days?: number): Promise<StagnantRow[]>
  stockTrend(days?: number): Promise<TrendRow[]>

  // ===== 标签打印模板 =====
  listLabelTemplates(): Promise<LabelTemplate[]>
  createLabelTemplate(payload: Partial<LabelTemplate>): Promise<LabelTemplate>
  updateLabelTemplate(id: string, patch: Partial<LabelTemplate>): Promise<LabelTemplate>
  deleteLabelTemplate(id: string): Promise<void>

  // ===== 库存盘点 =====
  createStocktake(take: StockTake, items: StockTakeItem[]): Promise<void>
  listStocktakes(): Promise<StockTake[]>
  getStocktake(id: string): Promise<{ take: StockTake; items: StockTakeItem[] }>
  deleteStocktake(id: string): Promise<void>
}
