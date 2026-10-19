-- ============================================================================
-- LinglongBin · Supabase 初始化脚本（全新项目一键建库）
-- ============================================================================
-- 用法：Supabase 后台 → SQL Editor →「新建查询」粘贴本文件 →「运行」。
-- 注意：第 0 段会先清空同名表，已在使用中的项目请先备份，或整段注释掉。
-- 说明：内置标签模板不由本脚本创建 —— App 导入立创分类后自动补建
--       （src/lib/db.ts ensureDefaultLabelTemplate）。
-- ============================================================================

create extension if not exists "pgcrypto";

-- 0) 清空重建
drop table if exists stocktake_items cascade;
drop table if exists stocktakes cascade;
drop table if exists purchase_items cascade;
drop table if exists purchase_orders cascade;
drop table if exists bom_pick_records cascade;
drop table if exists bom_items cascade;
drop table if exists bom_projects cascade;
drop table if exists material_params cascade;
drop table if exists material_files cascade;
drop table if exists category_params cascade;
drop table if exists stock_log cascade;
drop table if exists label_templates cascade;
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
  sort_order    int         default 0,
  created_at    timestamptz default now()
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
  status        text        default 'normal',                                      -- normal = 有效 | void = 已撤销
  void_reason   text,                                                              -- 撤销原因
  voided_at     timestamptz,                                                       -- 撤销时间
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

-- 5.1) 领料记录：一次领料出库（可多套）生成一条，便于按 BOM 维度追溯历史
create table if not exists bom_pick_records (
  id          uuid        primary key default gen_random_uuid(),
  owner       uuid        not null references auth.users(id) on delete cascade,
  project_id  uuid        not null references bom_projects(id) on delete cascade,
  sets        int         not null default 1,
  note        text,
  created_at  timestamptz default now()
);

-- 6) 待采购单（主表 + 明细）
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
  id          uuid        primary key default gen_random_uuid(),
  order_id    uuid        not null references purchase_orders(id) on delete cascade,
  material_id uuid        references materials(id) on delete set null,
  name        text        not null,                                            -- 物料名称（快照）
  model       text,
  brand       text,
  package     text,
  part_no     text,
  qty         int         not null default 1,                                  -- 需求数量
  stock_qty   int,                                                             -- 建单时的库存快照
  lack_qty    int         not null default 0,                                  -- 缺料数量 = max(0, 需求 - 库存)
  note        text,                                                            -- 备注（位号 / 来源行）
  done        boolean     default false,                                       -- 是否已处理（已入库 / 已忽略）
  created_at  timestamptz default now()
);

-- 7) 用户设置
create table if not exists settings (
  owner       uuid        primary key references auth.users(id) on delete cascade,
  theme       text        default 'auto',   -- auto | light | dark
  data        jsonb       default '{}'::jsonb
);

-- 7.1) 基础数据字典（下拉框选项维护，如 库位 / 出库用途）
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

-- 8) 标签打印模板：一套模板 = 一种标签尺寸 + 每个分类各自的字段布局
--    内置默认模板由 App 创建，脚本只建表。
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

-- 9) 库存盘点（主表 + 明细）：差异在提交时通过 applyStock 入账
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

-- 10) 索引
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
create index if not exists idx_stocktakes_owner     on stocktakes(owner);
create index if not exists idx_stocktake_items_take on stocktake_items(take_id);
create index if not exists idx_label_templates_owner
  on label_templates (owner) where deleted_at is null;

-- 11) 行级安全（RLS）：每个用户只能访问自己的数据
alter table categories         enable row level security;
alter table category_params    enable row level security;
alter table suppliers          enable row level security;
alter table materials          enable row level security;
alter table material_params    enable row level security;
alter table material_files     enable row level security;
alter table stock_log          enable row level security;
alter table bom_projects       enable row level security;
alter table bom_items          enable row level security;
alter table bom_pick_records   enable row level security;
alter table purchase_orders    enable row level security;
alter table purchase_items     enable row level security;
alter table settings           enable row level security;
alter table dict_types         enable row level security;
alter table dict_items         enable row level security;
alter table label_templates    enable row level security;
alter table stocktakes         enable row level security;
alter table stocktake_items    enable row level security;

-- 12.1) 先删除旧策略，保证可重复执行
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
drop policy if exists "owner only" on stocktakes;
drop policy if exists "owner only" on stocktake_items;
drop policy if exists "own label templates" on label_templates;
drop policy if exists "owner assets" on storage.objects;

-- 12.2) 带 owner 列的表：本人可读写（注意用 (select auth.uid()) 以保证稳定、可内联）
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
create policy "owner only" on purchase_orders
  for all using ((select auth.uid()) = owner) with check ((select auth.uid()) = owner);
create policy "owner only" on stocktakes
  for all using ((select auth.uid()) = owner) with check ((select auth.uid()) = owner);

-- 12.3) 无 owner 列的明细表：通过主表关联鉴权
create policy "owner only" on bom_items for all
  using  ((select auth.uid()) = (select owner from bom_projects where id = bom_items.project_id))
  with check ((select auth.uid()) = (select owner from bom_projects where id = bom_items.project_id));
create policy "owner only" on bom_pick_records for all
  using  ((select auth.uid()) = (select owner from bom_projects where id = bom_pick_records.project_id))
  with check ((select auth.uid()) = (select owner from bom_projects where id = bom_pick_records.project_id));
create policy "owner only" on purchase_items for all
  using  ((select auth.uid()) = (select owner from purchase_orders where id = purchase_items.order_id))
  with check ((select auth.uid()) = (select owner from purchase_orders where id = purchase_items.order_id));
create policy "owner only" on stocktake_items for all
  using  ((select auth.uid()) = (select owner from stocktakes where id = take_id))
  with check ((select auth.uid()) = (select owner from stocktakes where id = take_id));

-- 12.4) 标签模板：只能读写自己的模板
create policy "own label templates" on label_templates
  for all using (auth.uid() = owner) with check (auth.uid() = owner);

-- 13) Storage 桶 "assets"（公开桶）。
-- 只写入所有 Supabase 版本都支持的列 (id, name, public)，
-- 避免 file_size_limit / allowed_mime_types 在旧实例不存在导致整段回滚、表全没建出来。
-- 若后台已手动建好同名桶，on conflict 不会重复创建。
insert into storage.buckets (id, name, public)
values ('assets', 'assets', true)
on conflict (id) do nothing;

-- 13.1) 桶策略：用户仅能读写自己目录（<user_id>/...）下的对象
create policy "owner assets" on storage.objects for all
  using  (bucket_id = 'assets' and (select auth.uid()) is not null and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'assets' and (select auth.uid()) is not null and (storage.foldername(name))[1] = (select auth.uid())::text);

-- 14) 统计概览函数：一次聚合返回首页卡片所需的四项指标，供前端 statsOverview() 调用。
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
