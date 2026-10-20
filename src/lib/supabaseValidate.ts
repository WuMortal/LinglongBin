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

/**
 * 探测目标云端「当前已登录账号」是否已有数据，用于首启引导判断是否跳过初始化。
 *
 * 返回 true=已有数据 / false=确认为空 / null=无法判定（未登录或查询出错）。
 * 注意：业务表全部开着 RLS（owner = auth.uid()），未登录时查询只能拿到空集，
 * 所以未登录必须返回 null（「不知道」），绝不能当成「没有数据」——否则新端会重复初始化。
 */
export async function probeSupabaseHasData(url: string, anon: string): Promise<boolean | null> {
  try {
    // 用临时客户端读一遍本地会话即可，不改动全局客户端（此时 App 配置还没写入）
    const { createClient } = await import('@supabase/supabase-js')
    const tmp = createClient(url.replace(/\/+$/, ''), anon)
    const { data } = await tmp.auth.getSession()
    if (!data.session) return null
    for (const table of ['categories', 'materials']) {
      // limit 1 + 取行，比 count=exact 便宜；RLS 会过滤成自己的行
      const { data: rows, error } = await tmp.from(table).select('id').limit(1)
      if (error) return null
      if (rows && rows.length) return true
    }
    return false
  } catch {
    return null
  }
}
