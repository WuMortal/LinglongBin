-- ============================================================================
-- LinglongBin · SQLite 离线建表脚本
-- ============================================================================
-- 用于离线模式（VITE_DATA_MODE=sqlite），配合 tauri-plugin-sql 使用。
-- 在 Tauri 启动时自动执行，或手动通过 sqlite3 CLI 执行：
--   sqlite3 ~/.linglongbin/data.db < script/sqlite/0001_init.sql
--
-- 与 Supabase (0001_init.sql) 的差异：
--   - uuid → TEXT（JS 层用 crypto.randomUUID() 生成）
--   - jsonb → TEXT（存 JSON 字符串，SQLite 3.38+ 支持 json_extract 查询）
--   - numeric → REAL
--   - timestamptz → TEXT（ISO 8601 字符串）
--   - uuid[] → TEXT（JSON 数组字符串）
--   - auth.users 不存在，owner 为本地固定用户 id（单用户）
--   - RLS 不存在，访问控制由 App 层保证
-- ============================================================================

-- 启用外键约束（SQLite 默认关闭）
pragma foreign_keys = on;

-- 0) 清空重建（如需保留数据，整段注释掉）
drop table if exists bom_items;
drop table if exists bom_projects;
drop table if exists stock_log;
drop table if exists stocktake_items;
drop table if exists stocktakes;
drop table if exists materials;
drop table if exists suppliers;
drop table if exists categories;
drop table if exists settings;
drop table if exists label_templates;

-- 1) 分类（大类 / 小类二级层级：小类 parent 指向大类；lcsc_id 为嘉立创 catalogId）
create table if not exists categories (
  id              text        primary key,                                          -- UUID（JS 层 crypto.randomUUID()）
  owner           text        not null,                                             -- 离线模式固定为 'local-user'
  name            text        not null,
  parent          text        references categories(id) on delete set null,        -- 大类 parent=null；小类指向大类
  lcsc_id         integer,                                                          -- 嘉立创分类 id（小类导入时写入）
  location_prefix text,
  params          text        default '[]',                                         -- JSON 字符串：该分类可选参数模板（小类来自立创）
  threshold       integer     default 0,                                            -- 库存预警阈值
  sort_order      integer     default 0,                                            -- 排序序号（同父级下升序，导入时按循环顺序写入）
  created_at      text        default (strftime('%Y-%m-%dT%H:%M:%fZ','now'))       -- ISO 8601
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
  created_at      text        default (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
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
  params          text        default '{}',                                         -- JSON 字符串
  qty             integer     not null default 0,
  location        text,
  price           real        default 0,
  image_path      text,                                                             -- 本地文件路径：<app_data>/images/<random>.png
  datasheet_path  text,
  remark          text,                                                             -- 备注说明
  alternates      text        default '[]',                                         -- JSON 数组字符串：替代品 id 列表
  created_at      text        default (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- 4) 出入库流水
create table if not exists stock_log (
  id            text        primary key,
  owner         text        not null,
  material_id   text        references materials(id) on delete cascade,
  type          text        not null check (type in ('in','out')),
  qty           integer     not null,
  note          text,
  created_at    text        default (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- 4.5) 库存盘点（主表 + 明细）
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

-- 5) BOM 项目与物料清单
create table if not exists bom_projects (
  id          text        primary key,
  owner       text        not null,
  name        text        not null,
  created_at  text        default (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
create table if not exists bom_items (
  id           text        primary key,
  project_id   text        not null references bom_projects(id) on delete cascade,
  material_id  text        references materials(id) on delete set null,
  raw          text,       -- 原始 BOM 行文本
  qty          integer     not null default 1,
  matched      integer     default 0                                               -- boolean：0=false, 1=true
);

-- 6) 用户设置
create table if not exists settings (
  owner       text        primary key,
  theme       text        default 'auto',                                          -- auto | light | dark
  data        text        default '{}'                                             -- JSON 字符串
);

-- 7) 标签打印模板：一套模板 = 一种标签尺寸 + 每个分类各自的字段布局
create table if not exists label_templates (
  id               text        primary key,
  owner            text        not null,
  name             text        not null,
  width_mm         real        not null default 24,            -- 单标签宽（全模板共用）
  height_mm        real        not null default 12,            -- 单标签高（全模板共用）
  grid_rows        integer     not null default 2,             -- 内部栅格行（单元块）
  grid_cols        integer     not null default 2,             -- 内部栅格列
  cats             text        default '[]',                   -- JSON: LabelCatConfig[]（每分类 blocks + 排序）
  default_font_pt  real        not null default 6,
  layout           text        default '{}',                   -- JSON: LabelSheetLayout
  is_default       integer     default 0,
  builtin          integer     not null default 0,             -- 内置模板：不可删除
  created_at       text        default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  deleted_at       text
);

-- 8) 索引
create index if not exists idx_categories_owner  on categories(owner);
create index if not exists idx_categories_parent on categories(parent);
create index if not exists idx_categories_lcsc   on categories(lcsc_id);
create index if not exists idx_categories_sort   on categories(parent, sort_order);
create index if not exists idx_suppliers_owner   on suppliers(owner);
create index if not exists idx_materials_owner    on materials(owner);
create index if not exists idx_materials_category on materials(category_id);
create index if not exists idx_stocklog_owner      on stock_log(owner, created_at);
create index if not exists idx_stocktakes_owner     on stocktakes(owner);
create index if not exists idx_stocktake_items_take on stocktake_items(take_id);
create index if not exists idx_bomitems_project    on bom_items(project_id);
create index if not exists idx_labeltpl_owner      on label_templates(owner, deleted_at);

-- 9) 内置标签模板
--    builtin = 1 的模板 App 层禁止删除（deleteLabelTemplate 拒绝 + 页面隐藏删除按钮）。
--    这里只种一份「默认格式」（category_id 为空 = 未匹配分类时的兜底），不含任何本机分类 id / 参数 key，
--    因此可以直接用于全新库；具体分类的配置由用户在界面上自行添加。
--    幂等：已存在任何内置模板时跳过。
insert into label_templates
  (id, owner, name, width_mm, height_mm, grid_rows, grid_cols,
   cats, default_font_pt, layout, is_default, builtin, created_at)
select
  'builtin-label-default',
  'local-user',
  '默认模板',
  24,            -- width_mm
  9,             -- height_mm
  3,             -- grid_rows
  4,             -- grid_cols
  '[{"category_id":"{{贴片电阻_Id}}","blocks":[{"id":"b-name","type":"field","x":0,"y":0,"w":4,"h":1,"field":"model","align":"center","valign":"middle","auto_shrink":true,"font_pt":6},{"id":"bmu83ihi61","type":"field","field":"brand","x":0,"y":1,"w":2,"h":1,"align":"left","valign":"middle","auto_shrink":true,"font_pt":6},{"id":"bmu83iiry3","type":"field","field":"param:param_10835_n","x":2,"y":1,"w":1,"h":1,"align":"right","valign":"middle","auto_shrink":true,"font_pt":6},{"id":"bmu83ij2v4","type":"field","field":"param:param_10836_s","x":3,"y":1,"w":1,"h":1,"align":"left","valign":"middle","auto_shrink":true,"font_pt":6},{"id":"bmu83vz1y5","type":"field","field":"param:queryProductStandard","x":0,"y":2,"w":2,"h":1,"align":"left","valign":"middle","auto_shrink":true,"font_pt":6,"prefix":"封装:"},{"id":"bmu83we9n6","type":"field","field":"param:param_10837_n","x":2,"y":2,"w":1,"h":1,"align":"left","valign":"middle","auto_shrink":true,"font_pt":6,"text":" "},{"id":"bmu8de09v1","type":"field","field":"param:param_11155_n","x":3,"y":2,"w":1,"h":1,"align":"left","valign":"middle","auto_shrink":true,"font_pt":6}],"sort_mode":"field","sort_field":"param_10835_n","sort_dir":"asc"},{"category_id":"{{贴片电容(MLCC)_Id}}","blocks":[{"id":"b-name","type":"field","x":0,"y":0,"w":4,"h":1,"field":"model","align":"center","valign":"middle","auto_shrink":true,"font_pt":6},{"id":"bmu83pkfb1","type":"field","field":"brand","x":0,"y":1,"w":2,"h":1,"align":"left","valign":"middle","auto_shrink":true,"empty_behavior":"keep","font_pt":6},{"id":"bmu83plbn3","type":"field","field":"param:param_10951_n","x":2,"y":1,"w":1,"h":1,"align":"right","valign":"middle","auto_shrink":true,"empty_behavior":"keep","font_pt":6},{"id":"bmu83pljz4","type":"field","field":"param:param_10952_s","x":3,"y":1,"w":1,"h":1,"align":"left","valign":"middle","auto_shrink":true,"empty_behavior":"keep","font_pt":6},{"id":"bmu846b011","type":"field","field":"param:queryProductStandard","x":0,"y":2,"w":2,"h":1,"align":"left","valign":"middle","auto_shrink":true,"font_pt":6,"prefix":"封装:"},{"id":"bmu846l282","type":"field","field":"param:param_10953_n","x":2,"y":2,"w":1,"h":1,"align":"left","valign":"middle","auto_shrink":true,"text":" ","font_pt":6},{"id":"bmu8ddgoh3","type":"field","field":"param:param_10954","x":3,"y":2,"w":1,"h":1,"align":"left","valign":"middle","auto_shrink":true,"font_pt":6}],"sort_mode":"field","sort_field":"param_10951_n","sort_dir":"asc"},{"category_id":"","blocks":[{"id":"bmu8fiyzh1","type":"field","field":"name","x":0,"y":0,"w":4,"h":1,"align":"center","valign":"middle","auto_shrink":true,"font_pt":6},{"id":"bmu8fje6j2","type":"field","field":"brand","x":0,"y":1,"w":2,"h":1,"align":"left","valign":"middle","auto_shrink":true,"font_pt":6},{"id":"bmu8fjlkp4","type":"field","field":"model","x":2,"y":1,"w":2,"h":1,"align":"left","valign":"middle","auto_shrink":true,"prefix":"","font_pt":6},{"id":"bmu8fkber5","type":"field","field":"part_no","x":0,"y":2,"w":2,"h":1,"align":"left","valign":"middle","auto_shrink":true,"prefix":"","font_pt":6},{"id":"bmu8fkp1w6","type":"field","field":"location","x":2,"y":2,"w":2,"h":1,"align":"left","valign":"middle","auto_shrink":true,"prefix":"","font_pt":6}],"sort_mode":"cat","sort_field":null,"sort_dir":"asc"}]',
  6,             -- default_font_pt
  '{"paper":"A4","paper_w":210,"paper_h":297,"sheet_w":210,"sheet_h":297,"cols":8,"rows":26,"pad":2,"gap_w":2,"gap_h":2,"pos_mode":"custom","off_x":0,"off_y":0,"scale_fix":1,"guides":true,"auto_fill":false}',
  1,             -- is_default
  1,             -- builtin
  '2026-09-19T08:03:08.883Z'
 where not exists (select 1 from label_templates where builtin = 1);

-- 内置模板唯一默认
update label_templates
   set is_default = 0
 where deleted_at is null
   and id <> 'builtin-label-default'
   and exists (select 1 from label_templates where id = 'builtin-label-default' and deleted_at is null);

-- ============================================================================
-- 注意事项（接入 tauri-plugin-sql 时）：
--   1. JS 层所有 insert 需手动生成 UUID：crypto.randomUUID()
--   2. JSON 字段写入前 JSON.stringify()，读取后 JSON.parse()
--   3. boolean 字段用 0/1（SQLite 无布尔类型）
--   4. 图片存本地：用 tauri 的 fs API 写入 app_data_dir/images/，image_path 存相对路径
--   5. PRAGMA foreign_keys = on 需在每次连接时执行
-- ============================================================================
