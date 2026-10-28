-- ============================================================
-- 0002 库存字段拆分：materials.qty → total_qty / use_qty
-- 背景：原来出入库是「读出 qty → 算终值 → 写回 qty」的读-改-写，
--       并发下相互覆盖会丢更新。改为两个单调递增的累计列后，
--       入库只加 total_qty、出库只加 use_qty，可走服务端原子增量。
-- 迁移后：
--   total_qty  累计入库
--   use_qty    累计出库
--   qty        生成列（total_qty - use_qty），只读，杜绝与累计列不一致
--   qty_legacy 旧列改名保留，仅作备份
-- 幂等：可重复执行。
-- ============================================================

do $$
begin
  -- 1) 旧列改名备份（仅当它还是普通列时）
  if exists (
    select 1 from information_schema.columns
    where table_name = 'materials' and column_name = 'qty' and is_generated = 'NEVER'
  ) then
    alter table materials rename column qty to qty_legacy;
  end if;

  -- 2) 新增两个累计列
  if not exists (
    select 1 from information_schema.columns
    where table_name = 'materials' and column_name = 'total_qty'
  ) then
    alter table materials add column total_qty int not null default 0;
    -- 首次补列时一次性回填：旧库当前库存全部记为累计入库
    update materials set total_qty = coalesce(qty_legacy, 0);
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_name = 'materials' and column_name = 'use_qty'
  ) then
    alter table materials add column use_qty int not null default 0;
    update materials set use_qty = 0;
  end if;

  -- 3) qty 改为生成列：可用库存 = total_qty - use_qty
  if not exists (
    select 1 from information_schema.columns
    where table_name = 'materials' and column_name = 'qty'
  ) then
    alter table materials
      add column qty int generated always as (total_qty - use_qty) stored;
  end if;
end $$;

-- 4) 出入库原子累加：一次 UPDATE 在服务端完成，避免读-改-写并发覆盖。
--    默认 SECURITY INVOKER，沿用 materials 的 RLS，只能改自己名下的物料。
create or replace function apply_stock_delta(p_material uuid, p_in int, p_out int)
returns void
language sql
volatile
as $$
  update materials
     set total_qty = total_qty + coalesce(p_in, 0),
         use_qty   = use_qty   + coalesce(p_out, 0)
   where id = p_material;
$$;

grant execute on function apply_stock_delta(uuid, int, int) to authenticated;
grant execute on function apply_stock_delta(uuid, int, int) to service_role;
