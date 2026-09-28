// 校验 Supabase 连接：访问公开的 auth 设置接口，URL 错误或非法的 Anon Key 都会失败
export async function validateSupabase(url: string, anon: string): Promise<boolean> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 10000)
  try {
    const res = await fetch(`${url.replace(/\/+$/, '')}/auth/v1/settings`, {
      headers: { apikey: anon, Authorization: `Bearer ${anon}` },
      signal: ctrl.signal,
    })
    if (!res.ok) return false
    const body = await res.json().catch(() => null)
    return !!body && typeof body === 'object'
  } catch {
    return false
  } finally {
    clearTimeout(timer)
  }
}
