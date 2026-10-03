<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  t: number
  title: string
  titleAtMs: number
  bullets: Array<{ text: string; atMs: number }>
}>()

// 淡入耗时，所有元素共用
const FADE_MS = 400

// 把「当前时间」换算成某个元素的 0~1 进度。
//
// 全部的秘密就在这一次减法和一次除法里：
//   - 减掉开始时间，得到「已经过了多久」
//   - 除以淡入耗时，得到 0~1
//   - 夹到 0~1，防止负数（还没到）和超过 1（已经完成）
//
// 不碰 setTimeout，不碰 CSS transition —— 所以画面在任意时刻都可复现。
function progress(startAtMs: number, fadeMs = FADE_MS): number {
  return Math.max(0, Math.min((props.t - startAtMs) / fadeMs, 1))
}

// 标题淡入慢一点，显得稳
const titleOpacity = computed(() => progress(props.titleAtMs, 600))
</script>

<template>
  <div class="slide">
    <h1 :style="{ opacity: titleOpacity }">{{ title }}</h1>
    <ul>
      <li v-for="(b, i) in bullets" :key="i" :style="{ opacity: progress(b.atMs) }">
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