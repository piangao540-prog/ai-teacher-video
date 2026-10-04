<script setup lang="ts">
import { computed } from 'vue'

// 字幕层。它和场景一样，是**时间的纯函数**：给一个 t，就能算出该显示哪条字幕。
// 没有定时器、没有过渡动画 —— 所以逐帧渲染出来的每一帧都可复现。
//
// 它挂在 Stage 里、场景之上：字幕不属于任何一个场景，
// 它跟着配音走，跨场景连续。

type Cue = { i: number; startMs: number; endMs: number; text: string; lines: string[] }

/**
 * 字幕外观。纯样式差异，不影响任何时间计算 ——
 * 所以预览看到的和出片烧进去的必然一致。
 *
 *   pill     深色胶囊 + 细描边（★ 默认，明暗底都最稳）
 *   box      半透明圆角底板，比 pill 轻
 *   glass    毛玻璃半透明底板（现代感）
 *   bar      贴底通栏渐变黑条（自媒体感）
 *
 * ★ 为什么没有「无底板白字描边」那一版：试过了，在白底幻灯片上
 *   白字彻底糊掉、不可读。这个项目的场景一会儿白底一会儿深底，
 *   所以字幕底板必须是**自带对比度**的，不能指望底下的画面配合。
 */
export type SubtitleVariant = 'pill' | 'box' | 'glass' | 'bar'

const props = withDefaults(
  defineProps<{
    t: number
    cues: Cue[]
    variant?: SubtitleVariant
  }>(),
  { variant: 'pill' },
)

// 命中当前时刻的那条字幕。
// 线性扫一遍就够 —— 一集只有几十条，每条一次比较。
const active = computed<Cue | null>(() => {
  for (const c of props.cues) {
    if (props.t >= c.startMs && props.t < c.endMs) return c
  }
  return null
})

// 淡入：只在前 120ms 里做，够顺眼又不会拖
const FADE_MS = 120
const opacity = computed(() => {
  const c = active.value
  if (!c) return 0
  return Math.max(0, Math.min((props.t - c.startMs) / FADE_MS, 1))
})

const lines = computed(() => active.value?.lines ?? [])
</script>

<template>
  <div class="layer" :class="'v-' + variant">
    <div v-if="active" class="cue" :style="{ opacity }">
      <div v-for="(line, i) in lines" :key="i" class="line">{{ line }}</div>
    </div>
  </div>
</template>

<style scoped>
/* 铺满整帧，但自己不接收鼠标事件 —— 字幕绝不能挡住场景 */
.layer {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  padding-bottom: 64px;
  pointer-events: none;
  z-index: 10;
}

/* 三个方案共用的文字部分：字体、字号、行距、字重、位置、颜色 */
.cue {
  max-width: 1680px;
  box-sizing: border-box;
  font-family: system-ui, 'Microsoft YaHei', 'PingFang SC', sans-serif;
  font-size: 52px;
  line-height: 1.4;
  font-weight: 500;
  text-align: center;
  letter-spacing: 1px;
  /* 字幕颜色。想换色改这一处就够 —— 下面各方案不再单独覆盖 color */
  color: #ff69b4;
}

.line {
  white-space: pre-wrap;
}

/* ---------- box：半透明圆角底板（原来那一版） ---------- */
.v-box .cue {
  padding: 18px 40px;
  border-radius: 16px;
  background: rgba(0, 0, 0, 0.78);
  text-shadow: 0 2px 6px rgba(0, 0, 0, 0.6);
}

/* ---------- pill：深色胶囊 + 细描边 ----------
   和 box 是同一个思路，但更扎实：底板接近全黑（任何底色上都稳），
   圆角做成胶囊（= 行高的一半），再加一圈极淡白边勾出轮廓。
   代价是比 box「重」一点，好处是不管底下是白幻灯片还是深色代码都读得清。 */
.v-pill .cue {
  padding: 22px 52px;
  border-radius: 100px;
  background: rgba(0, 0, 0, 0.9);
  border: 1px solid rgba(255, 255, 255, 0.12);
  text-shadow: 0 1px 3px rgba(0, 0, 0, 0.8);
}

/* ---------- glass：毛玻璃半透明底板 ----------
   border 让浅色背景上也有个轮廓，否则玻璃会糊掉。 */
.v-glass .cue {
  padding: 20px 44px;
  border-radius: 22px;
  background: rgba(16, 18, 24, 0.62);
  border: 1px solid rgba(255, 255, 255, 0.16);
  backdrop-filter: blur(14px) saturate(1.2);
  -webkit-backdrop-filter: blur(14px) saturate(1.2);
  text-shadow: 0 2px 8px rgba(0, 0, 0, 0.55);
}

/* ---------- bar：贴底通栏渐变黑条 ----------
   铺满整个宽度，字幕从画面最底边往上排（这一版要覆盖 .layer 的留白）。 */
.v-bar {
  padding-bottom: 0;
}
.v-bar .cue {
  width: 100%;
  max-width: none;
  padding: 34px 90px 42px;
  border-radius: 0;
  background: linear-gradient(to top, rgba(0, 0, 0, 0.92) 0%, rgba(0, 0, 0, 0.72) 62%, rgba(0, 0, 0, 0) 100%);
  color: #ff69b4;
  text-shadow: 0 2px 8px rgba(0, 0, 0, 0.7);
}
</style>
