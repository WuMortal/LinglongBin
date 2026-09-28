<template>
  <div class="ob">
    <div class="bg-glow"></div>

    <!-- 右上角：外观主题（首屏即可选） -->
    <div class="theme-switch">
      <button class="ts-btn" :class="{ on: theme === 'light' }" title="浅色" @click="setTheme('light')">
        <Sun :size="15" style="display:inline-flex;flex-shrink:0" />
      </button>
      <button class="ts-btn" :class="{ on: theme === 'dark' }" title="深色" @click="setTheme('dark')">
        <Moon :size="15" style="display:inline-flex;flex-shrink:0" />
      </button>
      <button class="ts-btn" :class="{ on: theme === 'auto' }" title="跟随系统" @click="setTheme('auto')">
        <Palette :size="15" style="display:inline-flex;flex-shrink:0" />
      </button>
    </div>

    <div class="card">
      <!-- 步骤指示 -->
      <div class="steps">
        <span class="dot" :class="{ on: step === 0 }" />
        <span class="bar" :class="{ on: step >= 1 }" />
        <span class="dot" :class="{ on: step === 1 }" />
      </div>

      <!-- 步骤 1：存储模式 -->
      <section v-show="step === 0">
        <div class="brand">
          <div class="logo"><Box :size="26" style="display:inline-flex;flex-shrink:0" /></div>
          <h1>欢迎使用 玲珑 Bin</h1>
          <p class="sub">电子物料库存与 BOM 管理 · 请先选择数据存储方式</p>
        </div>

        <div class="mode-opts">
          <button class="mode-opt" :class="{ on: mode === 'sqlite' }" @click="mode = 'sqlite'">
            <div class="mode-ico"><HardDrive :size="18" style="display:inline-flex;flex-shrink:0" /></div>
            <div class="mode-txt">
              <b>离线模式</b>
              <small>数据存本地 SQLite，无需登录，隐私更好</small>
            </div>
            <Check v-if="mode === 'sqlite'" :size="14" class="ck" style="display:inline-flex;flex-shrink:0" />
          </button>
          <button class="mode-opt" :class="{ on: mode === 'supabase' }" @click="mode = 'supabase'">
            <div class="mode-ico"><Cloud :size="18" style="display:inline-flex;flex-shrink:0" /></div>
            <div class="mode-txt">
              <b>在线模式</b>
              <small>Supabase 云端同步，需填写地址并登录</small>
            </div>
            <Check v-if="mode === 'supabase'" :size="14" class="ck" style="display:inline-flex;flex-shrink:0" />
          </button>
        </div>

        <div v-if="mode === 'supabase'" class="supa-form">
          <label class="field">
            <span class="lbl">Supabase URL</span>
            <input v-model="supaUrl" type="text" placeholder="https://xxxx.supabase.co" autocomplete="off" />
          </label>
          <label class="field">
            <span class="lbl">Anon Key</span>
            <input v-model="supaAnon" type="password" placeholder="eyJhbGciOi..." autocomplete="off" />
          </label>
          <p class="supa-status" :class="supaStatus">
            <span class="spin" v-if="supaStatus === 'checking'" />
            <CircleCheck v-else-if="supaStatus === 'ok'" :size="13" style="display:inline-flex;flex-shrink:0" />
            <CircleAlert v-else-if="supaStatus === 'err'" :size="13" style="display:inline-flex;flex-shrink:0" />
            {{ supaStatusText }}
          </p>
        </div>

        <div class="actions">
          <button class="btn btn-primary next" :disabled="!canNext || validating" @click="nextFromA">
            {{ validating ? '校验中…' : '下一步' }}
          </button>
        </div>
      </section>

      <!-- 步骤 2：数据初始化 -->
      <section v-show="step === 1">
        <div class="brand">
          <h2>初始化你的数据</h2>
          <p class="sub">可选择一键建立常用分类，或从已有备份恢复</p>
        </div>

        <label class="opt-row">
          <input type="checkbox" v-model="importLcsc" :disabled="backupImported" />
          <div class="opt-txt">
            <b>导入立创分类</b>
            <small>一键建立大类 / 小类与参数模板（可稍后在分类管理重试）</small>
          </div>
        </label>

        <button class="backup-btn" :disabled="backupImporting" @click="pickBackup">
          <Download :size="14" style="display:inline-flex;flex-shrink:0" />
          {{ backupImported ? '备份已就绪，将以备份启动' : (backupImporting ? '导入中…' : '从已有备份恢复 (.db)') }}
        </button>

        <div v-if="importing" class="import-progress">
          <div class="bar-bg"><div class="bar-fill" :style="{ width: importPct + '%' }" /></div>
          <small>{{ importText }}</small>
        </div>

        <p v-if="mode === 'supabase'" class="login-hint">
          <CircleAlert :size="13" style="display:inline-flex;flex-shrink:0" />
          在线模式需要账号，初始化完成将进入登录页（还没有可先去注册）
        </p>

        <div class="actions row">
          <button class="btn btn-ghost" :disabled="finishing || importing" @click="step = 0">上一步</button>
          <button class="btn btn-primary" :disabled="finishing || importing" @click="finish">
            {{ finishing ? '正在完成…' : '开始使用' }}
          </button>
        </div>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onUnmounted } from 'vue'
import { Sun, Moon, Palette, Box, HardDrive, Cloud, Check, Download, CircleCheck, CircleAlert } from 'lucide-vue-next'
import { useTheme } from '../composables/useTheme'
import { validateSupabase } from '../lib/supabaseValidate'
import { importLcscCategories, type ImportProgress } from '../lib/db'
import { setAppSettings, setSetupDone } from '../lib/appSettings'
import { resetStore } from '../lib/storage'
import { resetSupabaseClient } from '../lib/supabase'
import { invoke } from '@tauri-apps/api/core'
import { open } from '@tauri-apps/plugin-dialog'
import { useToast } from '../composables/toast'

const { theme, setTheme } = useTheme()
const toast = useToast()

const step = ref(0)
const mode = ref<'sqlite' | 'supabase'>('sqlite')

const supaUrl = ref('')
const supaAnon = ref('')
const supaStatus = ref<'idle' | 'checking' | 'ok' | 'err'>('idle')
const validating = ref(false)
const supaStatusText = computed(() => {
  switch (supaStatus.value) {
    case 'checking': return '正在校验连接…'
    case 'ok': return '连接可用'
    case 'err': return 'URL 或 Anon Key 无效'
    default: return '填写后将自动校验'
  }
})
const canNext = computed(() => mode.value === 'sqlite' || supaStatus.value === 'ok')

let timer: number | undefined
function scheduleValidate() {
  if (mode.value !== 'supabase') return
  supaStatus.value = 'checking'
  validating.value = true
  clearTimeout(timer)
  timer = window.setTimeout(async () => {
    const ok = await validateSupabase(supaUrl.value.trim(), supaAnon.value.trim())
    supaStatus.value = ok ? 'ok' : 'err'
    validating.value = false
  }, 500)
}
watch([supaUrl, supaAnon], scheduleValidate)
watch(mode, (m) => { if (m === 'supabase') scheduleValidate() })
onUnmounted(() => clearTimeout(timer))

async function nextFromA() {
  if (!canNext.value) return
  if (mode.value === 'supabase') {
    validating.value = true
    const ok = await validateSupabase(supaUrl.value.trim(), supaAnon.value.trim())
    validating.value = false
    if (!ok) { supaStatus.value = 'err'; return }
  }
  step.value = 1
}

const importLcsc = ref(true)
const importing = ref(false)
const importPct = ref(0)
const importText = ref('')
const backupImporting = ref(false)
const backupImported = ref(false)
const finishing = ref(false)

function onProgress(p: ImportProgress) {
  importText.value = p.phase === 'done'
    ? '导入完成'
    : p.phase === 'prepare'
      ? '准备中…'
      : `正在导入 ${p.majorName} / ${p.minorName}`
  importPct.value = p.minorTotal ? Math.round((p.minorDone / p.minorTotal) * 100) : (p.phase === 'prepare' ? 5 : 50)
}

async function pickBackup() {
  if (backupImporting.value) return
  const src = await open({ multiple: false, filters: [{ name: 'SQLite Database', extensions: ['db', 'sqlite'] }] })
  if (!src || typeof src !== 'string') return
  backupImporting.value = true
  try {
    await invoke('import_db', { sourcePath: src })
    backupImported.value = true
    importLcsc.value = false
    toast.success('备份已导入，将以该数据启动')
  } catch (e) {
    toast.error('导入失败：' + (e as Error).message)
  } finally {
    backupImporting.value = false
  }
}

async function finish() {
  if (finishing.value) return
  finishing.value = true
  try {
    await setAppSettings({
      mode: mode.value,
      supabaseUrl: supaUrl.value.trim(),
      supabaseAnonKey: supaAnon.value.trim(),
    })
    // 让存储单例按新配置重建，确保后续导入落到正确存储
    resetStore()
    resetSupabaseClient()

    if (importLcsc.value && !backupImported.value) {
      importing.value = true
      try {
        await importLcscCategories(onProgress)
      } catch (e) {
        toast.error('立创分类导入失败，可稍后在「分类管理」重试：' + (e as Error).message)
      } finally {
        importing.value = false
      }
    }

    await setSetupDone(true)
    location.reload()
  } catch (e) {
    toast.error('初始化失败：' + (e as Error).message)
    finishing.value = false
  }
}
</script>

<style scoped>
.ob {
  height: 100%;
  display: grid;
  place-items: center;
  padding: 24px;
  position: relative;
  overflow: hidden;
}
.bg-glow {
  position: absolute; inset: -20%;
  background:
    radial-gradient(ellipse 600px 400px at 30% 20%, rgba(79,140,255,0.15), transparent),
    radial-gradient(ellipse 500px 500px at 70% 70%, rgba(52,218,191,0.12), transparent);
  pointer-events: none;
}
.theme-switch {
  position: absolute; top: 18px; right: 18px; z-index: 2;
  display: flex; gap: 6px;
  background: var(--c-glass); padding: 4px; border-radius: var(--r-lg);
  border: 1px solid var(--c-border);
}
.ts-btn {
  width: 30px; height: 30px; border-radius: var(--r-md);
  display: grid; place-items: center; border: 1px solid transparent;
  background: transparent; color: var(--c-text-2); cursor: pointer;
}
.ts-btn:hover { color: var(--c-text); background: var(--c-surface); }
.ts-btn.on { color: #fff; background: var(--c-primary); border-color: var(--c-primary); }

.card {
  position: relative; width: 100%; max-width: 460px;
  background: var(--c-glass-strong); border: 1px solid var(--c-border);
  border-radius: var(--r-2xl); backdrop-filter: blur(32px);
  -webkit-backdrop-filter: blur(32px); padding: 28px; box-shadow: var(--shadow-lg);
}
.steps { display: flex; align-items: center; gap: 8px; margin-bottom: 22px; }
.steps .dot { width: 9px; height: 9px; border-radius: 50%; background: var(--c-border-strong); transition: all var(--motion-fast); }
.steps .dot.on { background: var(--c-primary); box-shadow: 0 0 8px var(--c-primary-glow); }
.steps .bar { flex: 1; height: 2px; background: var(--c-border-hairline); border-radius: 2px; }
.steps .bar.on { background: var(--c-primary); }

.brand { text-align: center; margin-bottom: 20px; }
.logo {
  width: 52px; height: 52px; border-radius: var(--r-lg); color: #fff;
  background: var(--grad-brand); display: grid; place-items: center;
  margin: 0 auto 14px; box-shadow: 0 6px 24px var(--c-primary-glow);
}
.brand h1 { margin: 0; font-size: var(--fs-xl); font-weight: 700; letter-spacing: -0.02em; }
.brand h2 { margin: 0; font-size: var(--fs-lg); font-weight: 700; }
.sub { margin: 6px 0 0; color: var(--c-text-2); font-size: var(--fs-sm); }

.mode-opts { display: grid; gap: 10px; }
.mode-opt {
  position: relative; display: flex; align-items: center; gap: 12px;
  padding: 12px 14px; border-radius: var(--r-md); border: 2px solid var(--c-border);
  background: var(--c-glass); cursor: pointer; transition: all var(--motion-fast); text-align: left;
}
.mode-opt:hover { background: var(--c-surface-hover); border-color: var(--c-border-strong); }
.mode-opt.on { border-color: var(--c-primary); background: rgba(79,140,255,0.08); }
.mode-ico { width: 36px; height: 36px; border-radius: var(--r-sm); flex-shrink: 0; background: var(--c-surface); color: var(--c-text-2); display: grid; place-items: center; }
.mode-opt.on .mode-ico { background: var(--c-primary-soft); color: var(--c-primary); }
.mode-txt { display: flex; flex-direction: column; gap: 2px; min-width: 0; flex: 1; }
.mode-txt b { font-size: var(--fs-md); font-weight: 600; color: var(--c-text); }
.mode-txt small { font-size: var(--fs-xs); color: var(--c-text-2); }
.mode-opt .ck { color: var(--c-primary); flex-shrink: 0; }

.supa-form { display: flex; flex-direction: column; gap: 10px; margin-top: 12px; padding: 12px; background: var(--c-glass); border-radius: var(--r-md); border: 1px dashed var(--c-border); }
.supa-form .field { display: flex; flex-direction: column; gap: 4px; }
.supa-form .lbl { font-size: var(--fs-xs); color: var(--c-text-2); font-weight: 500; }
.supa-form input { width: 100%; height: var(--ctrl-h); padding: 0 var(--ctrl-px); font-size: var(--fs-xs); background: var(--c-surface); border: 1px solid var(--c-border); border-radius: var(--r-sm); color: var(--c-text); }
.supa-form input:focus { outline: none; border-color: var(--c-primary); background: var(--c-bg-2); }
.supa-status { display: flex; align-items: center; gap: 6px; margin: 0; font-size: var(--fs-xs); color: var(--c-text-2); }
.supa-status.ok { color: var(--c-success); }
.supa-status.err { color: var(--c-danger); }
.spin { width: 12px; height: 12px; border: 2px solid rgba(125,125,125,0.3); border-top-color: var(--c-primary); border-radius: 50%; animation: spin 0.7s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }

.actions { display: flex; justify-content: flex-end; margin-top: 18px; }
.actions.row { justify-content: space-between; }
.next, .actions .btn-primary { height: var(--ctrl-h-lg); padding: 0 22px; font-weight: 600; }
.actions .btn-ghost { height: var(--ctrl-h-lg); padding: 0 18px; }

.opt-row { display: flex; align-items: flex-start; gap: 10px; padding: 12px; border-radius: var(--r-md); background: var(--c-glass); border: 1px solid var(--c-border); cursor: pointer; }
.opt-row input { width: 18px; height: 18px; margin-top: 2px; accent-color: var(--c-primary); cursor: pointer; }
.opt-txt b { font-size: var(--fs-sm); color: var(--c-text); }
.opt-txt small { display: block; font-size: var(--fs-xs); color: var(--c-text-2); margin-top: 2px; }

.backup-btn { display: inline-flex; align-items: center; gap: 6px; margin-top: 10px; height: var(--ctrl-h); padding: 0 14px; border-radius: var(--r-sm); background: var(--c-surface); border: 1px solid var(--c-border); color: var(--c-text-2); font-size: var(--fs-xs); cursor: pointer; }
.backup-btn:hover { color: var(--c-primary); border-color: var(--c-primary); }

.import-progress { margin-top: 12px; display: flex; flex-direction: column; gap: 6px; }
.bar-bg { height: 6px; border-radius: 3px; background: var(--c-surface); overflow: hidden; }
.bar-fill { height: 100%; background: var(--c-primary); border-radius: 3px; transition: width 0.2s ease; }
.import-progress small { font-size: var(--fs-xs); color: var(--c-text-2); }

.login-hint { display: flex; align-items: center; gap: 6px; margin: 12px 0 0; padding: 10px 12px; border-radius: var(--r-md); background: rgba(79,140,255,0.08); color: var(--c-primary); font-size: var(--fs-xs); }
</style>
