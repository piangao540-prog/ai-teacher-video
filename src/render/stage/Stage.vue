<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue'
import CodeTyping from '../scenes/CodeTyping.vue'
import SlideBullets from '../scenes/SlideBullets.vue'
import Terminal from '../scenes/Terminal.vue'
import {
  codeStateAt,
  slideStateAt,
  terminalStateAt,
  type CodeLine,
  type SlideProps,
  type TermLine,
} from '../scenes/sceneState'
import Subtitle, { type SubtitleVariant } from './Subtitle.vue'

// 场景模板注册表。
// 分镜里写的 template 名字，必须能在这里找到对应的组件。
const TEMPLATES: Record<string, unknown> = {
  SlideBullets,
  CodeTyping,
  Terminal,
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

/** 某一时刻正在演的是哪个场景（取最后一个已经开始的） */
function sceneAt(ms: number): Scene | null {
  const list = storyboard.value?.scenes ?? []
  let found: Scene | null = null
  for (const s of list) {
    if (ms >= s.startMs) found = s
  }
  return found ?? list[0] ?? null
}

const current = computed<Scene | null>(() => sceneAt(t.value))

const CurrentComponent = computed(() =>
  current.value ? (TEMPLATES[current.value.template] ?? null) : null,
)

// 传给场景的是「相对时间」：场景不知道自己在时间轴哪里，永远从 0 开始演
const localT = computed(() => (current.value ? t.value - current.value.startMs : 0))

// ---- 逐帧渲染的提速：这一帧能不能直接复用上一帧？ ----
//
// 实测：screenshot 占 78.9ms/帧、seek 只占 13.4ms，而 79% 的帧
// 和上一帧内容完全相同。跳过这些截图就是这一版提速的全部来源。
//
// 判据必须**保守**：漏判只是少省一点，误判会让画面卡住不动。
//
// 字幕出现时的淡入时长，**含余量**。Subtitle.vue 里的 FADE_MS 是 120ms，
// 但那是「设计值」：实测透明度要 133ms 才到 1（帧对齐 + rAF 的零头），
// 所以这里留到 160ms。留窄了会误判 —— 实测 120 还漏 2 帧。
const CUE_FADE_MS = 160

/** 这一时刻显示的是第几条字幕；没有就返回 -1 */
function cueIndexAt(ms: number): number {
  const list = cues.value
  for (let i = 0; i < list.length; i++) {
    if (ms < list[i]!.startMs) return -1
    if (ms < list[i]!.endMs) return i
  }
  return -1
}

/**
 * 每个场景模板的「帧签名」：给一个时刻，交出这一帧画面上**所有随时间变化的值**。
 *
 * ★ 判据的思路变了：不再在这里猜场景内部长什么样，而是让场景用
 *   **渲染时的同一份公式**（sceneState.ts）算出状态，比较前后两帧的状态。
 *   状态相同 ⇒ 画面逐像素相同 ⇒ 可以放心复制上一帧的 PNG。
 *
 *   之前的写法是在这里拿 atMs 去「推」第几个字符打出来了 ——
 *   那等于把 CodeTyping 的公式抄了第二遍，两处公式在边界上必然错开一两个字符。
 *   现在两边调的是同一个 codeStateAt()，这种错位在结构上不可能发生。
 *
 * ★ 签名必须**列全**所有依赖 t 的东西。以后给场景加了新动效却忘了写进
 *   sceneState.ts，判据就会漏项 → 画面卡住。防呆只能靠逐帧对拍。
 *
 * ★ 没登记的模板 = 不认识 = 一律当作「在变」（保守）。漏判只是少省一点，
 *   误判才会让画面卡住。
 */
const SIGNATURES: Record<string, ((local: number, props: Record<string, unknown>) => unknown) | undefined> = {
  CodeTyping: (local, p) => codeStateAt(local, p.lines as CodeLine[]),
  SlideBullets: (local, p) => slideStateAt(local, p as unknown as SlideProps),
  Terminal: (local, p) => terminalStateAt(local, p.lines as TermLine[]),
}

/** 某一帧的画面签名；不认识的模板返回 null */
function signatureAt(scene: Scene, local: number): string | null {
  const f = SIGNATURES[scene.template]
  // 同一函数产出 ⇒ 键序一致，JSON.stringify 可以直接当深比较用
  return f ? JSON.stringify(f(local, scene.props)) : null
}

/**
 * 第 cur 毫秒这一帧，能不能直接复制上一帧（prev 毫秒）？
 *
 * ★ 为什么可以这么判：画面是**时间的纯函数**（第 1 条设计约束）。
 *   两帧的「帧签名」完全相同 ⇒ 它们算出来的 DOM 完全相同 ⇒ 像素逐字节相同。
 *
 * ★ prev 由 frames.ts 传**真实值**（Math.round((f-1)*1000/fps)）过来，
 *   不用 fps 在页面里反算 —— 上一版写成 ms - 1000/30，那是 33.333，
 *   而真实间隔是 33 或 34，差的那零点几毫秒正好踩在字幕/字符的整数边界上。
 */
function isStaticAt(cur: number, prev: number): boolean {
  if (prev < 0) return false // 第一帧，没有上一帧可复制

  const s = sceneAt(cur)
  const ps = sceneAt(prev)
  // 跨了场景（或还没进第一个场景）：画面必然不同
  if (!s || !ps || s.id !== ps.id) return false

  // 1. 场景内部这一帧变了吗？签名一样就是没变。
  //    （代码场景的逐字打字、光标闪烁、行高亮都算在这里面，见 sceneState.ts）
  const here = signatureAt(s, cur - s.startMs)
  if (here === null) return false // 不认识的模板：保守当成一直在变
  if (here !== signatureAt(ps, prev - ps.startMs)) return false

  // 2. 字幕是独立的一层，跨场景连续，单独判。
  //
  // ★ 这里**不能**写成「这条字幕必须在某个窗口内结束」。
  //   第一版就是这么写的，结果静态判定恒为 false：字幕一条持续 3~6 秒，
  //   而场景动效早就结束了，于是每个静态帧都落在某条字幕中间，
  //   全被判成「字幕还没结束」。表现是复用率 0%，但画面完全正确
  //   （所以对拍查不出来 —— 对拍只能证明没错，不能证明有效）。
  //
  // ★ 也**不要**再加一条「离字幕起点太近就不复用」。
  //   我加过（阈值 1ms），结果漏掉了正好落在两帧之间的切换：
  //   实测帧 175、176、285~288 因此误判 —— 复用会让字幕卡住。
  //   只要老老实实比较「上一帧和这一帧是不是同一条字幕」，
  //   切换点自己就被排除了，不需要额外的守卫。
  //
  // ★ 但「同一条字幕」还不够：字幕出现时有淡入，
  //   那段时间透明度一直在变，画面并不相同。漏了这条会有 7 帧误判，
  //   正好卡在两条字幕的交界处。
  const ci = cueIndexAt(cur)
  if (ci !== cueIndexAt(prev)) return false

  const cue = cues.value[ci]
  if (cue && cur < cue.startMs + CUE_FADE_MS) return false

  return true
}

;(window as unknown as { __static: (cur: number, prev: number) => boolean }).__static = isStaticAt


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