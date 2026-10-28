<template>
  <OnboardingPage v-if="route.name === 'onboarding'" />
  <LoginPage v-else-if="route.name === 'login'" />
  <DesktopShell v-else-if="isDesktop">
    <router-view v-slot="{ Component, route: r }">
      <transition name="page" mode="out-in">
        <component :is="Component" :key="r.matched[0]?.path || r.path" />
      </transition>
    </router-view>
  </DesktopShell>
  <MobileShell v-else>
    <router-view v-slot="{ Component, route: r }">
      <transition name="page" mode="out-in">
        <!-- KeepAlive 必须在 Transition 内侧：进出场动画仍作用于页面本身 -->
        <KeepAlive :include="KEEP_ALIVE">
          <component :is="Component" :key="r.matched[0]?.path || r.path" />
        </KeepAlive>
      </transition>
    </router-view>
  </MobileShell>
  <Toast />
  <ConfirmDialog />
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { getPlatformSync } from './lib/platform'
import { setAuthState, onAuthChange } from './lib/auth'
import { installKeyboardAvoid } from './composables/useKeyboardAvoid'
import DesktopShell from './shells/DesktopShell.vue'
import MobileShell from './shells/MobileShell.vue'
import OnboardingPage from './pages/Onboarding.vue'
import LoginPage from './pages/Login.vue'
import Toast from './components/Toast.vue'
import ConfirmDialog from './components/ConfirmDialog.vue'

const route = useRoute()

const isDesktop = ref(getPlatformSync().kind === 'desktop')

/**
 * 需要缓存的移动端页面（组件名，须与页面里的 defineOptions({ name }) 一致）。
 * 从详情页返回时保留搜索/筛选等本地状态，不重新走一遍生命周期。
 * 只缓存列表页：详情页（如 /m/material/:id）一旦被缓存，切到另一个物料时
 * 不会重新挂载，会停留在上一个物料的数据。
 * 注意：被缓存页的 onMounted 在返回时不会重跑，数据刷新统一写在 onActivated。
 */
const KEEP_ALIVE = ['Materials']

onMounted(() => {
  // 登录态由路由守卫统一门控，这里仅同步模块级状态以便守卫读取
  onAuthChange((_e: unknown, session: unknown) => setAuthState(!!session))
  // 全局键盘避让：聚焦输入框时自动滚出键盘区（edge-to-edge 下原生 adjustResize 不生效）
  installKeyboardAvoid()
})
</script>
