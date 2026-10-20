import { createRouter, createWebHashHistory } from 'vue-router'
import type { RouteRecordRaw } from 'vue-router'
import Login from './pages/Login.vue'
import { isSetupDone } from './lib/appSettings'
import { getAuthState, authRequired } from './lib/auth'
import { getPlatformSync } from './lib/platform'

declare module 'vue-router' {
  interface RouteMeta {
    title?: string
    icon?: string
    /** 是否在侧边栏导航中隐藏（仍可通过路由跳转访问） */
    hidden?: boolean
    /** 隐藏子页面归属的菜单路径，用于侧栏高亮（如 /categories → /settings） */
    activeMenu?: string
    /** 移动端路由（/m 组），MobileShell tabbar 导航使用 */
    mobile?: boolean
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

/**
 * 移动端路由组（/m 前缀）：MobileShell tabbar 导航专用。
 * P1 阶段组件暂复用桌面页面（已有响应式适配），P2 逐页替换为专属移动页面；
 * 桌面路由零波及，守卫会把移动端的桌面路径自动镜像到 /m 前缀。
 */
export const mobileRoutes: RouteRecordRaw[] = [
  { path: '/m', redirect: '/m/home' },
  { path: '/m/home', name: 'm-home', component: () => import('./pages/Home.vue'), meta: { title: '物料库', icon: 'grid', mobile: true } },
  {
    path: '/m/stock',
    name: 'm-stock',
    component: () => import('./pages/Stock.vue'),
    meta: { title: '库存', icon: 'box', mobile: true },
    children: [
      { path: '', name: 'm-stock-list', component: () => import('./pages/stock/StockList.vue'), meta: { title: '库存列表', mobile: true } },
      { path: 'logs', name: 'm-stock-logs', component: () => import('./pages/stock/StockLogs.vue'), meta: { title: '出入库记录', mobile: true } },
      { path: 'purchase', name: 'm-stock-purchase', component: () => import('./pages/stock/StockPurchase.vue'), meta: { title: '待采单', mobile: true } },
      { path: 'import', name: 'm-stock-import', component: () => import('./pages/stock/StockImport.vue'), meta: { title: '导入入库', mobile: true } },
      { path: 'take', name: 'm-stock-take', component: () => import('./pages/stock/StockTake.vue'), meta: { title: '盘点', mobile: true } },
    ],
  },
  { path: '/m/tools', name: 'm-tools', component: () => import('./pages/Tools.vue'), meta: { title: '工具', icon: 'wrench', mobile: true } },
  { path: '/m/bom', name: 'm-bom', component: () => import('./pages/BOM.vue'), meta: { title: 'BOM 项目', icon: 'list', mobile: true } },
  { path: '/m/stats', name: 'm-stats', component: () => import('./pages/Stats.vue'), meta: { title: '统计看板', icon: 'chart', mobile: true } },
]

// Tauri / 移动端 webview 用 hash 路由更稳，避免深链 404
const router = createRouter({ history: createWebHashHistory(), routes: [...routes, ...mobileRoutes] })
export default router

// 三层门控（按优先级）：
// 1) 未走完引导 → 仅放行 /onboarding，其余重定向过去（已走完再访问 /onboarding 则回首页）
// 2) 走完引导后，若在线模式需登录且未登录 → 仅放行 /login
// 3) 移动端：非 /m 前缀的桌面路径自动镜像到 /m 前缀（onboarding/login 裸页面除外）
// 4) 其余放行
router.beforeEach((to) => {
  const setupDone = isSetupDone()
  if (to.name === 'onboarding') return setupDone ? { name: 'home' } : true
  if (!setupDone) return { name: 'onboarding' }
  if (authRequired() && !getAuthState()) return to.name === 'login' ? true : { name: 'login' }
  if (getPlatformSync().kind === 'mobile' && !to.path.startsWith('/m')) {
    return { path: '/m' + (to.path === '/' ? '/home' : to.path) }
  }
  return true
})
