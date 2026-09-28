// 立创查询缓存：复用本地 SQLite 文件 sys.db（与 appSettings 共用同一连接）
// 与业务库（data.db / Supabase）分离、不同步，两种存储模式下行为一致。
// 目的：跨重启复用立创联网结果，减少重复请求。任何失败一律静默降级为「不缓存」，绝不阻塞主流程。
import Database from '@tauri-apps/plugin-sql'

const DB_CONN = 'sqlite:sys.db'

const SCHEMA_SQL = `
create table if not exists lcsc_cache (
  kind       text not null,
  key        text not null,
  payload    text not null,
  updated_at text default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  primary key (kind, key)
);
`

/** 缓存类型：详情查询 / 关键词搜索 / 图片 URL→本地路径 映射 */
export type LcscCacheKind = 'lookup' | 'search' | 'image'

let _db: Database | null = null
/** 初始化失败后不再重试（非 Tauri 环境下 Database.load 不可用） */
let _unavailable = false

async function ensureDb(): Promise<Database | null> {
  if (_unavailable) return null
  if (_db) return _db
  try {
    const db = await Database.load(DB_CONN)
    await db.execute(SCHEMA_SQL)
    _db = db
    return db
  } catch {
    _unavailable = true
    return null
  }
}

/**
 * 读取缓存。不存在或已超过 ttlMs 时返回 null（ttlMs <= 0 表示永不过期）。
 */
export async function lcscCacheGet<T>(kind: LcscCacheKind, key: string, ttlMs: number): Promise<T | null> {
  const db = await ensureDb()
  if (!db) return null
  try {
    const rows = await db.select<{ payload: string; updated_at: string }[]>(
      'select payload, updated_at from lcsc_cache where kind = ? and key = ?',
      [kind, key],
    )
    const row = rows[0]
    if (!row) return null
    if (ttlMs > 0) {
      const ts = Date.parse(row.updated_at)
      if (Number.isFinite(ts) && Date.now() - ts > ttlMs) return null
    }
    return JSON.parse(row.payload) as T
  } catch {
    return null
  }
}

/** 写入缓存（已存在则覆盖内容与时间） */
export async function lcscCacheSet(kind: LcscCacheKind, key: string, payload: unknown): Promise<void> {
  const db = await ensureDb()
  if (!db) return
  try {
    await db.execute(
      `insert into lcsc_cache (kind, key, payload, updated_at)
       values (?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
       on conflict(kind, key) do update set payload = excluded.payload, updated_at = excluded.updated_at`,
      [kind, key, JSON.stringify(payload)],
    )
  } catch {
    /* 写入失败不影响主流程 */
  }
}

/** 清空缓存：kind 省略表示清空全部 */
export async function lcscCacheClear(kind?: LcscCacheKind): Promise<void> {
  const db = await ensureDb()
  if (!db) return
  try {
    if (kind) await db.execute('delete from lcsc_cache where kind = ?', [kind])
    else await db.execute('delete from lcsc_cache')
  } catch {
    /* 清理失败不影响主流程 */
  }
}

/** 缓存总条数（设置页展示用） */
export async function lcscCacheCount(): Promise<number> {
  const db = await ensureDb()
  if (!db) return 0
  try {
    const rows = await db.select<{ n: number }[]>('select count(*) as n from lcsc_cache')
    return rows[0]?.n ?? 0
  } catch {
    return 0
  }
}
