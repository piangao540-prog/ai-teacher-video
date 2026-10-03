import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts'
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { findFfmpeg, probeDurationMs } from '../compose/ffmpeg'
import { narrationOf, validateEpisode, type Episode } from '../plan/episode'
import { deriveTimingsFromCed, type CharTiming, type CedAnchor } from './ced-timing'
import { pcmToWav } from './wav'
import { synthesizeXfyun } from './xfyun'

// 读 .env（Node 自带，不用装 dotenv）
try {
  process.loadEnvFile('.env')
} catch {
  // 没有 .env 也能跑，走默认值
}

const PROVIDER = process.env.TTS_PROVIDER ?? 'edge'
const VOICE = process.env.TTS_VOICE ?? (PROVIDER === 'xfyun' ? 'xiaoyan' : 'zh-CN-XiaoxiaoNeural')
const SPEED = Number(process.env.TTS_SPEED ?? 50)

// 讲稿不再单独存一个 txt —— 它是从剧本的 parts 拼出来的。
// 这样就不会出现「txt 改了、剧本没改」这种两边不一致的情况。
const episodeFile = process.argv[2] ?? 'corpus/episode.json'
const outDir = path.resolve(process.argv[3] ?? 'out/render/audio')

const episodeInfo = await stat(episodeFile).catch(() => null)
if (!episodeInfo || !episodeInfo.isFile()) {
  throw new Error('找不到剧本文件：' + path.resolve(episodeFile))
}

const episode = JSON.parse(await readFile(episodeFile, 'utf8')) as Episode
const problems = validateEpisode(episode)
if (problems.length > 0) {
  console.error('剧本有问题，先改好再跑：')
  for (const p of problems) console.error('  - ' + p)
  process.exit(1)
}

const text = narrationOf(episode).trim()
if (!text) throw new Error('剧本拼出来的讲稿是空的')

// 导出一份纯文本讲稿：方便肉眼检查，以后做字幕也用得上
const renderRoot = path.resolve('out/render')
await mkdir(renderRoot, { recursive: true })
await writeFile(path.join(renderRoot, 'narration.txt'), text + '\n')

await mkdir(outDir, { recursive: true })
console.log('供应商: ' + PROVIDER)
console.log('音色:   ' + VOICE)
console.log('剧本:   ' + episode.parts.length + ' 段 / ' + text.length + ' 字')

const ffmpeg = await findFfmpeg()
let words: CharTiming[] = []
let anchors: CedAnchor[] = []
let audioFile = ''

if (PROVIDER === 'xfyun') {
  const appId = process.env.XFYUN_APPID
  const apiKey = process.env.XFYUN_APIKEY
  const apiSecret = process.env.XFYUN_APISECRET
  if (!appId || !apiKey || !apiSecret) {
    throw new Error('缺少 XFYUN_APPID / XFYUN_APIKEY / XFYUN_APISECRET，检查 .env')
  }

  const result = await synthesizeXfyun({ appId, apiKey, apiSecret, vcn: VOICE, text, speed: SPEED })

  // 保留无损 PCM，只在最后合成 mp4 时压一次。中间不再过一遍 mp3。
  audioFile = 'voice.wav'
  await writeFile(path.join(outDir, audioFile), pcmToWav(result.pcm, result.sampleRate))

  const derived = await deriveTimingsFromCed(
    ffmpeg,
    result.frames,
    text,
    path.resolve('out/tmp'),
    (payload) => pcmToWav(payload, result.sampleRate),
    '.wav',
  )
  words = derived.words
  anchors = derived.anchors
  console.log('ced 帧数: ' + result.frames.length + '  ->  推导出 ' + anchors.length + ' 个锚点')
} else {
  const tts = new MsEdgeTTS()
  await tts.setMetadata(VOICE, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3, {
    wordBoundaryEnabled: true,
  })
  const { audioFilePath, metadataFilePath } = await tts.toFile(outDir, text)
  tts.close()

  audioFile = 'voice.mp3'
  const targetPath = path.join(outDir, audioFile)
  if (path.resolve(audioFilePath) !== targetPath) await rename(audioFilePath, targetPath)

  // Edge 的时间戳单位是 tick（1 tick = 100 纳秒），除以 10000 得到毫秒
  type RawMeta = {
    Metadata?: Array<{ Type: string; Data: { Offset: number; Duration: number; text: { Text: string } } }>
  }
  if (metadataFilePath) {
    const raw = JSON.parse(await readFile(metadataFilePath, 'utf8')) as RawMeta
    for (const item of raw.Metadata ?? []) {
      if (item.Type !== 'WordBoundary') continue
      words.push({
        text: item.Data.text.Text,
        startMs: Math.round(item.Data.Offset / 10000),
        durationMs: Math.round(item.Data.Duration / 10000),
      })
    }
  }
}

const voicePath = path.join(outDir, audioFile)
const durationMs = probeDurationMs(ffmpeg, voicePath)

await writeFile(
  path.join(outDir, 'timings.json'),
  JSON.stringify(
    {
      provider: PROVIDER,
      voice: VOICE,
      text,
      audioFile,
      durationMs,
      needsAlignment: words.length === 0,
      anchors,
      words,
    },
    null,
    2,
  ) + '\n',
)

const size = (await stat(voicePath)).size
console.log('音频:   ' + voicePath + '  (' + size + ' 字节)')
console.log('时长:   ' + durationMs + ' ms')
console.log('词条数: ' + words.length)