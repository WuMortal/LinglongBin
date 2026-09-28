// 鉴权类瞬时错误的一次性重试封装。
//
// 典型场景：隔夜后本地缓存的会话/令牌失效，或系统时钟偏移导致新签发的令牌被判为
// "JWT issued at future"。这类错误在刷新会话（拿到服务器当前时间签发的新 token）
// 后重试一次通常就能通过，不必让用户手动再点一次。
import { supabase } from './supabase'
import { authRequired } from './auth'

/** 命中这些关键词即视为「鉴权 / 令牌类」瞬时错误 */
const AUTH_ERR_RE = /jwt|token|auth|unauthorized|issued|expired|invalid claim/i

function isAuthError(e: unknown): boolean {
  return AUTH_ERR_RE.test(String((e as { message?: string } | null)?.message ?? e ?? ''))
}

/**
 * 执行一个 Supabase 请求；失败且属于鉴权类错误时，先强制刷新会话再重试一次。
 * 刷新本身失败也照样重试一次——可能只是本机时钟还没校时完成，稍后再试即可通过。
 * 重试仍失败才把错误抛给调用方，保证不会掩盖真正的业务错误。
 */
export async function withAuthRetry<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (e) {
    if (!authRequired() || !isAuthError(e)) throw e
    try { await supabase.auth.refreshSession() } catch { /* 忽略：仍用当前会话重试一次 */ }
    return await fn()
  }
}
