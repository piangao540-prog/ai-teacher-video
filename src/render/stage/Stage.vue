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

// 按钮上显示 ⏸ 还是 ▶，就看这一个。它是 UI 状态，不进画面 ——
// 出片时整条工具栏都不在 DOM 里（v-if="!isRender"）。
const playing = ref(false)

/**
 * 进度条的步长（毫秒）。
 *
 * ★ 它不只是一个 step，还定义了「多接近片尾才算已经播完」——
 *   因为 step 会把值**吸附到整数倍**上，拖到最右端落在的是
 *   `floor(duration/16)*16`，比 duration 小：153020 → 153008。
 *   拿 `t >= duration` 判「播完了」，拖到片尾再按播放就只会播十几毫秒，
 *   看着像按钮坏了。留一个 step 的余量刚好盖住这个吸附差。
 */
const SCRUB_STEP_MS = 16

function play() {
  // ★ 只停上一轮的时钟，**不**去 pause 音频。
  //   原来这里调的是 pause()，等于「停音频、seek、再播」三次状态切换，
  //   而这三步之间浏览器不一定来得及把 seek 应用上去。
  //   我们要的只是「别再往下跑了」，stopTicking 就够。
  stopTicking()
  const from = t.value >= duration.value - SCRUB_STEP_MS ? 0 : t.value
  playing.value = true
  const audio = audioEl.value

  if (audio) {
    audio.currentTime = from / 1000
    // 播不起来（自动播放被拦、音频 404）就把按钮弹回 ▶。
    // 不 catch 的话按钮会一直显示 ⏸ 而画面纹丝不动 —— 按钮在撒谎。
    void audio.play().catch(() => {
      playing.value = false
    })
    const tick = () => {
      t.value = Math.min(audio.currentTime * 1000, duration.value)
      // 用自己这份 playing 判「还该不该往下走」，不用 audio.paused：
      // play() 是异步的，刚调完那一瞬 audio.paused 还是 true，
      // 拿它当判据会让按钮在播起来的第一帧就弹回去。
      if (t.value >= duration.value || !playing.value) {
        playing.value = false
        return
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return
  }

  // 渲染模式没有 audio 元素，退回真实时间
  const startedAt = performance.now()
  const tick = (now: number) => {
    t.value = Math.min(from + (now - startedAt), duration.value)
    if (t.value < duration.value && playing.value) {
      raf = requestAnimationFrame(tick)
    } else {
      playing.value = false
    }
  }
  raf = requestAnimationFrame(tick)
}

/**
 * 暂停 —— 不是「停止」：t 不归零，从哪儿停的从哪儿接着播。
 *
 * 原来它叫 `stop`，而那个名字正是「播放」「暂停」做成两个按钮的起因：
 * 听起来像一个独立动作，于是 UI 上也给了它一个独立位置。
 * 它和 play 是一对，名字就该配成一对。
 */
function stopTicking() {
  if (raf) cancelAnimationFrame(raf)
  raf = 0
}

function pause() {
  stopTicking()
  audioEl.value?.pause()
  playing.value = false
}

function toggle() {
  if (playing.value) pause()
  else play()
}

// 拖时间条：画面和声音一起跳过去。
//
// ★ 「本来在播吗」只在**第一次** input 时记。拖一次会连发几十个 input，
//   而它们每一个都会走到下面的 pause() —— 第二次之后 playing 已经是 false，
//   再记就只会记成「本来没在播」，松手也就不接着播了。
let scrubbing = false
let resumeAfterScrub = false

function onScrub(e: Event) {
  const value = Number((e.target as HTMLInputElement).value)
  if (!scrubbing) {
    scrubbing = true
    resumeAfterScrub = playing.value
  }
  pause()
  t.value = value
  if (audioEl.value) audioEl.value.currentTime = value / 1000
}

/** 松手（或键盘松开方向键）。
 *  拖动本身不该是个「暂停」操作 —— 本来在播就接着播。 */
function onScrubEnd() {
  scrubbing = false
  if (!resumeAfterScrub) return
  resumeAfterScrub = false
  play()
}

/**
 * 毫秒 → `分:秒.毫秒`。
 *
 * 原来印的是 `1962 ms`。做片子的时候脑子里是「第 1.96 秒」，
 * 不是「第 1962 毫秒」。而且定长 9 个字符，拖进度条时数字不会左右抖。
 */
function timecode(ms: number): string {
  const v = Math.max(0, Math.round(ms))
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(Math.floor(v / 60000))}:${pad(Math.floor(v / 1000) % 60)}.${String(v % 1000).padStart(3, '0')}`
}

onUnmounted(pause)

async function seek(ms: number) {
  pause()
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

    <div class="controls" v-if="!isRender">
      <div class="bar">
        <!-- 播放/暂停是**一个**开关，不是两个按钮：它们互斥
             （播放时按暂停没意义，反之亦然），摆两个等于把
             「现在到底在播吗」推给观众去判断。 -->
        <button class="play" :title="playing ? '暂停' : '播放'" @click="toggle">
          {{ playing ? '⏸' : '▶' }}
        </button>

        <input
          class="scrub"
          type="range"
          min="0"
          :max="duration"
          :step="SCRUB_STEP_MS"
          :value="t"
          @input="onScrub"
          @change="onScrubEnd"
        />

        <span class="t">{{ timecode(t) }}</span>
        <span class="sep"></span>

        <!-- 原生 checkbox 藏起来但**留着**：键盘 Tab、空格切换、
             读屏全靠它。自己画一个 ≠ 把它删掉 —— 外观丢了能重画，语义丢了没法补。
             外观靠 `input:checked + .box` 跟着选中状态走，Vue 里不存第二份状态。 -->
        <label class="toggle">
          <input type="checkbox" v-model="showSubs" />
          <span class="box"></span>
          字幕
        </label>

        <select v-model="subtitleVariant" class="variant">
          <option v-for="v in VARIANTS" :key="v" :value="v">{{ v }}</option>
        </select>
      </div>

      <!-- 调试信息挪出工具栏：它是给作者的，不是给观众的，
           混在控件里会跟「字幕」那种真控件抢最右边那个位置 -->
      <p class="scene">{{ current?.id }} · {{ current?.template }}</p>
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
  /* storyboard 还没到、或者场景组件还没挂上时露出来的就是这个色。
     原来是白的 —— 页面刚打开那一下是一屏纯白，像坏了。
     改成和所有场景同一个底：那一瞬看着像「从黑场淡入」，是设计的一部分。 */
  background: #0d1117;
}
/* 工具栏 + 它下面那行调试信息。宽度和上面 960px 的画框对齐。 */
.controls {
  width: 960px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}
.bar {
  box-sizing: border-box;
  width: 100%;
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 10px 16px;
  background: #191919;
  border: 1px solid #2c2c2c;
  border-radius: 12px;
}

/* 圆形播放按钮：一个开关顶原来两个按钮 */
.play {
  flex: 0 0 auto;
  width: 38px;
  height: 38px;
  display: grid;
  place-items: center;
  padding: 0;
  font-family: system-ui, 'Segoe UI Symbol', sans-serif;
  font-size: 15px;
  line-height: 1;
  color: #dfe6e2;
  background: #2c5c46;
  border: 1px solid #3d7a5e;
  border-radius: 50%;
  cursor: pointer;
}
.play:hover {
  background: #356c53;
}
.play:active {
  transform: scale(0.94);
}

/* 进度条 ── `appearance: none` 是这个文件里最要紧的一行。
   原生 range 是**替换元素**：浏览器拿自己的渲染器画它，普通盒模型那套
   基本管不着。不写这行，下面 ::-webkit-slider-thumb 那些规则一条都不生效。 */
.scrub {
  flex: 1;
  appearance: none;
  height: 4px;
  border-radius: 2px;
  background: #333;
  outline: none;
  cursor: pointer;
}
.scrub::-webkit-slider-thumb {
  appearance: none;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: #6cc59a;
  border: none;
}
.scrub::-moz-range-thumb {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: #6cc59a;
  border: none;
}

/* tabular-nums：数字等宽，拖进度条时 `00:01.962` 不会左右抖 */
.t {
  flex: 0 0 auto;
  min-width: 74px;
  font-size: 13px;
  font-variant-numeric: tabular-nums;
  color: #9aa4a0;
  text-align: right;
}

/* 一根竖线把「放音」那半和「显示」那半分开 ——
   分组靠间距和分隔，不靠平均的 gap */
.sep {
  flex: 0 0 auto;
  width: 1px;
  height: 20px;
  background: #303030;
}

.toggle {
  position: relative;
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: #9aa4a0;
  cursor: pointer;
  user-select: none;
}
/* 藏起来、但留在 DOM 里（位置绝对化 + 零尺寸），键盘和读屏照旧能用 */
.toggle input {
  position: absolute;
  width: 0;
  height: 0;
  opacity: 0;
}
.toggle .box {
  position: relative;
  width: 15px;
  height: 15px;
  border: 1px solid #3f3f3f;
  border-radius: 4px;
  background: #121212;
}
/* `input:checked + .box` —— 相邻兄弟选择器。checkbox 和 .box 在 DOM 里挨着，
   所以选中时 .box 自己就变样，不用在 Vue 里再存一份重复的状态。 */
.toggle input:checked + .box {
  background: #2c5c46;
  border-color: #3d7a5e;
}
/* 对勾：一个小矩形只留右边和下边的边框，转 45° 就是了 */
.toggle input:checked + .box::after {
  content: '';
  position: absolute;
  left: 4px;
  top: 1px;
  width: 4px;
  height: 8px;
  border: solid #cfe9d8;
  border-width: 0 2px 2px 0;
  transform: rotate(45deg);
}
.toggle input:focus-visible + .box {
  outline: 2px solid #3d7a5e;
  outline-offset: 2px;
}

.variant {
  flex: 0 0 auto;
  appearance: none;
  padding: 4px 22px 4px 8px;
  font-size: 12px;
  color: #9aa4a0;
  background: #121212;
  border: 1px solid #333;
  border-radius: 6px;
  cursor: pointer;
  /* appearance: none 把原生那支箭头也一起干掉了，得自己画：
     两个 45° 渐变各露出一半，拼成一个小三角 */
  background-image: linear-gradient(45deg, transparent 50%, #7a7a7a 50%),
    linear-gradient(135deg, #7a7a7a 50%, transparent 50%);
  background-position: calc(100% - 11px) center, calc(100% - 7px) center;
  background-size: 4px 4px, 4px 4px;
  background-repeat: no-repeat;
}

.scene {
  margin: 0;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  color: #555;
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