// Supabase 数据存储实现
import { supabase } from '../supabase'
import type {
  Category, CategoryParam, SupplierRow, MaterialRow, StockLog, BomProject, BomItem,
  BomPickRecord, PurchaseOrder, PurchaseItem, MaterialFile, DictType, DictItem,
  LabelTemplate, StockTake, StockTakeItem, StagnantRow,
} from '../types'
import type {
  DataStore, ListMaterialsOpts, StockInput, ApplyStockInput,
  UploadResult, StatsOverview, StatsCategoryRow, LowStockRow, TrendRow, StockSummaryRow,
  PageResult, StockLogPageOpts, PurchaseOrderPageOpts,
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
      const kw = search.trim().split(/\s+/)
      for (const k of kw) {
        q = q.or(`name.ilike.%${k}%,model.ilike.%${k}%,brand.ilike.%${k}%,package.ilike.%${k}%`)
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
      const kw = search.trim().split(/\s+/)
      for (const k of kw) {
        q = q.or(`name.ilike.%${k}%,model.ilike.%${k}%,brand.ilike.%${k}%,package.ilike.%${k}%`)
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
    // 初始库存 > 0 时写入一条入库流水（备注：初始入库）
    if ((payload.qty ?? 0) > 0) {
      await supabase.from('stock_log').insert({
        owner, material_id: created.id, type: 'in', qty: payload.qty, note: '初始入库',
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
  async addStockLog(input: StockInput): Promise<StockLog> {
    const payload = { ...input, owner: await this.getOwnerId() }
    const { data, error } = await supabase.from('stock_log').insert(payload).select().single()
    if (error) throw error
    return data as StockLog
  }

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
    return (data as StockLog[]) || []
  }

  async listStockLogPage(opts: StockLogPageOpts = {}): Promise<PageResult<StockLog>> {
    const { type, keyword = '', from, to, limit = 20, offset = 0 } = opts
    const q = supabase
      .from('stock_log')
      .select('*, materials(name, model, package), suppliers(name)', { count: 'exact' })
      .order('created_at', { ascending: false })
    if (type) q.eq('type', type)
    if (keyword && keyword.trim()) q.ilike('materials.name', `%${keyword.trim()}%`)
    if (from) q.gte('created_at', from)
    if (to) q.lte('created_at', to)
    const { data, error, count } = await q.range(offset, offset + limit - 1)
    if (error) throw error
    return { rows: (data as StockLog[]) || [], total: count ?? 0 }
  }

  async stockSummary(): Promise<StockSummaryRow[]> {
    const { data, error } = await supabase
      .from('stock_log')
      .select('material_id, type, qty, created_at')
      .not('material_id', 'is', null)
    if (error) throw error
    const since = Date.now() - 30 * 86400000
    const map = new Map<string, StockSummaryRow>()
    for (const r of (data as Array<{ material_id: string; type: 'in' | 'out'; qty: number; created_at: string }>) || []) {
      const e = map.get(r.material_id) || { material_id: r.material_id, total_in: 0, total_out: 0, last30_in: 0, last30_out: 0 }
      const recent = new Date(r.created_at).getTime() >= since
      if (r.type === 'in') { e.total_in += r.qty; if (recent) e.last30_in += r.qty }
      else { e.total_out += r.qty; if (recent) e.last30_out += r.qty }
      map.set(r.material_id, e)
    }
    return [...map.values()]
  }

  async applyStock(input: ApplyStockInput): Promise<MaterialRow> {
    if (input.type === 'out' && input.qty > (input.currentQty || 0))
      throw new Error(`出库数量 ${input.qty} 超过当前库存 ${input.currentQty || 0}`)
    const next = input.type === 'in'
      ? (input.currentQty || 0) + input.qty
      : (input.currentQty || 0) - input.qty
    await this.addStockLog({
      material_id: input.material_id, type: input.type, qty: input.qty,
      supplier_id: input.supplier_id ?? null, note: input.note,
    })
    return await this.updateMaterial(input.material_id, { qty: next })
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
    const { data, error } = await supabase
      .from('materials')
      .select('id, name, model, brand, package, qty, image_path, alternates, categories(name)')
      .is('deleted_at', null)
      .or(`model.ilike.%${model}%,part_no.ilike.%${model}%,name.ilike.%${model}%`)
      .limit(10)
    if (error) throw error
    return (data as unknown as MaterialRow[]) || []
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
    const { data, error } = await supabase
      .from('stock_log')
      .select('type, qty, created_at')
      .gte('created_at', since)
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
    // 内置模板不可删除（脚本种子写入，见 script/0001_init.sql 第 11 段）
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
