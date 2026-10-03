import { chromium } from 'playwright'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { startStageServer } from './serve-dist'

const ms = Number(process.argv[2] ?? 1000)
const outDir = path.resolve('out/shots')
const outFile = path.join(outDir, 't-' + String(ms).padStart(5, '0') + '.png')

await mkdir(outDir, { recursive: true })

const stage = await startStageServer()
const browser = await chromium.launch()
try {
  const page = await browser.newPage({
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 1,
  })
  await page.goto(stage.url + '?render=1')
  await page.waitForFunction(() => typeof (window as any).__seek === 'function')
  await page.evaluate((v: number) => (window as any).__seek(v), ms)
  await page.screenshot({ path: outFile })
  console.log('saved: ' + outFile)
} finally {
  await browser.close()
  stage.close()
}
