// 一键匹配立创：批量为「未绑定」行查立创、自动挑最佳命中并生成待创建草稿。
// 串行执行（避免短时间大量请求被限流），逐条回调进度供 ProgressOverlay 展示。
import { lcscLookup, lcscSearch, type LcscComponent, type LcscHit } from './lcscApi'
import { buildDraftFromLcsc } from './lcscDraft'
import type { Category, MaterialDraft } from './types'

export interface LcscMatchInput {
  /** 搜索关键词（型号优先，其次是名称/参数值） */
  keyword: string
  /** 商品编码：为立创编号时参与精确比对 */
  partNo?: string | null
}

export type LcscMatchStatus = 'ok' | 'no-keyword' | 'no-hit' | 'error'

export interface LcscMatchOutcome {
  status: LcscMatchStatus
  /** 待创建草稿（status === 'ok' 时有值） */
  draft?: MaterialDraft
  /** 立创详情：存到行上，供后续「编辑」直接回填表单，无需重新查 */
  lcsc?: LcscComponent
  hit?: LcscHit
  price?: number | null
  message?: string
}

export interface LcscMatchProgress {
  done: number
  total: number
  /** 当前正在处理的关键词 */
  keyword: string
}

/** 归一化：去空白 + 大写，便于型号/编号比对 */
function norm(s: string | null | undefined): string {
  return (s || '').replace(/\s+/g, '').toUpperCase()
}

/**
 * 从搜索结果里挑最佳命中。
 * 优先级：型号精确 > 编码精确 > 型号/名称包含 > 有现货的首个 > 首个。
 */
export function pickBestHit(
  hits: LcscHit[],
  keyword: string,
  partNo?: string | null,
): LcscHit | null {
  if (!hits.length) return null
  const kw = norm(keyword)
  const pn = partNo ? norm(partNo) : ''

  const exactModel = hits.find(h => norm(h.model) === kw)
  if (exactModel) return exactModel

  if (pn) {
    const exactPn = hits.find(h => norm(h.part_no) === pn)
    if (exactPn) return exactPn
  }

  const contains = hits.find(h => norm(h.model).includes(kw) || norm(h.name).includes(kw))
  if (contains) return contains

  return hits.find(h => (h.stock ?? 0) > 0) ?? hits[0]
}

/**
 * 批量匹配立创。单项失败不影响其余行，失败原因写在 outcome 里由调用方汇总提示。
 */
export async function matchLcscBatch(
  inputs: LcscMatchInput[],
  categories: Category[],
  onProgress?: (p: LcscMatchProgress) => void,
): Promise<LcscMatchOutcome[]> {
  const total = inputs.length
  const out: LcscMatchOutcome[] = []

  for (let i = 0; i < inputs.length; i++) {
    const kw = (inputs[i].keyword || '').trim()
    onProgress?.({ done: i, total, keyword: kw || '—' })

    if (!kw) { out.push({ status: 'no-keyword' }); continue }

    try {
      const hits = await lcscSearch(kw)
      const hit = pickBestHit(hits, kw, inputs[i].partNo)
      if (!hit) { out.push({ status: 'no-hit' }); continue }

      const lcsc = await lcscLookup(hit.part_no)
      const draft = await buildDraftFromLcsc(lcsc, categories, { price: hit.price })
      out.push({ status: 'ok', draft, lcsc, hit, price: hit.price })
    } catch (e: unknown) {
      out.push({ status: 'error', message: (e as Error).message || String(e) })
    }
  }

  onProgress?.({ done: total, total, keyword: '' })
  return out
}
