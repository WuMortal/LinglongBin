// 库存相关页面的共享数据（模块级单例）。
// Stock 各子页面（列表 / 记录 / 导入 / 待采）共用同一份物料、分类、汇总与流水，
// 避免每个 tab 各自拉取；快速出入库、导入入库、待采入库对库存的改动会即时同步到这里，
// 切到其它 tab 时看到的就是最新数据。
import { ref, computed } from 'vue'
import {
  listMaterials, listCategories, listStockLog, stockSummary, buildCategoryTree,
} from '../lib/db'
import type { StockSummaryRow } from '../lib/storage'
import type { Category, MaterialRow, StockLog, SupplierRow } from '../lib/types'
import { useToast } from './toast'
import type { KpiEntry } from '../components/KpiCards.vue'

const comps = ref<MaterialRow[]>([])
const categories = ref<Category[]>([])
const suppliers = ref<SupplierRow[]>([])
const suppliersLoaded = ref(false)
const summaryMap = ref<Map<string, StockSummaryRow>>(new Map())
const logs = ref<StockLog[]>([])
const loading = ref(false)
// 仅「列表刷新」的加载态：与 loading 分离。
// loading 会驱动父页面 page-loading（整块内容卸载重建 → 整屏闪烁），列表刷新不能碰它。
const listLoading = ref(false)

const toast = useToast()

function sumOf(id: string): StockSummaryRow {
  return summaryMap.value.get(id) || { material_id: id, total_in: 0, total_out: 0, last30_in: 0, last30_out: 0 }
}

async function refreshLogs() {
  try { logs.value = await listStockLog({ limit: 500 }) } catch { /* 静默 */ }
}

async function load() {
  loading.value = true
  try {
    const [ms, cats, sums] = await Promise.all([
      listMaterials({}), listCategories(), stockSummary(),
    ])
    comps.value = ms
    categories.value = cats
    summaryMap.value = new Map(sums.map(s => [s.material_id, s]))
    await refreshLogs()
  } catch (e: unknown) { toast.error('加载失败：' + ((e as Error).message || e)) }
  finally { loading.value = false }
}

/** 仅刷新库存列表（物料本身），不重载汇总 / 分类 / 流水等共享状态 */
async function refreshList() {
  listLoading.value = true
  try {
    comps.value = await listMaterials({})
  } catch (e: unknown) { toast.error('刷新失败：' + ((e as Error).message || e)) }
  finally { listLoading.value = false }
}

const totalQty = computed(() => comps.value.reduce((s, c) => s + c.qty, 0))
const sum30 = computed(() => {
  let tin = 0, tout = 0
  for (const s of summaryMap.value.values()) { tin += s.last30_in; tout += s.last30_out }
  return { in: tin, out: tout }
})
const kpiItems = computed<KpiEntry[]>(() => [
  { icon: 'Boxes', tone: 'teal', value: comps.value.length, label: '物料种类' },
  { icon: 'Package', tone: 'blue', value: totalQty.value, label: '库存总量' },
  { icon: 'ArrowDownToLine', tone: 'teal', value: `+${sum30.value.in}`, label: '近30天入库' },
  { icon: 'ArrowUpFromLine', tone: 'red', value: `-${sum30.value.out}`, label: '近30天出库' },
])
const catOptions = computed(() => {
  const tree = buildCategoryTree(categories.value)
  return [
    { value: null, label: '全部分类' },
    ...tree.map(n => ({ value: n.cat.id, label: n.cat.name })),
  ]
})

export function useStockData() {
  return {
    comps, categories, suppliers, suppliersLoaded, summaryMap, logs, loading,
    sumOf, refreshLogs, load, refreshList, listLoading,
    totalQty, sum30, kpiItems, catOptions,
  }
}
