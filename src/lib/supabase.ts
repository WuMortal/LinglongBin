// Supabase 客户端：支持动态配置
// 优先从 localStorage 读取用户填入的 url/anonKey，回退到 .env，最后占位
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { getAppSettings } from './appSettings'

const PLACEHOLDER_URL = 'http://localhost:54321'
const PLACEHOLDER_ANON = 'public-anon-key'

let _client: SupabaseClient | null = null
let _currentUrl = ''
let _currentAnon = ''

function resolveConfig(): { url: string; anon: string } {
  const s = getAppSettings()
  const envUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined
  const envAnon = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined
  // localStorage 优先于 env
  const url = s.supabaseUrl || envUrl || PLACEHOLDER_URL
  const anon = s.supabaseAnonKey || envAnon || PLACEHOLDER_ANON
  return { url, anon }
}

/** 获取当前 Supabase 客户端（懒初始化） */
export function getSupabase(): SupabaseClient {
  const { url, anon } = resolveConfig()
  if (!_client || _currentUrl !== url || _currentAnon !== anon) {
    _client = createClient(url, anon)
    _currentUrl = url
    _currentAnon = anon
  }
  return _client
}

/** 配置变更后调用，强制重建客户端 */
export function resetSupabaseClient() {
  _client = null
  _currentUrl = ''
  _currentAnon = ''
}

// 兼容现有 `import { supabase } from './supabase'` 的写法
// 注意：取值时调用 getSupabase()，配置变更后需要重新 import 才生效
// 推荐新代码直接用 getSupabase()
export const supabase = new Proxy({} as SupabaseClient, {
  get(_t, prop) {
    return Reflect.get(getSupabase(), prop)
  },
})

if (!getAppSettings().supabaseUrl && !import.meta.env.VITE_SUPABASE_URL) {
  console.warn('[supabase] 未配置 Supabase URL/ANON_KEY，请在设置页或 .env 中配置。当前为占位值，离线模式可忽略此警告。')
}
