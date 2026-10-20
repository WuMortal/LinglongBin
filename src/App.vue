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
        <component :is="Component" :key="r.matched[0]?.path || r.path" />
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
import DesktopShell from './shells/DesktopShell.vue'
import MobileShell from './shells/MobileShell.vue'
import OnboardingPage from './pages/Onboarding.vue'
import LoginPage from './pages/Login.vue'
import Toast from './components/Toast.vue'
import ConfirmDialog from './components/ConfirmDialog.vue'

const route = useRoute()
// 同步探测：首帧即选中正确 Shell，避免移动端先闪桌面壳
const isDesktop = ref(getPlatformSync().kind === 'desktop')
// const isDesktop = ref(false)

onMounted(() => {
  // 登录态由路由守卫统一门控，这里仅同步模块级状态以便守卫读取
  onAuthChange((_e: unknown, session: unknown) => setAuthState(!!session))
})
</script>
