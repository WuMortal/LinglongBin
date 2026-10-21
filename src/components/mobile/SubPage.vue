<template>
  <section class="subpage" :class="{ bare }">
    <!-- 吸顶返回栏（通用组件，右侧可塞操作按钮） -->
    <NavBar :title="title">
      <template #extra><slot name="extra" /></template>
    </NavBar>
    <div class="sub-body">
      <slot />
    </div>
  </section>
</template>

<script setup lang="ts">
import NavBar from './NavBar.vue'

/**
 * 移动端 bare 子页壳（宫格/列表点进来的二级页）：
 * 吸顶返回栏 + 内容区，内容复用桌面页面组件。
 * 标题栏右侧可通过 #extra 插槽放操作按钮。
 * bare=true 时去掉内容区那层表面卡片背景/描边/圆角，让内容直接贴在页面底上。
 */
defineProps<{ title: string; bare?: boolean }>()
</script>

<style scoped>
.subpage {
  display: flex;
  flex-direction: column;
  min-height: 100%;
}

/* 卡片容器：桌面的 .tab 页面自身没有背景/描边/圆角，靠 Stock.vue 的 .main.card 提供；
   移动端没有这一层，这里补上，保证与物料详情、统计等移动页同一套卡片语言。
   注意不给 padding —— 子页面（.filters / .po-bar / .take-bar）自带内边距，
   加 padding 会和子页面的 16px 叠成双层内缩。 */
.sub-body {
  flex: 1;
  min-height: 0;
  margin-top: 12px;
  display: flex;
  flex-direction: column;
  background: var(--c-surface);
  border: 1px solid var(--c-border);
  border-radius: var(--r-xl);
  overflow: hidden;
}

/* bare：去掉内容区表面卡片，直接融进页面深色底 */
.subpage.bare .sub-body {
  background: transparent;
  border: none;
  border-radius: 0;
}
</style>
