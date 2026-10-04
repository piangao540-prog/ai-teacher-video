<script setup lang="ts">
import { computed } from 'vue'
import { terminalStateAt, type TermLine } from './sceneState'

// 终端演示：命令逐字打出来，输出整行出现。
//
// 和 CodeTyping 的分工：CodeTyping 讲「代码长什么样」，
// Terminal 讲「把它跑起来会发生什么」。
//
// 所有视觉状态由 sceneState.ts 的 terminalStateAt 从 t 算出来 ——
// 渲染器判断「这一帧能不能复用上一帧」时调的是同一个函数，
// 所以判据不可能和实际画面不一致。

const props = defineProps<{
  t: number
  /** 窗口标题栏上的字 */
  title?: string
  /** 命令提示符 */
  prompt?: string
  lines: TermLine[]
}>()

const state = computed(() => terminalStateAt(props.t, props.lines))
</script>

<template>
  <div class="scene">
    <div class="window">
      <div class="titlebar">
        <span class="dot red"></span>
        <span class="dot yellow"></span>
        <span class="dot green"></span>
        <span class="title">{{ title ?? '终端' }}</span>
      </div>
      <div class="body">
        <!-- 所有行一直占着位置（只是内容还没打出来）——
             这样后面的行不会往上跳，视频里排版是稳的 -->
        <div v-for="(line, i) in lines" :key="i" class="line" :class="line.kind">
          <span v-if="line.kind === 'command'" class="prompt">{{ prompt ?? '$' }}</span>
          <span class="text">{{ line.text.slice(0, state.typed[i]) }}</span>
          <span v-if="i === state.typingLine && state.caret" class="caret">█</span>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.scene {
  box-sizing: border-box;
  width: 100%;
  height: 100%;
  padding: 70px 90px;
  background: #0d1117;
  font-family: ui-monospace, Consolas, monospace;
}
.window {
  box-sizing: border-box;
  height: 100%;
  display: flex;
  flex-direction: column;
  background: #161b22;
  border: 1px solid #30363d;
  border-radius: 14px;
  overflow: hidden;
}
.titlebar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 20px 28px;
  background: #21262d;
  border-bottom: 1px solid #30363d;
}
.dot {
  width: 16px;
  height: 16px;
  border-radius: 50%;
}
.red { background: #ff5f56; }
.yellow { background: #ffbd2e; }
.green { background: #27c93f; }
.title {
  margin-left: 20px;
  font-size: 28px;
  color: #8b949e;
}
.body {
  flex: 1;
  padding: 48px 56px;
}
.line {
  font-size: 40px;
  line-height: 1.75;
  white-space: pre;
}
.prompt {
  margin-right: 22px;
  color: #3fb950;
  font-weight: bold;
}
/* 命令是你敲进去的，亮一些 */
.line.command .text {
  color: #e6edf3;
}
/* 输出是程序吐出来的，暗一些 */
.line.output .text {
  color: #8b949e;
}
.caret {
  color: #58a6ff;
}
</style>
