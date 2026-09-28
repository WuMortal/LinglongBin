<template>
  <section class="page">
    <header class="head"><h2>{{ title }}</h2></header>
    <div class="card">
      <p class="hint">模块建设中。本页规划功能：</p>
      <ul>
        <li v-for="f in features" :key="f">{{ f }}</li>
      </ul>
    </div>
  </section>
</template>

<script setup lang="ts">
withDefaults(
  defineProps<{ title: string; features?: string[] }>(),
  { features: () => [] }
)
</script>

<style scoped>
.head h2 { margin: 0 0 16px; font-size: 22px; }
.card {
  background: var(--c-surface); border: 1px solid var(--c-border); border-radius: var(--r-lg);
  box-shadow: var(--shadow-1); padding: 20px 22px;
}
.hint { color: var(--c-text-2); margin: 0 0 8px; font-size: 14px; }
li { color: var(--c-text-2); line-height: 1.9; font-size: 14px; }
</style>
