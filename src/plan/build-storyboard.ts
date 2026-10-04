import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { validateEpisode, type Episode } from './episode'
import { buildCues, norm } from './subtitle'
// ★ 打字速度从 sceneState.ts import，不再在这里抄一份。
//   这个常量决定「第几个字符什么时候出现」，分镜和渲染必须是同一个值 ——
//   以前两边各写一个 45、靠一句注释维持，正是复用判据踩过的那种坑。
import { CHAR_MS, termLineDurationMs } from '../render/scenes/sceneState'

type Word = { text: string; startMs: number; durationMs: number }

const LINE_GAP_MS = 200

const outRoot = path.resolve('out/render')

const episode = JSON.parse(await readFile(path.resolve('corpus/episode.json'), 'utf8')) as Episode

const problems = validateEpisode(episode)
if (problems.length > 0) {
  console.error('剧本有问题，先改好再跑：')
  for (const p of problems) console.error('  - ' + p)
  process.exit(1)
}

const timings = JSON.parse(await readFile(path.join(outRoot, 'audio', 'timings.json'), 'utf8')) as {
  durationMs: number
  audioFile: string
  provider: string
  voice: string
  // 讲稿原文：字幕断句要用它的标点，所以必须一起读进来
  text: string
  words: Word[]
}

// 只保留「字」：汉字、字母、数字。
//
// 为什么必须清洗？因为 TTS 返回的词表里没有标点和空格 ——
// 它给的是「我们 / 先 / 从 / Vue / 3 / 的 / 响应 / 式 / 原理 / 说 / 起」，
// 讲稿里的「。」「，」「：」在词表里根本不存在。
// 两边用同一把尺子量过，才可能对上。
//
// 这把尺子现在只有一份：subtitle.ts 里的 norm。
// 字幕断句用的也是它 —— 两边各写一份，迟早会漂。
const normalize = norm

let indexText = ''
const wordStart: number[] = []
for (const w of timings.words) {
  wordStart.push(indexText.length)
  indexText += normalize(w.text)
}

// 算出「每一段讲稿」从第几毫秒开始念。
//
// 这是整套对齐的基石：只要拿到第 i 段的开始时间，
// 画面元素写 { "part": i } 就能精确卡在那句话开口的瞬间。
//
// 用游标顺序查找：段本来就是按顺序拼成讲稿的，所以一路往前找就行，
// 不需要（也不能）回头找。
let cursor = 0
const partTimes = episode.parts.map((p, i) => {
  const needle = normalize(p.text)
  if (!needle) throw new Error('parts[' + i + '] 清洗后是空的（全是标点？）')

  const at = indexText.indexOf(needle, cursor)
  if (at < 0) {
    throw new Error(
      '在讲稿里找不到 parts[' + i + '] 这段：\n' +
        '  ' + needle.slice(0, 40) + '\n' +
        '  常见原因：这段文字 TTS 读成了别的写法，或者讲稿和配音不是同一次生成的（重跑 pnpm say）。',
    )
  }

  let wi = 0
  while (wi + 1 < wordStart.length && wordStart[wi + 1]! <= at) wi++
  cursor = at + needle.length
  return timings.words[wi]!.startMs
})

const scenes = episode.scenes.map((s, si) => {
  const startMs = partTimes[s.startPart]!
  const next = episode.scenes[si + 1]
  const endMs = next ? partTimes[next.startPart]! : timings.durationMs

  let props: Record<string, unknown>

  if (s.template === 'SlideBullets') {
    const p = s.props as { title: string; bullets: Array<{ text: string; part: number }> }
    props = {
      title: p.title,
      titleAtMs: 0,
      bullets: p.bullets.map((b) => ({ text: b.text, atMs: Math.max(0, partTimes[b.part]! - startMs) })),
    }
  } else if (s.template === 'CodeTyping') {
    const p = s.props as { fileName: string; lines: Array<{ code: string; part?: number }> }
    let prevEnd = -1
    const lines = p.lines.map((l) => {
      // 有 part 的行：卡在那段讲解开口时出现。
      // 没有 part 的行（收尾大括号）：等上一行打完再出现。
      const fromPart = typeof l.part === 'number' ? partTimes[l.part]! - startMs : null
      const minAt = prevEnd < 0 ? 0 : prevEnd + LINE_GAP_MS
      const atMs = fromPart === null ? minAt : Math.max(fromPart, minAt)
      prevEnd = atMs + l.code.length * CHAR_MS
      return { code: l.code, atMs }
    })
    props = { fileName: p.fileName, lines }
  } else if (s.template === 'Terminal') {
    const p = s.props as {
      title?: string
      prompt?: string
      lines: Array<{ text: string; kind: 'command' | 'output'; part?: number }>
    }
    let prevEnd = -1
    const lines = p.lines.map((l) => {
      // 命令：卡在那段讲解开口时开始打。
      // 输出：不写 part，紧接在自己那条命令打完之后出现。
      const fromPart = typeof l.part === 'number' ? partTimes[l.part]! - startMs : null
      const minAt = prevEnd < 0 ? 0 : prevEnd + LINE_GAP_MS
      const atMs = fromPart === null ? minAt : Math.max(fromPart, minAt)
      // 输出不占时间（整行出现），命令按字符数占时间
      prevEnd = atMs + termLineDurationMs(l)
      return { text: l.text, kind: l.kind, atMs }
    })
    props = { title: p.title, prompt: p.prompt ?? '$', lines }
  } else {
    throw new Error('不认识的场景模板「' + s.template + '」。要么拼错了，要么还没在 Stage.vue 里注册。')
  }

  return { id: 's' + (si + 1), template: s.template, startMs, endMs, props }
})

// ---- 字幕 ----
//
// 字幕不需要 AI 参与：讲稿原文管断句，词级时间戳管时间。
// 所以它是 storyboard 这一步的副产物 —— 重跑一次 storyboard 就能改字幕，
// 不用重新配音，也不用重新生成剧本。
//
// 传的是 parts 的**文字**而不是 partTimes：段的文字能给出确定的字符边界，
// 用时刻反推词边界会被 TTS 的词条粒度坑（详见 subtitle.ts 里的注释）。
const cues = buildCues(timings.text, timings.words, episode.parts.map((p) => p.text))

// 覆盖率自检：所有字幕拼起来，必须正好是整篇讲稿的每一个字。
//
// 这条检查是为了防「静默漏字」—— 断句算法一旦吃掉一个字，
// 画面上就会少一句话，而且没人会发现。所以让它在这里就撞墙。
const covered = cues.map((c) => normalize(c.text)).join('')
const expected = normalize(timings.text ?? '')
if (covered !== expected) {
  throw new Error(
    '字幕和讲稿对不上（断句算法漏字或串位了）：\n' +
      '  讲稿 ' + expected.length + ' 字，字幕拼起来 ' + covered.length + ' 字\n' +
      '  第一处不同在 ' +
      (() => {
        for (let i = 0; i < Math.max(covered.length, expected.length); i++) {
          if (covered[i] !== expected[i]) {
            return '第 ' + i + ' 字：讲稿「' + (expected[i] ?? '（结束）') + '」vs 字幕「' + (covered[i] ?? '（结束）') + '」'
          }
        }
        return '（长度不同但前缀一致）'
      })(),
  )
}

const storyboard = {
  durationMs: timings.durationMs,
  audioFile: timings.audioFile,
  provider: timings.provider,
  voice: timings.voice,
  scenes,
  cues,
}

await writeFile(path.join(outRoot, 'storyboard.json'), JSON.stringify(storyboard, null, 2) + '\n')

console.log('总时长: ' + storyboard.durationMs + 'ms  /  ' + scenes.length + ' 个场景  /  ' + cues.length + ' 条字幕')
console.log('')
console.log('--- 每段讲稿的开始时间 ---')
partTimes.forEach((ms, i) => {
  console.log('  [' + String(i).padStart(2) + '] +' + String(ms).padStart(6) + 'ms   ' + episode.parts[i]!.text)
})

for (const [si, sc] of scenes.entries()) {
  console.log('')
  console.log('场景 ' + sc.id + '  [' + sc.template + ']  ' + sc.startMs + 'ms -> ' + sc.endMs + 'ms')
  const p = sc.props as Record<string, unknown>
  if (typeof p.title === 'string') console.log('    标题: ' + p.title)
  if (Array.isArray(p.bullets)) {
    for (const b of p.bullets as Array<{ text: string; atMs: number }>) {
      console.log('    +' + String(b.atMs).padStart(6) + 'ms   ' + b.text)
    }
  }
  if (typeof p.fileName === 'string') console.log('    文件: ' + p.fileName)
  if (Array.isArray(p.lines)) {
    // part 在「源剧本」里，不在输出对象里 —— 从输出对象读会永远读不到
    const src = (episode.scenes[si]!.props as {
      lines: Array<{ code?: string; text?: string; kind?: string; part?: number }>
    }).lines
    const printed = p.lines as Array<{ code?: string; text?: string; kind?: string; atMs: number }>
    printed.forEach((l, j) => {
      // 把这一行对应的讲解也打出来 —— 一眼就能看出画面和声音对不对得上
      const part = src[j]?.part
      const narration = typeof part === 'number' ? episode.parts[part]!.text : '（无讲解，紧接上一行）'
      // Terminal 用 $ 标出命令，和输出区分开
      const mark = l.kind === 'command' ? '$ ' : ''
      console.log('    +' + String(l.atMs).padStart(6) + 'ms   ' + mark + (l.code ?? l.text ?? ''))
      console.log('                  └ ' + narration)
    })
  }
}
console.log('')
console.log('storyboard.json 已生成')

// 把字幕整条打出来：一眼就能看出有没有「一条字幕挂太久」「断句断在半句上」
console.log('')
console.log('--- 字幕 ---')
for (const c of cues) {
  const secs = ((c.endMs - c.startMs) / 1000).toFixed(1)
  console.log(
    '  [' + String(c.i).padStart(2) + '] ' +
      String(c.startMs).padStart(6) + 'ms +' + secs + 's  ' +
      c.lines.join(' / '),
  )
}