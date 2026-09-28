<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { Upload, Trash2 } from 'lucide-vue-next'
import { uploadImage, uploadFile, imagePublicUrl, getOwnerId } from '../../lib/db'
import { useToast } from '../../composables/toast'
import Segmented from './Segmented.vue'
import ImageViewer from '../ImageViewer.vue'

const props = withDefaults(defineProps<{
  /** 当前存储路径 / 在线 URL / null */
  modelValue: string | null
  /** 图片模式：显示预览缩略图、调用 uploadImage；否则按文件处理 */
  image?: boolean
  /** input[type=file] 的 accept；为空时按 image 自动推导 */
  accept?: string
  /** URL 输入框占位符 */
  placeholder?: string
  /** 是否显示清除按钮（选了文件后出现），默认 true */
  clearable?: boolean
}>(), {
  image: false,
  accept: '',
  placeholder: '请输入在线地址',
  clearable: true,
})

const emit = defineEmits<{
  'update:modelValue': [v: string | null]
}>()

const toast = useToast()

type Mode = 'upload' | 'url'
const mode = ref<Mode>('upload')
const urlInput = ref('')
const file = ref<File | null>(null)
const busy = ref(false)
const error = ref('')
const showViewer = ref(false)

const acceptVal = computed(() => props.accept || (props.image ? 'image/*' : ''))

// 初始化 / 外部重置：modelValue 为 http 链接时切到 URL 模式并同步输入框
watch(() => props.modelValue, (v) => {
  if (v && /^https?:\/\//i.test(v)) {
    if (mode.value !== 'url') mode.value = 'url'
    if (urlInput.value !== v) urlInput.value = v
  }
}, { immediate: true })

// URL 输入变化：校验后 emit（无效则保留旧值，提示错误）
watch(urlInput, (v) => {
  if (mode.value !== 'url') return
  const trimmed = v.trim()
  if (!trimmed) {
    error.value = ''
    emit('update:modelValue', null)
    return
  }
  if (!/^https?:\/\//i.test(trimmed)) {
    error.value = '地址需以 http(s):// 开头'
    return
  }
  error.value = ''
  emit('update:modelValue', trimmed)
})

// 图片预览：新选文件用 blob URL，已有路径用 imagePublicUrl
const localPreview = ref<string | null>(null)
watch(file, (f) => {
  if (localPreview.value) { URL.revokeObjectURL(localPreview.value); localPreview.value = null }
  if (f) localPreview.value = URL.createObjectURL(f)
})

// 图片预览：上传模式显示新选文件或已有路径；在线地址模式只认输入框中的合法 URL（切换后旧图先隐藏）
const previewUrl = computed(() => {
  if (mode.value === 'url') {
    const u = urlInput.value.trim()
    return /^https?:\/\//i.test(u) ? u : null
  }
  return localPreview.value || imagePublicUrl(props.modelValue) || null
})

const hasValue = computed(() => !!props.modelValue || !!file.value || (!!urlInput.value.trim() && !error.value))

const fileName = computed(() => {
  if (busy.value) return '上传中…'
  if (file.value) return shortName(file.value.name)
  return props.image ? '选择图片' : '选择文件'
})

function shortName(name: string, max = 14): string {
  return name.length > max ? name.slice(0, max - 3) + '…' : name
}

function onFile(e: Event) {
  const f = (e.target as HTMLInputElement).files?.[0]
  if (!f) return
  file.value = f
  doUpload(f)
}

async function doUpload(f: File) {
  busy.value = true
  error.value = ''
  try {
    const userId = await getOwnerId()
    const r = props.image ? await uploadImage(f, userId) : await uploadFile(f, userId)
    
    emit('update:modelValue', r.path)
    toast.success('上传成功')
  } catch (e: unknown) {
    error.value = '上传失败：' + ((e as Error).message || e)
    file.value = null
  } finally {
    busy.value = false
  }
}

function clear() {
  file.value = null
  urlInput.value = ''
  error.value = ''
  emit('update:modelValue', null)
}
</script>

<template>
  <div class="ff">
    <div class="ff-bar">
      <Segmented :model-value="mode" @update:model-value="(v) => mode = v as Mode"
        :options="[
          { value: 'upload', label: image ? '上传图片' : '上传文件' },
          { value: 'url', label: '在线地址' },
        ]" />
      <Transition name="ff-fade" mode="out-in">
        <span v-if="mode === 'upload'" class="ff-file" :title="file?.name || ''" key="upload">
          <input type="file" :accept="acceptVal" :disabled="busy" @change="onFile" />
          <span class="ff-btn">
            <Upload :size="14" style="display: inline-flex; flex-shrink: 0" />{{ fileName }}
          </span>
        </span>
        <input v-else key="url" v-model="urlInput" class="ff-url" :placeholder="placeholder" />
      </Transition>
      <img v-if="image && previewUrl" :src="previewUrl" class="ff-thumb" alt="" title="点击放大"
        @click="showViewer = true" />
      <button v-if="clearable && hasValue" type="button" class="ff-clear" title="清除" @click="clear">
        <Trash2 :size="14" style="display: inline-flex; flex-shrink: 0" />
      </button>
    </div>
    <p v-if="error" class="ff-err">{{ error }}</p>

    <ImageViewer v-if="image" v-model:open="showViewer" :src="previewUrl" />
  </div>
</template>

<style scoped>
.ff {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.ff-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.ff-file {
  position: relative;
  display: inline-flex;
  flex-shrink: 0;
  max-width: 220px;
}

.ff-file input[type="file"] {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  opacity: 0;
  cursor: pointer;
}

.ff-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: calc(var(--ctrl-h) - 6px);
  padding: 0 10px;
  background: var(--c-elevated-2);
  border: 1px solid var(--c-border-strong);
  border-radius: var(--r-md);
  font-size: var(--fs-xs);
  color: var(--c-text-2);
  max-width: 100%;
  overflow: hidden;
  white-space: nowrap;
  pointer-events: none;
}

.ff-url {
  flex: 1;
  min-width: 140px;
  height: var(--ctrl-h);
  padding: 0 var(--ctrl-px);
  background: var(--c-surface);
  border: 1px solid var(--c-border);
  border-radius: var(--r-md);
  font-size: var(--fs-sm);
  color: var(--c-text);
  transition: border-color var(--motion);
}

.ff-url:focus {
  outline: none;
  border-color: var(--c-primary);
  box-shadow: 0 0 0 3px var(--c-primary-glow);
}

.ff-thumb {
  width: 36px;
  height: 36px;
  object-fit: cover;
  border-radius: var(--r-sm);
  border: 1px solid var(--c-border);
  cursor: zoom-in;
  flex-shrink: 0;
}

.ff-clear {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 28px;
  height: 28px;
  border: none;
  border-radius: var(--r-md);
  background: transparent;
  color: var(--c-text-3);
  cursor: pointer;
  transition: all var(--motion);
}

.ff-clear:hover {
  background: var(--c-danger);
  color: #fff;
}

.ff-err {
  margin: 0;
  font-size: var(--fs-xs);
  color: var(--c-danger);
}

/* 上传/地址模式切换过渡（纯淡入淡出） */
.ff-fade-enter-active,
.ff-fade-leave-active {
  transition: opacity 0.18s ease;
}
.ff-fade-enter-from,
.ff-fade-leave-to {
  opacity: 0;
}
</style>
