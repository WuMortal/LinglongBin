import { ref } from 'vue'
import { check, type Update } from '@tauri-apps/plugin-updater'
import { relaunch } from '@tauri-apps/plugin-process'
import { getVersion } from '@tauri-apps/api/app'

export type UpdateStatus =
  | 'idle'
  | 'checking'
  | 'up-to-date'
  | 'available'
  | 'downloading'
  | 'installing'
  | 'error'

export interface UpdateProgress {
  downloaded: number
  contentLength: number
  percent: number
}

// 模块级单例状态（项目未引入 Pinia，直接用模块级 ref 实现全局共享）
const status = ref<UpdateStatus>('idle')
const errorMsg = ref('')
const currentVersion = ref('')
const updateInfo = ref<Update | null>(null)
const progress = ref<UpdateProgress>({ downloaded: 0, contentLength: 0, percent: 0 })

/** 加载当前版本号 */
async function loadCurrentVersion() {
  try {
    currentVersion.value = await getVersion()
  } catch (e) {
    console.error('获取当前版本失败:', e)
  }
}

/** 检查是否有可用更新（不自动下载） */
async function checkForUpdate(): Promise<boolean> {
  status.value = 'checking'
  errorMsg.value = ''
  updateInfo.value = null
  progress.value = { downloaded: 0, contentLength: 0, percent: 0 }

  try {
    const update = await check()
    if (update) {
      updateInfo.value = update
      status.value = 'available'
      return true
    }
    status.value = 'up-to-date'
    return false
  } catch (e: any) {
    console.error('检查更新失败:', e)
    errorMsg.value = e?.message || String(e)
    status.value = 'error'
    return false
  }
}

/** 下载并安装更新，安装完成后自动重启以应用新版本 */
async function downloadAndInstall() {
  if (!updateInfo.value) {
    errorMsg.value = '没有可用的更新'
    status.value = 'error'
    return
  }

  status.value = 'downloading'
  errorMsg.value = ''

  try {
    let downloaded = 0
    let contentLength = 0

    await updateInfo.value.downloadAndInstall((event) => {
      switch (event.event) {
        case 'Started':
          contentLength = event.data.contentLength ?? 0
          progress.value = { downloaded: 0, contentLength, percent: 0 }
          break
        case 'Progress':
          downloaded += event.data.chunkLength
          progress.value = {
            downloaded,
            contentLength,
            percent: contentLength > 0 ? Math.round((downloaded / contentLength) * 100) : 0,
          }
          break
        case 'Finished':
          progress.value = { downloaded: contentLength, contentLength, percent: 100 }
          status.value = 'installing'
          break
      }
    })

    // 安装完成，重启应用以切换到新版本
    await relaunch()
  } catch (e: any) {
    console.error('下载安装更新失败:', e)
    errorMsg.value = e?.message || String(e)
    status.value = 'error'
  }
}

/** 重置状态 */
function reset() {
  status.value = 'idle'
  errorMsg.value = ''
  updateInfo.value = null
  progress.value = { downloaded: 0, contentLength: 0, percent: 0 }
}

export function useUpdaterStore() {
  return {
    status,
    errorMsg,
    currentVersion,
    updateInfo,
    progress,
    loadCurrentVersion,
    checkForUpdate,
    downloadAndInstall,
    reset,
  }
}
