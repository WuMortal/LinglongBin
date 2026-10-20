<template>
  <section class="subpage">
    <!-- 吸顶返回栏：与 MaterialDetail 的 .nav 同款（负外边距吃掉 MobileShell .content 的 16px padding） -->
    <header class="nav">
      <button class="back" title="返回" @click="goBack">
        <ArrowLeft :size="20" style="display: inline-flex; flex-shrink: 0" />
      </button>
      <h1>{{ title }}</h1>
      <div class="nav-extra">
        <slot name="extra" />
      </div>
    </header>
    <div class="sub-body">
      <slot />
    </div>
  </section>
</template>

<script setup lang="ts">
import { useRouter } from 'vue-router'
import { ArrowLeft } from 'lucide-vue-next'

/**
 * 移动端 bare 子页壳（宫格/列表点进来的二级页）：
 * 吸顶返回栏 + 内容区，内容复用桌面页面组件。
 * 标题栏右侧可通过 #extra 插槽放操作按钮。
 */
defineProps<{ title: string }>()

const router = useRouter()

/** 返回：有历史回上一页，否则回工作台 */
function goBack() {
  if (window.history.length > 1) router.back()
  else router.replace('/m/home')
}
</script>

<style scoped>
.subpage {
  display: flex;
  flex-direction: column;
  min-height: 100%;
}

.nav {
  position: sticky;
  top: 0;
  z-index: 10;
  display: flex;
  align-items: center;
  gap: 10px;
  height: 48px;
  margin: -16px -16px 0;
  padding: 0 10px 0 8px;
  background: var(--c-bg);
  border-bottom: 1px solid var(--c-border-hairline);
}

.back {
  width: 36px;
  height: 36px;
  border: none;
  border-radius: 50%;
  background: transparent;
  color: var(--c-text);
  display: grid;
  place-items: center;
  cursor: pointer;
  flex-shrink: 0;
  -webkit-tap-highlight-color: transparent;
}

.back:active {
  background: var(--c-surface-hover);
}

.nav h1 {
  margin: 0;
  font-size: var(--fs-lg);
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.nav-extra {
  margin-left: auto;
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.sub-body {
  margin-top: 14px;
  display: flex;
  flex-direction: column;
  gap: 14px;
  flex: 1;
}
</style>
