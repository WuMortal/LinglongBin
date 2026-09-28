// 导入解析通用工具：支持 xls / xlsx / csv / tsv / 粘贴文本
// 兼容 GBK 编码 CSV（淘宝、京东等平台导出的订单多为 GBK），自动识别表头行与列映射。
import * as XLSX from 'xlsx'
// xlsx 的 ESM 入口（xlsx.mjs，Vite 会走 module 字段）不自带码表，$cptable 为空；
// 必须显式注入，否则解析 GBK 编码的旧版 .xls（立创 / 淘宝订单）时中文会乱码或抛错。
import * as cptable from 'xlsx/dist/cpexcel.full.mjs'

XLSX.set_cptable(cptable)

export interface ParsedSheet {
  headers: string[]
  rows: string[][]
  /** 原始矩阵（未切分表头），供界面在自动识别不准时手动改表头行 */
  matrix: string[][]
  /** 自动识别出的表头行索引 */
  headerIndex: number
}

const emptySheet = (): ParsedSheet => ({ headers: [], rows: [], matrix: [], headerIndex: 0 })

/** ZIP 魔数（xlsx 本质是 zip） */
const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04]
/** OLE2 复合文档魔数：Excel 97-2003 的 .xls 是 OLE2 容器内的 BIFF8 流 */
const OLE2_MAGIC = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]

/** 判断缓冲区是否以指定字节序列开头 */
function startsWith(u8: Uint8Array, sig: number[]): boolean {
  return u8.length >= sig.length && sig.every((b, i) => u8[i] === b)
}

/** 解码文本缓冲区：优先严格 UTF-8，失败回退 GBK（淘宝订单等 CSV 常见编码） */
export function decodeBuffer(buf: ArrayBuffer): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf)
  } catch {
    try {
      return new TextDecoder('gbk').decode(buf)
    } catch {
      return new TextDecoder('utf-8').decode(buf)
    }
  }
}

/** 解析文件/文本为「表头 + 数据行」 */
export function parseSheet(data: ArrayBuffer | string): ParsedSheet {
  if (typeof data === 'string') return fromText(data)
  const u8 = new Uint8Array(data)
  // xlsx(zip) 与旧版 xls(OLE2/BIFF8) 都是二进制工作簿，交给 SheetJS 按内容嗅探，
  // 内部会按文件的 CODEPAGE 记录解码（GBK 等），不能当文本解码否则必乱码。
  if (startsWith(u8, ZIP_MAGIC) || startsWith(u8, OLE2_MAGIC)) {
    return fromMatrix(toMatrix(XLSX.read(data, { type: 'array' })))
  }
  // 其余按文本处理：CSV / TSV / 粘贴文本 / 电商导出的伪 xls（HTML 表格）
  return fromText(decodeBuffer(data))
}

function fromText(text: string): ParsedSheet {
  if (!text.trim()) return emptySheet()
  const firstLine = text.split(/\r?\n/)[0] || ''
  const FS = firstLine.includes('\t') ? '\t' : undefined
  let wb: XLSX.WorkBook
  try {
    wb = XLSX.read(text, { type: 'string', raw: true, FS })
  } catch {
    wb = XLSX.read(text, { type: 'string', raw: true })
  }
  return fromMatrix(toMatrix(wb))
}

/** 工作簿 → 二维字符串矩阵（空单元格补空串） */
function toMatrix(wb: XLSX.WorkBook): string[][] {
  const ws = wb.Sheets[wb.SheetNames[0]]
  if (!ws) return []
  const json = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: '' })
  return json.map(r => (r as unknown[]).map(x => String(x ?? '').trim()))
}

/** 按指定行切分出「表头 + 数据」：界面手动改表头行时用 */
export function sliceAt(matrix: string[][], hi: number): { headers: string[]; rows: string[][] } {
  return { headers: matrix[hi] || [], rows: matrix.slice(hi + 1) }
}

/** 矩阵 → 解析结果（自动定位表头行） */
function fromMatrix(matrix: string[][]): ParsedSheet {
  if (!matrix.length) return emptySheet()
  const hi = findHeaderRow(matrix)
  return { ...sliceAt(matrix, hi), matrix, headerIndex: hi }
}

/** 表头关键词，用于定位真实表头行（如立创报价单前几行是标题/备注） */
const HEADER_KEYS = [
  '序号', '参数', '数量', '型号', '位号', '封装', '品牌', '名称', '值', '推荐商品', '商品编码',
  '商品标题', '宝贝标题', '订单编号', '交易时间', '实付款',
  // 明细表特征词：抬头区（客户编号 / 收货信息…）通常不含这些，
  // 加上它们能让真正的明细表头在打分时明显压过抬头行
  '商品编号', '单价', '金额',
  'comment', 'value', 'designator', 'footprint', 'quantity', 'manufacturer', 'part', 'supplier', 'name',
]

/** 抬头区里不可能作为表头的行：空行、分隔线、单格标题（如「商品明细列表」） */
function isNoiseRow(row: string[]): boolean {
  const cells = row.filter(c => c)
  if (!cells.length) return true
  if (cells.every(c => /^[-=_*·\s]+$/.test(c))) return true
  return cells.length <= 1
}

/** 在 [from, to) 行区间内找命中关键词最多的表头行，命中不足 2 个则返回 -1 */
function scanHeader(matrix: string[][], from: number, to: number): number {
  let best = -1, bestScore = -1
  for (let i = from; i < Math.min(to, matrix.length); i++) {
    if (isNoiseRow(matrix[i])) continue
    const cells = matrix[i].map(c => c.toLowerCase())
    const score = cells.filter(c => c && HEADER_KEYS.some(k => c.includes(k))).length
    if (score > bestScore) { bestScore = score; best = i }
  }
  return bestScore >= 2 ? best : -1
}

/**
 * 定位表头行：在前 50 行内取命中关键词最多的一行（平局取更靠前的）。
 * 不能只扫前 10 行：立创 / 淘宝等导出的订单顶部是大段抬头（客户编号、收货信息…），
 * 真实表头常落在第 20 行前后（立创订单明细表头实测在第 17 行）；
 * 也不能「前 10 行优先」：抬头区同样会命中「订单编号」等关键词而抢走表头位。
 */
export function findHeaderRow(matrix: string[][]): number {
  const hi = scanHeader(matrix, 0, 50)
  return hi >= 0 ? hi : 0
}

export type ColDetectMap = Record<string, number | null>

/**
 * 按关键词规则自动识别逻辑列。
 * 规则按优先级排列；关键词做小写 includes 匹配。
 * 返回 { 逻辑列名: 表头索引 | null }。
 */
export function detectColumns(
  headers: string[],
  rules: Array<[string, string[]]>,
): ColDetectMap {
  const lower = headers.map(x => x.toLowerCase())
  const m: ColDetectMap = {}
  for (const [field, keys] of rules) {
    const i = lower.findIndex(x => keys.some(k => x.includes(k)))
    m[field] = i >= 0 ? i : null
  }
  return m
}

/** 表头归一化：小写 + 去空格与常见标点/全角符号，便于比较 */
function normHead(s: string): string {
  return (s || '').toLowerCase().replace(/[\s\u3000()（）\[\]【】:：、/\\·.\-_*,，]/g, '')
}

/** 平台导入方案：不同商城导出的订单表头差异很大，内置方案可显著提升自动识别准确率 */
export interface ImportPreset {
  id: string
  /** 显示名，如「淘宝 / 天猫订单」 */
  name: string
  /** 方案说明 */
  desc: string
  /** 平台特征词，用于按表头自动判定来源 */
  signs: string[]
  /**
   * 逻辑字段 → 候选表头名（按优先级排列）。
   * 字段书写顺序即分配顺序：先写具体字段（数量/供应商/备注），
   * 后写宽泛字段（型号/名称），避免宽泛词抢走具体列。
   */
  rules: Record<string, string[]>
}

/**
 * 各平台订单导出的真实表头方案（signs 用于自动识别，rules 用于列映射）。
 * 可映射字段：model 型号、name 名称/规格（独立于型号展示）、qty 数量、price 单价、
 * amount 金额（÷数量得单价）、part_no 商品编号、brand 品牌、package 封装/规格、
 * supplier 供应商、note 备注、link 物料链接。
 * 注意：name 必须写在 model 之后——model 是匹配库存的主键，优先占用最像型号的列。
 * 注意：link 不使用「地址」这类泛词，以免把「收货地址」当成商品链接。
 */
export const IMPORT_PRESETS: ImportPreset[] = [
  {
    id: 'taobao',
    name: '淘宝 / 天猫订单',
    desc: '「已卖出的宝贝」导出 CSV，识别订单编号 / 宝贝标题 / 宝贝总数量 / 店铺名称',
    signs: ['订单编号', '买家会员名', '买家支付宝账号', '宝贝标题', '宝贝总数量', '物流单号', '店铺名称'],
    rules: {
      qty: ['宝贝总数量', '商品数量', '购买数量', '数量'],
      supplier: ['店铺名称', '卖家昵称', '店铺'],
      part_no: ['商家编码', '外部系统编号', '商品编号', '商品id', '货号'],
      brand: ['品牌'],
      package: ['商品规格', '规格'],
      price: ['商品单价', '单价', '商品价格', '售价'],
      amount: ['商品金额', '买家应付货款', '买家实际支付金额', '商品总价', '总金额'],
      link: ['宝贝地址', '宝贝链接', '商品链接', '商品地址', '详情链接'],
      note: ['订单编号', '订单号', '订单备注', '商家备注', '买家留言'],
      model: ['型号款式', '商品名称', '修改后的sku', '宝贝标题', '商品标题', '宝贝名称'],
      name: ['商品名称', '型号款式', '宝贝标题', '商品标题', '宝贝名称', '商品规格', '规格'],
    },
  },
  {
    id: 'jd',
    name: '京东订单',
    desc: '商家后台订单导出，识别订单号 / 商品名称 / 商品编号 / 商品数量',
    signs: ['京东', '商家编码', '商品编号', '京东价', '订单号'],
    rules: {
      qty: ['商品数量', '数量'],
      supplier: ['店铺名称', '商家名称', '店铺'],
      part_no: ['商品编号', '商家编码', '商品id'],
      brand: ['品牌'],
      package: ['商品规格', '规格'],
      price: ['商品单价', '京东价', '单价', '商品价格'],
      amount: ['商品总价', '订单金额', '金额'],
      link: ['商品链接', '商品地址', '详情链接'],
      note: ['订单号', '订单编号', '商家备注', '备注'],
      model: ['商品名称', '商品标题', '商品全称'],
      name: ['商品名称', '商品标题', '商品全称'],
    },
  },
  {
    id: 'lcsc',
    name: '立创商城',
    desc: '立创订单 / 配单导出，识别型号 / 品牌 / 封装 / 数量 / 商品编号',
    signs: ['立创', 'lcsc', '商品编号', '封装', '位号', '扩展库', '优惠券'],
    rules: {
      qty: ['数量', '需求数量'],
      // 立创导出只有「品牌」列、没有供应商列，故 supplier 留空、品牌映射到 brand
      supplier: [],
      part_no: ['商品编号', '立创编号', '物料编码'],
      brand: ['品牌', '厂家'],
      package: ['封装', '规格'],
      price: ['单价', '价格'],
      amount: ['金额', '小计', '总价'],
      link: ['商品链接', '详情链接', '商品地址'],
      note: ['商品编号', '备注'],
      // 立创订单：规格型号在「厂家型号」列，「商品名称」只是描述（如「2.2uF ±10%」）。
      // 「厂家型号」写在最前，让精确匹配优先命中它，避免型号落到描述列。
      model: ['厂家型号', '规格型号', '型号', '商品名称'],
      // 「商品名称」在立创里是描述（如「2.2uF ±10% 16V 编带」），单独作为名称展示
      name: ['商品名称', '型号', '规格型号'],
    },
  },
  {
    id: '1688',
    name: '1688 / 阿里巴巴',
    desc: '采购订单导出，识别订单号 / 货品名称 / 供应商 / 数量 / 单价',
    signs: ['1688', '阿里巴巴', '货品名称', '货品规格', '供应商名称', '卖家'],
    rules: {
      qty: ['数量', '采购数量', '货品数量'],
      supplier: ['供应商名称', '供应商', '公司名', '卖家'],
      part_no: ['货品编号', '商品编号', '商家编码', '货号'],
      brand: ['品牌', '厂家'],
      package: ['货品规格', '规格', '型号规格'],
      price: ['单价', '货品单价', '价格'],
      amount: ['总价', '金额', '货品总价'],
      link: ['货品链接', '商品链接', '详情链接'],
      note: ['订单号', '订单编号', '备注', '留言'],
      model: ['货品名称', '商品名称', '产品名称', '货品标题'],
      name: ['商品名称', '产品名称', '货品标题'],
    },
  },
  {
    id: 'pdd',
    name: '拼多多订单',
    desc: '商家后台导出，识别订单号 / 商品名称 / 商品规格 / 商品数量',
    signs: ['拼多多', '商品规格', '快递单号', '收件人', '下单时间'],
    rules: {
      qty: ['商品数量', '数量'],
      supplier: ['店铺名称', '商家名称'],
      part_no: ['商品编号', '商家编码', '商品id'],
      brand: ['品牌'],
      package: ['商品规格', '规格'],
      price: ['商品单价', '单价', '商品价格'],
      amount: ['商品总价', '订单金额', '金额'],
      link: ['商品链接', '详情链接'],
      note: ['订单号', '订单编号', '商家备注', '备注'],
      model: ['商品名称', '商品标题'],
      name: ['商品名称', '商品标题'],
    },
  },
  {
    id: 'generic',
    name: '通用表头',
    desc: '按常见表头名自动识别，适用于自建表格 / 未知来源',
    signs: [],
    rules: {
      qty: ['入库数量', '数量', 'qty', 'quantity', '个数'],
      supplier: ['供应商名称', '供应商', '厂家', '店铺名称', '商家', 'supplier', 'vendor'],
      part_no: ['商品编号', '商家编码', '物料编码', '料号', '货号', 'partno', 'mpn'],
      brand: ['品牌', '厂家', 'brand', 'manufacturer'],
      package: ['封装', '规格', 'package', 'footprint'],
      price: ['单价', '价格', '售价', 'price', '成本'],
      amount: ['总价', '金额', '小计', '合计', 'amount', 'total'],
      link: ['商品链接', '详情链接', '宝贝地址', '物料链接', 'url', 'link'],
      note: ['订单编号', '订单号', '备注', '留言', 'remark', 'note'],
      model: ['规格型号', '型号', '物料名称', '品名', '商品名称', '商品标题', '物料', '名称', 'model', 'mpn', 'title'],
      name: ['物料名称', '品名', '商品名称', '商品标题', '名称'],
    },
  },
]

/**
 * 精确优先的列识别：
 * 1) 先按「完全相等」匹配全部字段，再回退「包含」匹配；
 * 2) 已被占用的列不再分配给其它字段，避免多字段落到同一列；
 * 3) 字段按 rules 的书写顺序分配，宽泛字段应写在后面。
 * 例：淘宝表同时含「订单编号」「物流单号」时，note 会精确命中「订单编号」而非「物流单号」。
 */
export function detectColumnsPrecise(
  headers: string[],
  rules: Record<string, string[]>,
): ColDetectMap {
  const norm = headers.map(normHead)
  const used = new Set<number>()
  const m: ColDetectMap = {}
  for (const [field, names] of Object.entries(rules)) {
    m[field] = null
    const keys = names.map(normHead).filter(Boolean)
    // 第一轮：完全相等
    let i = norm.findIndex((h, idx) => !!h && !used.has(idx) && keys.includes(h))
    // 第二轮：包含回退（按候选顺序，靠前的候选优先）
    if (i < 0) {
      for (const k of keys) {
        const j = norm.findIndex((h, idx) => !!h && !used.has(idx) && h.includes(k))
        if (j >= 0) { i = j; break }
      }
    }
    if (i >= 0) { m[field] = i; used.add(i) }
  }
  return m
}

/** 按表头特征给各方案打分，返回最可能匹配的平台方案；无命中时返回通用方案 */
export function pickPreset(
  headers: string[],
  presets: ImportPreset[] = IMPORT_PRESETS,
): ImportPreset {
  const norm = headers.map(normHead)
  const generic = presets.find(p => p.id === 'generic') || presets[presets.length - 1]
  const hitCount = (keys: string[]) =>
    keys.map(normHead).filter(k => k && norm.some(h => h.includes(k))).length
  let best = generic
  let bestScore = 0
  for (const p of presets) {
    if (p.id === 'generic') continue
    let ruleKeys: string[] = []
    for (const names of Object.values(p.rules)) ruleKeys = ruleKeys.concat(names)
    // 特征词权重更高：规则名（数量/备注…）各平台高度重叠，只有特征词能区分来源；
    // 且必须命中至少一个特征词才考虑该平台，否则交由通用方案处理
    const signHit = hitCount(p.signs)
    if (!signHit) continue
    const score = signHit * 3 + hitCount(ruleKeys)
    if (score > bestScore) { bestScore = score; best = p }
  }
  return best
}
