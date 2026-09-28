import { createApp } from 'vue'
import App from './App.vue'
import router from './router'
import { initAppSettings } from './lib/appSettings'
import { initAuth } from './lib/auth'
import { initTheme } from './composables/useTheme'
import './styles/tokens.css'
import './styles/global.css'

// 尽早应用主题，避免首屏闪烁（在 Vue 挂载前就设置 data-theme）
initTheme()

// 先加载本地 sys.db 中的配置、并解析登录态到内存，再挂载应用
// 这样路由守卫同步读取 getAppSettings()/getAuthState() 都能拿到正确值
initAppSettings()
  .catch(err => console.error('[appSettings] 初始化失败，使用默认配置启动', err))
  .finally(() => initAuth())
  .finally(() => {
    createApp(App).use(router).mount('#app')
  })
