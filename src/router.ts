import { createRouter, createWebHashHistory } from 'vue-router'
import type { RouteRecordRaw } from 'vue-router'
import Login from './pages/Login.vue'
import { isSetupDone } from './lib/appSettings'
import { getAuthState, authRequired } from './lib/auth'

declare module 'vue-router' {
  interface RouteMeta {
    title?: string
    icon?: string
    /** 是否在侧边栏导航中隐藏（仍可通过路由跳转访问） */
    hidden?: boolean
    /** 隐藏子页面归属的菜单路径，用于侧栏高亮（如 /categories → /settings） */
    activeMenu?: string
  }
}

export const routes: RouteRecordRaw[] = [
  { path: '/', name: 'home', component: () => import('./pages/Home.vue'), meta: { title: '物料库', icon: 'grid' } },
  {
    path: '/stock',
    name: 'stock',
    component: () => import('./pages/Stock.vue'),
    meta: { title: '库存中心', icon: 'box' },
    children: [
      { path: '', name: 'stock-list', component: () => import('./pages/stock/StockList.vue'), meta: { title: '库存列表' } },
      { path: 'logs', name: 'stock-logs', component: () => import('./pages/stock/StockLogs.vue'), meta: { title: '出入库记录' } },
      { path: 'purchase', name: 'stock-purchase', component: () => import('./pages/stock/StockPurchase.vue'), meta: { title: '待采单' } },
      { path: 'import', name: 'stock-import', component: () => import('./pages/stock/StockImport.vue'), meta: { title: '导入入库' } },
      { path: 'take', name: 'stock-take', component: () => import('./pages/stock/StockTake.vue') },
    ],
  },
  // 工具：菜单页本身只有模块卡片，各功能是独立页面（hidden + activeMenu 归到「工具」高亮）
  { path: '/tools', name: 'tools', component: () => import('./pages/Tools.vue'), meta: { title: '工具', icon: 'wrench' } },
  {
    path: '/tools/labels',
    name: 'tools-labels',
    component: () => import('./pages/tools/LabelTemplates.vue'),
    meta: { title: '标签模板', hidden: true, activeMenu: '/tools' },
  },
  {
    path: '/tools/print',
    name: 'tools-print',
    component: () => import('./pages/tools/LabelPrint.vue'),
    meta: { title: '标签打印', hidden: true, activeMenu: '/tools' },
  },
  { path: '/bom', name: 'bom', component: () => import('./pages/BOM.vue'), meta: { title: 'BOM 项目', icon: 'list' } },
  { path: '/stats', name: 'stats', component: () => import('./pages/Stats.vue'), meta: { title: '统计看板', icon: 'chart' } },
  { path: '/categories', name: 'categories', component: () => import('./pages/Categories.vue'), meta: { title: '分类管理', icon: 'folder', hidden: true } },
  { path: '/suppliers', name: 'suppliers', component: () => import('./pages/Suppliers.vue'), meta: { title: '供应商管理', icon: 'truck', hidden: true } },
  // { path: '/scan', name: 'scan', component: () => import('./pages/Scan.vue'), meta: { title: '扫码', icon: 'scan' } },
  { path: '/login', name: 'login', component: Login },
  { path: '/onboarding', name: 'onboarding', component: () => import('./pages/Onboarding.vue'), meta: { title: '初始化引导', hidden: true } },
]

// Tauri / 移动端 webview 用 hash 路由更稳，避免深链 404
const router = createRouter({ history: createWebHashHistory(), routes })
export default router

// 三层门控（按优先级）：
// 1) 未走完引导 → 仅放行 /onboarding，其余重定向过去（已走完再访问 /onboarding 则回首页）
// 2) 走完引导后，若在线模式需登录且未登录 → 仅放行 /login
// 3) 其余放行
router.beforeEach((to) => {
  const setupDone = isSetupDone()
  if (to.name === 'onboarding') return setupDone ? { name: 'home' } : true
  if (!setupDone) return { name: 'onboarding' }
  if (authRequired() && !getAuthState()) return to.name === 'login' ? true : { name: 'login' }
  return true
})
