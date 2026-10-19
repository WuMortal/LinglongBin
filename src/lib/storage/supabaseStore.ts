// Supabase 数据存储实现
import { supabase } from '../supabase'
import type {
  Category, CategoryParam, SupplierRow, MaterialRow, StockLog, StockOrder, BomProject, BomItem,
  BomPickRecord, PurchaseOrder, PurchaseItem, MaterialFile, DictType, DictItem,
  LabelTemplate, StockTake, StockTakeItem, StagnantRow,
} from '../types'
import type {
  DataStore, ListMaterialsOpts,
  UploadResult, StatsOverview, StatsCategoryRow, LowStockRow, TrendRow, StockSummaryRow,
  PageResult, PurchaseOrderPageOpts,
  StockOrderInput, StockOrderPageOpts,
} from './types'
import { DEFAULT_LABEL_LAYOUT, normalizeTemplate } from '../labelDefaults'

/** Supabase 直接返回 json 列，这里只做缺失字段归一化 */
function mapLabelTemplate(r: LabelTemplate): LabelTemplate {
  return normalizeTemplate(r)
}

/** 软删除时间戳（删除 = 写入 deleted_at，不物理删除） */
function softDeleteAt(): string {
  return new Date().toISOString()
}

/**
 * 报错是否源于「云端 stock_log 还没加撤销字段」（PGRST204 或 PostgreSQL 找不到列）。
 * 用于老库的平滑降级：写入 / 汇总查询自动回退到不含 status 的字段集。
 */
function isMissingVoidColumn(msg?: string | null): boolean {
  if (!msg) return false
  return /PGRST204|does not exist|could not find the .*column/i.test(msg)
}

/**
 * or() / in.() 里的值转义：逗号与括号是逻辑树的语法字符，
 * 原样写入会被拆成多个条件（如型号 "BC847B,215" 会解析失败），故百分号转义。
 * 注意 supabase-js 用 URLSearchParams 再编码一次，服务端解出来正好是 %2C。
 */
function escOrVal(v: string): string {
  return v.replace(/,/g, '%2C').replace(/\(/g, '%28').replace(/\)/g, '%29')
}

/** 数组分批（避免单条 SQL / URL 过长） */
function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

/** 本地日期 yyyyMMdd（出入库单号用） */
function yyyyMMdd(d = new Date()): string {
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}${m}${day}`
}

/** stock_orders 行归一化：status 空值视为 normal（历史数据兜底） */
function mapStockOrder(r: Record<string, unknown>): StockOrder {
  const row = r as unknown as StockOrder
  return { ...row, status: row.status === 'void' ? 'void' : 'normal' }
}

/** 把 Supabase 嵌套的 categories.parent.name 摊平为 categories.parent_name */
function flattenCategory<T extends { categories?: { name: string | null; threshold?: number | null; parent?: { name: string | null } | null } | null }>(row: T): T {
  const c = row.categories
  if (c && c.parent) {
    const { parent, ...rest } = c
    row.categories = { ...rest, parent_name: parent?.name ?? null } as T['categories']
  }
  return row
}

export class SupabaseStore implements DataStore {
  async getOwnerId(): Promise<string> {
    const { data: auth } = await supabase.auth.getUser()
    const id = auth.user?.id
    if (!id) throw new Error('未登录')
    return id
  }

  // ===== 分类 =====
  async listCategories(): Promise<Category[]> {
    const { data, error } = await supabase
      .from('categories')
      .select('id,owner,name,parent,lcsc_id,location_prefix,threshold,sort_order,created_at')
      .is('deleted_at', null)
      .order('sort_order')
      .order('name')
    if (error) throw error
    return (data as Category[]) || []
  }

  async getCategoryParams(id: string): Promise<CategoryParam[]> {
    const { data, error } = await supabase
      .from('category_params')
      .select('key,name,value_list,sort_order')
      .eq('category_id', id)
      .order('sort_order')
    if (error) throw error
    return (data as { key: string; name: string; value_list?: unknown }[] || []).map(r => ({
      key: r.key, name: r.name,
      values: Array.isArray(r.value_list) ? r.value_list as string[] : [],
    }))
  }

  /** 将参数模板写入 category_params 表（先清后插） */
  private async saveCategoryParams(categoryId: string, params: unknown, owner: string): Promise<void> {
    const { error: dErr } = await supabase.from('category_params').delete().eq('category_id', categoryId)
    if (dErr) throw dErr
    // 兼容两种入参：数组（手动新建）或 JSON 字符串（批量导入立创分类时 JSON.stringify 后传入）
    let list: CategoryParam[] = []
    if (typeof params === 'string') {
      try { const v = JSON.parse(params); if (Array.isArray(v)) list = v as CategoryParam[] } catch { list = [] }
    } else if (Array.isArray(params)) {
      list = params as CategoryParam[]
    }
    list = list.filter(p => p && (p.key || p.name))
    if (!list.length) return
    const rows = list.map((p, i) => ({
      owner, category_id: categoryId,
      key: p.key || p.name, name: p.name || '',
      value_list: p.values ?? [], sort_order: i,
    }))
    const { error } = await supabase.from('category_params').insert(rows)
    if (error) throw error
  }

  async createCategory(payload: Partial<Category>): Promise<Category> {
    if (payload.sort_order == null) {
      const parent = payload.parent ?? null
      let q = supabase.from('categories').select('sort_order').is('deleted_at', null)
      if (parent) q = q.eq('parent', parent)
      else q = q.is('parent', null)
      const { data: existing } = await q
      const maxOrder = (existing || []).reduce((m, r) => Math.max(m, (r as { sort_order?: number }).sort_order ?? 0), -1)
      payload = { ...payload, sort_order: maxOrder + 1 }
    }
    if (!payload.owner) payload = { ...payload, owner: await this.getOwnerId() }
    // 参数模板走独立表，不再写入 categories.params 列
    const paramsTemplate = payload.params
    const { params, ...rest } = payload
    const { data, error } = await supabase.from('categories').insert(rest).select().single()
    if (error) throw error
    const created = data as Category
    if (paramsTemplate !== undefined) {
      await this.saveCategoryParams(created.id, paramsTemplate, created.owner)
    }
    return created
  }

  async updateCategory(id: string, patch: Partial<Category>): Promise<Category> {
    const { params, ...rest } = patch
    if (Object.keys(rest).length) {
      const { error } = await supabase.from('categories').update(rest).eq('id', id)
      if (error) throw error
    }
    if (params !== undefined) {
      const owner = await this.getOwnerId()
      await this.saveCategoryParams(id, params, owner)
    }
    const { data, error } = await supabase.from('categories').select().eq('id', id).single()
    if (error) throw error
    return data as Category
  }

  async deleteCategory(id: string): Promise<void> {
    const { error } = await supabase.from('categories').update({ deleted_at: softDeleteAt() }).eq('id', id)
    if (error) throw error
  }

  // ===== 物料 =====
  /** 将物料参数值写入 material_params 表（先清后插） */
  private async saveMaterialParams(materialId: string, params: unknown, owner: string): Promise<void> {
    const { error: dErr } = await supabase.from('material_params').delete().eq('material_id', materialId)
    if (dErr) throw dErr
    const obj = (params && typeof params === 'object' && !Array.isArray(params))
      ? params as Record<string, unknown>
      : {}
    const entries = Object.entries(obj).filter(([, v]) => v != null && String(v).trim())
    if (!entries.length) return
    const rows = entries.map(([k, v], i) => ({
      owner, material_id: materialId,
      param_key: k, value: String(v).trim(), sort_order: i,
    }))
    const { error } = await supabase.from('material_params').insert(rows)
    if (error) throw error
  }

  /** 批量查询 material_params 并填充到物料行 */
  private async fillMaterialParams(materials: MaterialRow[]): Promise<void> {
    if (!materials.length) return
    const ids = materials.map(m => m.id)
    const { data, error } = await supabase
      .from('material_params')
      .select('material_id,param_key,value')
      .in('material_id', ids)
      .order('sort_order')
    if (error) throw error
    if (!data || !data.length) return
    const map = new Map<string, Record<string, unknown>>()
    for (const r of data as { material_id: string; param_key: string; value: string }[]) {
      const p = map.get(r.material_id) || {}
      p[r.param_key] = r.value
      map.set(r.material_id, p)
    }
    for (const m of materials) {
      const p = map.get(m.id)
      if (p) m.params = p
    }
  }

  async listMaterials(opts: ListMaterialsOpts = {}): Promise<MaterialRow[]> {
    const { search = '', categoryId = null, categoryIds, params, location } = opts
    let q = supabase.from('materials').select('*, categories(name, parent(name))').is('deleted_at', null).order('created_at', { ascending: false })
    if (categoryId) q = q.eq('category_id', categoryId)
    else if (categoryIds && categoryIds.length) q = q.in('category_id', categoryIds)
    if (location) q = q.eq('location', location)
    if (search && search.trim()) {
      // 多商品查询：空格 / 逗号分隔多个词，任一词命中即返回。
      // 注意多个 .or() 会被 PostgREST AND 组合，必须拼成单条 or（内全为 OR）
      const kw = search.trim().split(/[\s,，]+/).filter(Boolean)
      if (kw.length) {
        const cols = ['name', 'model', 'brand', 'package', 'part_no']
        q = q.or(kw.map(k => cols.map(c => `${c}.ilike.%${k}%`).join(',')).join(','))
      }
    }
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        if (!v) continue
        const kk = k.replace(/'/g, "''")
        const vv = String(v).replace(/'/g, "''")
        q = q.filter('id', 'in', `(select material_id from material_params where param_key = '${kk}' and value = '${vv}')`)
      }
    }
    if (opts.limit != null) {
      if (opts.offset != null) q = q.range(opts.offset, opts.offset + opts.limit - 1)
      else q = q.limit(opts.limit)
    }
    const { data, error } = await q
    if (error) throw error
    const materials = ((data as MaterialRow[]) || []).map(flattenCategory)
    await this.fillMaterialParams(materials)
    return materials
  }

  async countMaterials(opts: ListMaterialsOpts = {}): Promise<number> {
    const { search = '', categoryId = null, categoryIds, params, location } = opts
    let q = supabase.from('materials').select('*', { count: 'exact', head: true }).is('deleted_at', null)
    if (categoryId) q = q.eq('category_id', categoryId)
    else if (categoryIds && categoryIds.length) q = q.in('category_id', categoryIds)
    if (search && search.trim()) {
      // 多商品查询：空格 / 逗号分隔多个词，任一词命中即返回。
      // 注意多个 .or() 会被 PostgREST AND 组合，必须拼成单条 or（内全为 OR）
      const kw = search.trim().split(/[\s,，]+/).filter(Boolean)
      if (kw.length) {
        const cols = ['name', 'model', 'brand', 'package', 'part_no']
        q = q.or(kw.map(k => cols.map(c => `${c}.ilike.%${k}%`).join(',')).join(','))
      }
    }
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        if (!v) continue
        const kk = k.replace(/'/g, "''")
        const vv = String(v).replace(/'/g, "''")
        q = q.filter('id', 'in', `(select material_id from material_params where param_key = '${kk}' and value = '${vv}')`)
      }
    }
    if (location) q = q.eq('location', location)
    const { count, error } = await q
    if (error) throw error
    return count ?? 0
  }

  async createMaterial(payload: Partial<MaterialRow>): Promise<MaterialRow> {
    const owner = await this.getOwnerId()
    if (!payload.owner) payload = { ...payload, owner }
    // 参数值走独立表，不再写入 materials.params 列
    const paramsValue = payload.params
    const { params, ...rest } = payload
    const { data, error } = await supabase.from('materials').insert(rest).select().single()
    if (error) throw error
    const created = data as MaterialRow
    if (paramsValue !== undefined) {
      await this.saveMaterialParams(created.id, paramsValue, owner)
    }
    // 初始库存 > 0 时生成一张初始入库单（1 单 1 明细，明细备注：初始入库）
    if ((payload.qty ?? 0) > 0) {
      await this.stockInOrder({
        type: 'in', source: 'init', source_id: null,
        title: '初始入库', supplier_id: null, note: null,
        items: [{ material_id: created.id, qty: payload.qty ?? 0, note: '初始入库' }],
      })
    }
    return created
  }

  async deleteMaterial(id: string): Promise<void> {
    const { error } = await supabase.from('materials').update({ deleted_at: softDeleteAt() }).eq('id', id)
    if (error) throw error
  }

  /** 批量软删除：单次请求完成 */
  async deleteMaterials(ids: string[]): Promise<void> {
    if (!ids.length) return
    const { error } = await supabase.from('materials').update({ deleted_at: softDeleteAt() }).in('id', ids)
    if (error) throw error
  }

  async updateMaterial(id: string, patch: Partial<MaterialRow>): Promise<MaterialRow> {
    const { params, ...rest } = patch
    if (Object.keys(rest).length) {
      const { error } = await supabase.from('materials').update(rest).eq('id', id)
      if (error) throw error
    }
    if (params !== undefined) {
      const owner = await this.getOwnerId()
      await this.saveMaterialParams(id, params, owner)
    }
    return await this.getMaterial(id)
  }

  async getMaterial(id: string): Promise<MaterialRow> {
    const { data, error } = await supabase
      .from('materials').select('*, categories(name, threshold, parent(name))').is('deleted_at', null).eq('id', id).single()
    if (error) throw error
    const mat = flattenCategory(data as MaterialRow)
    // 从 material_params 表填充参数值
    const { data: pRows, error: pErr } = await supabase
      .from('material_params')
      .select('param_key,value')
      .eq('material_id', id)
      .order('sort_order')
    if (pErr) throw pErr
    if (pRows && pRows.length) {
      const params: Record<string, unknown> = {}
      for (const r of pRows as { param_key: string; value: string }[]) params[r.param_key] = r.value
      mat.params = params
    }
    return mat
  }

  // ===== 供应商 =====
  async listSuppliers(): Promise<SupplierRow[]> {
    const { data, error } = await supabase
      .from('suppliers')
      .select('id,owner,name,addr,contact,phone,note,created_at')
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
    if (error) throw error
    return (data as SupplierRow[]) || []
  }

  async createSupplier(payload: Partial<SupplierRow>): Promise<SupplierRow> {
    if (!payload.owner) payload = { ...payload, owner: await this.getOwnerId() }
    const { data, error } = await supabase.from('suppliers').insert(payload).select().single()
    if (error) throw error
    return data as SupplierRow
  }

  async updateSupplier(id: string, patch: Partial<SupplierRow>): Promise<SupplierRow> {
    const { data, error } = await supabase.from('suppliers').update(patch).eq('id', id).select().single()
    if (error) throw error
    return data as SupplierRow
  }

  async deleteSupplier(id: string): Promise<void> {
    const { error } = await supabase.from('suppliers').update({ deleted_at: softDeleteAt() }).eq('id', id)
    if (error) throw error
  }

  // ===== 基础数据（字典） =====
  async listDictTypes(): Promise<DictType[]> {
    const { data, error } = await supabase
      .from('dict_types')
      .select('id,owner,key,name,builtin,sort_order,created_at')
      .order('sort_order')
      .order('id')
    if (error) throw error
    return (data as DictType[]) || []
  }

  async createDictType(payload: Partial<DictType>): Promise<DictType> {
    if (payload.sort_order == null) {
      const { data: existing } = await supabase.from('dict_types').select('sort_order')
      const maxOrder = (existing || []).reduce((m, r) => Math.max(m, (r as { sort_order?: number }).sort_order ?? 0), -1)
      payload = { ...payload, sort_order: maxOrder + 1 }
    }
    if (!payload.owner) payload = { ...payload, owner: await this.getOwnerId() }
    const { data, error } = await supabase.from('dict_types').insert(payload).select().single()
    if (error) throw error
    return data as DictType
  }

  async deleteDictType(id: string): Promise<void> {
    // 先取 key 连带删项，再删类型（物理删除，字典为低风险数据）
    const { data: t } = await supabase.from('dict_types').select('key').eq('id', id).single()
    if (t) {
      const err1 = (await supabase.from('dict_items').delete().eq('dict_key', (t as { key: string }).key)).error
      if (err1) throw err1
    }
    const { error } = await supabase.from('dict_types').delete().eq('id', id)
    if (error) throw error
  }

  async listDictItems(dictKey: string): Promise<DictItem[]> {
    const { data, error } = await supabase
      .from('dict_items')
      .select('id,owner,dict_key,label,sort_order,created_at')
      .eq('dict_key', dictKey)
      .order('sort_order')
      .order('created_at')
    if (error) throw error
    return (data as DictItem[]) || []
  }

  async countMaterialsByCategory(): Promise<Record<string, number>> {
    const out: Record<string, number> = {}
    // 只取 category_id 一列；分页拉全量（兼容 Supabase 默认 1000 上限）
    let off = 0
    while (off < 50000) {
      const { data, error } = await supabase
        .from('materials')
        .select('category_id')
        .is('deleted_at', null)
        .range(off, off + 999)
      if (error) throw error
      const rows = (data as { category_id: string | null }[]) || []
      for (const r of rows) if (r.category_id) out[r.category_id] = (out[r.category_id] ?? 0) + 1
      if (rows.length < 1000) break
      off += 1000
    }
    return out
  }

  async countDictItems(): Promise<Record<string, number>> {
    const { data, error } = await supabase.from('dict_items').select('dict_key')
    if (error) throw error
    const out: Record<string, number> = {}
    for (const r of (data || []) as { dict_key?: string }[]) {
      const k = r.dict_key || ''
      out[k] = (out[k] || 0) + 1
    }
    return out
  }

  async createDictItem(payload: Partial<DictItem>): Promise<DictItem> {
    if (payload.sort_order == null) {
      const { data: existing } = await supabase.from('dict_items').select('sort_order').eq('dict_key', payload.dict_key ?? '')
      const maxOrder = (existing || []).reduce((m, r) => Math.max(m, (r as { sort_order?: number }).sort_order ?? 0), -1)
      payload = { ...payload, sort_order: maxOrder + 1 }
    }
    if (!payload.owner) payload = { ...payload, owner: await this.getOwnerId() }
    const { data, error } = await supabase.from('dict_items').insert(payload).select().single()
    if (error) throw error
    return data as DictItem
  }

  async updateDictItem(id: string, patch: Partial<DictItem>): Promise<DictItem> {
    const { data, error } = await supabase.from('dict_items').update(patch).eq('id', id).select().single()
    if (error) throw error
    return data as DictItem
  }

  async deleteDictItem(id: string): Promise<void> {
    const { error } = await supabase.from('dict_items').delete().eq('id', id)
    if (error) throw error
  }

  // ===== 图片 =====
  async uploadImage(file: File, userId: string): Promise<UploadResult> {
    const ext = (file.name.split('.').pop() || 'png').toLowerCase()
    const path = `${userId}/${Date.now()}.${ext}`
    const { error } = await supabase.storage
      .from('assets').upload(path, file, { upsert: true, contentType: file.type })
    if (error) throw error
    const { data } = supabase.storage.from('assets').getPublicUrl(path)
    return { path, url: data.publicUrl }
  }

  // 手册等文档：与图片同桶，路径加 files/ 前缀区分
  async uploadFile(file: File, userId: string): Promise<UploadResult> {
    const ext = (file.name.split('.').pop() || 'bin').toLowerCase()
    const path = `${userId}/files/${Date.now()}.${ext}`
    const { error } = await supabase.storage
      .from('assets').upload(path, file, { upsert: true, contentType: file.type })
    if (error) throw error
    const { data } = supabase.storage.from('assets').getPublicUrl(path)
    return { path, url: data.publicUrl }
  }

  imagePublicUrl(path: string | null): string | undefined {
    if (!path) return undefined
    // 兼容外链 http(s) 与 base64 data URL（直接存进 path 的场景）
    if (/^(data:|https?:)/i.test(path)) return path
    const { data } = supabase.storage.from('assets').getPublicUrl(path)
    return data.publicUrl
  }

  // ===== 出入库 =====
  async listStockLog(opts: { limit?: number; materialId?: string; type?: 'in' | 'out' } = {}): Promise<StockLog[]> {
    const { limit = 100, materialId, type } = opts
    let q = supabase
      .from('stock_log')
      .select('*, materials(name, model, package), suppliers(name)')
      .order('created_at', { ascending: false })
      .limit(limit)
    if (materialId) q = q.eq('material_id', materialId)
    if (type) q = q.eq('type', type)
    const { data, error } = await q
    if (error) throw error
    const rows = ((data as StockLog[]) || []).map(r => ({ ...r, order_no: r.order_no ?? null }))
    // 补查所属单号（云端未升级 stock_orders 表时静默跳过，单号留空）
    const ids = [...new Set(rows.map(r => r.order_id).filter((x): x is string => !!x))]
    if (ids.length) {
      try {
        const { data: os } = await supabase
          .from('stock_orders').select('id, order_no').in('id', ids)
        const noMap = new Map(((os || []) as { id: string; order_no: string | null }[]).map(o => [o.id, o.order_no]))
        for (const r of rows) r.order_no = (r.order_id && noMap.get(r.order_id)) || null
      } catch { /* 表不存在等 → 不展示单号 */ }
    }
    return rows
  }

  async stockSummary(): Promise<StockSummaryRow[]> {
    // 已撤销流水不计入汇总（库存已回滚）；云端未加字段时降级为不带 status 的查询
    let res = await supabase
      .from('stock_log')
      .select('material_id, type, qty, created_at, status')
      .not('material_id', 'is', null)
    if (res.error && isMissingVoidColumn(res.error.message)) {
      // 降级查询少了 status 列（此时也不可能有撤销记录），按同构处理
      const fb = await supabase.from('stock_log').select('material_id, type, qty, created_at').not('material_id', 'is', null)
      res = fb as unknown as typeof res
    }
    if (res.error) throw res.error
    const since = Date.now() - 30 * 86400000
    const map = new Map<string, StockSummaryRow>()
    for (const r of (res.data as Array<{ material_id: string; type: 'in' | 'out'; qty: number; created_at: string; status?: string | null }>) || []) {
      if (r.status === 'void') continue
      const e = map.get(r.material_id) || { material_id: r.material_id, total_in: 0, total_out: 0, last30_in: 0, last30_out: 0 }
      const recent = new Date(r.created_at).getTime() >= since
      if (r.type === 'in') { e.total_in += r.qty; if (recent) e.last30_in += r.qty }
      else { e.total_out += r.qty; if (recent) e.last30_out += r.qty }
      map.set(r.material_id, e)
    }
    return [...map.values()]
  }

  // ===== 出入库单（单据化） =====
  /** legacy 流水聚合迁移（进程内只跑一次；失败允许下次重试） */
  private orderMigrated: Promise<void> | null = null

  private ensureOrderMigrated(): Promise<void> {
    if (!this.orderMigrated) {
      this.orderMigrated = (async () => { await this.migrateLegacyStockOrders() })()
        .catch(() => { this.orderMigrated = null })
    }
    return this.orderMigrated
  }

  /** 生成出入库单号：RK(入)/CK(出) + 本地日期 + 4 位序号（当日同前缀最大值 + 1） */
  private async nextOrderNo(type: 'in' | 'out', date: Date): Promise<string> {
    const owner = await this.getOwnerId()
    const prefix = `${type === 'in' ? 'RK' : 'CK'}${yyyyMMdd(date)}`
    const { data, error } = await supabase
      .from('stock_orders')
      .select('order_no')
      .eq('owner', owner)
      .like('order_no', `${prefix}-%`)
    if (error) throw error
    let max = 0
    for (const r of (data || []) as { order_no: string | null }[]) {
      const n = Number.parseInt((r.order_no || '').slice(prefix.length + 1), 10)
      if (Number.isFinite(n) && n > max) max = n
    }
    return `${prefix}-${String(max + 1).padStart(4, '0')}`
  }

  /**
   * 历史流水聚合为 legacy 单（幂等：没有未挂单流水时直接返回）。
   * 云端 DDL（stock_orders 表 / stock_log.order_id 列）由升级 SQL 脚本执行，
   * 未升级时探测失败直接跳过，不阻塞启动。
   * 规则（方案 B）：type 相同 + note 归一化相同 + 与上一条时间相邻 ≤ 60 秒 → 聚为一单。
   */
  private async migrateLegacyStockOrders(): Promise<void> {
    // 探测 order_id 列：缺失说明云端还没执行升级脚本
    const probe = await supabase.from('stock_log').select('id').not('order_id', 'is', null).limit(1)
    if (probe.error) return
    const { count, error } = await supabase
      .from('stock_log')
      .select('id', { count: 'exact', head: true })
      .is('order_id', null)
    if (error || !count) return

    // 分页拉全量未挂单流水（按时间正序）
    interface LegacyRow {
      id: string; type: 'in' | 'out'; qty: number; note: string | null
      status: string | null; void_reason: string | null; voided_at: string | null
      created_at: string
    }
    const rows: LegacyRow[] = []
    const PAGE = 1000
    for (let off = 0; ; off += PAGE) {
      const { data, error: e } = await supabase
        .from('stock_log')
        .select('id,type,qty,note,status,void_reason,voided_at,created_at')
        .is('order_id', null)
        .order('created_at', { ascending: true })
        .order('id', { ascending: true })
        .range(off, off + PAGE - 1)
      if (e) throw e
      const page = (data || []) as LegacyRow[]
      rows.push(...page)
      if (page.length < PAGE) break
    }
    if (!rows.length) return

    // 分组（与 SQLite 端同一规则）
    const groups: LegacyRow[][] = []
    let cur: LegacyRow[] = [rows[0]]
    for (let i = 1; i < rows.length; i++) {
      const prev = cur[cur.length - 1]
      const gap = (Date.parse(rows[i].created_at) || 0) - (Date.parse(prev.created_at) || 0)
      const sameKey = rows[i].type === prev.type
        && (rows[i].note ?? '') === (prev.note ?? '')
      if (sameKey && gap <= 60_000) cur.push(rows[i])
      else { groups.push(cur); cur = [rows[i]] }
    }
    groups.push(cur)

    for (const g of groups) {
      const first = g[0]
      const allVoid = g.every(x => x.status === 'void')
      const orderId = crypto.randomUUID()
      const orderNo = await this.nextOrderNo(first.type, new Date(first.created_at))
      const { error: insErr } = await supabase.from('stock_orders').insert({
        id: orderId, owner: await this.getOwnerId(),
        order_no: orderNo, type: first.type, source: 'legacy',
        source_id: null, title: first.note ?? null, supplier_id: null, note: first.note ?? null,
        item_count: g.length, total_qty: g.reduce((s, x) => s + (Number(x.qty) || 0), 0),
        status: allVoid ? 'void' : 'normal',
        void_reason: allVoid ? (g.find(x => x.void_reason)?.void_reason ?? null) : null,
        voided_at: allVoid ? (g.map(x => x.voided_at).filter(Boolean).sort().pop() ?? null) : null,
        created_at: first.created_at,
      })
      if (insErr) throw insErr
      // 只更新仍为 null 的流水：多端同时迁移时互不抢行
      const { data: upd, error: updErr } = await supabase
        .from('stock_log')
        .update({ order_id: orderId })
        .is('order_id', null)
        .in('id', g.map(x => x.id))
        .select('id')
      if (updErr) throw updErr
      // 整组都被其他端挂走：清理刚建的空单
      if (!(upd || []).length) {
        await supabase.from('stock_orders').delete().eq('id', orderId)
      }
    }
  }

  /**
   * 建单并批量入账：一次出入库 = 1 单 N 明细。
   * 先全量校验（物料存在、数量 > 0、出库不超库存）→ 建单 → 批量写明细 →
   * 并发更新库存；任一步失败清理已写数据后抛错（PostgREST 无事务，validate-then-write 反向补偿）。
   * 明细写入对 stock_log.order_id 缺列做降级（与撤销字段一致的容错策略）。
   */
  async stockInOrder(input: StockOrderInput): Promise<{ order: StockOrder; finals: Map<string, number> }> {
    const items = input.items ?? []
    if (!items.length) throw new Error('出入库明细不能为空')
    await this.ensureOrderMigrated()
    const owner = await this.getOwnerId()
    const createdAt = input.created_at ?? new Date().toISOString()

    // ---- 校验 + 终值计算（按物料累加，不依赖前端缓存） ----
    const ids = [...new Set(items.map(i => i.material_id))]
    const { data: matsRaw, error: eMats } = await supabase
      .from('materials')
      .select('id, name, qty')
      .is('deleted_at', null)
      .in('id', ids)
    if (eMats) throw eMats
    const byId = new Map((matsRaw || []).map(m => [m.id, m]))
    if (byId.size !== ids.length) throw new Error('部分物料不存在或已删除，无法出入库')

    const finals = new Map<string, number>()
    let totalQty = 0
    for (const it of items) {
      if (!(it.qty > 0)) throw new Error('出入库数量必须大于 0')
      const base = finals.get(it.material_id) ?? (Number(byId.get(it.material_id)?.qty) || 0)
      const next = base + (input.type === 'in' ? it.qty : -it.qty)
      if (next < 0) {
        const name = byId.get(it.material_id)?.name ?? it.material_id
        throw new Error(`「${name}」出库数量 ${it.qty} 超过当前库存 ${base}`)
      }
      finals.set(it.material_id, next)
      totalQty += it.qty
    }

    // ---- 建单 ----
    const orderId = crypto.randomUUID()
    const orderNo = await this.nextOrderNo(input.type, new Date(createdAt))
    const insOrder = await supabase
      .from('stock_orders')
      .insert({
        id: orderId, owner, order_no: orderNo, type: input.type, source: input.source,
        source_id: input.source_id ?? null, title: input.title ?? null,
        supplier_id: input.supplier_id ?? null, note: input.note ?? null,
        item_count: items.length, total_qty: totalQty,
        status: 'normal', created_at: createdAt,
      })
      .select('*, suppliers(name)')
      .single()
    if (insOrder.error) throw insOrder.error

    // ---- 明细流水 + 库存更新（失败清理） ----
    const logs = items.map(it => ({
      owner, material_id: it.material_id, type: input.type, qty: it.qty, order_id: orderId,
      supplier_id: input.type === 'in' ? (it.supplier_id ?? input.supplier_id ?? null) : null,
      note: it.note ?? null, status: 'normal', created_at: createdAt,
    }))
    const CHUNK = 500
    try {
      for (let i = 0; i < logs.length; i += CHUNK) {
        const chunkRows = logs.slice(i, i + CHUNK)
        let res = await supabase.from('stock_log').insert(chunkRows)
        if (res.error && isMissingVoidColumn(res.error.message)) {
          // 云端尚未加 order_id 列：降级写入（流水不挂单，升级后由 legacy 迁移聚合）
          res = await supabase.from('stock_log').insert(chunkRows.map(({ order_id: _o, ...l }) => l))
        }
        if (res.error) throw res.error
      }
      const updates = [...finals.entries()].map(async ([id, qty]) => {
        const { error } = await supabase.from('materials').update({ qty }).eq('id', id)
        if (error) throw error
      })
      await Promise.all(updates)
    } catch (e) {
      // 反向补偿：不留半单（无事务，失败时删除已写数据）
      await supabase.from('stock_log').delete().eq('order_id', orderId)
      await supabase.from('stock_orders').delete().eq('id', orderId)
      throw e
    }
    return { order: mapStockOrder(insOrder.data as Record<string, unknown>), finals }
  }

  /** 读单条出入库单 */
  async getStockOrder(id: string): Promise<StockOrder> {
    const { data, error } = await supabase
      .from('stock_orders')
      .select('*, suppliers(name)')
      .eq('id', id)
      .single()
    if (error) throw error
    return mapStockOrder(data as Record<string, unknown>)
  }

  async pageStockOrders(opts: StockOrderPageOpts = {}): Promise<PageResult<StockOrder>> {
    await this.ensureOrderMigrated()
    const { type, source, keyword = '', status, from, to, limit = 20, offset = 0 } = opts
    /*
     * 关键词多词 OR 并集（与首页搜索一致）。PostgREST 不允许 or() 里混用嵌入资源，
     * 明细物料命中分两步：先按词查物料 id，再查这些物料挂到的单据 id，全部拼成顶层条件。
     */
    const kws = keyword.trim() ? keyword.trim().split(/[\s,，]+/).filter(Boolean) : []
    const orParts: string[] = []
    for (const kw of kws) {
      const k = escOrVal(kw)
      const parts = [`order_no.ilike.%${k}%`, `title.ilike.%${k}%`, `note.ilike.%${k}%`]
      // 明细物料名 / 型号 / 编号 → 单据 id 集合
      const { data: ms } = await supabase
        .from('materials')
        .select('id')
        .is('deleted_at', null)
        .or(`name.ilike.%${k}%,model.ilike.%${k}%,part_no.ilike.%${k}%`)
        .limit(1000)
      const matIds = ((ms || []) as { id: string }[]).map(m => m.id)
      if (matIds.length) {
        const { data: ls } = await supabase
          .from('stock_log')
          .select('order_id')
          .in('material_id', matIds)
          .not('order_id', 'is', null)
          .limit(1000)
        const orderIds = [...new Set(((ls || []) as { order_id: string }[]).map(l => l.order_id))]
        if (orderIds.length) parts.push(`id.in.(${orderIds.join(',')})`)
      }
      orParts.push(parts.join(','))
    }

    const run = async (withOr: boolean) => {
      let q = supabase
        .from('stock_orders')
        .select('*, suppliers(name)', { count: 'exact' })
        .order('created_at', { ascending: false })
      if (type) q = q.eq('type', type)
      if (source) q = q.eq('source', source)
      // 历史数据 status 可能为空：空值视为有效（normal）
      if (status) q = status === 'void' ? q.eq('status', 'void') : q.neq('status', 'void')
      if (from) q = q.gte('created_at', from)
      if (to) q = q.lte('created_at', to)
      if (withOr && orParts.length) q = q.or(orParts.join(','))
      return q.range(offset, offset + limit - 1)
    }

    let res = await run(true)
    // 云端未升级（stock_orders 表不存在）时降级：不带关键词条件重试一次
    if (res.error && orParts.length && isMissingVoidColumn(res.error.message)) res = await run(false)
    if (res.error) throw res.error
    const rows = ((res.data || []) as Record<string, unknown>[]).map(mapStockOrder)
    return { rows, total: res.count ?? 0 }
  }

  async listStockLogsByOrder(orderId: string): Promise<StockLog[]> {
    const { data, error } = await supabase
      .from('stock_log')
      .select('*, materials(name, model, package), suppliers(name)')
      .eq('order_id', orderId)
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
    if (error) throw error
    return (data as StockLog[]) || []
  }

  /**
   * 撤销整单：先全量校验（每个物料回滚后不得为负）后执行，任一明细失败整单报错，
   * 不存在「部分撤销」状态；物料已删除的明细跳过回滚（软删物料库存无意义）。
   */
  async voidStockOrder(id: string, reason: string): Promise<void> {
    const { data: orderRaw, error: eOrder } = await supabase
      .from('stock_orders')
      .select('*')
      .eq('id', id)
      .maybeSingle()
    if (eOrder) throw eOrder
    if (!orderRaw) throw new Error('单据不存在')
    const order = mapStockOrder(orderRaw as Record<string, unknown>)
    if (order.status === 'void') throw new Error('该单据已撤销，无法重复操作')
    const why = reason?.trim() || null
    const voidedAt = new Date().toISOString()

    // 参与回滚的明细 = 该单下仍有效的流水
    const { data: logsRaw, error: eLogs } = await supabase
      .from('stock_log')
      .select('id, material_id, type, qty, status')
      .eq('order_id', id)
      .order('created_at', { ascending: true })
    if (eLogs) throw eLogs
    const logs = ((logsRaw || []) as StockLog[]).filter(l => l.status !== 'void')

    if (logs.length) {
      // 回滚增量：撤销入库 → 扣回；撤销出库 → 加回（按物料聚合）
      const deltas = new Map<string, number>()
      for (const l of logs) {
        if (!l.material_id) continue
        const d = deltas.get(l.material_id) ?? 0
        deltas.set(l.material_id, d + (l.type === 'in' ? -l.qty : l.qty))
      }
      const mats = await this.getMaterialsByIds([...deltas.keys()])
      const byId = new Map(mats.map(m => [m.id, m]))

      // ---- 全量校验：物料存在且回滚后不为负 ----
      const rollbackList: Array<{ id: string; qty: number }> = []
      for (const [mid, delta] of deltas) {
        const mat = byId.get(mid)
        if (!mat) continue // 物料已软删：跳过回滚，不阻塞整单撤销
        const cur = Number(mat.qty) || 0
        if (cur + delta < 0) {
          throw new Error(`「${mat.name}」当前库存 ${cur}，整单撤销后将变为负数，无法撤销`)
        }
        rollbackList.push({ id: mid, qty: cur + delta })
      }
      // ---- 执行：先回滚库存，再置流水与单据撤销 ----
      await Promise.all(rollbackList.map(async r => {
        const { error } = await supabase.from('materials').update({ qty: r.qty }).eq('id', r.id)
        if (error) throw error
      }))
    }

    await supabase
      .from('stock_log')
      .update({ status: 'void', void_reason: why, voided_at: voidedAt })
      .eq('order_id', id)
      .neq('status', 'void')
    const { error: eVoid } = await supabase
      .from('stock_orders')
      .update({ status: 'void', void_reason: why, voided_at: voidedAt })
      .eq('id', id)
    if (eVoid) throw eVoid
  }

  // ===== 库存盘点 =====
  async createStocktake(take: StockTake, items: StockTakeItem[]): Promise<void> {
    const owner = await this.getOwnerId()
    const { error: e1 } = await supabase
      .from('stocktakes')
      .insert({ id: take.id, owner, name: take.name, note: take.note ?? null, status: take.status ?? 'done', created_at: take.created_at })
    if (e1) throw e1
    if (items.length) {
      const rows = items.map(it => ({
        id: it.id, take_id: take.id, material_id: it.material_id ?? null,
        material_name: it.material_name ?? null, book_qty: it.book_qty,
        actual_qty: it.actual_qty, diff: it.diff, created_at: it.created_at,
      }))
      const { error } = await supabase.from('stocktake_items').insert(rows)
      if (error) throw error
    }
  }

  async listStocktakes(): Promise<StockTake[]> {
    const { data: takes, error } = await supabase
      .from('stocktakes').select('*').order('created_at', { ascending: false })
    if (error) throw error
    const list = (takes as StockTake[]) || []
    if (!list.length) return list
    const ids = list.map(t => t.id)
    const { data: items, error: e2 } = await supabase
      .from('stocktake_items').select('take_id, diff').in('take_id', ids)
    if (e2) throw e2
    const byTake = new Map<string, { items: number; diff: number }>()
    for (const it of (items as { take_id: string; diff: number }[]) || []) {
      const m = byTake.get(it.take_id) || { items: 0, diff: 0 }
      m.items++
      if (it.diff !== 0) m.diff++
      byTake.set(it.take_id, m)
    }
    return list.map(t => {
      const a = byTake.get(t.id)
      return { ...t, item_count: a?.items ?? 0, diff_count: a?.diff ?? 0 }
    })
  }

  async getStocktake(id: string): Promise<{ take: StockTake; items: StockTakeItem[] }> {
    const { data: t, error } = await supabase
      .from('stocktakes').select('*').eq('id', id).maybeSingle()
    if (error) throw error
    if (!t) throw new Error('盘点单不存在')
    const { data: items, error: e2 } = await supabase
      .from('stocktake_items').select('*').eq('take_id', id).order('created_at')
    if (e2) throw error
    return { take: t as StockTake, items: (items as StockTakeItem[]) || [] }
  }

  async deleteStocktake(id: string): Promise<void> {
    const { error: e1 } = await supabase.from('stocktake_items').delete().eq('take_id', id)
    if (e1) throw e1
    const { error } = await supabase.from('stocktakes').delete().eq('id', id)
    if (error) throw error
  }

  // ===== BOM =====
  async createBomProject(name: string): Promise<BomProject> {
    const payload = { name, owner: await this.getOwnerId() }
    const { data, error } = await supabase.from('bom_projects').insert(payload).select().single()
    if (error) throw error
    return data as BomProject
  }

  async listBomProjects(): Promise<BomProject[]> {
    const { data, error } = await supabase.from('bom_projects').select('*').is('deleted_at', null).order('created_at', { ascending: false })
    if (error) throw error
    return (data as BomProject[]) || []
  }

  async deleteBomProject(id: string): Promise<void> {
    const { error } = await supabase.from('bom_projects').update({ deleted_at: softDeleteAt() }).eq('id', id)
    if (error) throw error
  }

  async createBomItems(project_id: string, items: Partial<BomItem>[]): Promise<BomItem[]> {
    const rows = items.map(i => ({ project_id, ...i }))
    const { data, error } = await supabase.from('bom_items').insert(rows).select()
    if (error) throw error
    return (data as BomItem[]) || []
  }

  async listBomItems(projectId: string): Promise<BomItem[]> {
    const { data, error } = await supabase
      .from('bom_items')
      .select('*, materials(name, model, brand, package, qty, image_path, alternates, categories(name))')
      .eq('project_id', projectId)
    if (error) throw error
    return (data as BomItem[]) || []
  }

  async updateBomItem(id: string, patch: Partial<BomItem>): Promise<BomItem> {
    const { data, error } = await supabase.from('bom_items').update(patch).eq('id', id).select().single()
    if (error) throw error
    return data as BomItem
  }

  async createBomPickRecord(project_id: string, sets: number, note: string | null): Promise<BomPickRecord> {
    const payload = { project_id, sets, note, owner: await this.getOwnerId() }
    const { data, error } = await supabase.from('bom_pick_records').insert(payload).select().single()
    if (error) throw error
    return data as BomPickRecord
  }

  async listBomPickRecords(projectId: string): Promise<BomPickRecord[]> {
    const { data, error } = await supabase
      .from('bom_pick_records')
      .select('*')
      .eq('project_id', projectId)
      .order('created_at', { ascending: false })
    if (error) throw error
    return (data as BomPickRecord[]) || []
  }

  // ===== 物料附件（数据手册 / 认证资料 / 行业资讯，一个物料多个） =====
  async listMaterialFiles(materialId: string): Promise<MaterialFile[]> {
    const { data, error } = await supabase
      .from('material_files')
      .select()
      .eq('material_id', materialId)
      .order('sort_order')
      .order('created_at')
    if (error) throw error
    return (data as MaterialFile[]) || []
  }

  async createMaterialFiles(material_id: string, items: Partial<MaterialFile>[]): Promise<MaterialFile[]> {
    const owner = await this.getOwnerId()
    const rows = items
      .filter(f => f.url)
      .map((f, i) => ({
        owner,
        material_id,
        name: f.name || '数据手册',
        url: f.url,
        file_type: f.file_type ?? null,
        source: f.source ?? null,
        sort_order: f.sort_order ?? i,
      }))
    if (!rows.length) return []
    const { data, error } = await supabase.from('material_files').insert(rows).select().order('sort_order')
    if (error) throw error
    return (data as MaterialFile[]) || []
  }

  async deleteMaterialFile(id: string): Promise<void> {
    const { error } = await supabase.from('material_files').delete().eq('id', id)
    if (error) throw error
  }

  async deleteMaterialFilesOf(materialId: string): Promise<void> {
    const { error } = await supabase.from('material_files').delete().eq('material_id', materialId)
    if (error) throw error
  }

  // ===== 待采购单 =====
  async createPurchaseOrder(payload: Partial<PurchaseOrder>): Promise<PurchaseOrder> {
    const { data, error } = await supabase
      .from('purchase_orders')
      .insert({
        name: payload.name || '待采购单',
        source: payload.source ?? null,
        source_id: payload.source_id ?? null,
        note: payload.note ?? null,
        status: payload.status || 'pending',
        owner: await this.getOwnerId(),
      })
      .select().single()
    if (error) throw error
    return data as PurchaseOrder
  }

  async listPurchaseOrders(): Promise<PurchaseOrder[]> {
    const { data, error } = await supabase
      .from('purchase_orders').select('*').is('deleted_at', null).order('created_at', { ascending: false })
    if (error) throw error
    return ((data as PurchaseOrder[]) || []).map(r => ({ ...r, status: r.status || 'pending' }))
  }

  async listPurchaseOrdersPage(opts: PurchaseOrderPageOpts = {}): Promise<PageResult<PurchaseOrder>> {
    const { status, limit = 20, offset = 0 } = opts
    let q = supabase
      .from('purchase_orders').select('*', { count: 'exact' }).is('deleted_at', null).order('created_at', { ascending: false })
    if (status) q = q.eq('status', status)
    const { data, error, count } = await q.range(offset, offset + limit - 1)
    if (error) throw error
    return { rows: ((data as PurchaseOrder[]) || []).map(r => ({ ...r, status: r.status || 'pending' })), total: count ?? 0 }
  }

  async countPurchaseOrders(status?: 'pending' | 'done' | null): Promise<number> {
    let q = supabase.from('purchase_orders').select('*', { count: 'exact', head: true }).is('deleted_at', null)
    if (status) q = q.eq('status', status)
    const { count, error } = await q
    if (error) throw error
    return count ?? 0
  }

  async updatePurchaseOrder(id: string, patch: Partial<PurchaseOrder>): Promise<PurchaseOrder> {
    const { data, error } = await supabase.from('purchase_orders').update(patch).eq('id', id).select().single()
    if (error) throw error
    return data as PurchaseOrder
  }

  async deletePurchaseOrder(id: string): Promise<void> {
    const { error } = await supabase.from('purchase_orders').update({ deleted_at: softDeleteAt() }).eq('id', id)
    if (error) throw error
  }

  async createPurchaseItems(order_id: string, items: Partial<PurchaseItem>[]): Promise<PurchaseItem[]> {
    if (!items.length) return []
    const rows = items.map(i => ({ order_id, ...i }))
    const { data, error } = await supabase
      .from('purchase_items').insert(rows).select('*, materials(name, model, package, qty)')
    if (error) throw error
    return (data as PurchaseItem[]) || []
  }

  async listPurchaseItems(orderId: string): Promise<PurchaseItem[]> {
    const { data, error } = await supabase
      .from('purchase_items')
      .select('*, materials(name, model, package, qty)')
      .eq('order_id', orderId)
      .order('done', { ascending: true })
      .order('created_at', { ascending: true })
    if (error) throw error
    return (data as PurchaseItem[]) || []
  }

  async updatePurchaseItem(id: string, patch: Partial<PurchaseItem>): Promise<PurchaseItem> {
    const { data, error } = await supabase.from('purchase_items').update(patch).eq('id', id).select().single()
    if (error) throw error
    return data as PurchaseItem
  }

  async deletePurchaseItem(id: string): Promise<void> {
    const { error } = await supabase.from('purchase_items').delete().eq('id', id)
    if (error) throw error
  }

  // ===== 批量查询 =====
  async getMaterialsByIds(ids: string[]): Promise<MaterialRow[]> {
    if (!ids.length) return []
    // 必须取全部列：打印/预览要用 category_id 选分类块、用 part_no（商品编码）、
    // price、location 取值，缺列会让分类配置全部回落到默认格式。与 SQLite 的 c.* 对齐。
    const { data, error } = await supabase
      .from('materials')
      .select('*')
      .is('deleted_at', null)
      .in('id', ids)
    if (error) throw error
    const materials = (data as unknown as MaterialRow[]) || []
    await this.fillMaterialParams(materials)
    return materials
  }

  async matchMaterialByModel(model: string): Promise<MaterialRow[]> {
    const v = escOrVal(model ?? '')
    const { data, error } = await supabase
      .from('materials')
      .select('id, name, model, brand, package, part_no, qty, image_path, alternates, categories(name)')
      .is('deleted_at', null)
      .or(`model.ilike.%${v}%,part_no.ilike.%${v}%,name.ilike.%${v}%`)
      .limit(10)
    if (error) throw error
    return (data as unknown as MaterialRow[]) || []
  }

  /**
   * 批量匹配：一次查回「任意关键词命中型号 / 商品编号 / 名称」的候选物料。
   * 调用方再在本地按「精确 → 子串」挑出每行的最佳匹配，等价于原来逐行 ilike，
   * 但请求数从「每行一次」降到 O(关键词数 / 30)。
   */
  async matchMaterialsByKeys(keys: string[]): Promise<MaterialRow[]> {
    const ks = [...new Set((keys || []).map(k => (k ?? '').trim()).filter(Boolean))]
    if (!ks.length) return []
    const out: MaterialRow[] = []
    const seen = new Set<string>()
    // 每批 30 个关键词（每词 3 个条件），避免 or() 过长被拒
    for (const part of chunk(ks, 30)) {
      const conds: string[] = []
      for (const k of part) {
        const v = escOrVal(k)
        conds.push(`model.ilike.%${v}%`, `part_no.ilike.%${v}%`, `name.ilike.%${v}%`)
      }
      const { data, error } = await supabase
        .from('materials')
        .select('id, name, model, brand, package, part_no, qty, image_path, alternates, categories(name)')
        .is('deleted_at', null)
        .or(conds.join(','))
        .limit(1000)
      if (error) throw error
      for (const m of (data as unknown as MaterialRow[]) || []) {
        if (seen.has(m.id)) continue
        seen.add(m.id)
        out.push(m)
      }
    }
    return out
  }

  // ===== 统计 =====
  /**
   * 统计概览：走数据库函数 stats_overview() 一次聚合（不拉全表）。
   * 开发阶段直接依赖该函数，未部署时抛错暴露问题，不做内存兜底。
   */
  async stagnantMaterials(days = 180): Promise<StagnantRow[]> {
    const { data: mats, error } = await supabase
      .from('materials').select('id, name, model, brand, package, part_no, qty, price, created_at')
      .is('deleted_at', null)
    if (error) throw error
    const list = (mats as Record<string, unknown>[]) || []
    const ids = list.map(m => m.id as string)
    const { data: logs } = await supabase
      .from('stock_log').select('material_id, created_at').in('material_id', ids)
    const lastByMat = new Map<string, string>()
    for (const l of (logs as Record<string, unknown>[]) || []) {
      const mid = l.material_id as string
      if (!lastByMat.has(mid)) lastByMat.set(mid, l.created_at as string)
    }
    const now = Date.now()
    const out: StagnantRow[] = []
    for (const m of list) {
      const last = lastByMat.get(m.id as string) || (m.created_at as string)
      const t = last ? new Date(last).getTime() : 0
      const d = t ? Math.floor((now - t) / 86400000) : 99999
      if (d > days) out.push({
        id: m.id as string, name: m.name as string,
        model: (m.model as string) ?? null, brand: (m.brand as string) ?? null,
        package: (m.package as string) ?? null, part_no: (m.part_no as string) ?? null,
        qty: Number(m.qty) || 0, price: Number(m.price) || 0,
        last_move: last ?? null, days: d,
      })
    }
    return out
  }

  async statsOverview(): Promise<StatsOverview> {
    const { data, error } = await supabase.rpc('stats_overview')
    if (error) throw error
    const r = (Array.isArray(data) ? data[0] : data) as {
      total_materials: number | null; total_qty: number | null
      total_value: number | null; low_stock: number | null
    } | undefined
    if (!r) throw new Error('stats_overview 返回为空')
    return {
      totalMaterials: Number(r.total_materials) || 0,
      totalQty: Number(r.total_qty) || 0,
      totalValue: Number(r.total_value) || 0,
      lowStock: Number(r.low_stock) || 0,
    }
  }

  async statsByCategory(): Promise<StatsCategoryRow[]> {
    const { data, error } = await supabase
      .from('materials')
      .select('category_id, qty, price, categories(name, threshold)')
      .is('deleted_at', null)
    if (error) throw error
    const map = new Map<string, { name: string; qty: number; value: number; low: number }>()
    const rows = (data as unknown as Array<{
      category_id: string | null
      qty: number
      price: number
      categories: { name: string | null; threshold: number | null } | { name: string | null; threshold: number | null }[] | null
    }>) || []
    for (const c of rows) {
      const key = c.category_id || 'none'
      // category_id → categories 为一对一关系：PostgREST 有时返回数组、有时返回单对象，两者都兼容
      const catArr = c.categories
      const cat = Array.isArray(catArr) ? (catArr[0] ?? null) : catArr
      const e = map.get(key) || { name: cat?.name || '未分类', qty: 0, value: 0, low: 0 }
      e.qty += c.qty || 0
      e.value += (c.qty || 0) * Number(c.price || 0)
      map.set(key, e)
    }
    return [...map.entries()].map(([k, v]) => ({ id: k, ...v }))
  }

  async lowStockMaterials(globalThreshold = 5): Promise<LowStockRow[]> {
    const { data, error } = await supabase
      .from('materials')
      .select('id, name, model, qty, threshold, categories(threshold)')
      .is('deleted_at', null)
    if (error) throw error
    return ((data as Array<{ id: string; name: string; model: string | null; qty: number; threshold: number | null; categories: { threshold: number | null }[] | null }>) || [])
      .map(c => {
        const cat = c.categories && c.categories.length ? c.categories[0] : null
        // 生效阈值：物料自身（>0）→ 分类（>0）→ 全局默认
        const catThreshold = cat?.threshold ?? 0
        const threshold = (c.threshold || 0) > 0 ? c.threshold as number
          : catThreshold > 0 ? catThreshold
          : globalThreshold
        return { id: c.id, name: c.name, model: c.model, qty: c.qty || 0, threshold, categories: { threshold: cat?.threshold ?? null } }
      })
      .filter(c => c.qty <= c.threshold)
  }

  async stockTrend(days = 14): Promise<TrendRow[]> {
    const since = new Date(Date.now() - days * 86400000).toISOString()
    // 撤销流水不进趋势；云端未加字段时不带 status 条件
    let res = await supabase
      .from('stock_log')
      .select('type, qty, created_at, status')
      .gte('created_at', since)
      .or('status.is.null,status.eq.normal')
    if (res.error && isMissingVoidColumn(res.error.message)) {
      // 同上：云端无 status 列时降级
      const fb = await supabase.from('stock_log').select('type, qty, created_at').gte('created_at', since)
      res = fb as unknown as typeof res
    }
    const { data, error } = res
    if (error) throw error
    const daysArr: TrendRow[] = []
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(Date.now() - i * 86400000)
      daysArr.push({ date: d.toISOString().slice(0, 10), in: 0, out: 0 })
    }
    const idx: Record<string, number> = Object.fromEntries(daysArr.map((d, i) => [d.date, i]))
    for (const r of (data as Array<{ type: 'in' | 'out'; qty: number; created_at: string }>) || []) {
      const day = (r.created_at || '').slice(0, 10)
      if (day in idx) daysArr[idx[day]][r.type] += r.qty
    }
    return daysArr
  }

  // ===== 标签打印模板 =====

  async listLabelTemplates(): Promise<LabelTemplate[]> {
    const { data, error } = await supabase
      .from('label_templates')
      .select('*')
      .is('deleted_at', null)
      .order('is_default', { ascending: false })
      .order('created_at', { ascending: false })
    if (error) throw error
    return ((data as LabelTemplate[]) || []).map(mapLabelTemplate)
  }

  async createLabelTemplate(payload: Partial<LabelTemplate>): Promise<LabelTemplate> {
    const cats = payload.cats ?? []
    const layout = payload.layout ?? DEFAULT_LABEL_LAYOUT()
    const isDefault = !!payload.is_default
    // 默认模板唯一
    if (isDefault) await supabase.from('label_templates').update({ is_default: false }).eq('owner', await this.getOwnerId())
    const { data, error } = await supabase
      .from('label_templates')
      .insert({
        name: payload.name || '未命名模板',
        width_mm: payload.width_mm ?? 24,
        height_mm: payload.height_mm ?? 12,
        grid_rows: payload.grid_rows ?? 2,
        grid_cols: payload.grid_cols ?? 2,
        cats,
        default_font_pt: payload.default_font_pt ?? 6,
        layout,
        is_default: isDefault,
        builtin: false,
        owner: await this.getOwnerId(),
      })
      .select().single()
    if (error) throw error
    return mapLabelTemplate(data as LabelTemplate)
  }

  async updateLabelTemplate(id: string, patch: Partial<LabelTemplate>): Promise<LabelTemplate> {
    if (patch.is_default) {
      await supabase.from('label_templates').update({ is_default: false }).eq('owner', await this.getOwnerId())
    }
    const row: Record<string, unknown> = {}
    if (patch.name !== undefined) row.name = patch.name
    if (patch.cats !== undefined) row.cats = patch.cats
    if (patch.width_mm !== undefined) row.width_mm = patch.width_mm
    if (patch.height_mm !== undefined) row.height_mm = patch.height_mm
    if (patch.grid_rows !== undefined) row.grid_rows = patch.grid_rows
    if (patch.grid_cols !== undefined) row.grid_cols = patch.grid_cols
    if (patch.default_font_pt !== undefined) row.default_font_pt = patch.default_font_pt
    if (patch.layout !== undefined) row.layout = patch.layout
    if (patch.is_default !== undefined) row.is_default = patch.is_default
    const { data, error } = await supabase.from('label_templates').update(row).eq('id', id).select().single()
    if (error) throw error
    return mapLabelTemplate(data as LabelTemplate)
  }

  async deleteLabelTemplate(id: string): Promise<void> {
    // 内置模板不可删除（App 导入立创分类时种子写入，见 db.ts ensureDefaultLabelTemplate）
    const { data: cur, error: curErr } = await supabase
      .from('label_templates').select('builtin').eq('id', id).single()
    if (curErr) throw curErr
    if ((cur as { builtin?: boolean } | null)?.builtin) throw new Error('内置模板不可删除')
    const { error } = await supabase
      .from('label_templates')
      .update({ deleted_at: softDeleteAt(), is_default: false })
      .eq('id', id)
    if (error) throw error
  }
}
