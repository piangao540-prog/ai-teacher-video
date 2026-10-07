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
/*
  深色底，和 CodeTyping / Terminal 用的是同一个 #0d1117。

  ★ 为什么不用白底：一个片子里「要点」是白的、「代码」是深的，切来切去
    眼睛每换一个场景都要重新适应一次；而且开场那一两秒标题还没淡入，
    白底就是**一整屏纯白** —— 观感上像没加载出来。

  ★ 这里加的东西全部是**静态**的：底色、标题下划线、列表圆点颜色，
    没有一个随 t 变。这是刻意的，不是顺手 ——
    画面上任何随时间变化的量都必须写进 sceneState.ts，
    否则渲染器的复用判据看不见它，会把正在变的帧当成静态帧复制，
    画面就卡住了。纯静态的样式加多少都不会碰到那条线。
*/
.slide {
  position: relative;
  box-sizing: border-box;
  width: 100%;
  height: 100%;
  padding: 110px 140px;
  background: #0d1117;
  color: #e6edf3;
}
h1 {
  font-size: 88px;
  line-height: 1.2;
  /*
    ★ 这个 36 不是随便定的：::after 的 margin-top(30) + 横线高度(6) + 这个 36
      = 72 —— 和「加下划线之前」一个字不差。
      因为幻灯片已经贴着画框上限了（20 字标题折两行 + 6 条要点的最坏情况
      算下来 1086px > 1080px，本来就超 6px），
      下划线占的地方必须从原来那 72px 里抠，不能再往外吃。
  */
  margin: 0 0 36px;
}
/* 标题下的一条短横线：给深色画面一个视觉锚点，不然纯底 + 白字会发空 */
h1::after {
  content: '';
  display: block;
  width: 128px;
  height: 6px;
  margin-top: 30px;
  border-radius: 3px;
  background: #3fb950;
}
ul {
  margin: 0;
  padding-left: 56px;
}
li {
  font-size: 54px;
  line-height: 1.8;
  color: #c9d1d9;
}
/* 列表圆点默认跟着 li 的 color（#c9d1d9），在深底上太抢眼。
   调成和标题下划线同一个绿，一眼能认出是同一套 */
li::marker {
  color: #3fb950;
}
</style>