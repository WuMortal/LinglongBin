import { supabase } from './supabase'
import { isAuthRequired } from './appSettings'

/** 是否需要登录：离线模式或 supabase 未配置时返回 false */
export function authRequired(): boolean {
  return isAuthRequired()
}

// 离线模式（或 supabase 未配置）下的虚拟本地会话
export interface LocalSession {
  user: {
    id: 'local-user'
    email: 'local@offline'
    user_metadata: { name: '本地用户' }
  }
  access_token: 'local-token'
}

const LOCAL_SESSION: LocalSession = {
  user: {
    id: 'local-user',
    email: 'local@offline',
    user_metadata: { name: '本地用户' },
  },
  access_token: 'local-token',
}

export async function signUp(email: string, password: string) {
  if (!authRequired()) return { data: { user: LOCAL_SESSION.user, session: null }, error: null }
  return supabase.auth.signUp({ email, password })
}

export async function signIn(email: string, password: string) {
  if (!authRequired()) return { data: { user: LOCAL_SESSION.user, session: LOCAL_SESSION }, error: null }
  return supabase.auth.signInWithPassword({ email, password })
}

export async function signOut() {
  if (!authRequired()) return { error: null }
  return supabase.auth.signOut()
}

export async function getSession() {
  if (!authRequired()) {
    return { data: { session: LOCAL_SESSION }, error: null }
  }
  return supabase.auth.getSession()
}

// 模块级登录态：供路由守卫同步读取（初始化早于组件挂载，避免首屏门控竞态）
let _authed = false
export function getAuthState(): boolean { return _authed }
export function setAuthState(v: boolean): void { _authed = v }

/** 应用启动早期调用：基于会话解析登录态并写入模块变量 */
export async function initAuth(): Promise<boolean> {
  try {
    const { data } = await getSession()
    _authed = !!(data && (data as { session?: unknown }).session)
  } catch {
    _authed = false
  }
  return _authed
}

export function onAuthChange(cb: (event: unknown, session: unknown) => void) {
  if (!authRequired()) {
    // 离线模式无会话变更，直接返回一个 no-op unsubscribe
    return { data: { subscription: { unsubscribe: () => {} } } }
  }
  return supabase.auth.onAuthStateChange(cb)
}
