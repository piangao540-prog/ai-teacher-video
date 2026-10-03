import { chromium } from 'playwright'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { startStageServer } from './serve-dist'

const FPS = Number(process.argv[2] ?? 30)

const outRoot = path.resolve('out/render')
const framesDir = path.join(outRoot, 'frames')
const storyboardPath = path.join(outRoot, 'storyboard.json')

// 时长只有一个来源：storyboard.json（它自己又是从配音量出来的）。
// 两边读同一个文件，就不会出现「画面比声音长」这种错位。
let storyboard: { durationMs: number }
try {
  storyboard = JSON.parse(await readFile(storyboardPath, 'utf8')) as { durationMs: number }
} catch {
  throw new Error('读不到 out/render/storyboard.json，先跑 pnpm storyboard')
}

const DURATION_MS = Number(process.argv[3] ?? 0) || storyboard.durationMs
const frameCount = Math.round((DURATION_MS / 1000) * FPS)

console.log('时长: ' + DURATION_MS + 'ms  ->  ' + frameCount + ' 帧 @ ' + FPS + 'fps')

await rm(framesDir, { recursive: true, force: true })
await mkdir(framesDir, { recursive: true })

const stage = await startStageServer()
const browser = await chromium.launch()
try {
  const page = await browser.newPage({
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 1,
  })
  await page.goto(stage.url + '?render=1')
  await page.waitForFunction(() => typeof (window as any).__seek === 'function')

  const startedAt = Date.now()
  for (let f = 0; f < frameCount; f++) {
    const t = Math.round((f * 1000) / FPS)
    await page.evaluate((v: number) => (window as any).__seek(v), t)
    // 从 000001 开始编号，ffmpeg 默认就是从 1 开始找
    await page.screenshot({ path: path.join(framesDir, String(f + 1).padStart(6, '0') + '.png') })

    if (f % 60 === 0 || f === frameCount - 1) {
      const done = f + 1
      const pct = Math.round((done / frameCount) * 100)
      const secs = Math.round((Date.now() - startedAt) / 1000)
      process.stdout.write('\r  ' + done + '/' + frameCount + '   ' + pct + '%   ' + secs + 's')
    }
  }
  process.stdout.write('\n')
} finally {
  await browser.close()
  stage.close()
}

await writeFile(
  path.join(outRoot, 'render-meta.json'),
  JSON.stringify({ fps: FPS, frameCount, durationMs: DURATION_MS }, null, 2) + '\n',
)

console.log('frames: ' + framesDir)