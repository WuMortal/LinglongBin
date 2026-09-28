<template>
  <div class="pane-data">
    <div class="mode-opts">
      <button class="mode-opt" :class="{ on: mode === 'sqlite' }" @click="pickMode('sqlite')">
        <div class="mode-ico">
          <HardDrive :size="18" style="display: inline-flex; flex-shrink: 0" />
        </div>
        <div class="mode-txt">
          <b>离线模式</b>
          <small>数据存本地 SQLite，无需登录</small>
        </div>
        <Check v-if="mode === 'sqlite'" :size="14" class="ck" style="display: inline-flex; flex-shrink: 0" />
      </button>
      <button class="mode-opt" :class="{ on: mode === 'supabase' }" @click="pickMode('supabase')">
        <div class="mode-ico">
          <Cloud :size="18" style="display: inline-flex; flex-shrink: 0" />
        </div>
        <div class="mode-txt">
          <b>在线模式</b>
          <small>Supabase 云端同步，需登录</small>
        </div>
        <Check v-if="mode === 'supabase'" :size="14" class="ck"
          style="display: inline-flex; flex-shrink: 0" />
      </button>
    </div>

    <div v-if="mode === 'supabase'" class="supa-form">
      <div class="supa-row">
        <label class="field">
          <span class="lbl">Supabase URL</span>
          <input v-model="supaUrl" type="text" placeholder="https://xxxx.supabase.co" autocomplete="off" />
        </label>
        <label class="field">
          <span class="lbl">Anon Key</span>
          <input v-model="supaAnon" type="password" placeholder="eyJhbGciOi..." autocomplete="off" />
        </label>
        <button class="btn btn-primary save-btn" :disabled="!supaUrl || !supaAnon || saving" @click="saveSupa">
          <Save v-if="!saving" :size="14" style="display: inline-flex; flex-shrink: 0" />
          {{ saving ? '校验中…' : '保存' }}
        </button>
      </div>
      <p class="hint">
        <CircleAlert :size="12" style="display: inline-flex; flex-shrink: 0" />
        URL 或 Anon Key 为空、或配置错误时不会切换；填写正确配置并点击保存后启用在线模式
      </p>
    </div>

    <div v-else class="offline-tip">
      <CircleCheck :size="14" style="display: inline-flex; flex-shrink: 0" />
      <span>离线模式已启用 · 数据存储在本地 SQLite 文件</span>
    </div>

    <div v-if="mode === 'sqlite'" class="db-actions">
      <button class="btn btn-ghost db-btn" :disabled="exporting" @click="exportDb">
        <Download :size="14" style="display: inline-flex; flex-shrink: 0" />
        {{ exporting ? '导出中…' : '导出数据库' }}
      </button>
      <button class="btn btn-ghost db-btn" :disabled="importing" @click="importDb">
        <Upload :size="14" style="display: inline-flex; flex-shrink: 0" />
        {{ importing ? '导入中…' : '导入数据库' }}
      </button>
    </div>

    <div class="kv-list mode-status">
      <div class="kv"><span>当前激活模式</span>
        <b :class="activeMode === 'sqlite' ? 'off' : 'on'">
          <span class="dot" />
          {{ activeMode === 'sqlite' ? '离线（SQLite）' : '在线（Supabase）' }}
        </b>
      </div>
      <div class="kv"><span>登录要求</span>
        <b>{{ needLogin ? '需登录' : '免登录' }}</b>
      </div>

    </div>


  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { Cloud, HardDrive, Check, Save, CircleAlert, CircleCheck, Download, Upload } from 'lucide-vue-next'
import { invoke } from '@tauri-apps/api/core'
import { save, open } from '@tauri-apps/plugin-dialog'
import {
  getAppSettings, setAppSettings, isAuthRequired,
  type DataMode,
} from '../lib/appSettings'
import { validateSupabase } from '../lib/supabaseValidate'
import { resetStore, activeMode as getActiveMode } from '../lib/storage'
import { resetSupabaseClient } from '../lib/supabase'
import { confirm } from '../composables/confirm'
import { useToast } from '../composables/toast'

defineProps<{ embedded?: boolean }>()

const toast = useToast()
const exporting = ref(false)
const importing = ref(false)
const saving = ref(false)
const settings = getAppSettings()
const mode = ref<DataMode>(settings.mode)
const supaUrl = ref(settings.supabaseUrl)
const supaAnon = ref(settings.supabaseAnonKey)
const activeMode = ref<DataMode>(getActiveMode())
const needLogin = computed(() => isAuthRequired())

async function pickMode(m: DataMode) {
  if (m === mode.value) return
  if (m === 'supabase') {
    // 仅选中在线模式以展示配置表单，不在配置缺失/错误时直接切换；
    // 真正切换由「保存」按钮在校验通过后执行
    mode.value = 'supabase'
    return
  }
  // 离线模式无需配置，确认后直接切换
  const ok = await confirm({
    title: '切换到离线模式？',
    content: '离线模式与在线模式的数据相互独立存储，不会自动同步。切换后只能看到对应模式下的数据，已存在的另一模式数据不会被删除。切换后需要重新加载应用以应用新配置。',
    confirmText: '确认切换',
    cancelText: '取消',
    variant: 'warning',
  })
  if (!ok) return
  mode.value = m
  await setAppSettings({ mode: m })
  resetStore()
  resetSupabaseClient()
  toast.success('已切换到离线模式，正在重新加载…', 1200)
  setTimeout(() => location.reload(), 800)
}

/** 校验 Supabase 配置（实现见 @/lib/supabaseValidate） */
async function saveSupa() {
  const url = supaUrl.value.trim()
  const anon = supaAnon.value.trim()
  if (!url || !anon) {
    toast.error('请先填写 Supabase URL 和 Anon Key')
    return
  }
  saving.value = true
  try {
    const valid = await validateSupabase(url, anon)
    if (!valid) {
      toast.error('Supabase 配置无效：URL 或 Anon Key 不正确')
      return
    }
    await setAppSettings({
      mode: 'supabase',
      supabaseUrl: url,
      supabaseAnonKey: anon,
    })
    resetStore()
    resetSupabaseClient()
    toast.success('Supabase 配置已保存，正在重新加载…', 1200)
    setTimeout(() => location.reload(), 800)
  } catch (e) {
    toast.error('校验失败：' + (e as Error).message)
  } finally {
    saving.value = false
  }
}

async function exportDb() {
  if (exporting.value) return
  exporting.value = true
  try {
    const target = await save({
      defaultPath: `linglongbin-backup-${new Date().toISOString().slice(0, 10)}.db`,
      filters: [{ name: 'SQLite Database', extensions: ['db', 'sqlite'] }],
    })
    if (!target) { exporting.value = false; return }
    const bytes = await invoke<number>('export_db', { targetPath: target })
    toast.success(`已导出数据库（${(bytes / 1024).toFixed(1)} KB）`)
  } catch (e) {
    toast.error('导出失败：' + (e as Error).message)
  } finally {
    exporting.value = false
  }
}

async function importDb() {
  if (importing.value) return
  importing.value = true
  try {
    const source = await open({
      multiple: false,
      filters: [{ name: 'SQLite Database', extensions: ['db', 'sqlite'] }],
    })
    if (!source || Array.isArray(source)) { importing.value = false; return }
    const ok = await confirm({
      title: '导入数据库？',
      content: '导入将覆盖当前离线模式下的所有数据，且无法恢复。建议先导出当前数据作为备份。导入完成后需要重新加载应用。',
      confirmText: '确认覆盖导入',
      cancelText: '取消',
      variant: 'danger',
    })
    if (!ok) { importing.value = false; return }
    await invoke('import_db', { sourcePath: source })
    toast.success('导入成功，正在重新加载…', 1200)
    setTimeout(() => location.reload(), 800)
  } catch (e) {
    toast.error('导入失败：' + (e as Error).message)
  } finally {
    importing.value = false
  }
}
</script>

<style scoped>
.pane-data {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.mode-opts {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}

.mode-opt {
  position: relative;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 14px;
  border-radius: var(--r-md);
  border: 2px solid var(--c-border);
  background: var(--c-glass);
  cursor: pointer;
  transition: all var(--motion-fast);
  text-align: left;
}

.mode-opt:hover {
  background: var(--c-surface-hover);
  border-color: var(--c-border-strong);
}

.mode-opt.on {
  border-color: var(--c-primary);
  background: rgba(79, 140, 255, 0.08);
}

.mode-ico {
  width: 36px;
  height: 36px;
  border-radius: var(--r-sm);
  flex-shrink: 0;
  background: var(--c-surface);
  color: var(--c-text-2);
  display: grid;
  place-items: center;
}

.mode-opt.on .mode-ico {
  background: var(--c-primary-soft);
  color: var(--c-primary);
}

.mode-txt {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  flex: 1;
}

.mode-txt b {
  font-size: var(--fs-md);
  font-weight: 600;
  color: var(--c-text);
}

.mode-txt small {
  font-size: var(--fs-xs);
  color: var(--c-text-2);
}

.mode-opt .ck {
  color: var(--c-primary);
  flex-shrink: 0;
}

.supa-form {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px;
  background: var(--c-glass);
  border-radius: var(--r-md);
  border: 1px dashed var(--c-border);
}

.supa-row {
  display: flex;
  gap: 10px;
  align-items: flex-end;
}

.supa-row .field {
  flex: 1;
  min-width: 0;
}

.supa-form .field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.supa-form .lbl {
  font-size: var(--fs-xs);
  color: var(--c-text-2);
  font-weight: 500;
}

.supa-form input {
  width: 100%;
  height: var(--ctrl-h);
  padding: 0 var(--ctrl-px);
  font-size: var(--fs-xs);
  background: var(--c-surface);
  border: 1px solid var(--c-border);
  border-radius: var(--r-sm);
  color: var(--c-text);
}

.supa-form input:focus {
  outline: none;
  border-color: var(--c-primary);
  background: var(--c-bg-2);
}

.save-btn {
  height: var(--ctrl-h);
  flex-shrink: 0;
}

.hint {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 0;
  padding: 0;
  font-size: var(--fs-xs);
  color: var(--c-text-2);
  line-height: 1.5;
}

.offline-tip {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px;
  border-radius: var(--r-md);
  background: rgba(52, 211, 153, 0.08);
  color: var(--c-success);
  font-size: var(--fs-xs);
  font-weight: 500;
}

.db-actions {
  display: flex;
  gap: 8px;
}

.db-btn {
  flex: 1;
  height: var(--ctrl-h);
}

.kv-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding-top: 12px;
  border-top: 1px solid var(--c-border-hairline);
}

.kv {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: var(--fs-sm);
}

.kv span {
  color: var(--c-text-2);
}

.kv b {
  font-weight: 500;
  display: inline-flex;
  align-items: center;
  gap: 5px;
}

.kv b.on {
  color: var(--c-primary);
}

.kv b.on .dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--c-primary);
  box-shadow: 0 0 6px var(--c-primary-glow);
}

.kv b.off {
  color: var(--c-accent);
}

.kv b.off .dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--c-accent);
  box-shadow: 0 0 6px var(--c-accent-glow);
}

@media (max-width: 600px) {
  .mode-opts {
    grid-template-columns: 1fr;
  }
}
</style>
