import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) }
  },
  // Tauri 偏好固定端口，且开发期关闭严格 CSP（由 Tauri 自身管理）
  clearScreen: false,
  server: { port: 1420, strictPort: true, host: false },
  build: {
    target: 'es2021',
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      output: {
        // 把体积大、更新频率低的第三方库拆成独立 vendor chunk，便于浏览器缓存；
        // 配合路由懒加载，echarts / 扫码 库只在进入对应页面时才下载。
        manualChunks(id: string) {
          if (id.includes('node_modules')) {
            if (id.includes('echarts') || id.includes('zrender')) return 'echarts'
            if (id.includes('html5-qrcode')) return 'scanner'
            if (id.includes('qrcode')) return 'qrcode'
            if (id.includes('@supabase')) return 'supabase'
            if (id.includes('/vue') || id.includes('@vue') || id.includes('vue-router')) return 'vue'
          }
        }
      }
    }
  }
})
