import { execFileSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { exists, findFfmpeg } from './ffmpeg'

const outRoot = path.resolve('out/render')
const framesPattern = path.join(outRoot, 'frames', '%06d.png')
const outFile = path.join(outRoot, 'final.mp4')

const meta = JSON.parse(await readFile(path.join(outRoot, 'render-meta.json'), 'utf8')) as {
  fps: number
  frameCount: number
}

// 音频文件名由 speak.ts 决定（讯飞给无损 wav，Edge 给 mp3）
let voicePath: string | null = null
try {
  const timings = JSON.parse(await readFile(path.join(outRoot, 'audio', 'timings.json'), 'utf8')) as {
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