<template>
  <section class="page">
    <header class="head">
      <div>
        <h1>工具</h1>
        <p>与库存主流程解耦的辅助模块</p>
      </div>
    </header>

    <div class="grid">
      <button v-for="m in modules" :key="m.path" class="mod-card" @click="open(m.path)">
        <span class="mod-ico">
          <component :is="m.icon" :size="24" style="display: inline-flex; flex-shrink: 0" />
        </span>
        <span class="mod-txt">
          <b>{{ m.label }}</b>
          <small>{{ m.desc }}</small>
        </span>
        <ChevronRight :size="16" class="mod-arrow" style="display: inline-flex; flex-shrink: 0" />
      </button>
    </div>
  </section>
</template>

<script setup lang="ts">
import { useRouter } from 'vue-router'
import { ChevronRight, LayoutTemplate, Printer } from 'lucide-vue-next'

const router = useRouter()

/** 工具模块注册表：新增模块 = 这里加一项 + router.ts 加一条 hidden 路由（activeMenu: '/tools'） */
const modules = [
  {
    path: '/tools/print',
    label: '标签打印',
    desc: '选物料套用模板批量打印标签',
    icon: Printer,
  },
  {
    path: '/tools/labels',
    label: '标签模板',
    desc: '配置标签纸尺寸、字段布局与打印排版',
    icon: LayoutTemplate,
  },
]

function open(path: string) { router.push(path) }
</script>

<style scoped>
.page {
  height: 100%;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.head h1 {
  margin: 0;
  font-size: var(--fs-xl);
  font-weight: 700;
  letter-spacing: -0.02em;
}

.head p {
  margin: 4px 0 0;
  color: var(--c-text-2);
  font-size: var(--fs-sm);
}

/* ===== 模块卡片 ===== */
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 12px;
  align-content: start;
}

.mod-card {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 16px;
  text-align: left;
  background: var(--c-surface);
  border: 1px solid var(--c-border);
  border-radius: var(--r-xl);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  transition: all var(--motion);
  color: inherit;
}

.mod-card:hover {
  background: var(--c-surface-hover);
  border-color: var(--c-border-strong);
  transform: translateY(-1px);
}

.mod-ico {
  width: 44px;
  height: 44px;
  flex-shrink: 0;
  border-radius: var(--r-md);
  display: grid;
  place-items: center;
  background: linear-gradient(135deg, rgba(79, 140, 255, 0.2), rgba(79, 140, 255, 0.08));
  color: #4F8CFF;
}

.mod-txt {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.mod-txt b {
  font-size: var(--fs-md);
  font-weight: 600;
}

.mod-txt small {
  font-size: var(--fs-xs);
  color: var(--c-text-3);
  line-height: 1.5;
}

.mod-arrow {
  color: var(--c-text-3);
  flex-shrink: 0;
}

.mod-card:hover .mod-arrow {
  color: var(--c-primary);
}
</style>
