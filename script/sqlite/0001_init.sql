-- ============================================================================
-- LinglongBin · SQLite 离线初始化脚本
-- ============================================================================
-- 用于离线模式（VITE_DATA_MODE=sqlite），配合 tauri-plugin-sql 使用。
-- App 启动时会自动建表（幂等，见 sqliteStore.ts SCHEMA_SQL）；本脚本供
-- 手动初始化 / 重建本地 data.db 时使用：
--   sqlite3 <app_data>/data.db < script/sqlite/0001_init.sql
--
-- 与 Supabase (../0001_init.sql) 的差异：
--   - uuid → TEXT（JS 层用 crypto.randomUUID() 生成）
--   - jsonb → TEXT（存 JSON 字符串）
--   - numeric → REAL
--   - timestamptz → TEXT（ISO 8601 字符串）
--   - uuid[] → TEXT（JSON 数组字符串）
--   - 无 RLS / auth.users：单用户，owner 固定 'local-user'，访问控制由 App 层保证
--
-- 注意：
--   - 表结构须与 src/lib/storage/sqliteStore.ts 的 SCHEMA_SQL / INDEXES_SQL
--     保持一致，改动时两处同步
--   - 内置标签模板不在本脚本写入，App 启动时自动补建
--     （sqliteStore.ts seedBuiltinLabelTemplate）
-- ============================================================================

-- 启用外键约束（SQLite 默认关闭，且需在每次连接时执行）
pragma foreign_keys = on;

-- 0) 清空重建（如需保留数据，整段注释掉）
drop table if exists stocktake_items;
drop table if exists stocktakes;
drop table if exists purchase_items;
drop table if exists purchase_orders;
drop table if exists bom_pick_records;
drop table if exists bom_items;
drop table if exists bom_projects;
drop table if exists material_params;
drop table if exists material_files;
drop table if exists category_params;
drop table if exists stock_log;
drop table if exists label_templates;
drop table if exists materials;
drop table if exists suppliers;
drop table if exists categories;
drop table if exists dict_items;
drop table if exists dict_types;
drop table if exists settings;

-- 1) 分类（大类 / 小类二级层级：小类 parent 指向大类；lcsc_id 为嘉立创 catalogId）
create table if not exists categories (
  id              text        primary key,                                          -- UUID（JS 层 crypto.randomUUID()）
  owner           text        not null,                                             -- 离线模式固定为 'local-user'
  name            text        not null,
  parent          text        references categories(id) on delete set null,        -- 大类 parent=null；小类指向大类
  lcsc_id         integer,                                                          -- 嘉立创分类 id（小类导入时写入）
  location_prefix text,
  threshold       integer     default 0,                                            -- 库存预警阈值
  sort_order      integer     default 0,                                            -- 排序序号（同父级下升序，导入时按循环顺序写入）
  created_at      text        default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),     -- ISO 8601
  deleted_at      text                                                              -- 软删除时间（null=未删除）
);

-- 1.1) 分类参数模板（独立表）
create table if not exists category_params (
  id              text        primary key,
  owner           text        not null,
  category_id     text        not null references categories(id) on delete cascade,
  key             text        not null,                                             -- 参数 key（如 param_10951_n）
  name            text        not null default '',                                  -- 参数显示名（如 容值）
  value_list      text        default '[]',                                         -- 可选值列表（JSON 字符串）
  sort_order      integer     default 0,
  created_at      text        default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  unique (category_id, key)
);

-- 2) 供应商（扁平列表，无分组）
create table if not exists suppliers (
  id              text        primary key,
  owner           text        not null,                                             -- 离线模式固定为 'local-user'
  name            text        not null,                                             -- 供应商名称
  addr            text,                                                             -- 地址
  contact         text,                                                             -- 联系人
  phone           text,                                                             -- 电话
  note            text,                                                             -- 备注
  created_at      text        default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  deleted_at      text                                                              -- 软删除时间（null=未删除）
);

-- 3) 物料
create table if not exists materials (
  id              text        primary key,
  owner           text        not null,                                             -- 离线模式固定为 'local-user'
  category_id     text        references categories(id) on delete set null,        -- 挂到「小类」叶子
  name            text        not null,
  model           text,
  brand           text,
  package         text,
  part_no         text,                                                              -- 商品编号
  threshold       integer     default 0,                                            -- 库存预警阈值
  qty             integer     not null default 0,
  location        text,
  price           real        default 0,
  image_path      text,                                                             -- 本地文件路径：images/<yyyyMMdd>/<random>.png
  datasheet_path  text,
  link            text,                                                             -- 物料链接（如商城购买页 / 规格书外链）
  remark          text,                                                             -- 备注说明
  alternates      text        default '[]',                                         -- JSON 数组字符串：替代品 id 列表
  created_at      text        default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  deleted_at      text                                                              -- 软删除时间（null=未删除）
);

-- 3.1) 物料附件（数据手册 / 认证资料 / 行业资讯），一个物料可有多个
create table if not exists material_files (
  id           text        primary key,
  owner        text        not null,
  material_id  text        not null references materials(id) on delete cascade,
  name         text        not null,
  url          text        not null,
  file_type    text,                                                              -- pdf_property / certification_data_property / industry_information
  source       text,                                                             -- lcsc | manual
  sort_order   integer     default 0,
  created_at   text        default (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- 3.2) 物料参数值（独立表）
create table if not exists material_params (
  id              text        primary key,
  owner           text        not null,
  material_id     text        not null references materials(id) on delete cascade,
  param_key       text        not null,                                            -- 对应 category_params.key
  value           text,
  sort_order      integer     default 0,
  created_at      text        default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  unique (material_id, param_key)
);

-- 4) 出入库流水
create table if not exists stock_log (
  id            text        primary key,
  owner         text        not null,
  material_id   text        references materials(id) on delete cascade,
  type          text        not null check (type in ('in','out')),
  qty           integer     not null,
  supplier_id   text        references suppliers(id) on delete set null,   -- 供应商（type=in 时记录）
  note          text,
  status        text        default 'normal',                             -- normal = 有效 | void = 已撤销
  void_reason   text,                                                     -- 撤销原因
  voided_at     text,                                                     -- 撤销时间
  created_at    text        default (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- 5) 库存盘点（主表 + 明细）：差异在提交时通过 applyStock 入账
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

-- 6) BOM 项目与物料清单
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
  raw          text,       -- 原始 BOM 行文本
  qty          integer     not null default 1,
  matched      integer     default 0                                               -- boolean：0=false, 1=true
);

-- 6.1) 领料记录：一次领料出库（可多套）生成一条，便于按 BOM 维度追溯历史
create table if not exists bom_pick_records (
  id           text        primary key,
  owner        text        not null,
  project_id   text        not null references bom_projects(id) on delete cascade,
  sets         integer     not null default 1,
  note         text,
  created_at   text        default (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- 7) 待采购单（主表 + 明细）：来源可以是 BOM 导入的缺料行，也可手工新建
create table if not exists purchase_orders (
  id          text        primary key,
  owner       text        not null,
  name        text        not null,
  source      text,                                          -- bom | manual
  source_id    text,                                          -- 来源为 bom 时指向 bom_projects.id
  note        text,                                          -- 采购原因
  status      text        default 'pending',                  -- pending = 采购中 | done = 已完成
  created_at  text        default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  deleted_at  text
);

create table if not exists purchase_items (
  id          text        primary key,
  order_id    text        not null references purchase_orders(id) on delete cascade,
  material_id text        references materials(id) on delete set null,
  name        text        not null,                          -- 物料名称（快照）
  model       text,
  brand       text,
  package     text,
  part_no     text,
  qty         integer     not null default 1,                -- 需求数量
  stock_qty   integer,                                       -- 建单时的库存快照
  lack_qty    integer     not null default 0,                -- 缺料数量 = max(0, 需求 - 库存)
  note        text,                                          -- 备注（位号 / 来源行）
  done        integer     default 0,                         -- 是否已处理：0=false, 1=true
  created_at  text        default (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- 8) 用户设置
create table if not exists settings (
  owner       text        primary key,
  theme       text        default 'auto',                                          -- auto | light | dark
  data        text        default '{}'                                             -- JSON 字符串
);

-- 8.1) 基础数据字典（下拉框选项维护，如 库位 / 出库用途）
create table if not exists dict_types (
  id          text        primary key,
  owner       text        not null,
  key         text        not null,                                             -- 字典标识（location / out_purpose / 自定义）
  name        text        not null,                                             -- 显示名
  builtin     integer     default 0,                                            -- 内置字典不可删除：0=false, 1=true
  sort_order  integer     default 0,
  created_at  text        default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  unique (owner, key)
);
create table if not exists dict_items (
  id          text        primary key,
  owner       text        not null,
  dict_key    text        not null,
  label       text        not null,                                             -- 选项显示值
  sort_order  integer     default 0,
  created_at  text        default (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- 9) 标签打印模板：一套模板 = 一种标签尺寸 + 每个分类各自的字段布局
--    内置默认模板由 App 启动时自动创建，脚本只建表。
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
  is_default       integer     default 0,                       -- 0=false, 1=true
  builtin          integer     not null default 0,             -- 内置模板：不可删除
  created_at       text        default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  deleted_at       text
);

-- 10) 索引
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

-- ============================================================================
-- App 层接入约定（tauri-plugin-sql）：
--   1. JS 层所有 insert 需手动生成 UUID：crypto.randomUUID()
--   2. JSON 字段写入前 JSON.stringify()，读取后 JSON.parse()
--   3. boolean 字段用 0/1（SQLite 无布尔类型）
--   4. 图片存本地：resource 目录 images/<yyyyMMdd>/，image_path 存相对路径
--   5. PRAGMA foreign_keys = on 需在每次连接时执行
-- ============================================================================
