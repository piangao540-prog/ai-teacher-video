import { chromium } from 'playwright'
import { mkdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { startStageServer } from './serve-dist'

// 用法：
//   pnpm shot 20000        截第 20000ms 那一帧
//   pnpm shot 20000 5      连截 5 帧（每 400ms 一帧），用来看动效/字幕换行
//   pnpm shot --cue 3      截第 3 条字幕中间那一帧 —— 校对字幕最顺手的方式
//
// 环境变量 SUBTITLE_VARIANT=box|outline|glass|bar 可以指定字幕外观，
// 用来把几种样式各截一帧摆在一起比。
const args = process.argv.slice(2)

const variant = process.env.SUBTITLE_VARIANT
const variantQuery = variant ? '&subs=' + encodeURIComponent(variant) : ''

const outDir = path.resolve('out/shots')
await mkdir(outDir, { recursive: true })

let ms = 1000
let count = 1

if (args[0] === '--cue') {
  const want = Number(args[1] ?? 0)
  const storyboard = JSON.parse(await readFile(path.resolve('out/render/storyboard.json'), 'utf8')) as {
    cues?: Array<{ i: number; startMs: number; endMs: number; text: string }>
  }
  const cue = storyboard.cues?.[want]
  if (!cue) throw new Error('没有第 ' + want + ' 条字幕（一共 ' + (storyboard.cues?.length ?? 0) + ' 条）')
  // 取这条字幕的正中间，最能代表它长什么样
  ms = Math.round((cue.startMs + cue.endMs) / 2)
  console.log('字幕[' + cue.i + '] ' + cue.startMs + 'ms -> ' + cue.endMs + 'ms   「' + cue.text + '」')
} else {
  ms = Number(args[0] ?? 1000)
  count = Math.max(1, Number(args[1] ?? 1))
}

const stage = await startStageServer()
const browser = await chromium.launch()
try {
  const page = await browser.newPage({
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 1,
  })
  await page.goto(stage.url + '?render=1' + variantQuery)
  await page.waitForFunction(() => typeof (window as any).__seek === 'function')

  for (let i = 0; i < count; i++) {
    const at = ms + i * 400
    const suffix = variant ? '-' + variant : ''
    const outFile = path.join(outDir, 't-' + String(at).padStart(6, '0') + suffix + '.png')
    await page.evaluate((v: number) => (window as any).__seek(v), at)
    await page.screenshot({ path: outFile })
    console.log('saved: ' + outFile)
  }
} finally {
  await browser.close()
  stage.close()
}
