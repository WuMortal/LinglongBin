-- ============================================================================
-- LinglongBin · 完整建表 SQL（一次性重建）
-- ============================================================================
-- 在 Supabase 后台 → SQL Editor 中「新建查询」粘贴本文件，点击「运行」即可。
-- ============================================================================

create extension if not exists "pgcrypto";

-- 0) 清空重建（如需保留数据，整段注释掉）
drop table if exists material_params cascade;
drop table if exists material_files cascade;
drop table if exists category_params cascade;
drop table if exists purchase_items cascade;
drop table if exists purchase_orders cascade;
drop table if exists bom_items cascade;
drop table if exists bom_projects cascade;
drop table if exists bom_pick_records cascade;
drop table if exists stock_log cascade;
drop table if exists materials cascade;
drop table if exists suppliers cascade;
drop table if exists categories cascade;
drop table if exists dict_items cascade;
drop table if exists dict_types cascade;
drop table if exists settings cascade;

-- 1) 分类（大类 / 小类二级层级：小类 parent 指向大类；lcsc_id 为嘉立创 catalogId）
create table if not exists categories (
  id              uuid        primary key default gen_random_uuid(),
  owner           uuid        not null references auth.users(id) on delete cascade,
  name            text        not null,
  parent          uuid        references categories(id) on delete set null,  -- 大类 parent=null；小类指向大类
  lcsc_id         bigint,                                                          -- 嘉立创分类 id（小类导入时写入）
  location_prefix text,
  threshold       int         default 0,                                            -- 库存预警阈值
  sort_order      int         default 0,                                            -- 排序序号（同父级下升序，导入时按循环顺序写入）
  created_at      timestamptz default now(),
  deleted_at      timestamptz                                                     -- 软删除时间（null=未删除）
);

-- 1.1) 分类参数模板（独立表）
create table if not exists category_params (
  id              uuid        primary key default gen_random_uuid(),
  owner           uuid        not null references auth.users(id) on delete cascade,
  category_id     uuid        not null references categories(id) on delete cascade,
  key             text        not null,                                             -- 参数 key（如 param_10951_n）
  name            text        not null default '',                                  -- 参数显示名（如 容值）
  value_list      jsonb       default '[]'::jsonb,                                  -- 可选值列表
  sort_order      int         default 0,
  created_at      timestamptz default now(),
  unique (category_id, key)
);

-- 2) 供应商（扁平列表，无分组）
create table if not exists suppliers (
  id              uuid        primary key default gen_random_uuid(),
  owner           uuid        not null references auth.users(id) on delete cascade,
  name            text        not null,                                             -- 供应商名称
  addr            text,                                                             -- 地址
  contact         text,                                                             -- 联系人
  phone           text,                                                             -- 电话
  note            text,                                                             -- 备注
  created_at      timestamptz default now(),
  deleted_at      timestamptz                                                     -- 软删除时间（null=未删除）
);

-- 3) 物料
create table if not exists materials (
  id              uuid        primary key default gen_random_uuid(),
  owner           uuid        not null references auth.users(id) on delete cascade,
  category_id     uuid        references categories(id) on delete set null,        -- 挂到「小类」叶子
  name            text        not null,
  model           text,
  brand           text,
  package         text,
  part_no         text,       -- 商品编号
  threshold       int         default 0,                                            -- 库存预警阈值
  qty             int         not null default 0,
  location        text,
  price           numeric(12,2) default 0,
  image_path      text,       -- Storage 路径：<user_id>/<random>.png
  datasheet_path  text,
  link            text,       -- 物料链接（如商城购买页 / 规格书外链）
  remark          text,       -- 备注说明
  alternates      uuid[]      default '{}',                                          -- 替代品 id 列表（双向绑定）
  created_at      timestamptz default now(),
  deleted_at      timestamptz                                                     -- 软删除时间（null=未删除）
);

-- 3.1) 物料参数值（独立表）
create table if not exists material_params (
  id              uuid        primary key default gen_random_uuid(),
  owner           uuid        not null references auth.users(id) on delete cascade,
  material_id     uuid        not null references materials(id) on delete cascade,
  param_key       text        not null,                                            -- 对应 category_params.key
  value           text,
  sort_order      int         default 0,
  created_at      timestamptz default now(),
  unique (material_id, param_key)
);

-- 3.2) 物料附件（数据手册 / 认证资料 / 行业资讯），一个物料可有多个。
-- file_type 沿用立创分类：pdf_property / certification_data_property / industry_information。
-- 立创导入的附件存外链绝对地址（atta.szlcsc.com），打开时用浏览器直接访问。
create table if not exists material_files (
  id           uuid        primary key default gen_random_uuid(),
  owner        uuid        not null references auth.users(id) on delete cascade,
  material_id  uuid        not null references materials(id) on delete cascade,
  name         text        not null,
  url          text        not null,
  file_type    text,
  source       text,                                                            -- lcsc | manual
  sort_order   int         default 0,
  created_at   timestamptz default now()
);

-- 4) 出入库流水
create table if not exists stock_log (
  id            uuid        primary key default gen_random_uuid(),
  owner         uuid        not null references auth.users(id) on delete cascade,
  material_id   uuid        references materials(id) on delete cascade,
  type          text        not null check (type in ('in','out')),
  qty           int         not null,
  supplier_id   uuid        references suppliers(id) on delete set null,           -- 供应商（type=in 时记录）
  note          text,
  created_at    timestamptz default now()
);

-- 5) BOM 项目与物料清单
create table if not exists bom_projects (
  id          uuid        primary key default gen_random_uuid(),
  owner       uuid        not null references auth.users(id) on delete cascade,
  name        text        not null,
  created_at  timestamptz default now(),
  deleted_at  timestamptz                                                     -- 软删除时间（null=未删除）
);
create table if not exists bom_items (
  id           uuid        primary key default gen_random_uuid(),
  project_id   uuid        not null references bom_projects(id) on delete cascade,
  material_id  uuid        references materials(id) on delete set null,
  raw          text,       -- 原始 BOM 行文本
  qty          int         not null default 1,
  matched      boolean     default false
);

-- 5.0) 领料记录：一次领料出库（可多套）生成一条，便于按 BOM 维度追溯历史
create table if not exists bom_pick_records (
  id           uuid        primary key default gen_random_uuid(),
  owner        uuid        not null references auth.users(id) on delete cascade,
  project_id   uuid        not null references bom_projects(id) on delete cascade,
  sets         int         not null default 1,
  note         text,
  created_at   timestamptz default now()
);

-- 5.1) 待采购单（主表 + 明细）
-- 来源为 BOM 导入的缺料行（source='bom'，source_id 指向 BOM 项目），也可手工新建。
-- 明细保存物料快照（name/model/brand/package/part_no），未匹配物料 material_id 为 null。
create table if not exists purchase_orders (
  id          uuid        primary key default gen_random_uuid(),
  owner       uuid        not null references auth.users(id) on delete cascade,
  name        text        not null,
  source      text,                                                            -- bom | manual
  source_id   uuid,                                                            -- 来源为 bom 时指向 bom_projects.id
  note        text,                                                            -- 采购原因
  status      text        default 'pending',                                    -- pending = 进行中 | done = 已完成
  created_at  timestamptz default now(),
  deleted_at  timestamptz
);
create table if not exists purchase_items (
  id           uuid        primary key default gen_random_uuid(),
  order_id     uuid        not null references purchase_orders(id) on delete cascade,
  material_id  uuid        references materials(id) on delete set null,
  name         text        not null,                                            -- 物料名称（快照）
  model        text,
  brand        text,
  package      text,
  part_no      text,
  qty          int         not null default 1,                                  -- 需求数量
  stock_qty    int,                                                             -- 建单时的库存快照
  lack_qty     int         not null default 0,                                  -- 缺料数量 = max(0, 需求 - 库存)
  note         text,                                                            -- 备注（位号 / 来源行）
  done         boolean     default false,                                       -- 是否已处理（已入库 / 已忽略）
  created_at   timestamptz default now()
);

-- 6) 用户设置
create table if not exists settings (
  owner       uuid        primary key references auth.users(id) on delete cascade,
  theme       text        default 'auto',   -- auto | light | dark
  data        jsonb       default '{}'::jsonb
);

-- 6.1) 基础数据字典（下拉框选项维护，如 库位 / 出库用途）
create table if not exists dict_types (
  id          uuid        primary key default gen_random_uuid(),
  owner       uuid        not null references auth.users(id) on delete cascade,
  key         text        not null,                                             -- 字典标识（location / out_purpose / 自定义）
  name        text        not null,                                             -- 显示名
  builtin     boolean     default false,                                        -- 内置字典不可删除
  sort_order  int         default 0,
  created_at  timestamptz default now(),
  unique (owner, key)
);
create table if not exists dict_items (
  id          uuid        primary key default gen_random_uuid(),
  owner       uuid        not null references auth.users(id) on delete cascade,
  dict_key    text        not null,
  label       text        not null,                                             -- 选项显示值
  sort_order  int         default 0,
  created_at  timestamptz default now()
);

-- 7) 标签打印模板：一套模板 = 一种标签尺寸 + 每个分类各自的字段布局
create table if not exists label_templates (
  id               uuid        primary key default gen_random_uuid(),
  owner            uuid        not null references auth.users(id) on delete cascade,
  name             text        not null,
  width_mm         numeric     not null default 24,
  height_mm        numeric     not null default 12,
  grid_rows        integer     not null default 2,
  grid_cols        integer     not null default 2,
  cats             jsonb       not null default '[]'::jsonb,   -- 每分类 blocks + 排序（JSON 数组）
  default_font_pt  numeric     not null default 6,
  layout           jsonb       not null default '{}'::jsonb,
  is_default       boolean     not null default false,
  builtin          boolean     not null default false,         -- 内置模板：不可删除
  created_at       timestamptz not null default now(),
  deleted_at       timestamptz
);

-- 8) 索引
create index if not exists idx_categories_owner  on categories(owner);
create index if not exists idx_categories_parent on categories(parent);
create index if not exists idx_catparams_cat      on category_params(category_id);
create index if not exists idx_dict_items_owner  on dict_items(owner);
create index if not exists idx_dict_items_dict   on dict_items(dict_key);
create index if not exists idx_categories_lcsc   on categories(lcsc_id);
create index if not exists idx_suppliers_owner   on suppliers(owner);
create index if not exists idx_materials_owner    on materials(owner);
create index if not exists idx_materials_category on materials(category_id);
create index if not exists idx_matparams_mat      on material_params(material_id);
create index if not exists idx_matfiles_mat       on material_files(material_id);
create index if not exists idx_stocklog_owner      on stock_log(owner, created_at);
create index if not exists idx_bomitems_project    on bom_items(project_id);
create index if not exists idx_bompick_project     on bom_pick_records(project_id);
create index if not exists idx_purchase_orders_owner on purchase_orders(owner);
create index if not exists idx_purchase_items_order on purchase_items(order_id);
create index if not exists idx_label_templates_owner
  on label_templates (owner) where deleted_at is null;

-- 9) 行级安全（RLS）：每个用户只能访问自己的数据
alter table categories    enable row level security;
alter table category_params enable row level security;
alter table suppliers     enable row level security;
alter table materials     enable row level security;
alter table material_params enable row level security;
alter table material_files enable row level security;
alter table stock_log     enable row level security;
alter table bom_projects  enable row level security;
alter table bom_items     enable row level security;
alter table bom_pick_records enable row level security;
alter table purchase_orders enable row level security;
alter table purchase_items  enable row level security;
alter table settings      enable row level security;
alter table dict_types    enable row level security;
alter table dict_items    enable row level security;

-- 8.1) 先删除旧策略，保证可重复执行
drop policy if exists "owner only" on categories;
drop policy if exists "owner only" on category_params;
drop policy if exists "owner only" on suppliers;
drop policy if exists "owner only" on materials;
drop policy if exists "owner only" on material_params;
drop policy if exists "owner only" on material_files;
drop policy if exists "owner only" on stock_log;
drop policy if exists "owner only" on bom_projects;
drop policy if exists "owner only" on settings;
drop policy if exists "owner only" on bom_items;
drop policy if exists "owner only" on bom_pick_records;
drop policy if exists "owner only" on purchase_orders;
drop policy if exists "owner only" on purchase_items;
drop policy if exists "owner only" on dict_types;
drop policy if exists "owner only" on dict_items;
drop policy if exists "owner assets" on storage.objects;

-- 8.2) 用户表策略（注意用 (select auth.uid()) 以保证稳定、可内联）
create policy "owner only" on categories
  for all using ((select auth.uid()) = owner) with check ((select auth.uid()) = owner);
create policy "owner only" on category_params
  for all using ((select auth.uid()) = owner) with check ((select auth.uid()) = owner);
create policy "owner only" on suppliers
  for all using ((select auth.uid()) = owner) with check ((select auth.uid()) = owner);
create policy "owner only" on materials
  for all using ((select auth.uid()) = owner) with check ((select auth.uid()) = owner);
create policy "owner only" on material_params
  for all using ((select auth.uid()) = owner) with check ((select auth.uid()) = owner);
create policy "owner only" on material_files
  for all using ((select auth.uid()) = owner) with check ((select auth.uid()) = owner);
create policy "owner only" on stock_log
  for all using ((select auth.uid()) = owner) with check ((select auth.uid()) = owner);
create policy "owner only" on bom_projects
  for all using ((select auth.uid()) = owner) with check ((select auth.uid()) = owner);
create policy "owner only" on settings
  for all using ((select auth.uid()) = owner) with check ((select auth.uid()) = owner);
create policy "owner only" on dict_types
  for all using ((select auth.uid()) = owner) with check ((select auth.uid()) = owner);
create policy "owner only" on dict_items
  for all using ((select auth.uid()) = owner) with check ((select auth.uid()) = owner);

-- 8.3) bom_items 无冗余 owner 列，RLS 通过 project_id 关联 bom_projects 鉴权
create policy "owner only" on bom_items for all
  using  ((select auth.uid()) = (select owner from bom_projects where id = bom_items.project_id))
  with check ((select auth.uid()) = (select owner from bom_projects where id = bom_items.project_id));
-- 8.3.1) bom_pick_records 无冗余 owner 列，RLS 通过 project_id 关联 bom_projects 鉴权
create policy "owner only" on bom_pick_records for all
  using  ((select auth.uid()) = (select owner from bom_projects where id = bom_pick_records.project_id))
  with check ((select auth.uid()) = (select owner from bom_projects where id = bom_pick_records.project_id));
create policy "owner only" on purchase_orders for all
  using ((select auth.uid()) = owner) with check ((select auth.uid()) = owner);
-- 8.4) purchase_items 同样无 owner 列，通过 order_id 关联 purchase_orders 鉴权
create policy "owner only" on purchase_items for all
  using  ((select auth.uid()) = (select owner from purchase_orders where id = purchase_items.order_id))
  with check ((select auth.uid()) = (select owner from purchase_orders where id = purchase_items.order_id));

-- 9) Storage 桶 "assets"（公开桶）。
-- 只写入所有 Supabase 版本都支持的列 (id, name, public)，
-- 避免 file_size_limit / allowed_mime_types 在旧实例不存在导致整段回滚、表全没建出来。
-- 若后台已手动建好同名桶，on conflict 不会重复创建。
insert into storage.buckets (id, name, public)
values ('assets', 'assets', true)
on conflict (id) do nothing;

-- 9.1) 桶策略：用户仅能读写自己目录（<user_id>/...）下的对象
create policy "owner assets" on storage.objects for all
  using  (bucket_id = 'assets' and (select auth.uid()) is not null and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'assets' and (select auth.uid()) is not null and (storage.foldername(name))[1] = (select auth.uid())::text);

-- 10) 统计概览函数：一次聚合返回首页卡片所需的四项指标，供前端 statsOverview() 调用。
-- 使用默认 SECURITY INVOKER，自动沿用 materials / categories 的 RLS，只统计当前用户自己的数据。
-- low_stock 阈值优先级：物料自身阈值(>0) → 所属分类阈值(>0) → 全局默认 5。
create or replace function stats_overview()
returns table (
  total_materials bigint,
  total_qty       bigint,
  total_value     numeric,
  low_stock       bigint
) language sql stable as $$
  with base as (
    select
      m.qty,
      m.price,
      m.threshold,
      coalesce(c.threshold, 0) as cat_threshold
    from materials m
    left join categories c on c.id = m.category_id
    where m.deleted_at is null
  )
  select
    count(*)::bigint,
    coalesce(sum(qty), 0)::bigint,
    coalesce(sum(qty * price), 0),
    count(*) filter (
      where qty <= case
        when threshold > 0 then threshold
        when cat_threshold > 0 then cat_threshold
        else 5
      end
    )::bigint
  from base;
$$;

-- ============================================================================
-- 11) 标签模板的 RLS + 内置模板
-- ============================================================================

-- RLS：只能读写自己的模板
alter table label_templates enable row level security;

drop policy if exists "own label templates" on label_templates;
create policy "own label templates" on label_templates
  for all using (auth.uid() = owner) with check (auth.uid() = owner);

-- 内置模板种子：给每个已存在的用户各写一份。
-- 内置模板 App 层禁止删除：deleteLabelTemplate 拒绝 + 标签模板页面隐藏删除按钮。
-- owner 是 auth.users(id) 外键，SQL 脚本里拿不到 auth.uid()（无登录会话），
-- 幂等：该用户已有内置模板时跳过。
-- 新注册的用户由 App 层在首次启动时补（此处无法为“将来才出现的用户”预插）。
insert into label_templates
  (owner, name, width_mm, height_mm, grid_rows, grid_cols, cats, default_font_pt, layout, is_default, builtin)
select
  u.id,
  '默认模板',
  24,            -- width_mm
  9,             -- height_mm
  3,             -- grid_rows
  4,             -- grid_cols
  '[{"category_id":"{{贴片电阻_Id}}","blocks":[{"id":"b-name","type":"field","x":0,"y":0,"w":4,"h":1,"field":"model","align":"center","valign":"middle","auto_shrink":true,"font_pt":6},{"id":"bmu83ihi61","type":"field","field":"brand","x":0,"y":1,"w":2,"h":1,"align":"left","valign":"middle","auto_shrink":true,"font_pt":6},{"id":"bmu83iiry3","type":"field","field":"param:param_10835_n","x":2,"y":1,"w":1,"h":1,"align":"right","valign":"middle","auto_shrink":true,"font_pt":6},{"id":"bmu83ij2v4","type":"field","field":"param:param_10836_s","x":3,"y":1,"w":1,"h":1,"align":"left","valign":"middle","auto_shrink":true,"font_pt":6},{"id":"bmu83vz1y5","type":"field","field":"param:queryProductStandard","x":0,"y":2,"w":2,"h":1,"align":"left","valign":"middle","auto_shrink":true,"font_pt":6,"prefix":"封装:"},{"id":"bmu83we9n6","type":"field","field":"param:param_10837_n","x":2,"y":2,"w":1,"h":1,"align":"left","valign":"middle","auto_shrink":true,"font_pt":6,"text":" "},{"id":"bmu8de09v1","type":"field","field":"param:param_11155_n","x":3,"y":2,"w":1,"h":1,"align":"left","valign":"middle","auto_shrink":true,"font_pt":6}],"sort_mode":"field","sort_field":"param_10835_n","sort_dir":"asc"},{"category_id":"{{贴片电容(MLCC)_Id}}","blocks":[{"id":"b-name","type":"field","x":0,"y":0,"w":4,"h":1,"field":"model","align":"center","valign":"middle","auto_shrink":true,"font_pt":6},{"id":"bmu83pkfb1","type":"field","field":"brand","x":0,"y":1,"w":2,"h":1,"align":"left","valign":"middle","auto_shrink":true,"empty_behavior":"keep","font_pt":6},{"id":"bmu83plbn3","type":"field","field":"param:param_10951_n","x":2,"y":1,"w":1,"h":1,"align":"right","valign":"middle","auto_shrink":true,"empty_behavior":"keep","font_pt":6},{"id":"bmu83pljz4","type":"field","field":"param:param_10952_s","x":3,"y":1,"w":1,"h":1,"align":"left","valign":"middle","auto_shrink":true,"empty_behavior":"keep","font_pt":6},{"id":"bmu846b011","type":"field","field":"param:queryProductStandard","x":0,"y":2,"w":2,"h":1,"align":"left","valign":"middle","auto_shrink":true,"font_pt":6,"prefix":"封装:"},{"id":"bmu846l282","type":"field","field":"param:param_10953_n","x":2,"y":2,"w":1,"h":1,"align":"left","valign":"middle","auto_shrink":true,"text":" ","font_pt":6},{"id":"bmu8ddgoh3","type":"field","field":"param:param_10954","x":3,"y":2,"w":1,"h":1,"align":"left","valign":"middle","auto_shrink":true,"font_pt":6}],"sort_mode":"field","sort_field":"param_10951_n","sort_dir":"asc"},{"category_id":"","blocks":[{"id":"bmu8fiyzh1","type":"field","field":"name","x":0,"y":0,"w":4,"h":1,"align":"center","valign":"middle","auto_shrink":true,"font_pt":6},{"id":"bmu8fje6j2","type":"field","field":"brand","x":0,"y":1,"w":2,"h":1,"align":"left","valign":"middle","auto_shrink":true,"font_pt":6},{"id":"bmu8fjlkp4","type":"field","field":"model","x":2,"y":1,"w":2,"h":1,"align":"left","valign":"middle","auto_shrink":true,"prefix":"","font_pt":6},{"id":"bmu8fkber5","type":"field","field":"part_no","x":0,"y":2,"w":2,"h":1,"align":"left","valign":"middle","auto_shrink":true,"prefix":"","font_pt":6},{"id":"bmu8fkp1w6","type":"field","field":"location","x":2,"y":2,"w":2,"h":1,"align":"left","valign":"middle","auto_shrink":true,"prefix":"","font_pt":6}],"sort_mode":"cat","sort_field":null,"sort_dir":"asc"}]'::jsonb,
  6,             -- default_font_pt
  '{"paper":"A4","paper_w":210,"paper_h":297,"sheet_w":210,"sheet_h":297,"cols":8,"rows":26,"pad":2,"gap_w":2,"gap_h":2,"pos_mode":"custom","off_x":0,"off_y":0,"scale_fix":1,"guides":true,"auto_fill":false}'::jsonb,
  true,          -- is_default
  true           -- builtin
from auth.users u
where not exists (
  select 1 from label_templates t where t.owner = u.id and t.builtin
);

-- 内置模板唯一默认：同一 owner 下清掉其它模板的 is_default
update label_templates t
   set is_default = false
 where t.deleted_at is null
   and t.builtin = false
   and exists (
     select 1 from label_templates b
      where b.owner = t.owner and b.builtin and b.deleted_at is null
   );

-- 增量迁移：已部署库补备注列（新建库已在建表时包含；remark 默认值 null）
alter table materials add column if not exists remark text;

-- 库存盘点（主表 + 明细）：差异在提交时通过 applyStock 入账
create table if not exists stocktakes (
  id            uuid primary key default gen_random_uuid(),
  owner         uuid not null references auth.users(id) on delete cascade,
  name          text not null,
  note          text,
  status        text default 'done',
  created_at    timestamptz default now()
);

create table if not exists stocktake_items (
  id            uuid primary key default gen_random_uuid(),
  take_id       uuid not null references stocktakes(id) on delete cascade,
  material_id   uuid references materials(id) on delete set null,
  material_name text,
  book_qty      integer not null default 0,
  actual_qty    integer not null default 0,
  diff          integer not null default 0,
  created_at    timestamptz default now()
);

create index if not exists idx_stocktakes_owner on stocktakes(owner);
create index if not exists idx_stocktake_items_take on stocktake_items(take_id);

-- 9) 库存盘点表 RLS：与主流程表一致，仅本人可访问；明细（无 owner 列）通过主表 owner 判定
alter table stocktakes enable row level security;
alter table stocktake_items enable row level security;

drop policy if exists "owner only" on stocktakes;
create policy "owner only" on stocktakes
  for all using ((select auth.uid()) = owner) with check ((select auth.uid()) = owner);

drop policy if exists "owner only" on stocktake_items;
create policy "owner only" on stocktake_items
  for all using ((select auth.uid()) = (select owner from stocktakes where id = take_id))
  with check ((select auth.uid()) = (select owner from stocktakes where id = take_id));
