<script setup lang="ts">
import { computed } from 'vue'
import { codeStateAt, type CodeLine } from './sceneState'
// 逐字打字 + 光标闪烁 + 当前行高亮。
// 这三个视觉状态全部由 sceneState.ts 的 codeStateAt 从 t 算出来 ——
// 渲染器判断「这一帧能不能复用上一帧」时调的是同一个函数，
// 所以判据不可能和实际画面不一致。

const props = defineProps<{
  t: number
  fileName: string
  lines: CodeLine[]
}>()

// 一帧的全部视觉状态，从 t 算出来
const state = computed(() => codeStateAt(props.t, props.lines))
</script>

<template>
  <div class="scene">
    <div class="window">
      <div class="titlebar">
        <span class="dot red"></span>
        <span class="dot yellow"></span>
        <span class="dot green"></span>
        <span class="filename">{{ fileName }}</span>
      </div>
      <div class="body">
        <div v-for="(line, i) in lines" :key="i" class="line"
             :class="{ active: state.activeLine === i }">
          <span class="gutter">{{ i + 1 }}</span>
          <span class="text">{{ line.code.slice(0, state.typed[i]) }}</span>
          <span v-if="state.activeLine === i && state.caret" class="caret">▌</span>
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
.filename {
  margin-left: 20px;
  font-size: 28px;
  color: #8b949e;
}
.body {
  flex: 1;
  padding: 48px 56px;
}
.line {
  font-size: 42px;
  line-height: 1.9;
  white-space: pre;
}
.line.active {
  background: #1c2431;
}
.gutter {
  display: inline-block;
  width: 90px;
  color: #484f58;
}
.text {
  color: #c9d1d9;
}
.caret {
  color: #ff69b4;
}
</style>