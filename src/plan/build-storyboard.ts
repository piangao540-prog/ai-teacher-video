import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { validateEpisode, type Episode } from './episode'

type Word = { text: string; startMs: number; durationMs: number }

// 打字速度。必须和 CodeTyping.vue 里的 CHAR_MS 保持一致。
const CHAR_MS = 45
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
  words: Word[]
}

// 只保留「字」：汉字、字母、数字。
//
// 为什么必须清洗？因为 TTS 返回的词表里没有标点和空格 ——
// 它给的是「我们 / 先 / 从 / Vue / 3 / 的 / 响应 / 式 / 原理 / 说 / 起」，
// 讲稿里的「。」「，」「：」在词表里根本不存在。
// 两边用同一把尺子量过，才可能对上。
function normalize(s: string): string {
  return s.replace(/[^\p{Script=Han}\p{L}\p{N}]/gu, '')
}

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
  } else {
    throw new Error('不认识的场景模板「' + s.template + '」。要么拼错了，要么还没在 Stage.vue 里注册。')
  }

  return { id: 's' + (si + 1), template: s.template, startMs, endMs, props }
})

const storyboard = {
  durationMs: timings.durationMs,
  audioFile: timings.audioFile,
  provider: timings.provider,
  voice: timings.voice,
  scenes,
}

await writeFile(path.join(outRoot, 'storyboard.json'), JSON.stringify(storyboard, null, 2) + '\n')

console.log('总时长: ' + storyboard.durationMs + 'ms  /  ' + scenes.length + ' 个场景')
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
    const src = (episode.scenes[si]!.props as { lines: Array<{ code: string; part?: number }> }).lines
    const printed = p.lines as Array<{ code: string; atMs: number }>
    printed.forEach((l, j) => {
      // 把这一行对应的讲解也打出来 —— 一眼就能看出画面和声音对不对得上
      const part = src[j]?.part
      const narration = typeof part === 'number' ? episode.parts[part]!.text : '（无讲解，紧接上一行）'
      console.log('    +' + String(l.atMs).padStart(6) + 'ms   ' + l.code)
      console.log('                  └ ' + narration)
    })
  }
}
console.log('')
console.log('storyboard.json 已生成')