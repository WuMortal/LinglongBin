<script setup lang="ts">
// 嘉立创查面板（MaterialBindDialog 的「嘉立创查」tab 内容）。
// 布局：顶部搜索 → 左结果列表 / 右详情（参考 MaterialFormDialog 的 field 风格）→ 底部「选用」。
// 选中结果后按 part_no 取完整详情（含规格参数与附件列表），确认后 emit('pick', hit)。
import { ref, computed, watch } from 'vue'
import { Search, Inbox, FileText, Link2, Package } from 'lucide-vue-next'
import { lcscSearch, lcscLookup, lcscFileDisplayName, lcscFileTypeLabel, type LcscHit, type LcscComponent }
  from '../../lib/lcscApi'
import { useToast } from '../../composables/toast'

const props = defineProps<{
  keyword?: string
  /** 选用按钮交由父级 footer 渲染（如 Home / 导入弹窗），面板内部不再显示 */
  footerPick?: boolean
}>()
const emit = defineEmits<{ pick: [h: LcscHit]; 'update:selected': [h: LcscHit | null] }>()

const toast = useToast()
const kw = ref('')
const hits = ref<LcscHit[]>([])
const searching = ref(false)
/** 是否已执行过搜索：用于区分「尚未搜索」与「已搜索但无结果」 */
const searched = ref(false)
/** 选中的搜索结果 */
const selected = ref<LcscHit | null>(null)
/** 选中项的完整详情（联网取，带缓存） */
const detail = ref<LcscComponent | null>(null)
const detailLoading = ref(false)

watch(() => props.keyword, v => {
  kw.value = v || ''
  if (kw.value) void runSearch()
}, { immediate: true })

async function runSearch() {
  const k = kw.value.trim()
  if (!k || searching.value) return
  searching.value = true
  searched.value = true
  hits.value = []
  selected.value = null
  detail.value = null
  try {
    hits.value = await lcscSearch(k)
  } catch (e: unknown) {
    toast.error('搜立创失败：' + ((e as Error).message || e))
  } finally {
    searching.value = false
  }
}

async function select(h: LcscHit) {
  selected.value = h
  detail.value = null
  detailLoading.value = true
  try {
    detail.value = await lcscLookup(h.part_no)
  } catch (e: unknown) {
    toast.error('获取详情失败：' + ((e as Error).message || e))
  } finally {
    detailLoading.value = false
  }
}

/** 详情里的规格参数（[键, 值] → 展示用） */
const paramPairs = computed<[string, string][]>(() => {
  const d = detail.value
  if (!d?.params?.length) return []
  return d.params.filter(([k, v]) => k && v != null && String(v).trim() !== '')
})

/** 附件：详情优先，未取到详情时回落到搜索结果自带的 files */
const fileList = computed(() => detail.value?.files || selected.value?.files || [])

function confirmPick() {
  if (!selected.value) return
  emit('pick', selected.value)
}

// 选中态同步给父级（footer 渲染选用按钮时需要判断是否已选）
watch(selected, v => emit('update:selected', v), { immediate: true })

// 暴露给父级 footer 调用
defineExpose({ confirmPick })
</script>

<template>
  <div class="lcsc-pane">
    <!-- 顶部搜索 -->
    <div class="m-search">
      <Search :size="14" class="s-ico" />
      <input v-model="kw" placeholder="型号 / 关键词，回车搜索" @keydown.enter="runSearch" />
      <button class="btn btn-primary m-go" :disabled="searching" @click="runSearch">
        <template v-if="searching"><span class="spinner-xs" /></template>
        <template v-else>搜索</template>
      </button>
    </div>

    <!-- 左结果 / 右详情 -->
    <div class="lcsc-split">
      <ul class="cand">
        <li v-for="h in hits" :key="h.part_no" :class="{ on: selected?.part_no === h.part_no }"
          @click="select(h)">
          <img v-if="h.image_url" :src="h.image_url" class="cand-img" alt="" loading="lazy" />
          <div class="cand-info">
            <strong>{{ h.model || h.name }}</strong>
            <small>{{ h.brand || '—' }} · {{ h.package || '—' }} · {{ h.part_no }}</small>
          </div>
          <div class="lcsc-pr">
            <span v-if="h.price !== null" class="lcsc-price">¥{{ h.price }}</span>
            <span v-if="h.stock !== null" class="mq" :class="{ low: h.stock < 100 }">现货 {{ h.stock }}</span>
          </div>
        </li>
        <li v-if="searching" class="no"><span class="spinner-xs" />搜索中…</li>
        <li v-else-if="searched && !hits.length" class="no">
          <Inbox :size="20" />无匹配结果
        </li>
        <li v-else-if="!searched" class="no">
          <Inbox :size="20" />输入关键词开始搜索
        </li>
      </ul>

      <!-- 右侧详情 -->
      <div class="detail">
        <div v-if="detailLoading" class="detail-empty">
          <span class="spinner-sm" />加载详情…
        </div>
        <div v-else-if="!selected" class="detail-empty">
          <Package :size="28" />
          <p>从左侧选择一个商品查看详情</p>
        </div>
        <div v-else class="detail-body">
          <div class="d-top">
            <img v-if="detail?.image_url || selected.image_url"
              :src="detail?.image_url || selected.image_url || ''" class="d-img" alt="" />
            <div class="d-title">
              <strong>{{ detail?.name || selected.name }}</strong>
              <span class="d-part mono">{{ selected.part_no }}</span>
            </div>
          </div>

          <div class="d-grid">
            <div class="field">
              <label>型号</label>
              <span class="d-val">{{ detail?.model || selected.model || '—' }}</span>
            </div>
            <div class="field">
              <label>品牌</label>
              <span class="d-val">{{ detail?.brand || selected.brand || '—' }}</span>
            </div>
            <div class="field">
              <label>封装</label>
              <span class="d-val">{{ detail?.package || selected.package || '—' }}</span>
            </div>
            <div class="field">
              <label>分类</label>
              <span class="d-val">{{ detail?.category || selected.category || '—' }}</span>
            </div>
            <div class="field">
              <label>单价</label>
              <span class="d-val price">{{ selected.price !== null ? '¥' + selected.price : '—' }}</span>
            </div>
            <div class="field">
              <label>现货</label>
              <span class="d-val">{{ selected.stock !== null ? selected.stock : '—' }}</span>
            </div>
          </div>

          <div v-if="paramPairs.length" class="field">
            <label>规格参数</label>
            <div class="params-flow">
              <div v-for="([k, v], i) in paramPairs" :key="i" class="param-cell">
                <span class="param-name">{{ k }}</span>
                <span class="d-val">{{ v }}</span>
              </div>
            </div>
          </div>

          <div v-if="fileList.length" class="field">
            <label>数据手册 / 附件 <small class="hint-text">（{{ fileList.length }}）</small></label>
            <div class="file-list">
              <a v-for="(f, i) in fileList" :key="i" class="file-item" :href="f.url"
                target="_blank" rel="noopener">
                <FileText :size="13" class="file-ico" />
                <span class="file-name">{{ lcscFileDisplayName(f) }}</span>
                <span class="file-tag">{{ lcscFileTypeLabel(f.file_type) }}</span>
              </a>
            </div>
          </div>

          <a v-if="detail?.source_url || selected.source_url" class="d-link"
            :href="detail?.source_url || selected.source_url || ''" target="_blank" rel="noopener">
            <Link2 :size="12" />在立创商城打开
          </a>
        </div>
      </div>
    </div>

    <!-- 底部选用（footerPick 时交由父级 footer 渲染） -->
    <div v-if="!footerPick" class="lcsc-foot">
      <span class="foot-hint">
        <template v-if="selected">已选 {{ selected.part_no }}：{{ selected.model || selected.name }}</template>
        <template v-else>选中后可查看完整参数与数据手册</template>
      </span>
      <button class="btn btn-primary" :disabled="!selected" @click="confirmPick">选用</button>
    </div>
  </div>
</template>

<style scoped>
.lcsc-pane {
  display: flex;
  flex-direction: column;
  gap: 10px;
  height: 100%;
  min-height: 470px;
}

.m-search {
  position: relative;
  display: flex;
  align-items: center;
  flex-shrink: 0;
}

.s-ico {
  position: absolute;
  left: 10px;
  color: var(--c-text-3);
}

.m-search input {
  width: 100%;
  height: 32px;
  padding: 0 10px 0 30px;
  font-size: var(--fs-sm);
  background: var(--c-glass);
  border: 1px solid var(--c-border);
  border-radius: var(--r-md);
  color: var(--c-text);
  font-family: inherit;
  transition: all var(--motion);
}

.m-search input:focus {
  border-color: var(--c-primary);
  background: var(--c-surface);
  box-shadow: 0 0 0 3px var(--c-primary-glow);
  outline: none;
}

.m-go {
  margin-left: 8px;
  flex-shrink: 0;
}

.lcsc-split {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
  flex: 1;
  min-height: 0;
}

.cand {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-height: 0;
  overflow-y: auto;
}

.cand li {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border-radius: var(--r-md);
  background: var(--c-glass);
  cursor: pointer;
  transition: all var(--motion);
  border: 1px solid transparent;
}

.cand li:hover {
  background: var(--c-surface-active);
}

.cand li.on {
  background: var(--c-primary-soft);
  border-color: rgba(79, 140, 255, 0.25);
}

.cand li.no {
  justify-content: center;
  cursor: default;
  color: var(--c-text-2);
  gap: 8px;
}

.cand-img {
  width: 30px;
  height: 30px;
  object-fit: contain;
  flex-shrink: 0;
  border: 1px solid var(--c-border);
  border-radius: 4px;
  background: #fff;
}

.cand-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 1;
  min-width: 0;
}

.cand-info strong {
  font-size: var(--fs-sm);
  font-weight: 600;
}

.cand-info small {
  color: var(--c-text-2);
  font-size: var(--fs-xs);
}

.lcsc-pr {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 2px;
  flex-shrink: 0;
}

.lcsc-price {
  font-size: var(--fs-xs);
  color: var(--c-text-2);
}

.mq {
  font-weight: 700;
  font-size: var(--fs-xs);
  color: var(--c-accent);
}

.mq.low { color: var(--c-danger); }

/* ===== 右侧详情（参考 MaterialFormDialog 的 field 风格） ===== */
.detail {
  min-height: 0;
  overflow-y: auto;
  padding: 12px 14px;
  background: var(--c-glass);
  border: 1px solid var(--c-border);
  border-radius: var(--r-md);
}

.detail-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  height: 100%;
  min-height: 200px;
  color: var(--c-text-3);
  font-size: var(--fs-xs);
}

.detail-empty p { margin: 0; }

.detail-body {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.d-top {
  display: flex;
  align-items: center;
  gap: 10px;
}

.d-img {
  width: 52px;
  height: 52px;
  object-fit: contain;
  flex-shrink: 0;
  border: 1px solid var(--c-border);
  border-radius: var(--r-sm);
  background: #fff;
}

.d-title {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}

.d-title strong {
  font-size: var(--fs-sm);
  font-weight: 600;
  line-height: 1.35;
}

.d-part {
  font-size: var(--fs-xs);
  color: var(--c-text-3);
}

.d-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(110px, 1fr));
  gap: 8px 10px;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}

.field > label {
  font-size: var(--fs-xs);
  color: var(--c-text-2);
  font-weight: 500;
}

.hint-text {
  font-weight: 400;
  color: var(--c-text-3);
}

.d-val {
  font-size: var(--fs-sm);
  color: var(--c-text);
  word-break: break-all;
}

.d-val.price {
  color: var(--c-accent);
  font-weight: 600;
}

.params-flow {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.param-cell {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 90px;
  max-width: 130px;
  padding: 5px 8px;
  background: var(--c-surface);
  border: 1px solid var(--c-border);
  border-radius: var(--r-sm);
}

.param-name {
  font-size: var(--fs-xs);
  color: var(--c-text-3);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.file-list {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.file-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 8px;
  border-radius: var(--r-sm);
  background: var(--c-surface);
  border: 1px solid var(--c-border);
  color: var(--c-text);
  text-decoration: none;
  transition: all var(--motion-fast);
}

.file-item:hover {
  border-color: var(--c-primary);
  background: var(--c-surface-active);
}

.file-ico {
  color: var(--c-sub);
  flex-shrink: 0;
}

.file-name {
  flex: 1;
  min-width: 0;
  font-size: var(--fs-xs);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.file-tag {
  font-size: 11px;
  color: var(--c-primary);
  background: rgba(64, 128, 255, 0.1);
  border-radius: 4px;
  padding: 0 5px;
  line-height: 17px;
  flex-shrink: 0;
}

.d-link {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: var(--fs-xs);
  color: var(--c-primary);
  text-decoration: none;
}

.d-link:hover { text-decoration: underline; }

/* ===== 底部 ===== */
.lcsc-foot {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-shrink: 0;
  padding-top: 10px;
  border-top: 1px solid var(--c-border-hairline);
}

.foot-hint {
  flex: 1;
  min-width: 0;
  font-size: var(--fs-xs);
  color: var(--c-text-3);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.spinner-xs {
  width: 11px;
  height: 11px;
  border: 2px solid var(--c-border);
  border-top-color: var(--c-primary);
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
  display: inline-block;
}

@keyframes spin { to { transform: rotate(360deg); } }
</style>