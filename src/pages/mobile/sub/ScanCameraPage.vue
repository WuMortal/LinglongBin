<script setup lang="ts">
// 扫码相机页：作为 /m/stock/scan-in 的嵌套子路由，全屏覆盖在父页之上。
// 系统返回键会回到父页（已扫列表），而不是退出整个入库流程。
// ScanCamera 自身已是全屏组件（fixed + z-index），这里只负责把扫描事件
// 与统计文本回传给父页通过 provide 注入的处理函数 / 数据。
import { inject } from 'vue'
import ScanCamera from '../../../components/mobile/ScanCamera.vue'

const onDetected = inject<(code: string) => void>('scan:detected')!
const onError = inject<(msg: string) => void>('scan:error')!
const onClose = inject<() => void>('scan:close')!
// 父页提供的统计文本（匹配/待新建件数），由 ScanCamera 拼上内部「已扫码 n 次」
const stat = inject<string>('scan:stat', '')
</script>

<template>
  <ScanCamera :stat="stat" @detected="onDetected" @close="onClose" @error="onError" />
</template>
