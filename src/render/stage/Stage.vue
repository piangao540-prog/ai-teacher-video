<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue'
import CodeTyping from '../scenes/CodeTyping.vue'
import SlideBullets from '../scenes/SlideBullets.vue'
import Subtitle, { type SubtitleVariant } from './Subtitle.vue'

// 场景模板注册表。
// 分镜里写的 template 名字，必须能在这里找到对应的组件。
const TEMPLATES: Record<string, unknown> = {
  SlideBullets,
  CodeTyping,
}

const params = new URLSearchParams(location.search)
const isRender = params.has('render')

type Scene = {
  id: string
  template: string
  startMs: number
  endMs: number
  props: Record<string, unknown>
}

type Storyboard = {
  durationMs: number
  audioFile: string
  scenes: Scene[]
  cues?: Cue[]
}

type Cue = { i: number; startMs: number; endMs: number; text: string; lines: string[] }

const storyboard = ref<Storyboard | null>(null)
const audioEl = ref<HTMLAudioElement | null>(null)
const t = ref(0)
let raf = 0

// storyboard 是异步取的。__seek 必须等它到齐再动，
// 否则截图脚本会在画面还是空白的时候就把图截走。
let markReady: (() => void) | null = null
const ready = new Promise<void>((resolve) => {
  markReady = resolve
})

onMounted(async () => {
  const res = await fetch('./storyboard.json')
  if (!res.ok) throw new Error('取不到 storyboard.json：' + res.status + '（先跑 pnpm storyboard）')
  storyboard.value = (await res.json()) as Storyboard
  await nextTick()
  markReady?.()
})

const duration = computed(() => storyboard.value?.durationMs ?? 0)

// 字幕是独立的一层：它跟着配音走，不属于任何场景，所以跨场景连续。
const cues = computed<Cue[]>(() => storyboard.value?.cues ?? [])

// 出片时字幕必须开（不然白做）。预览时也默认开着 ——
// 不然打开 dev 看不见字幕，会以为没生效；想对比观感再关掉。
const showSubs = ref(true)
const subtitleOn = computed(() => showSubs.value && cues.value.length > 0)

// 字幕外观。出片走 ?subs=xxx（shot.ts 拼上去的），预览可用 &subs=xxx 或下面那个开关。
// 只影响样式，不参与任何时间计算。
const VARIANTS: SubtitleVariant[] = ['pill', 'box', 'glass', 'bar']
const asVariant = (v: string | null): SubtitleVariant | null =>
  VARIANTS.includes(v as SubtitleVariant) ? (v as SubtitleVariant) : null
const subtitleVariant = ref<SubtitleVariant>(asVariant(params.get('subs')) ?? 'pill')

// 音频也在 out/render/audio 里，由服务器直接喂过来
const audioSrc = computed(() => (storyboard.value ? './audio/' + storyboard.value.audioFile : ''))

const current = computed<Scene | null>(() => {
  const list = storyboard.value?.scenes ?? []
  let found: Scene | null = null
  for (const s of list) {
    if (t.value >= s.startMs) found = s
  }
  return found ?? list[0] ?? null
})

const CurrentComponent = computed(() =>
  current.value ? (TEMPLATES[current.value.template] ?? null) : null,
)

// 传给场景的是「相对时间」：场景不知道自己在时间轴哪里，永远从 0 开始演
const localT = computed(() => (current.value ? t.value - current.value.startMs : 0))

// ★ 预览时以「音频」为时钟：t 跟着 audio.currentTime 走。
//   这样你听到的和看到的是同一条时间线，能直接判断对不对得上。
//   这不违反「场景只依赖 t」—— 场景依然只认 t，只是 t 的来源从 performance.now 换成了音频。
function play() {
  stop()
  const from = t.value >= duration.value ? 0 : t.value
  const audio = audioEl.value

  if (audio) {
    audio.currentTime = from / 1000
    void audio.play()
    const tick = () => {
      t.value = Math.min(audio.currentTime * 1000, duration.value)
      if (!audio.paused && t.value < duration.value) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return
  }

  // 渲染模式没有 audio 元素，退回真实时间
  const startedAt = performance.now()
  const tick = (now: number) => {
    t.value = Math.min(from + (now - startedAt), duration.value)
    if (t.value < duration.value) raf = requestAnimationFrame(tick)
  }
  raf = requestAnimationFrame(tick)
}

function stop() {
  if (raf) cancelAnimationFrame(raf)
  raf = 0
  audioEl.value?.pause()
}

// 拖时间条：画面和声音一起跳过去
function onScrub(e: Event) {
  const value = Number((e.target as HTMLInputElement).value)
  stop()
  t.value = value
  if (audioEl.value) audioEl.value.currentTime = value / 1000
}

onUnmounted(stop)

async function seek(ms: number) {
  stop()
  await ready
  t.value = ms
  await nextTick()
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
  })
}

;(window as unknown as { __seek: (ms: number) => Promise<void> }).__seek = seek
</script>

<template>
  <div class="page" :class="{ render: isRender }">
    <div class="viewport">
      <div class="frame">
        <component
          :is="CurrentComponent"
          v-if="CurrentComponent && current"
          :t="localT"
          v-bind="current.props"
        />
        <!-- 字幕盖在场景上面，和场景同属「由 t 决定画面」这一层 -->
        <Subtitle v-if="subtitleOn" :t="t" :cues="cues" :variant="subtitleVariant" />
      </div>
    </div>

    <div class="bar" v-if="!isRender">
      <button @click="play">播放</button>
      <button @click="stop">暂停</button>
      <label class="toggle"><input type="checkbox" v-model="showSubs" /> 字幕</label>
      <select v-model="subtitleVariant" class="variant">
        <option v-for="v in VARIANTS" :key="v" :value="v">{{ v }}</option>
      </select>
      <input type="range" min="0" :max="duration" step="16" :value="t" @input="onScrub" />
      <span class="t">{{ Math.round(t) }} ms</span>
      <span class="scene">{{ current?.id }} / {{ current?.template }}</span>
    </div>

    <!-- 只在预览时挂 audio。渲染模式不挂：出片要的是纯画面，声音由 ffmpeg 混。 -->
    <audio v-if="!isRender && audioSrc" ref="audioEl" :src="audioSrc" preload="auto"></audio>
  </div>
</template>

<style scoped>
.page {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 20px;
  padding: 24px 0;
  font-family: system-ui, sans-serif;
  color: #eee;
}
.page audio {
  display: none;
}
.viewport {
  width: 960px;
  height: 540px;
  overflow: hidden;
  flex: 0 0 auto;
  box-shadow: 0 8px 40px #000;
}
.frame {
  /* 字幕层用 absolute 定位盖在场景上，所以这里是它的定位参照物 */
  position: relative;
  width: 1920px;
  height: 1080px;
  transform: scale(0.5);
  transform-origin: top left;
  background: #fff;
}
.bar {
  display: flex;
  align-items: center;
  gap: 12px;
}
.toggle {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 14px;
  color: #bbb;
  cursor: pointer;
}
.variant {
  background: #222;
  color: #ddd;
  border: 1px solid #444;
  border-radius: 6px;
  padding: 4px 8px;
  font-size: 13px;
}
.bar input {
  width: 420px;
}
.t {
  font-variant-numeric: tabular-nums;
  width: 90px;
  text-align: right;
}
.scene {
  color: #888;
  font-size: 13px;
}

/* ↓↓↓ 渲染模式：1:1 原尺寸，没 UI，没阴影 ↓↓↓ */
.page.render {
  display: block;
  padding: 0;
  gap: 0;
  min-height: 0;
  background: #fff;
}
.page.render .viewport {
  width: 1920px;
  height: 1080px;
  box-shadow: none;
}
.page.render .frame {
  transform: none;
}
</style>