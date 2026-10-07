import { execFileSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { formatReport, inspect, META_FILE, TIMINGS_FILE, VIDEO_FILE } from '../render/artifacts'
import { exists, findFfmpeg } from './ffmpeg'

const outRoot = path.resolve('out/render')
const framesPattern = path.join(outRoot, 'frames', '%06d.png')
const outFile = VIDEO_FILE

// ---- 出片前先看一眼：frames/ 里那几千张，是不是当前时间轴渲的 ----
//
// ★ 这里为什么**拦**（而「对照」那种提示只报不拦）：那条先例管的是语义判断，
//   只有人能判；这个是客观对不上，而且代价不对称 —— 静默出一条错的 mp4
//   拿去发布，比一条失败的命令贵得多。
//   （还有 `partial`：只渲了前 60 秒的 frames/ 配 `-shortest` 会**静默**
//    出一部 60 秒的片子，在这之前没有任何东西挡得住。）
//
// ★ 只卡「时间轴 → 画面」这一条，**不能卡全部**：pnpm video 走到这一步时
//   final.mp4 必然还是**上一部片子**，「画面 → 成片」那条边永远对不上，
//   卡全部就等于每次都把自己拦住。哪条边归谁卡，见 render/artifacts.ts 头注释。
const ALLOW_STALE = process.argv.includes('--allow-stale')

const report = await inspect()
const framesEdge = report.edges.find((e) => e.edge === 'storyboard->frames')!

if (framesEdge.verdict !== 'ok' && !ALLOW_STALE) {
  console.error('✗ 先别编：这批画面不是当前时间轴的产物。')
  console.error('')
  for (const line of formatReport(report)) console.error(line)
  console.error('')
  console.error('  重渲画面：pnpm frames      或者整条走一遍 pnpm video')
  console.error('  确实要拿这批画面出片：pnpm encode --allow-stale')
  process.exit(1)
}

const meta = JSON.parse(await readFile(META_FILE, 'utf8')) as {
  fps: number
  frameCount: number
}

// 音频文件名由 speak.ts 决定（讯飞给无损 wav，Edge 给 mp3）
let voicePath: string | null = null
try {
  const timings = JSON.parse(await readFile(TIMINGS_FILE, 'utf8')) as {
    audioFile?: string
  }
  const candidate = path.join(outRoot, 'audio', timings.audioFile ?? 'voice.mp3')
  if (await exists(candidate)) voicePath = candidate
} catch {
  // 没有配音也能出无声片
}

const ffmpeg = await findFfmpeg()
console.log('ffmpeg: ' + ffmpeg)
console.log('画面:   ' + meta.frameCount + ' 帧 @ ' + meta.fps + 'fps')
console.log('配音:   ' + (voicePath ?? '（无）'))

const args = ['-y', '-loglevel', 'error', '-framerate', String(meta.fps), '-i', framesPattern]
if (voicePath) args.push('-i', voicePath)

args.push('-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '18')

// 只有最后这一步是有损的。源是无损 PCM，所以 bitrate 给足。
if (voicePath) args.push('-c:a', 'aac', '-b:a', '128k', '-shortest')

args.push('-movflags', '+faststart', outFile)

execFileSync(ffmpeg, args, { stdio: 'inherit' })
console.log('video: ' + outFile)