-- ============================================================================
-- LinglongBin · Supabase 存量库升级脚本：出入库单据化（stock_orders）
-- ============================================================================
-- 适用：已用 0001_init.sql 建过库、已有业务数据的 Supabase 项目。
-- 用法：Supabase 后台 → SQL Editor → 粘贴本文件 →「运行」。可重复执行（幂等）。
--
-- 内容：
--   1) 新建 stock_orders 出入库单主表
--   2) stock_log 增加 order_id 列（挂单）
--   3) 单据相关索引
--   4) stock_orders 行级安全（RLS）策略
--
-- 说明：历史流水不在本脚本中聚合为单 —— App 首次访问出入库单页 / 首次建单时
--       自动迁移（supabaseStore.ensureOrderMigrated：按 type 相同 + note 相同
--       + 时间相邻 ≤60 秒聚合为 legacy 单，source_id 关联、单号按流水原始日期编号）。
--       多端并发迁移安全：流水按「order_id 仍为空」条件更新，抢不到即放弃并
--       清理空单。
-- ============================================================================

-- 1) 出入库单主表：一次出入库 = 1 单 N 明细（明细即 stock_log 挂 order_id）
create table if not exists stock_orders (
  id            uuid        primary key default gen_random_uuid(),
  owner         uuid        not null references auth.users(id) on delete cascade,
  order_no      text,       -- 单号：RK(入)/CK(出) + yyyyMMdd + 4 位序号
  type          text        not null check (type in ('in','out')),
  source        text        not null default 'manual',   -- manual | init | import | bom | purchase | stocktake | legacy
  source_id     uuid,       -- 关联业务单 id（BOM 领料记录 / 待采单 / 盘点单），跨表不建外键
  title         text,       -- 摘要标题（如「订单导入：xxx.xls」）
  supplier_id   uuid        references suppliers(id) on delete set null,           -- 单级供应商（入库常用）
  note          text,
  item_count    integer     not null default 0,      -- 明细条数（冗余，列表展示用）
  total_qty     integer     not null default 0,      -- 明细数量合计（冗余，列表展示用）
  status        text        default 'normal',                                      -- normal = 有效 | void = 已撤销
  void_reason   text,                                                              -- 撤销原因
  voided_at     timestamptz,                                                       -- 撤销时间
  created_at    timestamptz default now()
);

-- 2) 流水挂单列（已存在则跳过）
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_name = 'stock_log' and column_name = 'order_id'
  ) then
    alter table stock_log add column order_id uuid references stock_orders(id) on delete set null;
  end if;
end $$;

-- 3) 索引
create index if not exists idx_stockorders_owner on stock_orders(owner, created_at);
create index if not exists idx_stockorders_no    on stock_orders(owner, order_no);
create index if not exists idx_stocklog_order    on stock_log(order_id);

-- 4) 行级安全：只能读写自己的单据
alter table stock_orders enable row level security;
drop policy if exists "owner only" on stock_orders;
create policy "owner only" on stock_orders
  for all using ((select auth.uid()) = owner) with check ((select auth.uid()) = owner);
