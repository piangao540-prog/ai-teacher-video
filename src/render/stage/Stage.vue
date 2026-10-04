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

// ---- 逐帧渲染的提速：这一帧能不能直接复用上一帧？ ----
//
// ★ 为什么可以这么判：画面是**时间的纯函数**（第 1 条设计约束）。
//   同一段静态时间里，任意时刻算出来的画面完全一样 —— 所以不必去截图，
//   把上一帧的 PNG 直接拿来用即可。
//
// 实测：screenshot 占 78.9ms/帧、seek 只占 13.4ms，而 79% 的帧
// 和上一帧内容完全相同。跳过这些截图就是这一版提速的全部来源。
//
// 判据必须**保守**：漏判只是少省一点，误判会让画面卡住不动。
//
// 出片帧率。用来判断「这一帧和上一帧是不是落在同一条字幕里」。
// 从 URL 读（frames.ts 会因为 --fps 把它带过来），默认 30。
const FRAME_MS = 1000 / Number(params.get('fps') ?? 30)
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

/** 一个会「到点出现」的元素：它出现的那一刻 + 动效收尾的时间 */
const FADE_SLIDE = 450
const FADE_TITLE = 650

/**
 * 这一帧，场景内部有没有**正在发生**的变化？
 *
 * ★ 只处理幻灯片。代码场景一律返回「在变」，不参与复用。
 *
 *   本来我给代码场景也写了判据（看逐字打字的区间、看光标是否在闪），
 *   但那条路一直有边界漏洞：实测全片仍有 29 帧被误判 —— 而那些帧一旦
 *   被判成静态就会被复制成上一帧，画面就卡住了。
 *   原因是「第几个字符已经打出来」这件事由 CodeTyping.vue 的
 *   Math.floor(elapsed / CHAR_MS) 决定，我用 storyboard 里的 atMs 去推，
 *   总会差一两个字符的位置。
 *
 *   所以这里只留下**能确定**的部分：幻灯片上每个元素只在它出现后的
 *   那段时间里在动，其余时间画面真的不动。代码场景（占本片约 1/3）
 *   全部照常渲染，少省一点，但不会错。
 */
function sceneChangingAt(scene: Scene, local: number): boolean {
  const p = scene.props as Record<string, unknown>

  // 代码场景：不参与复用（光标一直在闪，见上面的说明）
  if (Array.isArray(p.lines)) return true

  // 幻灯片：每一条要点（含标题）只在它出现后的那段时间里在动
  if (Array.isArray(p.bullets)) {
    if (typeof p.titleAtMs === 'number' && local >= p.titleAtMs && local < p.titleAtMs + FADE_TITLE) return true
    for (const b of p.bullets as Array<{ atMs?: number }>) {
      if (typeof b.atMs === 'number' && local >= b.atMs && local < b.atMs + FADE_SLIDE) return true
    }
    return false
  }

  return true // 不认识的模板：保守起见当成一直在变
}

function isStaticAt(ms: number): boolean {
  const s = current.value
  if (!s) return false

  const local = ms - s.startMs

  // 1. 场景内部此刻有没有元素正在动？（代码场景一律算「在动」，见上）
  if (sceneChangingAt(s, local)) return false

  // 3. 字幕在这一帧有没有变？
  //
  // ★ 这里**不能**写成「这条字幕必须在 STATIC_HORIZON 内结束」。
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
  const here = cueIndexAt(ms)
  const before = cueIndexAt(ms - FRAME_MS)
  if (here !== before) return false

  const cue = cues.value[here]
  if (cue && ms < cue.startMs + CUE_FADE_MS) return false

  return true
}

;(window as unknown as { __static: (ms: number) => boolean }).__static = isStaticAt


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