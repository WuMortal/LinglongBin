// 数据库行类型（与 script/0001_init.sql 对应）

export interface Category {
  id: string
  owner: string
  name: string
  parent: string | null
  /** 嘉立创 catalogId（小类导入时写入，用于与商城数据关联） */
  lcsc_id: number | null
  location_prefix: string | null
  /** 参数模板（列表查询不返回，编辑时按需加载） */
  params?: unknown
  threshold: number
  /** 同父级下排序序号（升序） */
  sort_order: number
  created_at: string
}

/** 分类参数模板项 */
export interface CategoryParam {
  key: string
  name: string
  values: string[]
}

/** 供应商（扁平列表，无分组） */
export interface SupplierRow {
  id: string
  owner: string
  name: string
  addr: string | null
  contact: string | null
  phone: string | null
  note: string | null
  created_at: string
}

export interface MaterialRow {
  id: string
  owner: string
  category_id: string | null
  name: string
  model: string | null
  brand: string | null
  package: string | null
  part_no: string | null
  threshold: number
  params: Record<string, unknown>
  qty: number
  location: string | null
  price: number
  image_path: string | null
  datasheet_path: string | null
  link: string | null
  remark: string | null
  alternates: string[]
  created_at: string
  categories?: { name: string | null; threshold: number | null; parent_name?: string | null } | null
}

/**
 * 待创建物料（暂存，未落库）。
 * BOM / 库存导入场景下，从立创或手工新增的物料先在内存中绑定到行，
 * 用户点「保存」时才统一 createMaterial → 入库 → 写附件 → 建采购单。
 */
export interface MaterialDraft {
  name: string
  model: string | null
  brand: string | null
  package: string | null
  part_no: string | null
  category_id: string | null
  params: Record<string, unknown>
  /** 初始库存 > 0 时，落库后走 applyStock 入库（产生流水） */
  qty: number
  location: string | null
  price: number
  threshold: number
  image_path: string | null
  datasheet_path: string | null
  link: string | null
  /** 备注说明（如导入来源文件名） */
  remark: string | null
  /** 立创附件（数据手册 / 认证资料 / 行业资讯），落库后写入 material_files */
  files?: { name: string; url: string; file_type: string }[]
}

/** 新增物料表单的保存结果 */
export interface MaterialFormResult {
  /** 表单产出的物料数据 */
  draft: MaterialDraft
  /** 已落库的物料行；暂存模式（deferPersist）下为 null */
  material: MaterialRow | null
}

export interface StockLog {
  id: string
  owner: string
  material_id: string | null
  type: 'in' | 'out'
  qty: number
  /** 入库时记录的供应商 */
  supplier_id: string | null
  note: string | null
  created_at: string
  materials?: { name: string | null; model: string | null; package: string | null } | null
  suppliers?: { name: string | null } | null
}

// ===== 库存盘点 =====
export interface StockTake {
  id: string
  owner: string
  name: string
  note: string | null
  status: string
  created_at: string
  /** 汇总（列表展示用） */
  item_count?: number | null
  diff_count?: number | null
}

export interface StockTakeItem {
  id: string
  take_id: string
  material_id: string | null
  material_name: string | null
  /** 账面数量 */
  book_qty: number
  /** 实盘数量 */
  actual_qty: number
  /** 差异 = 实盘 - 账面 */
  diff: number
  created_at: string
}

// ===== 呆滞料 =====
export interface StagnantRow {
  id: string
  name: string
  model: string | null
  brand: string | null
  package: string | null
  part_no: string | null
  qty: number
  price: number
  /** 最近一次出入库时间（无流水则取入库时间）；null 表示未知 */
  last_move: string | null
  /** 距今天数（无记录视为极大值） */
  days: number
}

export interface BomProject {
  id: string
  owner: string
  name: string
  created_at: string
}

export interface BomItem {
  id: string
  project_id: string
  material_id: string | null
  raw: string | null
  qty: number
  matched: boolean
  materials?: MaterialRow | null
}

/** 领料记录：一次领料出库（可多套）生成一条，便于按 BOM 维度追溯历史 */
export interface BomPickRecord {
  id: string
  project_id: string
  /** 本次领料的套数（每套按 BOM 各行 qty 出库） */
  sets: number
  note: string | null
  created_at: string
}

/**
 * 物料附件（数据手册 / 认证资料 / 行业资讯），一个物料可有多个。
 * file_type 沿用立创分类：pdf_property 数据手册 / certification_data_property 认证资料 / industry_information 行业资讯
 */
export interface MaterialFile {
  id: string
  owner: string
  material_id: string
  name: string
  url: string
  file_type: string | null
  /** lcsc = 立创导入，manual = 手工添加 */
  source: string | null
  sort_order: number
  created_at: string
}

/** 待采购单（主表）：来源可以是 BOM 导入的缺料行，也可以手工新建 */
export interface PurchaseOrder {
  id: string
  owner: string
  name: string
  /** 来源：bom = BOM 导入生成，manual = 手工新建 */
  source: string | null
  /** 关联的 BOM 项目 id（来源为 bom 时） */
  source_id: string | null
  note: string | null
  /** 状态：pending = 采购中（可编辑 / 可删除 / 可完成采购），done = 已完成（只读、不可删） */
  status: string | null
  created_at: string
}

/** 待采购明细：未匹配物料没有 material_id，靠名称/型号等快照字段描述 */
export interface PurchaseItem {
  id: string
  order_id: string
  material_id: string | null
  name: string
  model: string | null
  brand: string | null
  package: string | null
  part_no: string | null
  /** 需求数量 */
  qty: number
  /** 建单时的库存快照 */
  stock_qty: number | null
  /** 缺料数量 = max(0, 需求 - 库存) */
  lack_qty: number
  /** 备注（位号 / 来源行） */
  note: string | null
  /** 是否已处理（已入库或已忽略） */
  done: boolean
  created_at: string
  materials?: { name: string | null; model: string | null; package: string | null; qty: number | null } | null
}

/** 基础数据字典类型（如 库位、出库用途） */
export interface DictType {
  id: string
  owner: string
  /** 字典标识（如 location / out_purpose），同 owner 下唯一 */
  key: string
  /** 显示名（如 库位） */
  name: string
  /** 内置字典（库位/出库用途）不可删除 */
  builtin: boolean
  sort_order: number
  created_at: string
}

/** 字典项 */
export interface DictItem {
  id: string
  owner: string
  dict_key: string
  label: string
  sort_order: number
  created_at: string
}

// ===== 标签打印模板 =====

/** 标签内的一个内容块：位置尺寸以「单元块」为单位（栅格 rows × cols） */
export interface LabelBlock {
  id: string
  /** field = 取物料字段值；text = 固定文本 */
  type: 'field' | 'text'
  /** 左上角所在单元块坐标（从 0 开始） */
  x: number
  y: number
  /** 占几个单元块（跨行 / 跨列即合并） */
  w: number
  h: number
  /**
   * 取值来源。固定字段用主表列名（name / model / brand / package / part_no /
   * location / category_minor / qty / price / id）；分类参数用 `param:<key>`。
   */
  field?: string
  /** 值前缀，如「型号：」 */
  prefix?: string
  /** type=text 时的固定文本 */
  text?: string
  align?: 'left' | 'center' | 'right'
  valign?: 'top' | 'middle' | 'bottom'
  /** 覆盖模板默认字号 */
  font_pt?: number
  bold?: boolean
  /** 内容过长时自动缩小字号塞进格子 */
  auto_shrink?: boolean
  /** 取值为空时：keep 保留空格子 / hide 连块一起不画 */
  empty_behavior?: 'keep' | 'hide'
}

/** 纸张与贴纸排版（沿用贴纸打印工具的参数，用于抵消实际打印偏移） */
export interface LabelSheetLayout {
  paper: 'A4' | 'A5' | 'LETTER' | 'CUSTOM'
  paper_w: number
  paper_h: number
  /** 整张不干胶尺寸 */
  sheet_w: number
  sheet_h: number
  /** 一张纸上排几个标签 */
  cols: number
  rows: number
  /** 贴纸四周留白与标签间距（mm） */
  pad: number
  gap_w: number
  gap_h: number
  pos_mode: 'center' | 'custom'
  off_x: number
  off_y: number
  /** 比例校正 = 100 ÷ 实测基准条长度 */
  scale_fix: number
  /** 打印辅助线（裁切用） */
  guides: boolean
  /** 自动铺满整页：自动算 列×行、居中、偏移 0/0，与手动排版互斥 */
  auto_fill?: boolean
}

/** 某个分类在模板里的标签配置：尺寸共用模板，字段各分类不同 */
export interface LabelCatConfig {
  category_id: string
  /** 该分类显示的字段块（在模板固定尺寸内排版） */
  blocks: LabelBlock[]
  /** 该分类内排序：cat = 分类序号，field = 指定扩展字段 */
  sort_mode: 'cat' | 'field'
  /** sort_mode=field 时使用的扩展字段 key（本分类参数） */
  sort_field: string | null
  /** 排序方向 */
  sort_dir: 'asc' | 'desc'
}

/** 标签打印模板：一套模板 = 一种标签尺寸 + 每个分类各自的字段布局 */
export interface LabelTemplate {
  id: string
  owner: string
  name: string
  /** 单个标签尺寸（mm）；全模板共用，分类配置不覆盖 */
  width_mm: number
  height_mm: number
  /** 标签内部栅格：grid_rows × grid_cols 个单元块，块的 x/y/w/h 以此为刻度（对应库表 label_templates.grid_rows / grid_cols） */
  grid_rows: number
  grid_cols: number
  /** 分类配置列表：每个分类一份自己的 blocks 与排序 */
  cats: LabelCatConfig[]
  default_font_pt: number
  /** 纸张 / 排版参数 */
  layout: LabelSheetLayout
  /** 默认模板（唯一），无命中时的兜底 */
  is_default: boolean
  /** 内置模板：由脚本种子写入，App 层禁止删除 */
  builtin?: boolean
  created_at: string
  deleted_at: string | null
}
