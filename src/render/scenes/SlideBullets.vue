<script setup lang="ts">
import { computed } from 'vue'
import { slideStateAt } from './sceneState'

const props = defineProps<{
  t: number
  title: string
  titleAtMs: number
  bullets: Array<{ text: string; atMs: number }>
}>()

// 本帧全部透明度，从 t 算出来。
// 「减掉开始时间、除以耗时、夹到 0~1」这套算法住在 sceneState.ts 里，
// 渲染器和复用判据共用同一份 —— 不碰 setTimeout、不碰 CSS transition，
// 所以画面在任意时刻都可复现。
const state = computed(() => slideStateAt(props.t, props))
</script>

<template>
  <div class="slide">
    <h1 :style="{ opacity: state.titleOpacity }">{{ title }}</h1>
    <ul>
      <li v-for="(b, i) in bullets" :key="i" :style="{ opacity: state.bulletOpacity[i] }">
        {{ b.text }}
      </li>
    </ul>
  </div>
</template>

<style scoped>
.slide {
  position: relative;
  box-sizing: border-box;
  width: 100%;
  height: 100%;
  padding: 110px 140px;
  background: #fff;
  color: #111;
}
h1 {
  font-size: 88px;
  line-height: 1.2;
  margin: 0 0 72px;
}
ul {
  margin: 0;
  padding-left: 56px;
}
li {
  font-size: 54px;
  line-height: 1.8;
}
</style>