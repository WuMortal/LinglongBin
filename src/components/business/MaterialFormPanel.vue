<script setup lang="ts">
import { ref, computed, watch, nextTick, onMounted } from 'vue'
import { createMaterial, createMaterialFiles, updateMaterial, listMaterials, getCategoryParams, getOwnerId, imagePublicUrl, listDictItems, listMaterialFiles, deleteMaterialFile } from '../../lib/db'
import type { Category, CategoryParam, MaterialRow, MaterialDraft, MaterialFormResult, MaterialFile } from '../../lib/types'
import AppSelect from '../form/AppSelect.vue'
import FileField from '../form/FileField.vue'
import { Plus, Trash2, ChevronDown, Check } from 'lucide-vue-next'
import { useToast } from '../../composables/toast'
import { useFormValidation, rules } from '../../composables/useFormValidation'
import { lcscFileSeeds, lcscFileTaggedName, type LcscComponent } from '../../lib/lcscApi'
import { matchLcscCategory, fillParamsFromLcsc as lcscParamValues } from '../../lib/lcscDraft'
import { mappedFieldOf, type MappableField } from '../../lib/paramFields'

const toast = useToast()

const props = defineProps<{
  categories: Category[]
  /** 传入则为编辑模式 */
  material?: MaterialRow | null
  /** 立创数据：传入则以立创信息预填表单（新增模式） */
  lcsc?: LcscComponent | null
  /** 立创搜索结果的价格（详情接口本身不返回价格，由调用方从搜索结果带入） */
  lcscPrice?: number | null
  /** 暂存模式：不落库，仅把表单数据 emit 出去（BOM / 库存导入场景，点保存时统一入库） */
  deferPersist?: boolean
  /** 普通预填（非编辑 / 非立创）：用传入的物料草稿字段预填表单（如库存导入行数据、待创建草稿），保存仍为新增 */
  prefill?: Partial<MaterialDraft> | null
  /** 新增（含立创预填）时「初始库存」的默认值：传入则预填（如库存导入把订单数量作为初始库存），缺省为 0 */
  initialStock?: number | null
}>()
const emit = defineEmits<{
  /** 保存结果：暂存模式下 material 为 null；是否关闭容器由父组件决定 */
  saved: [result: MaterialFormResult]
}>()

const isEdit = computed(() => !!props.material)

const saving = ref(false)
const formError = ref('')

/** 物料附件条目（数据手册 / 认证资料等，一个物料可多个）。key 为已落库附件 id（编辑载入时），新条目为空串 */
interface ManualItem {
  key: string
  name: string
  path: string | null
  file_type: string
  source: string
}

interface AddForm {
  name: string; model: string; brand: string; package: string; part_no: string
  major_id: string | null; category_id: string | null
  qty: number; location: string; price: number; threshold: number
  image_path: string | null
  /** 数据手册 / 附件列表（支持多个），落库写入 material_files */
  manuals: ManualItem[]
  link: string
  remark: string
}

function emptyForm(): AddForm {
  return {
    name: '', model: '', brand: '', package: '', part_no: '',
    major_id: null, category_id: null,
    qty: 0, location: '', price: 0, threshold: 0,
    image_path: null,
    manuals: [],
    link: '',
    remark: '',
  }
}
const form = ref<AddForm>(emptyForm())

const { errors, validate, validateField, clear: clearErrors } = useFormValidation<AddForm & Record<string, unknown>>({
  name: { label: '名称', rules: [rules.required('名称')] },
  part_no: { label: '商品编号', rules: [rules.required('商品编号')] },
  model: { label: '型号', rules: [rules.required('型号')] },
  major_id: { label: '大类', rules: [rules.required('大类')] },
  category_id: { label: '小类', rules: [rules.required('小类')] },
  qty: { label: '初始库存', rules: [rules.min('初始库存', 0)] },
  price: { label: '单价', rules: [rules.min('单价', 0)] },
  threshold: { label: '阈值', rules: [rules.min('阈值', 0)] },
  link: { label: '物料链接', rules: [rules.pattern('物料链接', /^https?:\/\/\S+$/i, '需以 http(s):// 开头')] },
})

// 大类 / 小类选项
const majors = computed(() => props.categories.filter(c => !c.parent))
const majorOptions = computed(() =>
  majors.value.map(m => ({ value: m.id, label: m.name }))
)

const minorOptions = computed(() => {
  if (!form.value.major_id) return []
  return props.categories
    .filter(c => c.parent === form.value.major_id)
    .map(c => ({ value: c.id, label: c.name }))
})

// 分类参数模板 + 用户填写的参数值
const categoryParams = ref<CategoryParam[]>([])
const paramsLoading = ref(false)
const paramValues = ref<Record<string, string>>({})
const customMode = ref<Record<string, boolean>>({})

// ===== 立创预填 =====
/** 编辑模式载入的附件 id 集合，保存时整体删除后按当前 manuals 重建 */
const loadedFileIds = ref<string[]>([])

/** 新增一个空的手册 / 附件条目 */
function addManual() {
  form.value.manuals.push({ key: '', name: '', path: null, file_type: 'manual', source: 'manual' })
}
/** 移除第 idx 个手册 / 附件条目 */
function removeManual(idx: number) {
  form.value.manuals.splice(idx, 1)
}
/** 附件类型中文名（编辑载入的立创附件按类型展示） */
function fileTag(t: string | null | undefined): string {
  switch (t) {
    case 'pdf_property': return '数据手册'
    case 'certification_data_property': return '认证资料'
    case 'industry_information': return '行业资讯'
    default: return '附件'
  }
}
/** 待填的立创数据：分类参数模板加载完成后再填参数（模板要按分类加载，故延后） */
let pendingLcsc: LcscComponent | null = null
/** 立创来源标记：预填后表单处于"来自立创"状态（用于提示与附件携带） */
const fromLcsc = ref(false)
/** 立创预填命中的小类，供 category_id 的 watch 判断"这次变更是否属于预填" */
const lcscCategoryId = ref<string | null>(null)

/**
 * 用立创规格参数填充分类参数区。
 * 与「一键匹配立创」共用 lcscDraft 的实现，两条路径写入库里的参数才一致。
 */
function fillParamsFromLcsc(lcsc: LcscComponent) {
  Object.assign(paramValues.value, lcscParamValues(lcsc, categoryParams.value))
}

/** 立创数据预填表单（新增模式） */
async function applyLcsc(lcsc: LcscComponent, price?: number | null) {
  fromLcsc.value = true
  const { major, minor } = matchLcscCategory(lcsc, props.categories)
  lcscCategoryId.value = minor
  form.value = {
    ...emptyForm(),
    name: lcsc.name || '',
    model: lcsc.model || '',
    brand: lcsc.brand || '',
    package: lcsc.package || '',
    part_no: lcsc.part_no || '',
    link: lcsc.source_url || '',
    // 立创附件（数据手册 / 认证资料 / 行业资讯）直接填入手册列表，用户可继续增删
    manuals: lcscFileSeeds(lcsc.files).map(s => ({
      key: '', name: lcscFileTaggedName(s.name, s.file_type), path: s.url,
      file_type: s.file_type || 'manual', source: 'lcsc',
    })),
    price: price ?? 0,
    qty: props.initialStock ?? 0,
    major_id: major,
    category_id: minor,
  }
  // 参数在分类模板加载完后填（见 category_id 的 watch）
  pendingLcsc = lcsc
  // 图片：直接存立创远程链接（与 buildDraftFromLcsc 一致，不下载落本地）
  const url = lcsc.image_url
  if (url) form.value.image_path = url
}

// ===== 库位（字典下拉建议，应用样式浮层；仍可自由输入） =====
const locationOptions = ref<string[]>([])
/**
 * 加载库位字典。
 * 原实现挂在 props.modelValue 上，但本组件没有这个 prop（父级用 v-if 挂载、
 * 通过 saved 事件回传），watch 永远不会触发，导致建议列表恒为空——改为挂载时加载一次。
 */
async function loadLocationOptions() {
  try { locationOptions.value = (await listDictItems('location')).map(i => i.label) }
  catch { locationOptions.value = [] }
}
const locRoot = ref<HTMLElement | null>(null)
const locPop = ref<HTMLElement | null>(null)
const locOpen = ref(false)
const locKeyword = ref('')
const locPopStyle = ref<Record<string, string>>({})
const filteredLocations = computed(() => {
  const k = locKeyword.value.trim().toLowerCase()
  if (!k) return locationOptions.value
  return locationOptions.value.filter(o => o.toLowerCase().includes(k))
})
function updateLocPos() {
  const el = locRoot.value
  if (!el) return
  const r = el.getBoundingClientRect()
  const n = filteredLocations.value.length
  const estH = Math.min(252, 12 + n * 34 + 2)
  const bottomSpace = window.innerHeight - r.bottom
  const showBelow = bottomSpace >= Math.min(estH, 252) || bottomSpace >= window.innerHeight / 2
  const top = showBelow ? r.bottom + 6 : Math.max(8, r.top - estH - 6)
  locPopStyle.value = {
    position: 'fixed',
    top: top + 'px',
    left: r.left + 'px',
    width: r.width + 'px',
    maxHeight: '240px',
  }
}
function openLoc() {
  locKeyword.value = form.value.location
  locOpen.value = true
  void nextTick(updateLocPos)
}
function closeLoc() { locOpen.value = false }
function toggleLoc() { locOpen.value ? closeLoc() : openLoc() }
function pickLoc(o: string) {
  form.value.location = o
  closeLoc()
}
function onLocInput() { locKeyword.value = form.value.location }
function onLocKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') closeLoc()
  if (e.key === 'Enter') {
    const first = filteredLocations.value[0]
    if (locOpen.value && first && first !== form.value.location) { e.preventDefault(); pickLoc(first) }
  }
}
function onDocLoc(e: MouseEvent) {
  const t = e.target as Node
  if (locRoot.value?.contains(t) || locPop.value?.contains(t)) return
  closeLoc()
}
watch(locOpen, (v) => {
  if (v) {
    document.addEventListener('mousedown', onDocLoc)
    window.addEventListener('scroll', updateLocPos, true)
    window.addEventListener('resize', updateLocPos)
  } else {
    document.removeEventListener('mousedown', onDocLoc)
    window.removeEventListener('scroll', updateLocPos, true)
    window.removeEventListener('resize', updateLocPos)
  }
})

// 参数 → 主表字段反写映射：参数区选择"品牌/封装"等时，自动同步到对应主表字段
// 映射表与判定收在 lib/paramFields，表单 / 立创草稿 / 卡片与抽屉展示共用同一份规则
/** 当前模板中带映射的参数：参数键 → 主表字段 */
const mappedParams = computed(() => {
  const m = new Map<string, MappableField>()
  for (const p of categoryParams.value) {
    const f = mappedFieldOf(p)
    if (f) m.set(p.key, f)
  }
  return m
})

/** 被参数驱动（锁定）的主表字段集合 */
const mappedFields = computed(() => new Set(mappedParams.value.values()))

// 参数值变化 → 反写主表字段（单一数据源：参数区）
watch(paramValues, (vals) => {
  for (const [pKey, field] of mappedParams.value) {
    form.value[field] = vals[pKey] || ''
  }
}, { deep: true })

// ===== 表单初始化 =====
/** prefill 带来的参数值，等分类模板加载完成后回填 */
let pendingPrefillParams: Record<string, unknown> | null = null
let restoring = false

/**
 * 按当前 props 初始化表单。
 * 面板由父组件用 v-if 控制挂载（弹窗打开 / 切到「新建物料」tab），
 * 所以每次挂载都是一份全新表单，无需再监听开关状态。
 */
function initForm() {
  formError.value = ''
  clearErrors()
  if (props.material) {
    // 编辑模式：预填充（restoring 期间跳过联动清空）
    fromLcsc.value = false
    lcscCategoryId.value = null
    restoring = true
    const m = props.material
    const cat = props.categories.find(c => c.id === m.category_id)
    form.value = {
      name: m.name, model: m.model || '', brand: m.brand || '',
      package: m.package || '', part_no: m.part_no || '',
      major_id: cat?.parent || null, category_id: m.category_id,
      qty: m.qty, location: m.location || '', price: m.price,
      threshold: m.threshold, image_path: m.image_path,
      manuals: [],
      link: m.link || '',
      remark: m.remark || '',
    }
    // 载入已落库附件（数据手册 / 认证资料 / 行业资讯），编辑后整体重建
    loadedFileIds.value = []
    listMaterialFiles(m.id).then(files => {
      loadedFileIds.value = files.map(f => f.id)
      form.value.manuals = files.map<ManualItem>(f => ({
        key: f.id,
        name: lcscFileTaggedName(f.name, f.file_type) || fileTag(f.file_type),
        path: f.url,
        file_type: f.file_type || 'manual',
        source: f.source || 'manual',
      }))
    }).catch(() => { form.value.manuals = [] })
    nextTick(() => { restoring = false })
  } else if (props.lcsc) {
    // 立创预填模式：基础字段 + 分类先落位，参数等模板加载完再填
    restoring = true
    lcscCategoryId.value = null
    loadedFileIds.value = []
    categoryParams.value = []
    paramValues.value = {}
    customMode.value = {}
    void applyLcsc(props.lcsc, props.lcscPrice)
    nextTick(() => { restoring = false })
  } else if (props.prefill) {
    // 普通预填（库存导入行数据 / 待创建草稿）：基础字段 + 分类 + 图片 / 附件 / 参数
    fromLcsc.value = false
    lcscCategoryId.value = null
    restoring = true
    loadedFileIds.value = []
    categoryParams.value = []
    paramValues.value = {}
    customMode.value = {}
    const p = props.prefill
    // 草稿里只存了小类，大类由分类树反推
    const cat = p.category_id ? props.categories.find(c => c.id === p.category_id) : undefined
    pendingPrefillParams = p.params ?? null
    form.value = {
      ...emptyForm(),
      name: p.name ?? '',
      model: p.model ?? '',
      brand: p.brand ?? '',
      package: p.package ?? '',
      part_no: p.part_no ?? '',
      major_id: cat?.parent || cat?.id || null,
      category_id: p.category_id ?? null,
      qty: Number(p.qty) || 0,
      location: p.location ?? '',
      price: Number(p.price) || 0,
      threshold: Number(p.threshold) || 0,
      image_path: p.image_path ?? null,
      link: p.link ?? '',
      remark: p.remark ?? '',
      manuals: (p.files ?? []).map(f => ({
        key: '', name: f.name, path: f.url,
        file_type: f.file_type || 'manual', source: 'manual',
      })),
    }
    nextTick(() => { restoring = false })
  } else {
    fromLcsc.value = false
    lcscCategoryId.value = null
    loadedFileIds.value = []
    form.value = emptyForm()
    categoryParams.value = []
    paramValues.value = {}
    customMode.value = {}
  }
}
onMounted(() => { initForm(); void loadLocationOptions() })

// 大类切换 → 清空小类
watch(() => form.value.major_id, () => {
  if (restoring) return
  form.value.category_id = null
  paramValues.value = {}
  customMode.value = {}
  categoryParams.value = []
})

// 小类切换 → 加载参数模板
watch(() => form.value.category_id, async (id) => {
  // 预填（编辑已有物料 / 立创带入 / prefill 草稿）期间的首次变更才放行；用户后续主动切换不受影响。
  // 立创模式下 props.material 为空，故预填目标改用 lcscCategoryId；prefill 场景用草稿自带的小类。
  const prefillId = props.material?.category_id
    ?? (fromLcsc.value ? lcscCategoryId.value : props.prefill?.category_id)
  if (restoring && prefillId !== id) return
  const restoringNow = restoring
  // 先捕获旧模板映射的字段，再清空模板（让 paramValues 反写 watcher 立即失效，避免误清/误写）
  const prevFields = [...mappedFields.value]
  categoryParams.value = []
  // 非恢复（用户主动切换分类）：清空旧模板反写的主表字段
  if (!restoringNow) {
    for (const f of prevFields) form.value[f] = ''
  }
  paramValues.value = {}
  customMode.value = {}
  if (!id) return
  paramsLoading.value = true
  try {
    categoryParams.value = await getCategoryParams(id)
    // 编辑模式：恢复已有参数值（restoring 标志可能在 await 期间被重置）
    if (restoringNow && props.material?.params) {
      for (const [k, v] of Object.entries(props.material.params)) {
        if (v != null && String(v).trim()) paramValues.value[k] = String(v)
      }
      // 映射参数兜底：params 缺失时用主表字段值回填参数区（兼容老数据）
      for (const [pKey, field] of mappedParams.value) {
        if (paramValues.value[pKey] == null) {
          const mv = props.material[field]
          if (mv != null && String(mv).trim()) paramValues.value[pKey] = String(mv)
        }
      }
    } else if (restoringNow && pendingPrefillParams) {
      // prefill 模式（订单行 / 待创建草稿）：模板加载完成后回填草稿里的参数值
      for (const [k, v] of Object.entries(pendingPrefillParams)) {
        if (v != null && String(v).trim()) paramValues.value[k] = String(v)
      }
      // 与编辑模式一致的主表字段兜底：草稿 params 缺「型号/品牌/封装」时用主表字段补，
      // 否则反写 watcher 会把这些列清空（品牌输入框还是锁定的，用户补不回来）
      for (const [pKey, field] of mappedParams.value) {
        if (paramValues.value[pKey] == null) {
          const mv = props.prefill?.[field]
          if (mv != null && String(mv).trim()) paramValues.value[pKey] = String(mv)
        }
      }
      pendingPrefillParams = null
    } else if (restoringNow && pendingLcsc) {
      // 立创预填模式：模板加载完成，用立创规格参数填参数区（自动反写 model/brand/package）
      fillParamsFromLcsc(pendingLcsc)
      pendingLcsc = null
    }
  } catch (e: unknown) {
    toast.error('加载参数模板失败：' + ((e as Error).message || e))
    categoryParams.value = []
  } finally {
    paramsLoading.value = false
  }
})

function paramValueOptions(p: CategoryParam) {
  return [
    { value: '', label: '（不填）' },
    ...p.values.map(v => ({ value: v, label: v })),
    { value: '__custom__', label: '+ 自定义' },
  ]
}

function onParamChange(p: CategoryParam, v: string) {
  if (v === '__custom__') {
    customMode.value[p.key] = true
    paramValues.value[p.key] = ''
  } else {
    customMode.value[p.key] = false
    paramValues.value[p.key] = v
  }
}

async function submit() {
  formError.value = ''
  if (!validate(form.value)) {
    // 校验失败必须给出提示：否则点了保存像"没反应"，弹窗也不关（导入场景尤其明显）
    const firstKey = Object.keys(errors).find(k => errors[k])
    toast.error(firstKey ? errors[firstKey] : '请检查表单填写')
    return
  }
  saving.value = true
  try {
    // 名称重复校验（同分类下同名物料不允许，编辑时排除自身）
    const name = form.value.name.trim()
    const existed = await listMaterials({ search: name })
    const dup = existed.find(m => m.name === name
      && m.category_id === form.value.category_id
      && m.id !== props.material?.id)
    if (dup) {
      toast.error(`分类下已存在同名物料「${name}」，请更换名称`)
      saving.value = false
      return
    }

    // 型号唯一校验（全库唯一，编辑时排除自身）
    const model = form.value.model.trim()
    if (model) {
      const dupModel = (await listMaterials({ search: model }))
        .find(m => (m.model || '').trim() === model && m.id !== props.material?.id)
      if (dupModel) {
        toast.error(`型号「${model}」已存在（${dupModel.name}），请更换型号`)
        saving.value = false
        return
      }
    }

    // 图片 / 附件：FileField 已把最终路径（或 URL / null）写入各 manual.path
    const image_path = form.value.image_path

    // 手册 / 附件：过滤掉未填路径的条目，按序构建落库载荷
    const validManuals = form.value.manuals
      .filter(m => m.path && m.path.trim())
      .map((m, i) => ({
        name: lcscFileTaggedName(m.name, m.file_type) || fileTag(m.file_type),
        url: m.path!.trim(),
        file_type: m.file_type || 'manual',
        source: m.source || 'manual',
        sort_order: i,
      }))
    // 主手册（datasheet_path）：优先数据手册类型，否则取第一个，保持旧字段兼容展示
    const datasheet_path =
      validManuals.find(f => f.file_type === 'pdf_property')?.url
      ?? validManuals[0]?.url ?? null

    // 收集参数：仅写入非空项
    const params: Record<string, unknown> = {}
    for (const p of categoryParams.value) {
      const v = paramValues.value[p.key]
      if (v && v.trim()) params[p.key] = v.trim()
    }

    // 表单产出的完整物料数据（未落库），正常 / 暂存模式统一以它为准
    const draft: MaterialDraft = {
      name,
      model: form.value.model.trim() || null,
      brand: form.value.brand.trim() || null,
      package: form.value.package.trim() || null,
      part_no: form.value.part_no.trim() || null,
      category_id: form.value.category_id,
      params,
      qty: Number(form.value.qty) || 0,
      location: form.value.location.trim() || null,
      price: Number(form.value.price) || 0,
      threshold: Number(form.value.threshold) || 0,
      image_path, datasheet_path,
      link: form.value.link.trim() || null,
      remark: form.value.remark.trim() || null,
      files: validManuals.length ? validManuals : undefined,
    }

    // 暂存模式（BOM / 库存导入）：不落库，草稿交给父组件，保存时统一建料 + 入库 + 附件
    if (props.deferPersist) {
      emit('saved', { draft, material: null })
      return
    }

    if (props.material) {
      const m = await updateMaterial(props.material.id, {
        name, model: draft.model, brand: draft.brand, package: draft.package,
        part_no: draft.part_no, category_id: draft.category_id,
        location: draft.location, price: draft.price, threshold: draft.threshold,
        params, image_path, datasheet_path, link: draft.link, remark: draft.remark,
      })
      // 附件整体重建：删除原载入的全部附件，再按当前 manuals 写入（含改名 / 增删）
      for (const id of loadedFileIds.value) {
        try { await deleteMaterialFile(id) } catch { /* 忽略单条失败 */ }
      }
      loadedFileIds.value = []
      if (draft.files?.length) await createMaterialFiles(m.id, draft.files)
      toast.success('物料更新成功')
      emit('saved', { draft, material: m })
    } else {
      const m = await createMaterial({
        name, model: draft.model, brand: draft.brand, package: draft.package,
        part_no: draft.part_no, category_id: draft.category_id,
        location: draft.location, price: draft.price, threshold: draft.threshold,
        params, image_path, datasheet_path, link: draft.link, remark: draft.remark, qty: draft.qty,
      })
      // 立创附件 / 手动手册（数据手册 / 认证资料 / 行业资讯）全部落库
      if (draft.files?.length) await createMaterialFiles(m.id, draft.files)
      toast.success('物料添加成功')
      emit('saved', { draft, material: m })
    }
  } catch (e: unknown) { formError.value = '保存失败：' + ((e as Error).message || e) }
  finally { saving.value = false }
}

// 供外层容器（弹窗 / 绑定弹窗的「新建物料」tab）触发保存与读取保存中状态
defineExpose({ submit, saving })
</script>

<template>
  <!-- 表单主体：不含弹窗外壳，可直接内嵌到「新增物料」弹窗或绑定弹窗的「新建物料」tab -->
  <div class="mf-panel">
    <div class="form-grid">
      <div class="field" :class="{ 'has-err': errors.name }">
        <label>名称 <span class="req">*</span></label>
        <input v-model="form.name" placeholder="如 贴片电阻" @blur="validateField('name', form.name)" />
        <span v-if="errors.name" class="field-err">{{ errors.name }}</span>
      </div>
      <div class="field" :class="{ 'has-err': errors.part_no }">
        <label>商品编号 <span class="req">*</span></label>
        <input v-model="form.part_no" placeholder="如 LCSC-123456" @blur="validateField('part_no', form.part_no)" />
        <span v-if="errors.part_no" class="field-err">{{ errors.part_no }}</span>
      </div>
      <div class="field" :class="[{ 'has-err': errors.model, 'field-locked': mappedFields.has('model') }]">
        <label>型号 <span class="req">*</span>
          <small v-if="mappedFields.has('model')" class="hint-text">（由参数填充）</small>
        </label>
        <input v-model="form.model" placeholder="如 0603 10k" :disabled="mappedFields.has('model')"
          @blur="validateField('model', form.model)" />
        <span v-if="errors.model" class="field-err">{{ errors.model }}</span>
      </div>
      <div class="field" :class="{ 'field-locked': mappedFields.has('brand') }">
        <label>品牌 <small v-if="mappedFields.has('brand')" class="hint-text">（由参数填充）</small></label>
        <input v-model="form.brand" :disabled="mappedFields.has('brand')" />
      </div>
      <div class="field" :class="{ 'field-locked': mappedFields.has('package') }">
        <label>封装 <small v-if="mappedFields.has('package')" class="hint-text">（由参数填充）</small></label>
        <input v-model="form.package" placeholder="如 0603" :disabled="mappedFields.has('package')" />
      </div>
      <div class="field" :class="{ 'field-locked': isEdit }">
        <label>初始库存 <small v-if="isEdit" class="hint-text">（通过出入库修改）</small></label>
        <input v-model.number="form.qty" type="number" min="0" :disabled="isEdit" placeholder="大于 0 时自动记一条初始入库" />
      </div>

      <div class="field" :class="{ 'has-err': errors.major_id }">
        <label>大类 <span class="req">*</span></label>
        <AppSelect v-model="form.major_id" :options="majorOptions" :searchable="true" search-placeholder="搜索大类"
          placeholder="选择大类" :min-width="0" @update:model-value="validateField('major_id', form.major_id)" />
        <span v-if="errors.major_id" class="field-err">{{ errors.major_id }}</span>
      </div>
      <div class="field" :class="{ 'has-err': errors.category_id }">
        <label>小类 <span class="req">*</span></label>
        <AppSelect v-model="form.category_id" :options="minorOptions" :searchable="true" search-placeholder="搜索小类"
          :placeholder="form.major_id ? '选择小类' : '请先选大类'" :min-width="0" :disabled="!form.major_id"
          @update:model-value="validateField('category_id', form.category_id)" />
        <span v-if="errors.category_id" class="field-err">{{ errors.category_id }}</span>
      </div>

      <div class="field">
        <label>库位</label>
        <div ref="locRoot" class="loc-box">
          <input v-model="form.location" class="loc-input" placeholder="如 A01-03" @focus="openLoc" @input="onLocInput"
            @keydown="onLocKeydown" />
          <button type="button" class="loc-caret" :class="{ on: locOpen }" tabindex="-1" title="选择已有库位"
            @mousedown.prevent @click="toggleLoc">
            <ChevronDown :size="14" style="display: inline-flex; flex-shrink: 0" />
          </button>
        </div>
        <Teleport to="body">
          <transition name="locpop">
            <div v-if="locOpen" ref="locPop" class="loc-pop-float" :style="locPopStyle">
              <ul class="loc-list">
                <li v-for="o in filteredLocations" :key="o" class="loc-opt" :class="{ on: o === form.location }"
                  @mousedown.prevent="pickLoc(o)">
                  <span>{{ o }}</span>
                  <Check v-if="o === form.location" :size="13" style="display: inline-flex; flex-shrink: 0" />
                </li>
                <li v-if="!filteredLocations.length" class="loc-opt loc-empty">无匹配库位</li>
              </ul>
            </div>
          </transition>
        </Teleport>
      </div>
      <div class="field"><label>单价(¥)</label><input v-model.number="form.price" type="number" min="0" step="0.01" />
      </div>
      <div class="field" :class="{ 'has-err': errors.threshold }">
        <label>预警阈值</label>
        <input v-model.number="form.threshold" type="number" min="0" placeholder="0" />
        <span v-if="errors.threshold" class="field-err">{{ errors.threshold }}</span>
      </div>

      <!-- 分类参数 -->
      <div v-if="paramsLoading" class="field full params-loading">
        <span class="spinner-sm" />加载参数模板…
      </div>
      <div v-else-if="categoryParams.length" class="field full">
        <label>参数 <small class="hint-text">（按分类模板）</small></label>
        <div class="params-flow">
          <div v-for="p in categoryParams" :key="p.key" class="param-cell">
            <span class="param-name">{{ p.name || p.key }}</span>
            <AppSelect :model-value="paramValues[p.key] || ''" :options="paramValueOptions(p)" :searchable="true"
              :search-placeholder="p.name || p.key" :min-width="0"
              @update:model-value="(v) => onParamChange(p, v as string)" />
            <input v-if="customMode[p.key]" class="param-custom" v-model="paramValues[p.key]" placeholder="自定义值" />
          </div>
        </div>
      </div>

      <div class="field full">
        <label>图片</label>
        <FileField v-model="form.image_path" image accept="image/*" placeholder="请输入图片在线地址" />
      </div>

      <div class="field full">
        <label>数据手册 / 附件 <small class="hint-text">（可添加多个）</small></label>
        <div class="manuals">
          <div v-for="(m, idx) in form.manuals" :key="idx" class="manual-row">
            <input v-model="m.name" class="manual-name" placeholder="名称（如 (数据手册)xxx.pdf）" />
            <FileField v-model="m.path" :clearable="false" placeholder="请输入文件在线地址" />
            <button type="button" class="manual-del" title="移除该手册" @click="removeManual(idx)">
              <Trash2 :size="14" style="display: inline-flex; flex-shrink: 0" />
            </button>
          </div>
          <button type="button" class="btn btn-ghost manual-add" @click="addManual">
            <Plus :size="14" style="display: inline-flex; flex-shrink: 0" />{{ form.manuals.length ? '再添加一个手册 / 附件' :
            '添加手册' }}
          </button>
        </div>
      </div>

      <div class="field full" :class="{ 'has-err': errors.link }">
        <label>物料链接</label>
        <input v-model="form.link" type="url" placeholder="如 https://item.szlcsc.com/xxx.html"
          @blur="validateField('link', form.link)" />
        <span v-if="errors.link" class="field-err">{{ errors.link }}</span>
      </div>

      <div class="field full">
        <label>备注说明</label>
        <input v-model="form.remark" type="text" placeholder="备注（如来源、特殊说明）" />
      </div>
    </div>
    <p v-if="formError" class="form-err">{{ formError }}</p>
  </div>
</template>

<style scoped>
.form-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 14px;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.field.full {
  grid-column: 1 / -1;
}

.field label {
  font-size: var(--fs-xs);
  color: var(--c-text-2);
  font-weight: 500;
}

.field label .hint-text {
  color: var(--c-text-3);
  font-weight: 400;
  margin-left: 4px;
}

.field input {
  height: var(--ctrl-h);
  padding: 0 var(--ctrl-px);
  font-size: var(--fs-xs);
  background: var(--c-surface);
  border: 1px solid var(--c-border);
  border-radius: var(--r-md);
  color: var(--c-text);
  transition: border-color var(--motion);
}

.field input:focus {
  outline: none;
  border-color: var(--c-primary);
}

/* 禁用字段（如编辑模式下的数量）：明显弱化 + 禁用光标 */
.field input:disabled {
  background: var(--c-glass);
  border-style: dashed;
  color: var(--c-text-3);
  cursor: not-allowed;
  -webkit-text-fill-color: var(--c-text-3);
  opacity: 1;
}

.field input:disabled::-webkit-outer-spin-button,
.field input:disabled::-webkit-inner-spin-button {
  -webkit-appearance: none;
  margin: 0;
}

/* 整个只读字段（含标签）弱化 */
.field-locked label {
  color: var(--c-text-3) !important;
}

.field.has-err input {
  border-color: var(--c-danger);
}

.req {
  color: var(--c-danger);
  margin-left: 2px;
}

.field-err {
  font-size: 11px;
  color: var(--c-danger);
}

/* 参数流式布局 */
.params-flow {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 10px;
}

.param-cell {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 140px;
  flex: 1 1 140px;
  max-width: 220px;
}

.param-name {
  font-size: var(--fs-xs);
  color: var(--c-text-2);
  font-weight: 500;
}

.param-custom {
  height: var(--ctrl-h-sm, 28px);
  padding: 0 8px;
  font-size: var(--fs-xs);
  background: var(--c-surface);
  border: 1px solid var(--c-border);
  border-radius: var(--r-sm);
  color: var(--c-text);
  transition: border-color var(--motion);
}

.param-custom:focus {
  outline: none;
  border-color: var(--c-primary);
}

/* 参数加载 */
.params-loading {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--c-text-2);
  font-size: var(--fs-xs);
}

.spinner-sm {
  width: 12px;
  height: 12px;
  border: 2px solid var(--c-border);
  border-top-color: var(--c-primary);
  border-radius: 50%;
  animation: spin 0.6s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.form-err {
  color: var(--c-danger);
  font-size: var(--fs-sm);
  margin: 12px 0 0;
}

/* ===== 数据手册 / 附件（可多个） ===== */
.manuals {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

/* 类型已并入名称（(数据手册)xxx.pdf），故每行只有「名称 + 文件控件 + 删除」单行 */
.manual-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.manual-name {
  width: 168px;
  flex-shrink: 0;
  height: var(--ctrl-h);
  padding: 0 var(--ctrl-px);
  font-size: var(--fs-xs);
  background: var(--c-surface);
  border: 1px solid var(--c-border);
  border-radius: var(--r-md);
  color: var(--c-text);
  transition: border-color var(--motion);
}

.manual-name:focus {
  outline: none;
  border-color: var(--c-primary);
}

/* 文件控件占满剩余宽度 */
.manual-row :deep(.ff) {
  flex: 1;
  min-width: 0;
}

/* 控件行与名称框同高：FileField 上传模式 34px（Segmented 28+3×2）、在线地址模式 36px，
   统一到 --ctrl-h 后与名称框完全对齐。 */
.manual-row :deep(.ff-bar) {
  min-height: var(--ctrl-h);
}

.manual-del {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: none;
  background: transparent;
  border-radius: var(--r-md);
  color: var(--c-text-3);
  cursor: pointer;
  transition: all var(--motion);
}

.manual-del:hover {
  background: rgba(255, 92, 114, 0.12);
  color: var(--c-danger);
}

.manual-add {
  align-self: flex-start;
  height: var(--ctrl-h-sm, 30px);
  padding: 0 12px;
  font-size: var(--fs-xs);
  gap: 4px;
}

/* ===== 库位下拉（应用样式浮层 + 自由输入） ===== */
.loc-box {
  position: relative;
}

.loc-input {
  width: 100%;
  padding-right: 32px;
}

.loc-caret {
  position: absolute;
  top: 50%;
  right: 4px;
  transform: translateY(-50%);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border: none;
  background: transparent;
  border-radius: var(--r-sm);
  color: var(--c-text-2);
  cursor: pointer;
  transition: background var(--motion);
}

.loc-caret:hover {
  background: var(--c-elevated-2);
  color: var(--c-text);
}

.loc-caret svg {
  transition: transform var(--motion);
}

.loc-caret.on svg {
  transform: rotate(180deg);
}

@media (max-width: 600px) {
  .form-grid {
    grid-template-columns: 1fr;
  }
}
</style>

<style>
/* 库位下拉浮层 teleport 到 body，需非 scoped 样式 */
.loc-pop-float {
  z-index: 1000;
  background: var(--c-elevated);
  border: 1px solid var(--c-border);
  border-radius: var(--r-md);
  box-shadow: var(--shadow-pop);
  padding: 6px;
  overflow: auto;
}

.loc-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.loc-opt {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 9px 10px;
  border-radius: var(--r-sm);
  cursor: pointer;
  font-size: var(--fs-xs);
  color: var(--c-text);
  transition: background var(--motion);
}

.loc-opt:hover {
  background: var(--c-elevated-2);
}

.loc-opt.on {
  color: var(--c-primary);
  background: var(--c-primary-soft);
  font-weight: 600;
}

.loc-opt.on svg {
  color: var(--c-primary);
  flex-shrink: 0;
}

.loc-opt.loc-empty {
  justify-content: center;
  color: var(--c-text-3);
  cursor: default;
}

.locpop-enter-active,
.locpop-leave-active {
  transition: opacity var(--motion), transform var(--motion);
}

.locpop-enter-from,
.locpop-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}
</style>
