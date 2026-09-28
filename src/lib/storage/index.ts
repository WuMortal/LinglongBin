// 存储工厂：按 appSettings 选择 Supabase（在线）或 SQLite（离线）
// 选择规则：仅当 mode === 'supabase' 且 url/anon 都已配置时才用 SupabaseStore，
// 否则降级到 SqliteStore（避免误用占位 URL 调用 supabase 报错）。
import type { DataStore } from './types'
import { SupabaseStore } from './supabaseStore'
import { SqliteStore } from './sqliteStore'
import { getAppSettings, type DataMode } from '../appSettings'

export type { DataStore } from './types'
export type {
  ListMaterialsOpts, StockInput, ApplyStockInput,
  UploadResult, StatsOverview, StatsCategoryRow, LowStockRow, TrendRow, StockSummaryRow,
  PageResult, StockLogPageOpts, PurchaseOrderPageOpts,
} from './types'
// BomPickRecord 定义在 src/lib/types.ts（storage/types.ts 仅 import 未 re-export），需从上级模块导出
export type { BomPickRecord } from '../types'

let _store: DataStore | null = null
let _currentKey: string | null = null

/** 实际激活的存储模式（supabase 未配置时降级为 sqlite） */
export function activeMode(): DataMode {
  const s = getAppSettings()
  if (s.mode === 'supabase' && s.supabaseUrl && s.supabaseAnonKey) return 'supabase'
  return 'sqlite'
}

/** 获取当前激活的存储实例（单例，按配置切换） */
export function getStore(): DataStore {
  const mode = activeMode()
  const settings = getAppSettings()
  // 用 mode + url + anon 作为缓存键，配置变更后自动重建
  const key = `${mode}|${settings.supabaseUrl}|${settings.supabaseAnonKey}`
  if (!_store || _currentKey !== key) {
    _store = mode === 'sqlite' ? new SqliteStore() : new SupabaseStore()
    _currentKey = key
  }
  return _store
}

/** 切换模式或配置后调用，强制重建 store */
export function resetStore() {
  _store = null
  _currentKey = null
}

export function currentMode(): DataMode {
  return activeMode()
}
