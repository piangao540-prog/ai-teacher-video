// 「out/render/ 里这几份产物，是不是同一版？」—— 全项目唯一的判据。
//
// ★ 为什么需要它：这条链有五环，每一环都是上一环的派生物
//
//     剧本 → 配音 → 时间轴 → 画面 → 成片
//
//   只要手工只跑了其中一步，out/render/ 就会变成**半新半旧**。
//   而在加这个文件之前，项目里唯一的检查是 plan-api.ts 里那个比 mtime 的
//   `isStale()`：只盖「剧本 → 时间轴」一条边，不看配音、不看画面、不看成片。
//   这个坑 HANDOFF 里记了三次，每次都靠人眼发现。
//
// ★ 判据用**内容指纹**（sha1 前 12 位），不用 mtime。mtime 区分不了
//   「重跑了一遍但内容没变」和「真的换了一版」，而且会被复制 / git checkout /
//   随手 touch 无谓地扰动。指纹只回答一个问题：**这一版是不是从那一版来的**。
//   （指纹不是加密，也不防篡改 —— 别拿它当安全措施。）
//
// ★ **两档判据**，因为老产物里没有指纹，而「没有指纹」不能当成「没问题」
//   （那样一个旧文件就能绕过整套自检）：
//
//     强判据  指纹对上 / 对不上 / 不知道    确定，但要产物配合
//     弱判据  时长对不上                    只能证明「一定不是一版」，
//                                           但**不需要任何迁移**就能用
//
//   所以报告里两档都出 —— 加完这个模块第一次跑就有结论，不用先迁一轮。
//
// ★ 三条边分开，**各自的消费者只卡自己那条**（见「谁卡哪条」）。
//   不能做成「任意一条断了就拦」：`pnpm video` 是
//   build-storyboard → frames → encode，走到 encode 时 final.mp4 必然还是
//   **上一部片子**，时长和新写的 render-meta 必然对不上 —— 那样每次都会
//   把自己拦住。

import { createHash } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { findFfmpeg, probeDurationMs } from '../compose/ffmpeg'

export const EPISODE_FILE = path.resolve('corpus/episode.json')
export const TIMINGS_FILE = path.resolve('out/render/audio/timings.json')
export const STORYBOARD_FILE = path.resolve('out/render/storyboard.json')
export const META_FILE = path.resolve('out/render/render-meta.json')
export const VIDEO_FILE = path.resolve('out/render/final.mp4')

/** 成片是 ffmpeg 编出来的，容器时长和「帧数 ÷ 帧率」对不齐 —— 实测差 40ms
 *  （约 1.2 帧，AAC priming 那类改不动的东西）。所以给一帧多的容差。 */
const VIDEO_TOLERANCE_MS = 100

/** 其余各环之间记的是**同一个数**（直接抄过去的），所以只留 1ms 的浮点余量 */
const EXACT_TOLERANCE_MS = 1

export type StageKey = 'episode' | 'timings' | 'storyboard' | 'frames' | 'video'

export type Edge =
  | 'episode->timings'
  | 'timings->storyboard'
  | 'storyboard->frames'
  | 'frames->video'

/** ok       这一环确实是上一环的派生物
 *  mismatch **确定的**「对不上」
 *  unknown  判不了（文件不在，或者产物里没指纹）—— 不等于「没问题」 */
export type Verdict = 'ok' | 'mismatch' | 'unknown'

export type EdgeResult = {
  edge: Edge
  from: StageKey
  to: StageKey
  verdict: Verdict
  detail: string
}

export type Stage = {
  key: StageKey
  label: string
  file: string
  exists: boolean
  durationMs: number | null
  hasId: boolean
  /** 这一环**自己**长什么样。只有剧本那环非空 —— 它没有入边，没有判语可写。 */
  note: string
}

export type Report = {
  stages: Stage[]
  edges: EdgeResult[]
  /** 弱判据抓到的（不需要迁移就能得出） */
  weak: string[]
  /** 哪些环还没有指纹 —— 也就是迁移清单 */
  migration: string[]
}

export const EDGE_LABEL: Record<Edge, string> = {
  'episode->timings': '剧本 → 配音',
  'timings->storyboard': '配音 → 时间轴',
  'storyboard->frames': '时间轴 → 画面',
  'frames->video': '画面 → 成片',
}

/** 页面只关心**前两条**（剧本 → 配音 → 时间轴）。
 *
 *  为什么停在第二条、不往后算：页面（`pnpm dev`）根本不读 `frames/` ——
 *  预览是浏览器照 `storyboard.json` **现算**的。所以「时间轴 → 画面」和
 *  「画面 → 成片」断不断，跟页面上看到的东西没有关系。
 *
 *  ★ 而且这两条边在 A+（`pnpm say` + `pnpm storyboard`，跑完停住不出片）
 *    跑完之后是必然断的 —— 它们要等 `pnpm video`。把注定断的边算进页面，
 *    那个标签就会**永远**亮着，等于没有。 */
export const PAGE_EDGES: Edge[] = ['episode->timings', 'timings->storyboard']

/** 内容指纹。读不到返回 null —— 「文件不在」本身就是一种状态，不该抛。 */
export async function fileId(file: string): Promise<string | null> {
  try {
    return createHash('sha1').update(await readFile(file)).digest('hex').slice(0, 12)
  } catch {
    return null
  }
}

type BuiltFrom = { episode?: string | null; timings?: string | null; storyboard?: string | null }

/** 只会去读我们关心的那几个字段，不做完整校验 —— 这个模块是「体检」，
 *  遇到读不懂的文件要报出来，不能自己先崩。 */
type Loose = {
  durationMs?: number
  builtFrom?: BuiltFrom
  partial?: boolean
  scenes?: unknown[]
  parts?: Array<{ text?: string }>
}

async function readLoose(file: string): Promise<Loose | null> {
  try {
    return JSON.parse(await readFile(file, 'utf8')) as Loose
  } catch {
    return null
  }
}

async function exists(file: string): Promise<boolean> {
  try {
    return (await stat(file)).isFile()
  } catch {
    return false
  }
}

/** 成片的时长只能问 ffmpeg —— 它是唯一不留下 JSON 记录的一环。 */
async function videoDuration(): Promise<number | null> {
  if (!(await exists(VIDEO_FILE))) return null
  try {
    return probeDurationMs(await findFfmpeg(), VIDEO_FILE)
  } catch {
    return null
  }
}

const rel = (file: string): string => path.relative(process.cwd(), file).replace(/\\/g, '/')

/** 行里印的路径。报告抬头已经写了「out/render」，所以那一截不再重复 ——
 *  省下的宽度留给判语。（`corpus/episode.json` 不在 out/render 下，原样印。） */
const rowFile = (file: string): string => {
  const r = rel(file)
  return r.startsWith('out/render/') ? r.slice('out/render/'.length) : r
}
const secs = (ms: number | null): string => (ms === null ? '—' : (ms / 1000).toFixed(2) + 's')

/** 时长的弱判据：两边都知道、且差得超过容差 → 「一定不是一版」 */
function durationMismatch(a: number | null, b: number | null, tolerance: number): boolean {
  return a !== null && b !== null && Math.abs(a - b) > tolerance
}

export async function inspect(): Promise<Report> {
  const [episode, timings, storyboard, meta, video] = await Promise.all([
    readLoose(EPISODE_FILE),
    readLoose(TIMINGS_FILE),
    readLoose(STORYBOARD_FILE),
    readLoose(META_FILE),
    videoDuration(),
  ])

  // ★ 指纹一律比**当前磁盘上的文件**，而不是比别处记下来的值 ——
  //   这样「谁是最新的」这个问题不需要有人来回答。
  const [episodeId, timingsId, storyboardId] = await Promise.all([
    fileId(EPISODE_FILE),
    fileId(TIMINGS_FILE),
    fileId(STORYBOARD_FILE),
  ])

  const dEpisode: number | null = null
  const dTimings = timings?.durationMs ?? null
  const dStoryboard = storyboard?.durationMs ?? null
  const dFrames = meta?.durationMs ?? null
  const dVideo = video

  const stageOf = (
    key: StageKey,
    label: string,
    file: string,
    ex: boolean,
    durationMs: number | null,
    hasId: boolean,
    note = '',
  ): Stage => ({ key, label, file, exists: ex, durationMs, hasId, note })

  // 只有剧本这一环写 note —— 理由见 formatReport 里那段。
  // 其余四环的 note 都留空：它们的处境由「指向它的那条边」来说，
  // 再说一遍只会和判语重复（这两种话本来就是一回事）。
  const episodeNote = episode
    ? (episode.scenes?.length ?? 0) + ' 场景 / ' +
      (episode.parts ?? []).reduce((n, p) => n + (p.text ?? '').length, 0) + ' 字'
    : '读不到（先跑 pnpm plan）'

  const stages: Stage[] = [
    stageOf('episode', '剧本', EPISODE_FILE, episode !== null, dEpisode, episodeId !== null, episodeNote),
    stageOf('timings', '配音', TIMINGS_FILE, timings !== null, dTimings, timings?.builtFrom?.episode != null),
    stageOf(
      'storyboard',
      '时间轴',
      STORYBOARD_FILE,
      storyboard !== null,
      dStoryboard,
      storyboard?.builtFrom?.timings != null,
    ),
    stageOf('frames', '画面', META_FILE, meta !== null, dFrames, meta?.builtFrom?.storyboard != null),
    // 成片没有指纹，而且**永远不会有** —— 它是 ffmpeg 编出来的，没有地方写字段。
    // 所以它那一环只能靠时长反查（弱判据），见下面 frames->video 那条边。
    stageOf('video', '成片', VIDEO_FILE, dVideo !== null, dVideo, false),
  ]

  const edges: EdgeResult[] = []

  // ---- 剧本 → 配音 ----
  edges.push({
    edge: 'episode->timings',
    from: 'episode',
    to: 'timings',
    ...(timings === null
      ? { verdict: 'unknown' as Verdict, detail: '还没有配音' }
      : timings.builtFrom?.episode == null
        ? { verdict: 'unknown' as Verdict, detail: '配音里没有指纹，不知道它是哪一版剧本配的' }
        : timings.builtFrom.episode === episodeId
          ? { verdict: 'ok' as Verdict, detail: '配音是对着当前剧本来的' }
          : { verdict: 'mismatch' as Verdict, detail: '配音是**另一版剧本**配的（剧本改过之后没重跑 say）' }),
  })

  // ---- 配音（和剧本）→ 时间轴 ----
  edges.push({
    edge: 'timings->storyboard',
    from: 'timings',
    to: 'storyboard',
    ...(storyboard === null
      ? { verdict: 'unknown' as Verdict, detail: '还没有时间轴' }
      : storyboard.builtFrom?.timings == null
        ? { verdict: 'unknown' as Verdict, detail: '时间轴里没有指纹，不知道它是从哪一版切的' }
        : storyboard.builtFrom.episode !== episodeId
          ? { verdict: 'mismatch' as Verdict, detail: '时间轴是**另一版剧本**的（剧本改过之后没重跑 storyboard）' }
          : storyboard.builtFrom.timings !== timingsId
            ? { verdict: 'mismatch' as Verdict, detail: '时间轴是**另一版配音**切的（配音重跑过，时间轴没跟上）' }
            : { verdict: 'ok' as Verdict, detail: '时间轴对着当前剧本、当前配音' }),
  })

  // ---- 时间轴 → 画面 ----
  edges.push({
    edge: 'storyboard->frames',
    from: 'storyboard',
    to: 'frames',
    ...(meta === null
      ? { verdict: 'unknown' as Verdict, detail: '还没有画面记录（render-meta.json）' }
      : meta.builtFrom?.storyboard == null
        ? { verdict: 'unknown' as Verdict, detail: '画面记录里没有指纹，不知道它是照哪一版渲的' }
        : meta.builtFrom.storyboard !== storyboardId
          ? { verdict: 'mismatch' as Verdict, detail: '画面是**上一版**时间轴渲的' }
          : meta.partial
            ? { verdict: 'mismatch' as Verdict, detail: '画面只渲了一部分（缩短跑/对拍留下的），不是整片' }
            : { verdict: 'ok' as Verdict, detail: '画面对着当前时间轴' }),
  })

  // ---- 画面 → 成片 ----
  edges.push({
    edge: 'frames->video',
    from: 'frames',
    to: 'video',
    ...(dVideo === null
      ? { verdict: 'unknown' as Verdict, detail: '还没有成片（或读不出它的时长）' }
      : meta?.partial
        ? { verdict: 'mismatch' as Verdict, detail: '画面只渲了一部分，成片对不上它' }
        : durationMismatch(dVideo, dFrames, VIDEO_TOLERANCE_MS)
          ? { verdict: 'mismatch' as Verdict, detail: '成片比画面旧（时长对不上）' }
          : { verdict: 'ok' as Verdict, detail: '成片对着当前画面' }),
  })

  // ---- 弱判据 + 迁移清单 ----
  //
  // 只在**强判据没能给出 ok** 的时候才提，不然是纯重复。
  const weak: string[] = []
  const edgeOf = (e: Edge): EdgeResult => edges.find((x) => x.edge === e)!

  if (edgeOf('timings->storyboard').verdict !== 'ok' && durationMismatch(dTimings, dStoryboard, EXACT_TOLERANCE_MS)) {
    weak.push('配音 ' + secs(dTimings) + ' 和时间轴 ' + secs(dStoryboard) + ' 时长对不上 —— 一定不是同一版')
  }
  if (edgeOf('storyboard->frames').verdict !== 'ok' && durationMismatch(dStoryboard, dFrames, EXACT_TOLERANCE_MS)) {
    weak.push('时间轴 ' + secs(dStoryboard) + ' 和画面 ' + secs(dFrames) + ' 时长对不上 —— 一定不是同一版')
  }
  if (edgeOf('frames->video').verdict !== 'ok' && durationMismatch(dFrames, dVideo, VIDEO_TOLERANCE_MS)) {
    weak.push('画面 ' + secs(dFrames) + ' 和成片 ' + secs(dVideo) + ' 时长对不上 —— 一定不是同一版')
  }

  const migration = stages.filter((s) => s.exists && !s.hasId && s.key !== 'video' && s.key !== 'episode').map((s) => s.label)

  return { stages, edges, weak, migration }
}

/** 断掉的边（ok 之外的都算）。**注意「unknown」也在里面** ——
 *  「不知道是哪一版」不能当成「没问题」。 */
export async function brokenEdges(): Promise<EdgeResult[]> {
  const report = await inspect()
  return report.edges.filter((e) => e.verdict !== 'ok')
}

/** 给人话，一版一行。页面和 encode 都用它 —— 不各写一遍。 */
export function formatBroken(edges: EdgeResult[]): string[] {
  return edges.map((e) => (e.verdict === 'unknown' ? '？ ' : '✗ ') + EDGE_LABEL[e.edge] + '：' + e.detail)
}

const ICON: Record<Verdict, string> = { ok: '✓', mismatch: '✗', unknown: '？' }

/** 五个中文标签的**显示宽度**对齐到 6 列（CJK 算 2 列）—— 这样不用手数空格 */
function padLabel(label: string): string {
  const width = [...label].reduce((n, ch) => n + (ch.charCodeAt(0) > 0x2e80 ? 2 : 1), 0)
  return label + ' '.repeat(Math.max(1, 6 - width))
}

export function formatReport(report: Report): string[] {
  const lines: string[] = ['out/render 版本体检', '']

  // 每一行印的是**这一环和它上游的关系**，不是它自己长什么样 ——
  // 这个命令要回答的就是「哪一环落后了」。
  //
  // 例外只有剧本：它是整条链的源头，没有入边，也就没有判语可写，
  // 那一行只能写它自己是什么（`note`，见下面的 stageOf 调用）。
  for (const s of report.stages) {
    const verdict = report.edges.find((e) => e.to === s.key)
    const tail = verdict ? '   ' + ICON[verdict.verdict] + ' ' + verdict.detail : '   ' + s.note
    lines.push('  ' + padLabel(s.label) + rowFile(s.file).padEnd(22) + secs(s.durationMs).padStart(8) + tail)
  }

  if (report.weak.length > 0) {
    lines.push('')
    for (const w of report.weak) lines.push('  ✗ ' + w)
  }
  if (report.migration.length > 0) {
    lines.push('')
    lines.push('  ？ ' + report.migration.join('、') + ' 还没有指纹，是加自检之前生成的。')
    lines.push('     跑一次 pnpm say 开始记账（其余几步跟着 pnpm video 走掉）。')
  }

  lines.push('')
  const broken = report.edges.filter((e) => e.verdict !== 'ok')
  const definite = broken.filter((e) => e.verdict === 'mismatch')
  if (broken.length === 0) {
    lines.push('  ✓ 五环是同一版。')
  } else {
    if (definite.length > 0) {
      lines.push('  ✗ ' + definite.length + ' 处确定对不上：' + definite.map((e) => EDGE_LABEL[e.edge]).join('、'))
    }
    if (broken.length > definite.length) {
      lines.push('  ？ ' + (broken.length - definite.length) + ' 处判不了（不等于没问题）')
    }
    lines.push('     想让它们跟上：pnpm say → pnpm storyboard → pnpm video')
  }
  return lines
}
