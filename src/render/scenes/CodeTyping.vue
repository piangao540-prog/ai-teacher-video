<script setup lang="ts">
import { computed } from 'vue'

// ============================================================
//  ★ 占位版：每行只在对应的时间点出现（淡入）。
//    完整的「逐字打字 + 光标 + 当前行高亮」由你来写。
// ============================================================

const props = defineProps<{
  t: number
  fileName: string
  lines: Array<{ code: string; atMs: number }>
}>()

// 每个字打出来的耗时
const CHAR_MS = 45
// 贯标闪烁周期
const BLINK_MS = 530

/**
 * @param i 行下标
 * @returns 当前这一行应该展示多少字符
 */

 function typedChars(i: number):number{
  const line = props.lines[i]!
  // 当前时间减去这一行开始的时间
  const elapsed = props.t - line.atMs
  if(elapsed <= 0) return 0
  return Math.min(Math.floor(elapsed / CHAR_MS), line.code.length)
 }

const FADE_MS = 300

// 当前正在打字的行数，没有激活行返回-1
const activeLine = computed(() =>{
  let active = -1
  for(let i = 0; i < props.lines.length; i++){
    if(props.t >= props.lines[i]!.atMs) active = i
  }
  return active
})

// 光标闪烁显示隐藏由t决定
const caretVisible = computed(() => {
  return Math.floor(props.t / BLINK_MS) % 2 === 0
})

// 和 SlideBullets 里一模一样的那套算法：减掉开始时间，除以耗时，夹到 0~1
function progress(startAtMs: number): number {
  return Math.max(0, Math.min((props.t - startAtMs) / FADE_MS, 1))
}
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
        <div v-for="(line, i) in lines" :key="i" class="line" :class="{ active: activeLine === i }">
          <span class="gutter">{{ i + 1 }}</span>
          <span class="text">{{line.code.slice(0, typedChars(i))}}</span>
          <span v-if="activeLine === i && caretVisible" class="caret">▌</span>
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