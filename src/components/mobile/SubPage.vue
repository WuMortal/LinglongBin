<template>
  <section class="subpage">
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
 */
defineProps<{ title: string }>()
</script>

<style scoped>
.subpage {
  display: flex;
  flex-direction: column;
  min-height: 100%;
}

.sub-body {
  margin-top: 14px;
  display: flex;
  flex-direction: column;
  gap: 14px;
  flex: 1;
}
</style>
