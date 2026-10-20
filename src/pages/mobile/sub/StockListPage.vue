<template>
  <SubPage title="库存列表">
    <!-- KeepAlive 不能省：StockList 的首屏加载挂在 onActivated 上（桌面侧也是这么工作的），
         去掉后移动端不会触发，列表会一直空着 -->
    <KeepAlive>
      <StockList />
    </KeepAlive>
  </SubPage>
</template>

<script setup lang="ts">
import SubPage from '../../../components/mobile/SubPage.vue'
import StockList from '../../stock/StockList.vue'
</script>
