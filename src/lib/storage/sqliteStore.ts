// SQLite 数据存储实现（离线模式）
//
// 使用 tauri-plugin-sql 执行 SQL，db 文件由 tauri.conf.json preload 指定为
// sqlite:data.db。首次调用任何方法时懒执行建表脚本（幂等）。
//
// 离线模式特性：
//   - owner 固定为 'local-user'（单用户）
//   - UUID 用 crypto.randomUUID() 生成
//   - JSON 字段写入前 stringify，读取后 parse
//   - 布尔值用 0/1
//   - 时间戳为 ISO 8601 字符串
//   - 图片等文件存程序 resource 目录 images/<yyyyMMdd>/，DB 仅存相对路径
//     展示时经 Tauri asset 协议（convertFileSrc）转为可访问 URL
import Database from '@tauri-apps/plugin-sql'
import { invoke, convertFileSrc } from '@tauri-apps/api/core'
import type {
  DataStore, ListMaterialsOpts, StockInput, ApplyStockInput,
  UploadResult, StatsOverview, StatsCategoryRow, LowStockRow, TrendRow, StockSummaryRow,
  PageResult, StockLogPageOpts, PurchaseOrderPageOpts,
} from './types'
import type {
  Category, CategoryParam, SupplierRow, MaterialRow, StockLog, BomProject, BomItem,
  BomPickRecord, PurchaseOrder, PurchaseItem, MaterialFile, DictType, DictItem,
  LabelTemplate, LabelBlock, LabelCatConfig, LabelSheetLayout,
  StockTake, StockTakeItem, StagnantRow,
} from '../types'
import { DEFAULT_LABEL_LAYOUT, normalizeTemplate } from '../labelDefaults'

/** 全局默认低库存阈值：物料自身 / 所属分类都未设置时的兜底值 */
const DEFAULT_LOW_THRESHOLD = 5

// ===== 建表 SQL（幂等，可重复执行） =====
const SCHEMA_SQL = `
pragma foreign_keys = on;

create table if not exists categories (
  id              text        primary key,
  owner           text        not null,
  name            text        not null,
  parent          text        references categories(id) on delete set null,
  lcsc_id         integer,
  location_prefix text,
  threshold       integer     default 0,
  sort_order      integer     default 0,
  created_at      text        default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  deleted_at      text
);

create table if not exists category_params (
  id              text        primary key,
  owner           text        not null,
  category_id     text        not null references categories(id) on delete cascade,
  key             text        not null,
  name            text        not null default '',
  value_list      text        default '[]',
  sort_order      integer     default 0,
  created_at      text        default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  unique (category_id, key)
);

create table if not exists suppliers (
  id              text        primary key,
  owner           text        not null,
  name            text        not null,
  addr            text,
  contact         text,
  phone           text,
  note            text,
  created_at      text        default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  deleted_at      text
);

create table if not exists materials (
  id              text        primary key,
  owner           text        not null,
  category_id     text        references categories(id) on delete set null,
  name            text        not null,
  model           text,
  brand           text,
  package         text,
  part_no         text,
  threshold       integer     default 0,
  qty             integer     not null default 0,
  location        text,
  price           real        default 0,
  image_path      text,
  datasheet_path  text,
  link            text,
  alternates      text        default '[]',
  created_at      text        default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  deleted_at      text
);

-- 物料附件（数据手册 / 认证资料 / 行业资讯），一个物料可有多个
create table if not exists material_files (
  id           text        primary key,
  owner        text        not null,
  material_id  text        not null references materials(id) on delete cascade,
  name         text        not null,
  url          text        not null,
  file_type    text,
  source       text,                                        -- lcsc | manual
  sort_order   integer     default 0,
  created_at   text        default (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

create table if not exists material_params (
  id              text        primary key,
  owner           text        not null,
  material_id     text        not null references materials(id) on delete cascade,
  param_key       text        not null,
  value           text,
  sort_order      integer     default 0,
  created_at      text        default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  unique (material_id, param_key)
);

create table if not exists stock_log (
  id            text        primary key,
  owner         text        not null,
  material_id   text        references materials(id) on delete cascade,
  type          text        not null check (type in ('in','out')),
  qty           integer     not null,
  note          text,
  created_at    text        default (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- 库存盘点（主表 + 明细）：差异在提交时通过 applyStock 入账
create table if not exists stocktakes (
  id            text        primary key,
  owner         text        not null,
  name          text        not null,
  note          text,
  status        text        default 'done',                  -- done = 已入账
  created_at    text        default (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

create table if not exists stocktake_items (
  id            text        primary key,
  take_id       text        not null references stocktakes(id) on delete cascade,
  material_id   text        references materials(id) on delete set null,
  material_name text,
  book_qty      integer     not null default 0,              -- 账面数量
  actual_qty    integer     not null default 0,              -- 实盘数量
  diff          integer     not null default 0,              -- 差异 = 实盘 - 账面
  created_at    text        default (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

create table if not exists bom_projects (
  id          text        primary key,
  owner       text        not null,
  name        text        not null,
  created_at  text        default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  deleted_at  text
);

create table if not exists bom_items (
  id           text        primary key,
  project_id   text        not null references bom_projects(id) on delete cascade,
  material_id  text        references materials(id) on delete set null,
  raw          text,
  qty          integer     not null default 1,
  matched      integer     default 0
);

-- 领料记录：一次领料出库（可多套）生成一条，便于按 BOM 维度追溯历史
create table if not exists bom_pick_records (
  id           text        primary key,
  owner        text        not null,
  project_id   text        not null references bom_projects(id) on delete cascade,
  sets         int         not null default 1,
  note         text,
  created_at   text        default (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- 待采购单（主表 + 明细）：来源可以是 BOM 导入的缺料行，也可手工新建
create table if not exists purchase_orders (
  id          text        primary key,
  owner       text        not null,
  name        text        not null,
  source      text,                                          -- bom | manual
  source_id   text,                                          -- 来源为 bom 时指向 bom_projects.id
  note        text,                                          -- 采购原因
  status      text        default 'pending',                  -- pending = 采购中 | done = 已完成
  created_at  text        default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  deleted_at  text
);

create table if not exists purchase_items (
  id           text        primary key,
  order_id     text        not null references purchase_orders(id) on delete cascade,
  material_id  text        references materials(id) on delete set null,
  name         text        not null,                          -- 物料名称（快照）
  model        text,
  brand        text,
  package      text,
  part_no      text,
  qty          integer     not null default 1,                -- 需求数量
  stock_qty    integer,                                       -- 建单时的库存快照
  lack_qty     integer     not null default 0,                -- 缺料数量 = max(0, 需求 - 库存)
  note         text,                                          -- 备注（位号 / 来源行）
  done         integer     default 0,                         -- 是否已处理
  created_at   text        default (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

create table if not exists settings (
  owner       text        primary key,
  theme       text        default 'auto',
  data        text        default '{}'
);

create table if not exists dict_types (
  id          text        primary key,
  owner       text        not null,
  key         text        not null,
  name        text        not null,
  builtin     integer     default 0,
  sort_order  integer     default 0,
  created_at  text        default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  unique (owner, key)
);

create table if not exists dict_items (
  id          text        primary key,
  owner       text        not null,
  dict_key    text        not null,
  label       text        not null,
  sort_order  integer     default 0,
  created_at  text        default (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- 标签打印模板：一套模板 = 一种标签尺寸 + 每个分类各自的字段布局
create table if not exists label_templates (
  id               text        primary key,
  owner            text        not null,
  name             text        not null,
  width_mm         real        not null default 24,            -- 单标签宽（全模板共用）
  height_mm        real        not null default 12,            -- 单标签高（全模板共用）
  grid_rows        integer     not null default 2,             -- 内部栅格行（单元块）
  grid_cols        integer     not null default 2,             -- 内部栅格列
  cats             text        default '[]',                   -- JSON: LabelCatConfig[]（每分类 blocks + 排序）
  default_font_pt  real        not null default 8,
  layout           text        default '{}',                   -- JSON: LabelSheetLayout
  is_default       integer     default 0,
  builtin          integer     not null default 0,   -- 内置模板：不可删除
  created_at       text        default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  deleted_at       text
);
`

// 索引单独放，避免旧库列缺失导致建索引失败
const INDEXES_SQL = `
create index if not exists idx_categories_owner  on categories(owner);
create index if not exists idx_categories_parent on categories(parent);
create index if not exists idx_categories_lcsc   on categories(lcsc_id);
create index if not exists idx_categories_sort   on categories(parent, sort_order);
create index if not exists idx_catparams_cat     on category_params(category_id);
create index if not exists idx_suppliers_owner   on suppliers(owner);
create index if not exists idx_materials_owner    on materials(owner);
create index if not exists idx_materials_category on materials(category_id);
create index if not exists idx_matparams_mat      on material_params(material_id);
create index if not exists idx_matfiles_mat       on material_files(material_id);
create index if not exists idx_stocklog_owner      on stock_log(owner, created_at);
create index if not exists idx_stocktakes_owner     on stocktakes(owner);
create index if not exists idx_stocktake_items_take on stocktake_items(take_id);
create index if not exists idx_bomitems_project    on bom_items(project_id);
create index if not exists idx_purchase_orders_owner on purchase_orders(owner);
create index if not exists idx_purchase_items_order  on purchase_items(order_id);
create index if not exists idx_dicttypes_owner     on dict_types(owner);
create index if not exists idx_dictitems_key       on dict_items(owner, dict_key, sort_order);
create index if not exists idx_labeltpl_owner      on label_templates(owner, deleted_at);
`

// 旧库迁移：增量补列（软删除 deleted_at、stock_log.supplier_id）
// SQLite 不支持 DROP COLUMN（3.35+），materials 旧列保留不影响新逻辑
const MIGRATE_COLUMNS: Array<{ table: string; column: string }> = [
  { table: 'stock_log', column: 'supplier_id' },
  { table: 'categories', column: 'deleted_at' },
  { table: 'suppliers', column: 'deleted_at' },
  { table: 'label_templates', column: 'cats' },
  { table: 'label_templates', column: 'builtin' },
  { table: 'materials', column: 'deleted_at' },
  { table: 'materials', column: 'link' },
  { table: 'materials', column: 'remark' },
  { table: 'bom_projects', column: 'deleted_at' },
  { table: 'purchase_orders', column: 'status' },
]

/*
 * 内置标签模板种子：新库首次启动时写入，之后不再覆盖（可改、不可删）。
 * 内容与 script/sqlite/0001_init.sql 第 9 段保持一致 —— 两处都改时要同步。
 * 只种一份「默认格式」（category_id 为空 = 未匹配分类时的兜底），不含任何本机分类 id / 参数 key。
 */
const BUILTIN_TPL_CATS = '[{"category_id":"","blocks":[{"id":"b-name","type":"field","field":"name","x":0,"y":0,"w":4,"h":1,"align":"center","valign":"middle","auto_shrink":true,"font_pt":6},{"id":"b-brand","type":"field","field":"brand","x":0,"y":1,"w":2,"h":1,"align":"left","valign":"middle","auto_shrink":true,"font_pt":6},{"id":"b-model","type":"field","field":"model","x":2,"y":1,"w":2,"h":1,"align":"left","valign":"middle","auto_shrink":true,"font_pt":6},{"id":"b-partno","type":"field","field":"part_no","x":0,"y":2,"w":2,"h":1,"align":"left","valign":"middle","auto_shrink":true,"font_pt":6},{"id":"b-location","type":"field","field":"location","x":2,"y":2,"w":2,"h":1,"align":"left","valign":"middle","auto_shrink":true,"font_pt":6}],"sort_mode":"cat","sort_field":null,"sort_dir":"asc"}]'
const BUILTIN_TPL_LAYOUT = '{"paper":"A4","paper_w":210,"paper_h":297,"sheet_w":210,"sheet_h":297,"cols":8,"rows":26,"pad":2,"gap_w":2,"gap_h":2,"pos_mode":"custom","off_x":0,"off_y":0,"scale_fix":1,"guides":true,"auto_fill":false}'
const BUILTIN_TPL_ID = 'builtin-label-default'

/** 写入内置模板：已存在同 id 或任何内置模板时跳过（不覆盖用户的修改） */
async function seedBuiltinLabelTemplate(db: Database) {
  const rows = await db.select<{ id: string }[]>(
    'select id from label_templates where id = ? or builtin = 1 limit 1', [BUILTIN_TPL_ID],
  )
  if (rows.length) return
  await db.execute(
    `insert into label_templates
       (id, owner, name, width_mm, height_mm, grid_rows, grid_cols,
        cats, default_font_pt, layout, is_default, builtin, created_at)
     values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1, ?)`,
    [
      BUILTIN_TPL_ID, LOCAL_OWNER, '默认模板',
      24, 9, 3, 4,
      BUILTIN_TPL_CATS, 6, BUILTIN_TPL_LAYOUT, now(),
    ],
  )
}

// 检查某列是否存在
async function columnExists(db: Database, table: string, column: string): Promise<boolean> {
  const rows = await db.select<{ name: string }[]>(
    `pragma table_info(${table})`,
  )
  return rows.some(r => r.name === column)
}

// ===== 工具函数 =====

const LOCAL_OWNER = 'local-user'

function uuid(): string {
  return crypto.randomUUID()
}

function now(): string {
  return new Date().toISOString()
}

function toJson(v: unknown): string {
  return v == null ? '[]' : JSON.stringify(v)
}

function fromJson<T>(v: unknown, fallback: T): T {
  if (typeof v !== 'string') return fallback
  try { return JSON.parse(v) as T } catch { return fallback }
}

function boolToDb(b: boolean | undefined): number {
  return b ? 1 : 0
}

function dbToBool(v: unknown): boolean {
  return v === 1 || v === true || v === '1' || v === 'true'
}

// ===== 文件存储（resource 目录 images/<yyyyMMdd>/） =====

/** resource 目录绝对路径（ensure() 时加载并缓存） */
let resourceDir: string | null = null

/** 本地日期 yyyyMMdd，用作图片存放子目录 */
function yyyyMMdd(d = new Date()): string {
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}${m}${day}`
}

/** File → base64（分块转换，避免大文件栈溢出） */
async function fileToBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  let bin = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(bin)
}

// ===== 行映射（DB -> TS 类型） =====

interface CategoryRow {
  id: string; owner: string; name: string; parent: string | null
  lcsc_id: number | null; location_prefix: string | null
  threshold: number; sort_order: number
  created_at: string
}

function mapCategory(r: Record<string, unknown>): Category {
  const row = r as unknown as CategoryRow
  return {
    id: row.id, owner: row.owner, name: row.name, parent: row.parent,
    lcsc_id: row.lcsc_id, location_prefix: row.location_prefix,
    threshold: row.threshold, sort_order: row.sort_order,
    created_at: row.created_at,
  }
}

interface MaterialDbRow {
  id: string; owner: string; category_id: string | null
  name: string; model: string | null; brand: string | null; package: string | null
  part_no: string | null; threshold: number
  qty: number; location: string | null
  price: number; image_path: string | null; datasheet_path: string | null
  link: string | null
  remark: string | null
  alternates: string | null; created_at: string
  category_name?: string | null
  category_threshold?: number | null
  parent_name?: string | null
}

function mapMaterial(r: Record<string, unknown>): MaterialRow {
  const row = r as unknown as MaterialDbRow
  return {
    id: row.id, owner: row.owner, category_id: row.category_id,
    name: row.name, model: row.model, brand: row.brand, package: row.package,
    part_no: row.part_no ?? null,
    threshold: row.threshold ?? 0,
    params: {},
    qty: row.qty, location: row.location, price: Number(row.price) || 0,
    image_path: row.image_path, datasheet_path: row.datasheet_path,
    link: row.link ?? null,
    remark: row.remark ?? null,
    alternates: fromJson<string[]>(row.alternates, []),
    created_at: row.created_at,
    categories: row.category_name != null
      ? { name: row.category_name, threshold: row.category_threshold ?? null, parent_name: row.parent_name ?? null }
      : null,
  }
}

interface SupplierDbRow {
  id: string; owner: string; name: string
  addr: string | null; contact: string | null
  phone: string | null; note: string | null; created_at: string
}

function mapSupplier(r: Record<string, unknown>): SupplierRow {
  const row = r as unknown as SupplierDbRow
  return {
    id: row.id, owner: row.owner, name: row.name,
    addr: row.addr ?? null, contact: row.contact ?? null,
    phone: row.phone ?? null, note: row.note ?? null, created_at: row.created_at,
  }
}

interface DictTypeDbRow {
  id: string; owner: string; key: string; name: string
  builtin: number; sort_order: number; created_at: string
}

function mapDictType(r: Record<string, unknown>): DictType {
  const row = r as unknown as DictTypeDbRow
  return {
    id: row.id, owner: row.owner, key: row.key, name: row.name,
    builtin: dbToBool(row.builtin), sort_order: row.sort_order, created_at: row.created_at,
  }
}

interface DictItemDbRow {
  id: string; owner: string; dict_key: string; label: string
  sort_order: number; created_at: string
}

function mapDictItem(r: Record<string, unknown>): DictItem {
  const row = r as unknown as DictItemDbRow
  return {
    id: row.id, owner: row.owner, dict_key: row.dict_key,
    label: row.label, sort_order: row.sort_order, created_at: row.created_at,
  }
}

interface StockLogDbRow {
  id: string; owner: string; material_id: string | null
  type: 'in' | 'out'; qty: number; note: string | null; created_at: string
  supplier_id?: string | null; supplier_name?: string | null
  comp_name?: string | null; comp_model?: string | null; comp_package?: string | null
}

function mapStockLog(r: Record<string, unknown>): StockLog {
  const row = r as unknown as StockLogDbRow
  return {
    id: row.id, owner: row.owner, material_id: row.material_id,
    type: row.type, qty: row.qty, note: row.note, created_at: row.created_at,
    supplier_id: row.supplier_id ?? null,
    suppliers: row.supplier_name != null ? { name: row.supplier_name } : null,
    materials: row.comp_name != null
      ? { name: row.comp_name, model: row.comp_model ?? null, package: row.comp_package ?? null }
      : null,
  }
}

interface BomItemDbRow {
  id: string; project_id: string; material_id: string | null
  raw: string | null; qty: number; matched: number
  comp_id?: string; comp_name?: string; comp_model?: string | null
  comp_brand?: string | null; comp_package?: string | null
  comp_qty?: number; comp_image_path?: string | null
  comp_alternates?: string | null; comp_category_name?: string | null
}

/** 待采明细 join materials 后的行结构 */
interface PurchaseItemDbRow extends PurchaseItemDbBase {
  comp_id?: string | null
  comp_name?: string | null
  comp_model?: string | null
  comp_package?: string | null
  comp_qty?: number | null
}
interface PurchaseItemDbBase {
  id: string; order_id: string; material_id: string | null
  name: string; model: string | null; brand: string | null; package: string | null; part_no: string | null
  qty: number; stock_qty: number | null; lack_qty: number; note: string | null
  done: number | boolean; created_at: string
}

function mapMaterialFile(r: Record<string, unknown>): MaterialFile {
  const row = r as unknown as MaterialFile
  return {
    id: row.id,
    owner: row.owner,
    material_id: row.material_id,
    name: row.name,
    url: row.url,
    file_type: row.file_type ?? null,
    source: row.source ?? null,
    sort_order: row.sort_order ?? 0,
    created_at: row.created_at,
  }
}

function mapPurchaseItem(r: Record<string, unknown>): PurchaseItem {
  const row = r as unknown as PurchaseItemDbRow
  const hasComp = !!row.comp_id
  return {
    id: row.id,
    order_id: row.order_id,
    material_id: row.material_id,
    name: row.name,
    model: row.model ?? null,
    brand: row.brand ?? null,
    package: row.package ?? null,
    part_no: row.part_no ?? null,
    qty: row.qty ?? 1,
    stock_qty: row.stock_qty ?? null,
    lack_qty: row.lack_qty ?? 0,
    note: row.note ?? null,
    done: dbToBool(row.done),
    created_at: row.created_at,
    materials: hasComp
      ? { name: row.comp_name ?? null, model: row.comp_model ?? null, package: row.comp_package ?? null, qty: row.comp_qty ?? null }
      : null,
  }
}

function mapBomItem(r: Record<string, unknown>): BomItem {
  const row = r as unknown as BomItemDbRow
  const hasComp = !!row.comp_id
  return {
    id: row.id, project_id: row.project_id, material_id: row.material_id,
    raw: row.raw, qty: row.qty, matched: dbToBool(row.matched),
    materials: hasComp ? {
      id: row.comp_id!,
      owner: LOCAL_OWNER,
      category_id: null,
      name: row.comp_name ?? '',
      model: row.comp_model ?? null,
      brand: row.comp_brand ?? null,
      package: row.comp_package ?? null,
      part_no: null,
      threshold: 0,
      params: {},
      qty: row.comp_qty ?? 0,
      location: null,
      price: 0,
      image_path: row.comp_image_path ?? null,
      datasheet_path: null,
      link: null,
      remark: null,
      alternates: fromJson<string[]>(row.comp_alternates, []),
      created_at: '',
      categories: row.comp_category_name != null
        ? { name: row.comp_category_name, threshold: null }
        : null,
    } : null,
  }
}

/** 行 → LabelTemplate（JSON 列在这里解开并归一化） */
function mapLabelTemplate(r: Record<string, unknown>): LabelTemplate {
  const row = r as {
    id: string; owner: string; name: string
    width_mm: number; height_mm: number; grid_rows: number; grid_cols: number
    cats: string | null; default_font_pt: number; layout: string | null
    is_default: number; builtin: number | null; created_at: string; deleted_at: string | null
  }
  return normalizeTemplate({
    id: row.id,
    owner: row.owner,
    name: row.name,
    width_mm: row.width_mm,
    height_mm: row.height_mm,
    grid_rows: row.grid_rows,
    grid_cols: row.grid_cols,
    cats: fromJson<LabelCatConfig[]>(row.cats, []),
    default_font_pt: row.default_font_pt,
    layout: fromJson<LabelSheetLayout>(row.layout, DEFAULT_LABEL_LAYOUT()),
    is_default: dbToBool(row.is_default),
    builtin: dbToBool(row.builtin),
    created_at: row.created_at,
    deleted_at: row.deleted_at ?? null,
  })
}

// ===== Store 实现 =====

export class SqliteStore implements DataStore {
  private db: Database | null = null
  private initPromise: Promise<void> | null = null

  /** 懒加载数据库连接 + 首次建表 */
  private async ensure(): Promise<Database> {
    if (this.db) return this.db
    if (!this.initPromise) {
      this.initPromise = (async () => {
        const db = await Database.load('sqlite:data.db')
        // 启用外键 + 建表（幂等）
        await db.execute('pragma foreign_keys = on;')
        await db.execute(SCHEMA_SQL)
        // 旧库迁移：增量补列
        for (const m of MIGRATE_COLUMNS) {
          if (!(await columnExists(db, m.table, m.column))) {
            await db.execute(`alter table ${m.table} add column ${m.column} text`)
          }
        }
        // 历史待采单补默认状态（增量补列不带默认值，需回填）
        await db.execute(`update purchase_orders set status = 'pending' where status is null or status = ''`)
        // 迁移完成后再建索引（避免列缺失时建索引报错）
        try { await db.execute(INDEXES_SQL) } catch { /* 旧库兼容，忽略索引错误 */ }
        // 内置标签模板：清库 / 新装时自动写入（种子也在 script/sqlite/0001_init.sql，二者等价）
        try { await seedBuiltinLabelTemplate(db) } catch { /* 种子失败不阻塞启动 */ }
        // 缓存 resource 目录（图片相对路径 → asset URL 用）；去掉 Windows canonicalize 的 \\?\ 前缀
        resourceDir = (await invoke<string>('get_resource_dir')).replace(/^\\\\\?\\/, '').replace(/\\/g, '/')
        this.db = db
      })().catch(e => { this.initPromise = null; throw e })
    }
    await this.initPromise
    return this.db!
  }

  async getOwnerId(): Promise<string> {
    return LOCAL_OWNER
  }

  // ===== 分类 =====
  async listCategories(): Promise<Category[]> {
    const db = await this.ensure()
    const rows = await db.select<Record<string, unknown>[]>(`
      select id, owner, name, parent, lcsc_id, location_prefix, threshold, sort_order, created_at
      from categories where deleted_at is null order by sort_order asc, name asc
    `)
    return rows.map(mapCategory)
  }

  async getCategoryParams(id: string): Promise<CategoryParam[]> {
    const db = await this.ensure()
    const rows = await db.select<{ key: string; name: string; value_list: string | null; sort_order: number }[]>(
      'select key, name, value_list, sort_order from category_params where category_id = ? order by sort_order asc',
      [id],
    )
    return rows.map(r => ({ key: r.key, name: r.name, values: fromJson<string[]>(r.value_list, []) }))
  }

  /** 将参数模板写入 category_params 表（先清后插） */
  private async saveCategoryParams(categoryId: string, params: unknown, owner: string): Promise<void> {
    const db = await this.ensure()
    await db.execute('delete from category_params where category_id = ?', [categoryId])
    const list = (typeof params === 'string' ? fromJson<CategoryParam[]>(params, []) : (Array.isArray(params) ? params as CategoryParam[] : []))
      .filter(p => p.key || p.name)
    for (let i = 0; i < list.length; i++) {
      const p = list[i]
      await db.execute(
        `insert into category_params (id, owner, category_id, key, name, value_list, sort_order, created_at)
         values (?, ?, ?, ?, ?, ?, ?, ?)`,
        [uuid(), owner, categoryId, p.key || p.name, p.name || '', toJson(p.values ?? []), i, now()],
      )
    }
  }

  async createCategory(payload: Partial<Category>): Promise<Category> {
    const db = await this.ensure()
    const owner = await this.getOwnerId()
    // 计算 sort_order：同父级下 max + 1
    let sortOrder = payload.sort_order
    if (sortOrder == null) {
      const parent = payload.parent ?? null
      const rows = parent
        ? await db.select<{ m: number | null }[]>(
          'select coalesce(max(sort_order), -1) as m from categories where parent = ? and deleted_at is null',
          [parent],
        )
        : await db.select<{ m: number | null }[]>(
          "select coalesce(max(sort_order), -1) as m from categories where parent is null and deleted_at is null",
        )
      sortOrder = (rows[0]?.m ?? -1) + 1
    }
    const id = payload.id || uuid()
    await db.execute(
      `insert into categories (id, owner, name, parent, lcsc_id, location_prefix, threshold, sort_order, created_at)
       values (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id, owner, payload.name ?? '', payload.parent ?? null,
        payload.lcsc_id ?? null, payload.location_prefix ?? null,
        payload.threshold ?? 0, sortOrder, now(),
      ],
    )
    // 参数模板写入独立表
    if (payload.params !== undefined) {
      await this.saveCategoryParams(id, payload.params, owner)
    }
    const rows = await db.select<Record<string, unknown>[]>(
      'select * from categories where id = ?', [id],
    )
    return mapCategory(rows[0])
  }

  async updateCategory(id: string, patch: Partial<Category>): Promise<Category> {
    const db = await this.ensure()
    const sets: string[] = []
    const vals: unknown[] = []
    if (patch.name !== undefined) { sets.push('name = ?'); vals.push(patch.name) }
    if (patch.parent !== undefined) { sets.push('parent = ?'); vals.push(patch.parent) }
    if (patch.lcsc_id !== undefined) { sets.push('lcsc_id = ?'); vals.push(patch.lcsc_id) }
    if (patch.location_prefix !== undefined) { sets.push('location_prefix = ?'); vals.push(patch.location_prefix) }
    if (patch.threshold !== undefined) { sets.push('threshold = ?'); vals.push(patch.threshold) }
    if (patch.sort_order !== undefined) { sets.push('sort_order = ?'); vals.push(patch.sort_order) }
    if (sets.length) {
      vals.push(id)
      await db.execute(`update categories set ${sets.join(', ')} where id = ?`, vals)
    }
    // 参数模板写入独立表
    if (patch.params !== undefined) {
      const owner = await this.getOwnerId()
      await this.saveCategoryParams(id, patch.params, owner)
    }
    const rows = await db.select<Record<string, unknown>[]>(
      'select * from categories where id = ?', [id],
    )
    if (!rows.length) throw new Error('分类不存在')
    return mapCategory(rows[0])
  }

  async deleteCategory(id: string): Promise<void> {
    const db = await this.ensure()
    await db.execute('update categories set deleted_at = ? where id = ?', [now(), id])
  }

  // ===== 物料 =====
  /** 将物料参数值写入 material_params 表（先清后插） */
  private async saveMaterialParams(materialId: string, params: unknown, owner: string): Promise<void> {
    const db = await this.ensure()
    await db.execute('delete from material_params where material_id = ?', [materialId])
    const obj = typeof params === 'string' ? fromJson<Record<string, unknown>>(params, {}) : (params as Record<string, unknown> ?? {})
    const entries = Object.entries(obj).filter(([, v]) => v != null && String(v).trim())
    for (let i = 0; i < entries.length; i++) {
      const [k, v] = entries[i]
      await db.execute(
        `insert into material_params (id, owner, material_id, param_key, value, sort_order, created_at)
         values (?, ?, ?, ?, ?, ?, ?)`,
        [uuid(), owner, materialId, k, String(v).trim(), i, now()],
      )
    }
  }

  /** 批量查询 material_params 并填充到物料行 */
  private async fillMaterialParams(materials: MaterialRow[]): Promise<void> {
    if (!materials.length) return
    const db = await this.ensure()
    const ids = materials.map(m => m.id)
    const placeholders = ids.map(() => '?').join(',')
    const rows = await db.select<{ material_id: string; param_key: string; value: string }[]>(
      `select material_id, param_key, value from material_params where material_id in (${placeholders}) order by sort_order asc`,
      ids,
    )
    if (!rows.length) return
    const map = new Map<string, Record<string, unknown>>()
    for (const r of rows) {
      const p = map.get(r.material_id) || {}
      p[r.param_key] = r.value
      map.set(r.material_id, p)
    }
    for (const m of materials) {
      const p = map.get(m.id)
      if (p) m.params = p
    }
  }

  async listMaterials(opts: ListMaterialsOpts = {}): Promise<MaterialRow[]> {
    const db = await this.ensure()
    const { search = '', categoryId = null, categoryIds, params: paramFilter, location } = opts
    const where: string[] = ['c.deleted_at is null']
    const params: unknown[] = []
    if (categoryId) { where.push('c.category_id = ?'); params.push(categoryId) }
    else if (categoryIds && categoryIds.length) {
      where.push(`c.category_id in (${categoryIds.map(() => '?').join(',')})`)
      params.push(...categoryIds)
    }
    if (location) { where.push('c.location = ?'); params.push(location) }
    if (search && search.trim()) {
      const kws = search.trim().split(/\s+/)
      for (const k of kws) {
        where.push('(c.name like ? or c.model like ? or c.brand like ? or c.package like ?)')
        const kw = `%${k}%`
        params.push(kw, kw, kw, kw)
      }
    }
    if (paramFilter) {
      for (const [k, v] of Object.entries(paramFilter)) {
        if (!v) continue
        where.push('exists (select 1 from material_params mp where mp.material_id = c.id and mp.param_key = ? and mp.value = ?)')
        params.push(k, v)
      }
    }
    const whereSql = where.length ? `where ${where.join(' and ')}` : ''
    if (opts.limit != null) { params.push(opts.limit); if (opts.offset != null) params.push(opts.offset) }
    const rows = await db.select<Record<string, unknown>[]>(
      `select c.*, cat.name as category_name, cat.threshold as category_threshold, parent.name as parent_name
       from materials c
       left join categories cat on cat.id = c.category_id
       left join categories parent on parent.id = cat.parent
       ${whereSql}
       order by c.created_at desc
       ${opts.limit != null ? `limit ?${opts.offset != null ? ' offset ?' : ''}` : ''}`,
      params,
    )
    const materials = rows.map(mapMaterial)
    await this.fillMaterialParams(materials)
    return materials
  }

  async countMaterials(opts: ListMaterialsOpts = {}): Promise<number> {
    const db = await this.ensure()
    const { search = '', categoryId = null, categoryIds, params: paramFilter, location } = opts
    const where: string[] = ['c.deleted_at is null']
    const params: unknown[] = []
    if (categoryId) { where.push('c.category_id = ?'); params.push(categoryId) }
    else if (categoryIds && categoryIds.length) {
      where.push(`c.category_id in (${categoryIds.map(() => '?').join(',')})`)
      params.push(...categoryIds)
    }
    if (location) { where.push('c.location = ?'); params.push(location) }
    if (search && search.trim()) {
      const kws = search.trim().split(/\s+/)
      for (const k of kws) {
        where.push('(c.name like ? or c.model like ? or c.brand like ? or c.package like ?)')
        const kw = `%${k}%`
        params.push(kw, kw, kw, kw)
      }
    }
    if (paramFilter) {
      for (const [k, v] of Object.entries(paramFilter)) {
        if (!v) continue
        where.push('exists (select 1 from material_params mp where mp.material_id = c.id and mp.param_key = ? and mp.value = ?)')
        params.push(k, v)
      }
    }
    const whereSql = where.length ? `where ${where.join(' and ')}` : ''
    const rows = await db.select<{ n: number }[]>(`select count(*) as n from materials c ${whereSql}`, params)
    return Number(rows[0]?.n ?? 0)
  }

  async createMaterial(payload: Partial<MaterialRow>): Promise<MaterialRow> {
    const db = await this.ensure()
    const owner = await this.getOwnerId()
    const id = payload.id || uuid()
    const alternatesStr = toJson(payload.alternates ?? [])
    await db.execute(
      `insert into materials (id, owner, category_id, name, model, brand, package, part_no, threshold, qty, location, price, image_path, datasheet_path, link, remark, alternates, created_at)
       values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id, owner, payload.category_id ?? null, payload.name ?? '',
        payload.model ?? null, payload.brand ?? null, payload.package ?? null,
        payload.part_no ?? null,
        payload.threshold ?? 0,
        payload.qty ?? 0, payload.location ?? null,
        Number(payload.price) || 0, payload.image_path ?? null,
        payload.datasheet_path ?? null, payload.link ?? null,
        payload.remark ?? null, alternatesStr, now(),
      ],
    )
    // 参数值写入独立表
    if (payload.params !== undefined) {
      await this.saveMaterialParams(id, payload.params, owner)
    }

    // 初始库存 > 0 时写入一条入库流水（备注：初始入库）
    if ((payload.qty ?? 0) > 0) {
      await db.execute(
        `insert into stock_log (id, owner, material_id, type, qty, supplier_id, note, created_at)
         values (?, ?, ?, 'in', ?, null, ?, ?)`,
        [uuid(), owner, id, payload.qty, '初始入库', now()],
      )
    }
    return (await this.getMaterial(id))
  }

  async deleteMaterial(id: string): Promise<void> {
    const db = await this.ensure()
    await db.execute('update materials set deleted_at = ? where id = ?', [now(), id])
  }

  /** 批量软删除：单条语句完成，避免逐条往返 */
  async deleteMaterials(ids: string[]): Promise<void> {
    if (!ids.length) return
    const db = await this.ensure()
    const placeholders = ids.map(() => '?').join(',')
    await db.execute(`update materials set deleted_at = ? where id in (${placeholders})`, [now(), ...ids])
  }

  async updateMaterial(id: string, patch: Partial<MaterialRow>): Promise<MaterialRow> {
    const db = await this.ensure()
    const sets: string[] = []
    const vals: unknown[] = []
    const map: Record<string, string> = {
      category_id: 'category_id', name: 'name', model: 'model', brand: 'brand',
      package: 'package', part_no: 'part_no',
      threshold: 'threshold',
      qty: 'qty', location: 'location',
      image_path: 'image_path', datasheet_path: 'datasheet_path',
      link: 'link', remark: 'remark',
    }
    for (const k of Object.keys(map)) {
      if ((patch as Record<string, unknown>)[k] !== undefined) {
        sets.push(`${map[k]} = ?`)
        vals.push((patch as Record<string, unknown>)[k])
      }
    }
    if (patch.price !== undefined) { sets.push('price = ?'); vals.push(Number(patch.price) || 0) }
    if (patch.alternates !== undefined) {
      sets.push('alternates = ?')
      vals.push(toJson(patch.alternates))
    }
    if (sets.length) {
      vals.push(id)
      await db.execute(`update materials set ${sets.join(', ')} where id = ?`, vals)
    }
    // 参数值写入独立表
    if (patch.params !== undefined) {
      const owner = await this.getOwnerId()
      await this.saveMaterialParams(id, patch.params, owner)
    }
    return (await this.getMaterial(id))
  }

  async getMaterial(id: string): Promise<MaterialRow> {
    const db = await this.ensure()
    const rows = await db.select<Record<string, unknown>[]>(
      `select c.*, cat.name as category_name, cat.threshold as category_threshold, parent.name as parent_name
       from materials c
       left join categories cat on cat.id = c.category_id
       left join categories parent on parent.id = cat.parent
       where c.id = ? and c.deleted_at is null`,
      [id],
    )
    if (!rows.length) throw new Error('物料不存在')
    const mat = mapMaterial(rows[0])
    // 从 material_params 表填充参数值
    const paramRows = await db.select<{ param_key: string; value: string }[]>(
      'select param_key, value from material_params where material_id = ? order by sort_order asc',
      [id],
    )
    if (paramRows.length) {
      const params: Record<string, unknown> = {}
      for (const r of paramRows) params[r.param_key] = r.value
      mat.params = params
    }
    return mat
  }

  // ===== 供应商 =====
  async listSuppliers(): Promise<SupplierRow[]> {
    const db = await this.ensure()
    const rows = await db.select<Record<string, unknown>[]>(
      'select * from suppliers where deleted_at is null order by created_at desc',
    )
    return rows.map(mapSupplier)
  }

  async createSupplier(payload: Partial<SupplierRow>): Promise<SupplierRow> {
    const db = await this.ensure()
    const owner = await this.getOwnerId()
    const id = payload.id || uuid()
    await db.execute(
      `insert into suppliers (id, owner, name, addr, contact, phone, note, created_at)
       values (?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, owner, payload.name ?? '', payload.addr ?? null,
        payload.contact ?? null, payload.phone ?? null, payload.note ?? null, now()],
    )
    const rows = await db.select<Record<string, unknown>[]>(
      'select * from suppliers where id = ?', [id],
    )
    if (!rows.length) throw new Error('供应商创建失败')
    return mapSupplier(rows[0])
  }

  async updateSupplier(id: string, patch: Partial<SupplierRow>): Promise<SupplierRow> {
    const db = await this.ensure()
    const sets: string[] = []
    const vals: unknown[] = []
    const map: Record<string, string> = {
      name: 'name', addr: 'addr', contact: 'contact',
      phone: 'phone', note: 'note',
    }
    for (const k of Object.keys(map)) {
      if ((patch as Record<string, unknown>)[k] !== undefined) {
        sets.push(`${map[k]} = ?`)
        vals.push((patch as Record<string, unknown>)[k])
      }
    }
    if (sets.length) {
      vals.push(id)
      await db.execute(`update suppliers set ${sets.join(', ')} where id = ?`, vals)
    }
    const rows = await db.select<Record<string, unknown>[]>(
      'select * from suppliers where id = ?', [id],
    )
    if (!rows.length) throw new Error('供应商不存在')
    return mapSupplier(rows[0])
  }

  async deleteSupplier(id: string): Promise<void> {
    const db = await this.ensure()
    await db.execute('update suppliers set deleted_at = ? where id = ?', [now(), id])
  }

  // ===== 基础数据（字典） =====
  async listDictTypes(): Promise<DictType[]> {
    const db = await this.ensure()
    const rows = await db.select<Record<string, unknown>[]>(
      'select id, owner, key, name, builtin, sort_order, created_at from dict_types order by sort_order asc, id asc',
    )
    return rows.map(mapDictType)
  }

  async createDictType(payload: Partial<DictType>): Promise<DictType> {
    const db = await this.ensure()
    const owner = await this.getOwnerId()
    let sortOrder = payload.sort_order
    if (sortOrder == null) {
      const rows = await db.select<{ m: number | null }[]>(
        'select coalesce(max(sort_order), -1) as m from dict_types where owner = ?', [owner],
      )
      sortOrder = (rows[0]?.m ?? -1) + 1
    }
    const id = payload.id || uuid()
    await db.execute(
      'insert into dict_types (id, owner, key, name, builtin, sort_order, created_at) values (?, ?, ?, ?, ?, ?, ?)',
      [id, owner, payload.key ?? '', payload.name ?? '', boolToDb(payload.builtin), sortOrder, now()],
    )
    const rows = await db.select<Record<string, unknown>[]>('select * from dict_types where id = ?', [id])
    return mapDictType(rows[0])
  }

  async deleteDictType(id: string): Promise<void> {
    const db = await this.ensure()
    // 连带删除该字典下所有项（物理删除，字典为低风险数据）
    const rows = await db.select<{ key: string }[]>('select key from dict_types where id = ?', [id])
    if (rows.length) {
      await db.execute('delete from dict_items where dict_key = ?', [rows[0].key])
    }
    await db.execute('delete from dict_types where id = ?', [id])
  }

  async listDictItems(dictKey: string): Promise<DictItem[]> {
    const db = await this.ensure()
    const rows = await db.select<Record<string, unknown>[]>(
      'select id, owner, dict_key, label, sort_order, created_at from dict_items where dict_key = ? order by sort_order asc, created_at asc',
      [dictKey],
    )
    return rows.map(mapDictItem)
  }

  async countDictItems(): Promise<Record<string, number>> {
    const db = await this.ensure()
    const rows = await db.select<{ dict_key: string; c: number }[]>(
      'select dict_key, count(*) as c from dict_items group by dict_key',
    )
    const out: Record<string, number> = {}
    for (const r of rows) out[r.dict_key] = r.c
    return out
  }

  async createDictItem(payload: Partial<DictItem>): Promise<DictItem> {
    const db = await this.ensure()
    const owner = await this.getOwnerId()
    let sortOrder = payload.sort_order
    if (sortOrder == null) {
      const rows = await db.select<{ m: number | null }[]>(
        'select coalesce(max(sort_order), -1) as m from dict_items where dict_key = ?',
        [payload.dict_key ?? ''],
      )
      sortOrder = (rows[0]?.m ?? -1) + 1
    }
    const id = payload.id || uuid()
    await db.execute(
      'insert into dict_items (id, owner, dict_key, label, sort_order, created_at) values (?, ?, ?, ?, ?, ?)',
      [id, owner, payload.dict_key ?? '', payload.label ?? '', sortOrder, now()],
    )
    const rows = await db.select<Record<string, unknown>[]>('select * from dict_items where id = ?', [id])
    return mapDictItem(rows[0])
  }

  async updateDictItem(id: string, patch: Partial<DictItem>): Promise<DictItem> {
    const db = await this.ensure()
    const sets: string[] = []
    const vals: unknown[] = []
    if (patch.label !== undefined) { sets.push('label = ?'); vals.push(patch.label) }
    if (patch.sort_order !== undefined) { sets.push('sort_order = ?'); vals.push(patch.sort_order) }
    if (sets.length) {
      vals.push(id)
      await db.execute(`update dict_items set ${sets.join(', ')} where id = ?`, vals)
    }
    const rows = await db.select<Record<string, unknown>[]>('select * from dict_items where id = ?', [id])
    if (!rows.length) throw new Error('字典项不存在')
    return mapDictItem(rows[0])
  }

  async deleteDictItem(id: string): Promise<void> {
    const db = await this.ensure()
    await db.execute('delete from dict_items where id = ?', [id])
  }

  // ===== 文件（离线模式：落盘到 resource 目录 images|files/<yyyyMMdd>/，DB 存相对路径） =====
  async uploadImage(file: File, _userId: string): Promise<UploadResult> {
    await this.ensure()
    const ext = (file.name.split('.').pop() || 'png')
      .toLowerCase().replace(/[^a-z0-9]/g, '') || 'png'
    const rel = `images/${yyyyMMdd()}/${uuid()}.${ext}`
    const data = await fileToBase64(file)
    await invoke<string>('save_file', { relPath: rel, data })
    return { path: rel, url: this.imagePublicUrl(rel) || rel }
  }

  // 手册等文档：存 resource 目录 files/<yyyyMMdd>/
  async uploadFile(file: File, _userId: string): Promise<UploadResult> {
    await this.ensure()
    const ext = (file.name.split('.').pop() || 'bin')
      .toLowerCase().replace(/[^a-z0-9]/g, '') || 'bin'
    const rel = `files/${yyyyMMdd()}/${uuid()}.${ext}`
    const data = await fileToBase64(file)
    await invoke<string>('save_file', { relPath: rel, data })
    return { path: rel, url: this.imagePublicUrl(rel) || rel }
  }

  imagePublicUrl(path: string | null): string | undefined {
    if (!path) return undefined
    // 兼容旧数据（base64 data URL）与外链 http(s)
    if (/^(data:|https?:)/i.test(path)) return path
    // 新格式：相对 resource 目录的路径 → asset 协议 URL
    if (!resourceDir) return undefined
    return convertFileSrc(`${resourceDir}/${path.replace(/\\/g, '/')}`)
  }

  /** 本地文件绝对路径（手册等用系统默认程序打开）；http/data 外链返回 null */
  localFilePath(path: string): string | null {
    if (!path || /^(data:|https?:)/i.test(path)) return null
    if (!resourceDir) return null
    return `${resourceDir}/${path.replace(/\\/g, '/')}`
  }

  // ===== 出入库 =====
  async addStockLog(input: StockInput): Promise<StockLog> {
    const db = await this.ensure()
    const owner = await this.getOwnerId()
    const id = uuid()
    await db.execute(
      `insert into stock_log (id, owner, material_id, type, qty, supplier_id, note, created_at)
       values (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id, owner, input.material_id, input.type, input.qty,
        input.type === 'in' ? (input.supplier_id ?? null) : null,
        input.note ?? null, now(),
      ],
    )
    const rows = await db.select<Record<string, unknown>[]>(
      `select s.*, c.name as comp_name, c.model as comp_model, c.package as comp_package,
              sup.name as supplier_name
       from stock_log s
       left join materials c on c.id = s.material_id
       left join suppliers sup on sup.id = s.supplier_id
       where s.id = ?`,
      [id],
    )
    if (!rows.length) throw new Error('流水创建失败')
    return mapStockLog(rows[0])
  }

  async listStockLog(opts: { limit?: number; materialId?: string; type?: 'in' | 'out' } = {}): Promise<StockLog[]> {
    const db = await this.ensure()
    const limit = Math.max(1, Math.min(opts.limit ?? 100, 1000))
    const conds: string[] = []
    const params: unknown[] = []
    if (opts.materialId) { conds.push('s.material_id = ?'); params.push(opts.materialId) }
    if (opts.type) { conds.push('s.type = ?'); params.push(opts.type) }
    const where = conds.length ? 'where ' + conds.join(' and ') : ''
    params.push(limit)
    const rows = await db.select<Record<string, unknown>[]>(
      `select s.*, c.name as comp_name, c.model as comp_model, c.package as comp_package,
              sup.name as supplier_name
       from stock_log s
       left join materials c on c.id = s.material_id
       left join suppliers sup on sup.id = s.supplier_id
       ${where}
       order by s.created_at desc limit ?`,
      params,
    )
    return rows.map(mapStockLog)
  }

  async listStockLogPage(opts: StockLogPageOpts = {}): Promise<PageResult<StockLog>> {
    const db = await this.ensure()
    const limit = Math.max(1, opts.limit ?? 20)
    const offset = Math.max(0, opts.offset ?? 0)
    const conds: string[] = []
    const params: unknown[] = []
    if (opts.type) { conds.push('s.type = ?'); params.push(opts.type) }
    if (opts.keyword && opts.keyword.trim()) { conds.push('c.name like ?'); params.push(`%${opts.keyword.trim()}%`) }
    if (opts.from) { conds.push('s.created_at >= ?'); params.push(opts.from) }
    if (opts.to) { conds.push('s.created_at <= ?'); params.push(opts.to) }
    const where = conds.length ? 'where ' + conds.join(' and ') : ''
    const countRows = await db.select<{ n: number }[]>(
      `select count(*) as n from stock_log s left join materials c on c.id = s.material_id ${where}`,
      params,
    )
    const total = Number(countRows[0]?.n ?? 0)
    const rows = await db.select<Record<string, unknown>[]>(
      `select s.*, c.name as comp_name, c.model as comp_model, c.package as comp_package,
              sup.name as supplier_name
       from stock_log s
       left join materials c on c.id = s.material_id
       left join suppliers sup on sup.id = s.supplier_id
       ${where}
       order by s.created_at desc limit ? offset ?`,
      [...params, limit, offset],
    )
    return { rows: rows.map(mapStockLog), total }
  }

  async stagnantMaterials(days = 180): Promise<StagnantRow[]> {
    const db = await this.ensure()
    const rows = await db.select<Record<string, unknown>[]>(
      `select m.id, m.name, m.model, m.brand, m.package, m.part_no, m.qty, m.price,
              coalesce(s.last_log, m.created_at) as last_move
       from materials m
       left join (select material_id, max(created_at) as last_log from stock_log group by material_id) s
         on s.material_id = m.id
       where m.deleted_at is null
       order by last_move asc`,
    )
    const now = Date.now()
    const out: StagnantRow[] = []
    for (const r of rows) {
      const last = r.last_move ? new Date(r.last_move as string).getTime() : 0
      const d = last ? Math.floor((now - last) / 86400000) : 99999
      if (d > days) out.push({
        id: r.id as string, name: r.name as string,
        model: (r.model as string) ?? null, brand: (r.brand as string) ?? null,
        package: (r.package as string) ?? null, part_no: (r.part_no as string) ?? null,
        qty: Number(r.qty) || 0, price: Number(r.price) || 0,
        last_move: (r.last_move as string) ?? null, days: d,
      })
    }
    return out
  }

  async stockSummary(): Promise<StockSummaryRow[]> {
    const db = await this.ensure()
    const since = new Date(Date.now() - 30 * 86400000).toISOString()
    const rows = await db.select<
      { material_id: string; total_in: number; total_out: number; last30_in: number; last30_out: number }[]
    >(
      `select material_id,
              coalesce(sum(case when type = 'in' then qty else 0 end), 0) as total_in,
              coalesce(sum(case when type = 'out' then qty else 0 end), 0) as total_out,
              coalesce(sum(case when type = 'in' and created_at >= ? then qty else 0 end), 0) as last30_in,
              coalesce(sum(case when type = 'out' and created_at >= ? then qty else 0 end), 0) as last30_out
       from stock_log
       where material_id is not null
       group by material_id`,
      [since, since],
    )
    return rows.map(r => ({
      material_id: r.material_id,
      total_in: r.total_in || 0,
      total_out: r.total_out || 0,
      last30_in: r.last30_in || 0,
      last30_out: r.last30_out || 0,
    }))
  }

  async applyStock(input: ApplyStockInput): Promise<MaterialRow> {
    const db = await this.ensure()
    if (input.type === 'out' && input.qty > (input.currentQty || 0))
      throw new Error(`出库数量 ${input.qty} 超过当前库存 ${input.currentQty || 0}`)
    const next = input.type === 'in'
      ? (input.currentQty || 0) + input.qty
      : (input.currentQty || 0) - input.qty
    await this.addStockLog({
      material_id: input.material_id, type: input.type,
      qty: input.qty, supplier_id: input.supplier_id ?? null, note: input.note,
    })
    return await this.updateMaterial(input.material_id, { qty: next })
  }

  // ===== 库存盘点 =====
  async createStocktake(take: StockTake, items: StockTakeItem[]): Promise<void> {
    const db = await this.ensure()
    await db.execute(
      `insert into stocktakes (id, owner, name, note, status, created_at)
       values (?, ?, ?, ?, ?, ?)`,
      [take.id, take.owner, take.name, take.note ?? null, take.status ?? 'done', take.created_at],
    )
    for (const it of items) {
      await db.execute(
        `insert into stocktake_items (id, take_id, material_id, material_name, book_qty, actual_qty, diff, created_at)
         values (?, ?, ?, ?, ?, ?, ?, ?)`,
        [it.id, take.id, it.material_id ?? null, it.material_name ?? null, it.book_qty, it.actual_qty, it.diff, it.created_at],
      )
    }
  }

  async listStocktakes(): Promise<StockTake[]> {
    const db = await this.ensure()
    const rows = await db.select<Record<string, unknown>[]>(
      `select t.*,
         (select count(*) from stocktake_items i where i.take_id = t.id) as item_count,
         (select count(*) from stocktake_items i where i.take_id = t.id and i.diff <> 0) as diff_count
       from stocktakes t order by t.created_at desc`,
    )
    return rows.map(r => ({
      id: r.id as string, owner: r.owner as string, name: r.name as string,
      note: (r.note as string) ?? null, status: (r.status as string) ?? 'done',
      created_at: r.created_at as string,
      item_count: (r.item_count as number | null) ?? null,
      diff_count: (r.diff_count as number | null) ?? null,
    }))
  }

  async getStocktake(id: string): Promise<{ take: StockTake; items: StockTakeItem[] }> {
    const db = await this.ensure()
    const t = (await db.select<Record<string, unknown>[]>('select * from stocktakes where id = ?', [id]))[0]
    if (!t) throw new Error('盘点单不存在')
    const items = await db.select<Record<string, unknown>[]>(
      'select * from stocktake_items where take_id = ? order by created_at', [id],
    )
    return {
      take: {
        id: t.id as string, owner: t.owner as string, name: t.name as string,
        note: (t.note as string) ?? null, status: (t.status as string) ?? 'done',
        created_at: t.created_at as string,
      },
      items: items.map(r => ({
        id: r.id as string, take_id: r.take_id as string,
        material_id: (r.material_id as string) ?? null, material_name: (r.material_name as string) ?? null,
        book_qty: Number(r.book_qty) || 0, actual_qty: Number(r.actual_qty) || 0,
        diff: Number(r.diff) || 0, created_at: r.created_at as string,
      })),
    }
  }

  async deleteStocktake(id: string): Promise<void> {
    const db = await this.ensure()
    await db.execute('delete from stocktake_items where take_id = ?', [id])
    await db.execute('delete from stocktakes where id = ?', [id])
  }

  // ===== BOM =====
  async createBomProject(name: string): Promise<BomProject> {
    const db = await this.ensure()
    const owner = await this.getOwnerId()
    const id = uuid()
    const ts = now()
    await db.execute(
      'insert into bom_projects (id, owner, name, created_at) values (?, ?, ?, ?)',
      [id, owner, name, ts],
    )
    return { id, owner, name, created_at: ts }
  }

  async listBomProjects(): Promise<BomProject[]> {
    const db = await this.ensure()
    const rows = await db.select<{ id: string; owner: string; name: string; created_at: string }[]>(
      'select * from bom_projects where deleted_at is null order by created_at desc',
    )
    return rows
  }

  async deleteBomProject(id: string): Promise<void> {
    const db = await this.ensure()
    await db.execute('update bom_projects set deleted_at = ? where id = ?', [now(), id])
  }

  async createBomItems(project_id: string, items: Partial<BomItem>[]): Promise<BomItem[]> {
    const db = await this.ensure()
    if (!items.length) return []
    const ids: string[] = []
    for (const i of items) {
      const id = uuid()
      ids.push(id)
      await db.execute(
        `insert into bom_items (id, project_id, material_id, raw, qty, matched)
         values (?, ?, ?, ?, ?, ?)`,
        [
          id, project_id, i.material_id ?? null, i.raw ?? null,
          i.qty ?? 1, boolToDb(i.matched),
        ],
      )
    }
    const placeholders = ids.map(() => '?').join(',')
    const rows = await db.select<Record<string, unknown>[]>(
      `select bi.*, c.id as comp_id, c.name as comp_name, c.model as comp_model,
              c.brand as comp_brand, c.package as comp_package, c.qty as comp_qty,
              c.image_path as comp_image_path, c.alternates as comp_alternates,
              cat.name as comp_category_name
       from bom_items bi
       left join materials c on c.id = bi.material_id and c.deleted_at is null
       left join categories cat on cat.id = c.category_id
       where bi.id in (${placeholders})`,
      ids,
    )
    return rows.map(mapBomItem)
  }

  async listBomItems(projectId: string): Promise<BomItem[]> {
    const db = await this.ensure()
    const rows = await db.select<Record<string, unknown>[]>(
      `select bi.*, c.id as comp_id, c.name as comp_name, c.model as comp_model,
              c.brand as comp_brand, c.package as comp_package, c.qty as comp_qty,
              c.image_path as comp_image_path, c.alternates as comp_alternates,
              cat.name as comp_category_name
       from bom_items bi
       left join materials c on c.id = bi.material_id and c.deleted_at is null
       left join categories cat on cat.id = c.category_id
       where bi.project_id = ?`,
      [projectId],
    )
    return rows.map(mapBomItem)
  }

  async updateBomItem(id: string, patch: Partial<BomItem>): Promise<BomItem> {
    const db = await this.ensure()
    const sets: string[] = []
    const vals: unknown[] = []
    if (patch.material_id !== undefined) { sets.push('material_id = ?'); vals.push(patch.material_id) }
    if (patch.raw !== undefined) { sets.push('raw = ?'); vals.push(patch.raw) }
    if (patch.qty !== undefined) { sets.push('qty = ?'); vals.push(patch.qty) }
    if (patch.matched !== undefined) { sets.push('matched = ?'); vals.push(boolToDb(patch.matched)) }
    if (sets.length) {
      vals.push(id)
      await db.execute(`update bom_items set ${sets.join(', ')} where id = ?`, vals)
    }
    const rows = await db.select<Record<string, unknown>[]>(
      `select bi.*, c.id as comp_id, c.name as comp_name, c.model as comp_model,
              c.brand as comp_brand, c.package as comp_package, c.qty as comp_qty,
              c.image_path as comp_image_path, c.alternates as comp_alternates,
              cat.name as comp_category_name
       from bom_items bi
       left join materials c on c.id = bi.material_id and c.deleted_at is null
       left join categories cat on cat.id = c.category_id
       where bi.id = ?`,
      [id],
    )
    if (!rows.length) throw new Error('BOM 项不存在')
    return mapBomItem(rows[0])
  }

  async createBomPickRecord(project_id: string, sets: number, note: string | null): Promise<BomPickRecord> {
    const db = await this.ensure()
    const owner = await this.getOwnerId()
    const id = uuid()
    const ts = now()
    await db.execute(
      'insert into bom_pick_records (id, owner, project_id, sets, note, created_at) values (?, ?, ?, ?, ?, ?)',
      [id, owner, project_id, sets, note, ts],
    )
    return { id, project_id, sets, note, created_at: ts }
  }

  async listBomPickRecords(projectId: string): Promise<BomPickRecord[]> {
    const db = await this.ensure()
    const rows = await db.select<{ id: string; project_id: string; sets: number; note: string | null; created_at: string }[]>(
      'select * from bom_pick_records where project_id = ? order by created_at desc',
      [projectId],
    )
    return rows
  }

  // ===== 物料附件（数据手册等） =====
  async listMaterialFiles(materialId: string): Promise<MaterialFile[]> {
    const db = await this.ensure()
    const rows = await db.select<Record<string, unknown>[]>(
      'select * from material_files where material_id = ? order by sort_order asc, created_at asc',
      [materialId],
    )
    return rows.map(mapMaterialFile)
  }

  async createMaterialFiles(material_id: string, items: Partial<MaterialFile>[]): Promise<MaterialFile[]> {
    const db = await this.ensure()
    if (!items.length) return []
    const owner = await this.getOwnerId()
    const ids: string[] = []
    for (let i = 0; i < items.length; i++) {
      const f = items[i]
      if (!f.url) continue
      const id = uuid()
      ids.push(id)
      await db.execute(
        `insert into material_files (id, owner, material_id, name, url, file_type, source, sort_order, created_at)
         values (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id, owner, material_id, f.name || '数据手册', f.url,
          f.file_type ?? null, f.source ?? null, f.sort_order ?? i, now(),
        ],
      )
    }
    if (!ids.length) return []
    const placeholders = ids.map(() => '?').join(',')
    const rows = await db.select<Record<string, unknown>[]>(
      `select * from material_files where id in (${placeholders}) order by sort_order asc`,
      ids,
    )
    return rows.map(mapMaterialFile)
  }

  async deleteMaterialFile(id: string): Promise<void> {
    const db = await this.ensure()
    await db.execute('delete from material_files where id = ?', [id])
  }

  async deleteMaterialFilesOf(materialId: string): Promise<void> {
    const db = await this.ensure()
    await db.execute('delete from material_files where material_id = ?', [materialId])
  }

  // ===== 待采购单 =====
  async createPurchaseOrder(payload: Partial<PurchaseOrder>): Promise<PurchaseOrder> {
    const db = await this.ensure()
    const owner = await this.getOwnerId()
    const id = uuid()
    const ts = now()
    const status = payload.status || 'pending'
    await db.execute(
      'insert into purchase_orders (id, owner, name, source, source_id, note, status, created_at) values (?, ?, ?, ?, ?, ?, ?, ?)',
      [id, owner, payload.name || '待采购单', payload.source ?? null, payload.source_id ?? null, payload.note ?? null, status, ts],
    )
    return { id, owner, name: payload.name || '待采购单', source: payload.source ?? null, source_id: payload.source_id ?? null, note: payload.note ?? null, status, created_at: ts }
  }

  async listPurchaseOrders(): Promise<PurchaseOrder[]> {
    const db = await this.ensure()
    const rows = await db.select<Record<string, unknown>[]>(
      'select * from purchase_orders where deleted_at is null order by created_at desc',
    )
    return rows.map(r => {
      const row = r as unknown as PurchaseOrder
      return {
        ...row,
        source: row.source ?? null,
        source_id: row.source_id ?? null,
        note: row.note ?? null,
        status: row.status || 'pending',
      }
    })
  }

  async listPurchaseOrdersPage(opts: PurchaseOrderPageOpts = {}): Promise<PageResult<PurchaseOrder>> {
    const db = await this.ensure()
    const limit = Math.max(1, opts.limit ?? 20)
    const offset = Math.max(0, opts.offset ?? 0)
    const conds = ['deleted_at is null']
    const params: unknown[] = []
    if (opts.status) { conds.push('status = ?'); params.push(opts.status) }
    const where = 'where ' + conds.join(' and ')
    const countRows = await db.select<{ n: number }[]>(`select count(*) as n from purchase_orders ${where}`, params)
    const total = Number(countRows[0]?.n ?? 0)
    const rows = await db.select<Record<string, unknown>[]>(
      `select * from purchase_orders ${where} order by created_at desc limit ? offset ?`,
      [...params, limit, offset],
    )
    return {
      rows: rows.map(r => {
        const row = r as unknown as PurchaseOrder
        return { ...row, source: row.source ?? null, source_id: row.source_id ?? null, note: row.note ?? null, status: row.status || 'pending' }
      }),
      total,
    }
  }

  async countPurchaseOrders(status?: 'pending' | 'done' | null): Promise<number> {
    const db = await this.ensure()
    const params: unknown[] = []
    let where = 'where deleted_at is null'
    if (status) { where += ' and status = ?'; params.push(status) }
    const rows = await db.select<{ n: number }[]>(`select count(*) as n from purchase_orders ${where}`, params)
    return Number(rows[0]?.n ?? 0)
  }

  async updatePurchaseOrder(id: string, patch: Partial<PurchaseOrder>): Promise<PurchaseOrder> {
    const db = await this.ensure()
    const sets: string[] = []
    const vals: unknown[] = []
    if (patch.name !== undefined) { sets.push('name = ?'); vals.push(patch.name) }
    if (patch.note !== undefined) { sets.push('note = ?'); vals.push(patch.note) }
    if (patch.status !== undefined) { sets.push('status = ?'); vals.push(patch.status) }
    if (sets.length) {
      vals.push(id)
      await db.execute(`update purchase_orders set ${sets.join(', ')} where id = ?`, vals)
    }
    const rows = await db.select<Record<string, unknown>[]>(
      'select * from purchase_orders where id = ?', [id],
    )
    if (!rows.length) throw new Error('待采单不存在')
    return rows[0] as unknown as PurchaseOrder
  }

  async deletePurchaseOrder(id: string): Promise<void> {
    const db = await this.ensure()
    // 明细有外键级联，直接删主表即可
    await db.execute('delete from purchase_orders where id = ?', [id])
  }

  async createPurchaseItems(order_id: string, items: Partial<PurchaseItem>[]): Promise<PurchaseItem[]> {
    const db = await this.ensure()
    if (!items.length) return []
    const ids: string[] = []
    for (const i of items) {
      const id = uuid()
      ids.push(id)
      await db.execute(
        `insert into purchase_items (id, order_id, material_id, name, model, brand, package, part_no, qty, stock_qty, lack_qty, note, done, created_at)
         values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id, order_id, i.material_id ?? null, i.name || '未命名物料', i.model ?? null, i.brand ?? null,
          i.package ?? null, i.part_no ?? null, i.qty ?? 1, i.stock_qty ?? null, i.lack_qty ?? 0,
          i.note ?? null, boolToDb(i.done), now(),
        ],
      )
    }
    const placeholders = ids.map(() => '?').join(',')
    const rows = await db.select<Record<string, unknown>[]>(
      `select pi.*, c.name as comp_name, c.model as comp_model, c.package as comp_package, c.qty as comp_qty
       from purchase_items pi
       left join materials c on c.id = pi.material_id and c.deleted_at is null
       where pi.id in (${placeholders})`,
      ids,
    )
    return rows.map(mapPurchaseItem)
  }

  async listPurchaseItems(orderId: string): Promise<PurchaseItem[]> {
    const db = await this.ensure()
    const rows = await db.select<Record<string, unknown>[]>(
      `select pi.*, c.name as comp_name, c.model as comp_model, c.package as comp_package, c.qty as comp_qty
       from purchase_items pi
       left join materials c on c.id = pi.material_id and c.deleted_at is null
       where pi.order_id = ?
       order by pi.done asc, pi.created_at asc`,
      [orderId],
    )
    return rows.map(mapPurchaseItem)
  }

  async updatePurchaseItem(id: string, patch: Partial<PurchaseItem>): Promise<PurchaseItem> {
    const db = await this.ensure()
    const sets: string[] = []
    const vals: unknown[] = []
    if (patch.material_id !== undefined) { sets.push('material_id = ?'); vals.push(patch.material_id) }
    if (patch.name !== undefined) { sets.push('name = ?'); vals.push(patch.name) }
    if (patch.model !== undefined) { sets.push('model = ?'); vals.push(patch.model) }
    if (patch.brand !== undefined) { sets.push('brand = ?'); vals.push(patch.brand) }
    if (patch.package !== undefined) { sets.push('package = ?'); vals.push(patch.package) }
    if (patch.part_no !== undefined) { sets.push('part_no = ?'); vals.push(patch.part_no) }
    if (patch.qty !== undefined) { sets.push('qty = ?'); vals.push(patch.qty) }
    if (patch.stock_qty !== undefined) { sets.push('stock_qty = ?'); vals.push(patch.stock_qty) }
    if (patch.lack_qty !== undefined) { sets.push('lack_qty = ?'); vals.push(patch.lack_qty) }
    if (patch.note !== undefined) { sets.push('note = ?'); vals.push(patch.note) }
    if (patch.done !== undefined) { sets.push('done = ?'); vals.push(boolToDb(patch.done)) }
    if (sets.length) {
      vals.push(id)
      await db.execute(`update purchase_items set ${sets.join(', ')} where id = ?`, vals)
    }
    const rows = await db.select<Record<string, unknown>[]>(
      `select pi.*, c.name as comp_name, c.model as comp_model, c.package as comp_package, c.qty as comp_qty
       from purchase_items pi
       left join materials c on c.id = pi.material_id and c.deleted_at is null
       where pi.id = ?`,
      [id],
    )
    if (!rows.length) throw new Error('待采明细不存在')
    return mapPurchaseItem(rows[0])
  }

  async deletePurchaseItem(id: string): Promise<void> {
    const db = await this.ensure()
    await db.execute('delete from purchase_items where id = ?', [id])
  }

  // ===== 批量查询 =====
  async getMaterialsByIds(ids: string[]): Promise<MaterialRow[]> {
    if (!ids.length) return []
    const db = await this.ensure()
    const placeholders = ids.map(() => '?').join(',')
    const rows = await db.select<Record<string, unknown>[]>(
      `select c.*, cat.name as category_name, cat.threshold as category_threshold, parent.name as parent_name
       from materials c left join categories cat on cat.id = c.category_id
       left join categories parent on parent.id = cat.parent
       where c.deleted_at is null and c.id in (${placeholders})`,
      ids,
    )
    const materials = rows.map(mapMaterial)
    await this.fillMaterialParams(materials)
    return materials
  }

  async matchMaterialByModel(model: string): Promise<MaterialRow[]> {
    const db = await this.ensure()
    const like = `%${model}%`
    const rows = await db.select<Record<string, unknown>[]>(
      `select c.*, cat.name as category_name, cat.threshold as category_threshold, parent.name as parent_name
       from materials c left join categories cat on cat.id = c.category_id
       left join categories parent on parent.id = cat.parent
       where c.deleted_at is null and (c.model like ? or c.part_no like ? or c.name like ?) limit 10`,
      [like, like, like],
    )
    return rows.map(mapMaterial)
  }

  // ===== 统计 =====
  /** 统计概览：单条 SQL 一次聚合，不把全表拉进内存 */
  async statsOverview(): Promise<StatsOverview> {
    const db = await this.ensure()
    const rows = await db.select<
      { total_materials: number; total_qty: number; total_value: number | null; low_stock: number }[]
    >(
      `select count(*) as total_materials,
              coalesce(sum(c.qty), 0) as total_qty,
              coalesce(sum(c.qty * c.price), 0) as total_value,
              coalesce(sum(
                case when c.qty <= coalesce(nullif(c.threshold, 0), nullif(cat.threshold, 0), ${DEFAULT_LOW_THRESHOLD})
                     then 1 else 0 end
              ), 0) as low_stock
       from materials c
       left join categories cat on cat.id = c.category_id
       where c.deleted_at is null`,
    )
    const r = rows[0] || { total_materials: 0, total_qty: 0, total_value: 0, low_stock: 0 }
    return {
      totalMaterials: Number(r.total_materials) || 0,
      totalQty: Number(r.total_qty) || 0,
      totalValue: Number(r.total_value) || 0,
      lowStock: Number(r.low_stock) || 0,
    }
  }

  async statsByCategory(): Promise<StatsCategoryRow[]> {
    const db = await this.ensure()
    const rows = await db.select<
      { category_id: string | null; name: string | null; threshold: number | null; qty: number; value: number | null; low: number }[]
    >(
      `select c.category_id,
              cat.name as name,
              cat.threshold as threshold,
              coalesce(sum(c.qty), 0) as qty,
              coalesce(sum(c.qty * c.price), 0) as value,
              0 as low
       from materials c
       left join categories cat on cat.id = c.category_id
       where c.deleted_at is null
       group by c.category_id, cat.name, cat.threshold`,
    )
    return rows.map(r => ({
      id: r.category_id || 'none',
      name: r.name || '未分类',
      qty: r.qty || 0,
      value: Number(r.value) || 0,
      low: 0,
    }))
  }

  async lowStockMaterials(globalThreshold = 5): Promise<LowStockRow[]> {
    const db = await this.ensure()
    const rows = await db.select<{ id: string; name: string; model: string | null; qty: number; threshold: number | null; cat_threshold: number | null }[]>(
      `select c.id, c.name, c.model, c.qty, c.threshold, cat.threshold as cat_threshold
       from materials c
       left join categories cat on cat.id = c.category_id
       where c.deleted_at is null`,
    )
    return rows
      .map(r => {
        // 生效阈值：物料自身（>0）→ 分类（>0）→ 全局默认
        const threshold = (r.threshold || 0) > 0 ? r.threshold as number
          : (r.cat_threshold || 0) > 0 ? r.cat_threshold as number
            : globalThreshold
        return {
          id: r.id, name: r.name, model: r.model, qty: r.qty || 0, threshold,
          categories: { threshold: r.cat_threshold ?? null },
        }
      })
      .filter(r => r.qty <= r.threshold)
  }

  async stockTrend(days = 14): Promise<TrendRow[]> {
    const db = await this.ensure()
    const since = new Date(Date.now() - days * 86400000).toISOString()
    const rows = await db.select<{ type: 'in' | 'out'; qty: number; created_at: string }[]>(
      'select type, qty, created_at from stock_log where created_at >= ?',
      [since],
    )
    const daysArr: TrendRow[] = []
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(Date.now() - i * 86400000)
      daysArr.push({ date: d.toISOString().slice(0, 10), in: 0, out: 0 })
    }
    const idx: Record<string, number> = Object.fromEntries(daysArr.map((d, i) => [d.date, i]))
    for (const r of rows) {
      const day = (r.created_at || '').slice(0, 10)
      if (day in idx) daysArr[idx[day]][r.type] += r.qty
    }
    return daysArr
  }

  // ===== 标签打印模板 =====

  async listLabelTemplates(): Promise<LabelTemplate[]> {
    const db = await this.ensure()
    const rows = await db.select<Record<string, unknown>[]>(
      'select * from label_templates where deleted_at is null order by is_default desc, created_at desc',
    )
    return rows.map(mapLabelTemplate)
  }

  async createLabelTemplate(payload: Partial<LabelTemplate>): Promise<LabelTemplate> {
    const db = await this.ensure()
    const owner = await this.getOwnerId()
    const id = uuid()
    const ts = now()
    const cats = payload.cats ?? []
    const layout = payload.layout ?? DEFAULT_LABEL_LAYOUT()
    const isDefault = payload.is_default ? 1 : 0
    // 默认模板唯一
    if (isDefault) await db.execute('update label_templates set is_default = 0')
    await db.execute(
      `insert into label_templates
       (id, owner, name, width_mm, height_mm, grid_rows, grid_cols,
        cats, default_font_pt, layout, is_default, created_at)
       values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id, owner, payload.name || '未命名模板',
        payload.width_mm ?? 24, payload.height_mm ?? 12,
        payload.grid_rows ?? 2, payload.grid_cols ?? 2,
        toJson(cats), payload.default_font_pt ?? 6, toJson(layout), isDefault, ts,
      ],
    )
    return {
      id, owner, name: payload.name || '未命名模板',
      width_mm: payload.width_mm ?? 24, height_mm: payload.height_mm ?? 12,
      grid_rows: payload.grid_rows ?? 2, grid_cols: payload.grid_cols ?? 2,
      cats, default_font_pt: payload.default_font_pt ?? 6, layout,
      is_default: !!isDefault, builtin: false, created_at: ts, deleted_at: null,
    }
  }

  async updateLabelTemplate(id: string, patch: Partial<LabelTemplate>): Promise<LabelTemplate> {
    const db = await this.ensure()
    if (patch.is_default) await db.execute('update label_templates set is_default = 0')
    const sets: string[] = []
    const vals: unknown[] = []
    if (patch.name !== undefined) { sets.push('name = ?'); vals.push(patch.name) }
    if (patch.cats !== undefined) { sets.push('cats = ?'); vals.push(toJson(patch.cats)) }
    if (patch.width_mm !== undefined) { sets.push('width_mm = ?'); vals.push(patch.width_mm) }
    if (patch.height_mm !== undefined) { sets.push('height_mm = ?'); vals.push(patch.height_mm) }
    if (patch.grid_rows !== undefined) { sets.push('grid_rows = ?'); vals.push(patch.grid_rows) }
    if (patch.grid_cols !== undefined) { sets.push('grid_cols = ?'); vals.push(patch.grid_cols) }
    if (patch.default_font_pt !== undefined) { sets.push('default_font_pt = ?'); vals.push(patch.default_font_pt) }
    if (patch.layout !== undefined) { sets.push('layout = ?'); vals.push(toJson(patch.layout)) }
    if (patch.is_default !== undefined) { sets.push('is_default = ?'); vals.push(boolToDb(patch.is_default)) }
    if (sets.length) {
      vals.push(id)
      await db.execute(`update label_templates set ${sets.join(', ')} where id = ?`, vals)
    }
    const rows = await db.select<Record<string, unknown>[]>(
      'select * from label_templates where id = ?', [id],
    )
    if (!rows.length) throw new Error('标签模板不存在')
    return mapLabelTemplate(rows[0])
  }

  async deleteLabelTemplate(id: string): Promise<void> {
    const db = await this.ensure()
    // 内置模板不可删除（脚本种子写入，见 script/sqlite/0001_init.sql 第 9 段）
    const rows = await db.select<{ builtin: number | null }[]>(
      'select builtin from label_templates where id = ?', [id],
    )
    if (rows[0] && dbToBool(rows[0].builtin)) throw new Error('内置模板不可删除')
    await db.execute('update label_templates set deleted_at = ?, is_default = 0 where id = ?', [now(), id])
  }
}
