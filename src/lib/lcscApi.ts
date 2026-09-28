import { invoke } from '@tauri-apps/api/core'
import { lcscCacheGet, lcscCacheSet } from './lcscCache'

/** 立创物料附件（数据手册 / 认证资料 / 行业资讯），一个物料可有多个 */
export interface LcscFile {
  /** 展示名，可能为空（如 wj221811），前端按类型兜底 */
  name: string
  /** 绝对地址（外链或 atta.szlcsc.com 绝对路径） */
  url: string
  /** pdf_property 数据手册 / certification_data_property 认证资料 / industry_information 行业资讯 */
  file_type: string
}

/** 立创商城物料详情（Rust 侧 lcsc.rs 返回结构） */
export interface LcscComponent {
  /** 立创编号，如 C17710 */
  part_no: string
  name: string
  model: string | null
  brand: string | null
  package: string | null
  category: string | null
  /** 分类编码（productTypeCode，如 "439"），精确对应本地分类表的 lcsc_id */
  category_code: string | null
  description: string | null
  /** 商品详情页 */
  source_url: string | null
  /** 远程缩略图地址（下载落本地后存入 materials.image_path） */
  image_url: string | null
  /** 规格参数 [键, 值] */
  params: [string, string][]
  /** 附件列表（数据手册排最前），随补建写入物料 */
  files: LcscFile[]
}

/** 立创搜索结果条目（精简，选中后再按编号查详情） */
export interface LcscHit {
  /** 立创编号，如 C8734 */
  part_no: string
  name: string
  model: string | null
  brand: string | null
  package: string | null
  category: string | null
  /** 分类编码（productTypeCode，如 "439"），精确对应本地分类表的 lcsc_id */
  category_code: string | null
  image_url: string | null
  /** 立创现货库存 */
  stock: number | null
  /** 最低阶梯单价（元） */
  price: number | null
  source_url: string | null
  /** 附件列表（数据手册排最前） */
  files: LcscFile[]
}

/** 查询类缓存有效期：7 天 */
const TTL_QUERY = 7 * 24 * 60 * 60 * 1000
/** 图片映射缓存有效期：90 天（图片内容稳定） */
const TTL_IMAGE = 90 * 24 * 60 * 60 * 1000

/** 进程内缓存：同一次会话内不重复请求 */
const lookupCache = new Map<string, LcscComponent>()
const searchCache = new Map<string, LcscHit[]>()

/**
 * 按立创编号查询物料详情。
 * 读取顺序：内存缓存 → 本地 SQLite 缓存（未过期）→ 联网请求立创。
 * 失败时抛出异常，调用方需降级处理（回退手动补建），不要阻塞主流程。
 */
export async function lcscLookup(partNo: string): Promise<LcscComponent> {
  const key = partNo.trim().toUpperCase()
  if (!key) throw new Error('立创编号为空')

  const mem = lookupCache.get(key)
  if (mem) return ensureFiles(mem)

  const cached = await lcscCacheGet<LcscComponent>('lookup', key, TTL_QUERY)
  if (cached) {
    lookupCache.set(key, cached)
    return ensureFiles(cached)
  }

  const d = await invoke<LcscComponent>('lcsc_lookup', { partNo: key })
  lookupCache.set(key, d)
  void lcscCacheSet('lookup', key, d)
  return ensureFiles(d)
}

/**
 * 按型号/关键词搜索立创商城，返回候选列表（编号或型号精确匹配者排前）。
 * 读取顺序同 lcscLookup；失败时抛异常。
 */
export async function lcscSearch(keyword: string, limit = 20): Promise<LcscHit[]> {
  const key = keyword.trim().toUpperCase()
  if (!key) return []
  // 条数影响结果集，与关键词一起作为缓存键
  const ck = `${key}|${limit}`

  const mem = searchCache.get(ck)
  if (mem) return mem.map(ensureFiles)

  const cached = await lcscCacheGet<LcscHit[]>('search', ck, TTL_QUERY)
  if (cached) {
    searchCache.set(ck, cached)
    return cached.map(ensureFiles)
  }

  const r = await invoke<LcscHit[]>('lcsc_search', { keyword: key, limit })
  searchCache.set(ck, r)
  void lcscCacheSet('search', ck, r)
  return r.map(ensureFiles)
}

/** 兼容旧缓存：早期抓取的数据没有 files 字段，补齐为空数组 */
function ensureFiles<T extends { files?: LcscFile[] }>(d: T): T {
  if (!Array.isArray(d.files)) (d as T & { files: LcscFile[] }).files = []
  return d
}

/** 附件类型的中文名（展示与名称兜底用） */
export function lcscFileTypeLabel(t: string | null | undefined): string {
  switch (t) {
    case 'pdf_property': return '数据手册'
    case 'certification_data_property': return '认证资料'
    case 'industry_information': return '行业资讯'
    default: return '附件'
  }
}

/** 附件展示名：优先文件名，空名（如 wj221811）按类型兜底 */
export function lcscFileDisplayName(f: Pick<LcscFile, 'name' | 'file_type'>): string {
  const n = (f.name || '').trim()
  return n || lcscFileTypeLabel(f.file_type)
}

/**
 * 附件展示名（含类型前缀）：「(数据手册)xxx.pdf」。
 * 类型并入名称后，任何只展示文件名的位置（如物料详情附件列表）也能看出附件类型。
 * 幂等：已带该前缀、或名称本身即类型名（立创空名兜底）时不重复添加。
 * 手工新增（file_type 为 manual / 空）不加前缀，保持原名。
 */
export function lcscFileTaggedName(name: string, fileType: string | null | undefined): string {
  if (!fileType || fileType === 'manual') return (name || '').trim()
  const tag = lcscFileTypeLabel(fileType)
  const n = (name || '').trim()
  if (!n) return `(${tag})`
  if (n.startsWith(`(${tag})`)) return n
  if (n === tag) return `(${tag})`
  return `(${tag})${n}`
}

/** 主手册：数据手册优先，无则取第一个文件 */
export function lcscMainFile(files: LcscFile[] | null | undefined): LcscFile | null {
  return files?.find(f => f.file_type === 'pdf_property') ?? files?.[0] ?? null
}

/** 附件行载荷：写入物料后逐条入库 material_files */
export function lcscFileSeeds(files: LcscFile[] | null | undefined, offset = 0) {
  return (files || []).map((f, i) => ({
    name: lcscFileDisplayName(f),
    url: f.url,
    file_type: f.file_type,
    source: 'lcsc',
    sort_order: offset + i,
  }))
}

/** 是否为合法立创编号（C + 数字），用于决定是否显示「查立创」入口 */
export function isLcscCode(partNo: string): boolean {
  const s = (partNo || '').trim().toUpperCase()
  return s.length >= 2 && s.startsWith('C') && /^\d+$/.test(s.slice(1))
}

/**
 * 下载立创图片到本地 resource 目录，返回相对路径（如 images/lcsc/xxx.png）。
 * 同一图片 URL 已下载过则直接复用本地路径，不重复下载。
 * 失败抛异常，调用方降级（图片缺失不影响物料保存）。
 */
export async function lcscFetchImage(url: string): Promise<string> {
  const cached = await lcscCacheGet<string>('image', url, TTL_IMAGE)
  if (cached) return cached
  const rel = await invoke<string>('lcsc_fetch_image', { url })
  void lcscCacheSet('image', url, rel)
  return rel
}
