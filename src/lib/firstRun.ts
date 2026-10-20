// 首次引导的「初始化数据」（目前=导入常用分类）执行时机控制。
//
// 为什么需要推迟：在线模式下所有业务表都开了 RLS（owner = auth.uid()），未登录时
// 既读不到任何数据、也写不进去，所以在引导页直接导入只会得到「未登录」错误。
// 而且登录后还可能发现云端本来就有数据（同一账号换了端使用 / 重装），这种情况要整跳过，
// 否则会重复建一份分类。故：引导阶段只登记待办，登录成功后再由 runPendingInit 决定做不做。
import { countMaterials, listCategories, importLcscCategories, type ImportProgress } from './db'

/** 待办标记：纯本地、不同步，reload 后仍可读 */
const PENDING_KEY = 'llb.pending-init'

/** 引导结束时无法判定（未登录）→ 登记待办，等登录后处理 */
export function markPendingInit(): void {
  try { localStorage.setItem(PENDING_KEY, 'lcsc') } catch { /* 隐私模式下忽略 */ }
}

/** 取出并清除待办（幂等消费） */
export function takePendingInit(): boolean {
  try {
    if (localStorage.getItem(PENDING_KEY) !== 'lcsc') return false
    localStorage.removeItem(PENDING_KEY)
    return true
  } catch { return false }
}

/** 当前账号名下是否已有数据（RLS 只放行自己的行，天然按账号隔离） */
export async function hasUserData(): Promise<boolean> {
  try {
    const [materials, categories] = await Promise.all([countMaterials({}), listCategories()])
    return materials > 0 || categories.length > 0
  } catch {
    // 查不动的时候按「没有」处理，下面的导入本身按 lcsc_id 去重，重复跑也不会多建
    return false
  }
}

export interface PendingInitResult {
  /** true=没做初始化（无待办，或云端已有数据） */
  skipped: boolean
  /** true=因为检测到云端已有数据而跳过 */
  hasData: boolean
}

/**
 * 登录成功后补做引导遗留的初始化：云端已有数据就直接跳过（用户只是多了一端），否则导入常用分类。
 * 失败会抛错由调用方兜底 —— 主线仍要进主界面，可在「分类管理」里重试。
 */
export async function runPendingInit(
  onProgress?: (p: ImportProgress) => void,
): Promise<PendingInitResult> {
  if (!takePendingInit()) return { skipped: true, hasData: false }
  if (await hasUserData()) return { skipped: true, hasData: true }
  await importLcscCategories(onProgress)
  return { skipped: false, hasData: false }
}
