import { chromium } from 'playwright'
import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileId, META_FILE, STORYBOARD_FILE } from './artifacts'
import { startStageServer } from './serve-dist'

const FPS = Number(process.argv[2] ?? 30)

const outRoot = path.resolve('out/render')
const framesDir = path.join(outRoot, 'frames')
const storyboardPath = STORYBOARD_FILE

// 关掉静态帧复用，用来和开启时逐帧对拍（见 README 里那次验证）
const NO_REUSE = process.env.FRAMES_NO_REUSE === '1'

// 时长只有一个来源：storyboard.json（它自己又是从配音量出来的）。
// 两边读同一个文件，就不会出现「画面比声音长」这种错位。
let storyboard: { durationMs: number }
try {
  storyboard = JSON.parse(await readFile(storyboardPath, 'utf8')) as { durationMs: number }
} catch {
  throw new Error('读不到 out/render/storyboard.json，先跑 pnpm storyboard')
}

// 给了第三个参数就是**缩短跑**（对拍/试片用，只渲前 N 毫秒）。
// ★ 这件事必须记进 render-meta：不然一个只渲了 60 秒的 frames/ 目录，
//   从记录上看和整片一模一样，而 encode 拿它配 `-shortest` 会**静默**
//   出一部 60 秒的片子 —— 没有任何东西挡得住。
const argDuration = Number(process.argv[3] ?? 0)
const DURATION_MS = argDuration || storyboard.durationMs
const PARTIAL = argDuration > 0
const frameCount = Math.round((DURATION_MS / 1000) * FPS)

console.log('时长: ' + DURATION_MS + 'ms  ->  ' + frameCount + ' 帧 @ ' + FPS + 'fps')
if (PARTIAL) console.log('★ 缩短跑：只渲前 ' + DURATION_MS + 'ms，不是整片')
if (NO_REUSE) console.log('静态帧复用: 关闭（对拍模式）')

await rm(framesDir, { recursive: true, force: true })
await mkdir(framesDir, { recursive: true })

const stage = await startStageServer()
const browser = await chromium.launch()

// 从 000001 开始编号，ffmpeg 默认就是从 1 开始找
const framePath = (f: number): string => path.join(framesDir, String(f).padStart(6, '0') + '.png')

try {
  const page = await browser.newPage({
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 1,
  })
  // fps 仍然带给页面：调试时能从 URL 看出这一遍是按几帧跑的
  // （复用判据不再需要它 —— 上一帧的真实时刻由下面的 prevT 直接传）
  await page.goto(stage.url + '?render=1&fps=' + FPS)
  await page.waitForFunction(() => typeof (window as any).__seek === 'function')

  const startedAt = Date.now()
  let reused = 0
  let prevPath: string | null = null
  let tReuse = 0
  let tRender = 0
  let tAsk = 0
  let tLink = 0

  for (let f = 0; f < frameCount; f++) {
    const t = Math.round((f * 1000) / FPS)
    // 上一帧的**真实**时刻。不能让页面用 fps 反算：1000/30 = 33.333，
    // 而这里真实的间隔是 33 或 34 —— 差的零点几毫秒正好踩在
    // 字幕 / 字符出现的整数边界上，判据就会在边界帧上翻车。
    const prevT = f > 0 ? Math.round(((f - 1) * 1000) / FPS) : -1
    const target = framePath(f + 1)
    const t0 = performance.now()

    // ★ 先问、再 seek。
    //
    //   __static 是「时间 + storyboard」的纯函数，不依赖页面当前停在哪一帧 ——
    //   所以可以在 seek 之前就问。这一条很关键：
    //   seek 内部要等两个 requestAnimationFrame（约 11ms），
    //   如果复用的帧也付这笔钱，省下的就只有截图。
    const q0 = performance.now()
    const canReuse =
      !NO_REUSE &&
      prevPath !== null &&
      (await page.evaluate(
        ([c, p]) => (window as any).__static(c, p),
        [t, prevT] as [number, number],
      ))
    tAsk += performance.now() - q0

    if (canReuse && prevPath !== null) {
      // 同一张画面：不 seek、不截图，把上一帧的文件复制过来。
      //
      // ★ 用**复制**而不是硬链接。本来想的是「硬链接不复制数据，几乎不花时间」，
      //   实测恰恰相反：在这个有几万个文件的目录里，link() 要 47ms/次，
      //   而 copyFile() 只要 6.5ms —— 复制反而快 7 倍，直接决定了这个功能
      //   是提速还是负优化。（另外 NTFS 单文件硬链接上限 1024，超了会报错。）
      const l0 = performance.now()
      await copyFile(prevPath, target)
      tLink += performance.now() - l0
      reused++
      tReuse += performance.now() - t0
    } else {
      await page.evaluate((v: number) => (window as any).__seek(v), t)
      await page.screenshot({ path: target })
      prevPath = target
      tRender += performance.now() - t0
    }

    if (f % 60 === 0 || f === frameCount - 1) {
      const done = f + 1
      const pct = Math.round((done / frameCount) * 100)
      const secs = Math.round((Date.now() - startedAt) / 1000)
      process.stdout.write(
        '\r  ' + done + '/' + frameCount + '   ' + pct + '%   ' + secs + 's   复用 ' + reused,
      )
    }
  }
  process.stdout.write('\n')
  console.log('静态帧复用: ' + reused + ' / ' + frameCount + '（' + Math.round((reused / frameCount) * 100) + '%）')
  const rendered = frameCount - reused
  console.log(
    '  复用帧: ' + reused + ' 帧，合计 ' + (tReuse / 1000).toFixed(1) + 's（' +
      (tReuse / Math.max(1, reused)).toFixed(1) + 'ms/帧）',
  )
  console.log(
    '  渲染帧: ' + rendered + ' 帧，合计 ' + (tRender / 1000).toFixed(1) + 's（' +
      (tRender / Math.max(1, rendered)).toFixed(1) + 'ms/帧）',
  )
  console.log(
    '    其中 __static 询问: ' + (tAsk / 1000).toFixed(1) + 's（' + (tAsk / frameCount).toFixed(2) + 'ms/帧）',
  )
  console.log(
    '    其中 link/copy   : ' + (tLink / 1000).toFixed(1) + 's（' + (tLink / Math.max(1, reused)).toFixed(2) +
      'ms/次）',
  )
} finally {
  await browser.close()
  stage.close()
}

// 这份记录是「`frames/` 里那几千张 PNG 属于哪一版」的**唯一**依据 ——
// 单张 PNG 上没有任何地方能记这件事。所以指纹一定要写。
// 注意指纹取的是**刚读的那个文件**，读完到这里之间没有别人动过它。
await writeFile(
  META_FILE,
  JSON.stringify(
    {
      fps: FPS,
      frameCount,
      durationMs: DURATION_MS,
      builtFrom: { storyboard: await fileId(storyboardPath) },
      partial: PARTIAL,
    },
    null,
    2,
  ) + '\n',
)

console.log('frames: ' + framesDir)