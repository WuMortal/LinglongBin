// 应用级配置：数据模式 + Supabase 连接信息
// 持久化在本地独立 SQLite 文件 sys.db（与业务库 data.db 分离，不同步）
// 启动时调用 initAppSettings() 一次性载入内存缓存，之后所有读操作走同步缓存
import Database from '@tauri-apps/plugin-sql'

const DB_CONN = 'sqlite:sys.db'

const SCHEMA_SQL = `
create table if not exists app_settings (
  key        text primary key,
  value      text,
  updated_at text default (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
`

// 内部 key（数据库列）
const KEY_MODE = 'mode'
const KEY_URL = 'supabase_url'
const KEY_ANON = 'supabase_anon'
const KEY_SETUP = 'onboarding_done'

// 老版本 localStorage 键 -> sys.db key（一次性迁移用）
const LEGACY_KEYS: Record<string, string> = {
  'llv-data-mode': KEY_MODE,
  'llv-supabase-url': KEY_URL,
  'llv-supabase-anon': KEY_ANON,
}

export type DataMode = 'sqlite' | 'supabase'

export interface AppSettings {
  mode: DataMode
  supabaseUrl: string
  supabaseAnonKey: string
}

const DEFAULT_SETTINGS: AppSettings = {
  mode: 'sqlite',
  supabaseUrl: '',
  supabaseAnonKey: '',
}

let _db: Database | null = null
let _cache: AppSettings | null = null
let _setupDone = false

async function ensureDb(): Promise<Database> {
  if (_db) return _db
  const db = await Database.load(DB_CONN)
  await db.execute(SCHEMA_SQL)
  _db = db
  return db
}

async function upsert(db: Database, key: string, value: string): Promise<void> {
  await db.execute(
    `insert into app_settings (key, value, updated_at)
     values (?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
     on conflict(key) do update set value = excluded.value, updated_at = excluded.updated_at`,
    [key, value],
  )
}

/** 从老版本 localStorage 一次性迁移到 sys.db，迁移后清除 localStorage 旧键 */
async function migrateFromLocalStorage(db: Database): Promise<void> {
  let migrated = false
  for (const [lk, sk] of Object.entries(LEGACY_KEYS)) {
    const v = localStorage.getItem(lk)
    if (v != null) {
      await upsert(db, sk, v)
      localStorage.removeItem(lk)
      migrated = true
    }
  }
  if (migrated) {
    console.info('[appSettings] 已从 localStorage 迁移配置到 sys.db')
  }
}

/** 启动时调用一次：加载 sys.db 配置到内存缓存，并执行一次性迁移 */
export async function initAppSettings(): Promise<void> {
  if (_cache) return
  const db = await ensureDb()
  await migrateFromLocalStorage(db)
  const rows = await db.select<{ key: string; value: string | null }[]>(
    'select key, value from app_settings',
  )
  const map = new Map(rows.map(r => [r.key, r.value]))
  _cache = {
    mode: (map.get(KEY_MODE) as DataMode) || DEFAULT_SETTINGS.mode,
    supabaseUrl: map.get(KEY_URL) || DEFAULT_SETTINGS.supabaseUrl,
    supabaseAnonKey: map.get(KEY_ANON) || DEFAULT_SETTINGS.supabaseAnonKey,
  }
  _setupDone = map.get(KEY_SETUP) === '1'
}

/** 同步读取内存缓存。未初始化时返回默认值（避免启动竞态导致崩溃） */
export function getAppSettings(): AppSettings {
  if (!_cache) return { ...DEFAULT_SETTINGS }
  return _cache
}

/** 异步写入 sys.db 并同步更新内存缓存 */
export async function setAppSettings(s: Partial<AppSettings>): Promise<void> {
  const db = await ensureDb()
  if (!_cache) _cache = { ...DEFAULT_SETTINGS }
  if (s.mode !== undefined) {
    await upsert(db, KEY_MODE, s.mode)
    _cache.mode = s.mode
  }
  if (s.supabaseUrl !== undefined) {
    await upsert(db, KEY_URL, s.supabaseUrl)
    _cache.supabaseUrl = s.supabaseUrl
  }
  if (s.supabaseAnonKey !== undefined) {
    await upsert(db, KEY_ANON, s.supabaseAnonKey)
    _cache.supabaseAnonKey = s.supabaseAnonKey
  }
}

export function getDataMode(): DataMode {
  return getAppSettings().mode
}

export async function setDataMode(mode: DataMode): Promise<void> {
  await setAppSettings({ mode })
}

/** 是否需要登录：仅 supabase 模式且 url/anon 都填了才需要 */
export function isAuthRequired(): boolean {
  const s = getAppSettings()
  if (s.mode === 'sqlite') return false
  return !!(s.supabaseUrl && s.supabaseAnonKey)
}

/** 是否已走完首次引导（首启判定由路由守卫读取，避免依赖组件挂载时机） */
export function isSetupDone(): boolean {
  return _setupDone
}

/** 标记引导完成（写入 sys.db，与业务库分离、不同步） */
export async function setSetupDone(done = true): Promise<void> {
  const db = await ensureDb()
  await upsert(db, KEY_SETUP, done ? '1' : '0')
  _setupDone = done
}
