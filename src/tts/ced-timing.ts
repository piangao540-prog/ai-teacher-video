import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { probeDurationMs } from '../compose/ffmpeg'
import type { XfyunFrame } from './xfyun'

export type CharTiming = { text: string; startMs: number; durationMs: number }
export type CedAnchor = { byte: number; ms: number }

/**
 * 从讯飞的 ced 推导每个字的时间。
 *
 * ced 是「已合成文本的字节数」，本身不含时间。但把每一帧的音频累加起来量出时长，
 * 就能得到一组锚点：
 *
 *     音频走到 3450ms 时，文本已经合成到第 45 字节
 *
 * 有了锚点，任意字节位置的时刻按比例插值就能算出来。
 *
 * ⚠️ 这是实测出来的行为，官方文档没说 ced 可以这么用。
 *    所以这里做了单调性检查：一旦讯飞改了行为，直接报错，
 *    而不是悄悄给出一份错误的时间戳（那会让画面和声音错位，且很难查）。
 *
 * @param wrap 把累积的裸数据包成 ffmpeg 认得的容器（PCM 需要补 WAV 头）
 */
export async function deriveTimingsFromCed(
  ffmpeg: string,
  frames: XfyunFrame[],
  text: string,
  tmpDir: string,
  wrap: (payload: Buffer) => Buffer,
  ext: string,
): Promise<{ words: CharTiming[]; anchors: CedAnchor[] }> {
  await mkdir(tmpDir, { recursive: true })
  const accPath = path.join(tmpDir, 'acc' + ext)

  const acc: Buffer[] = []
  const frameEndMs: number[] = []
  for (const f of frames) {
    acc.push(f.audio)
    await writeFile(accPath, wrap(Buffer.concat(acc)))
    frameEndMs.push(probeDurationMs(ffmpeg, accPath))
  }

  // 同一个 ced 会连续出现在好几帧里，只保留它最后一次出现的时刻
  const anchors: CedAnchor[] = []
  for (let i = 0; i < frames.length; i++) {
    const byte = Number(frames[i]!.ced)
    if (!Number.isFinite(byte)) continue
    const last = anchors[anchors.length - 1]
    if (last && last.byte === byte) last.ms = frameEndMs[i]!
    else anchors.push({ byte, ms: frameEndMs[i]! })
  }

  for (let i = 1; i < anchors.length; i++) {
    const a = anchors[i - 1]!
    const b = anchors[i]!
    if (b.byte <= a.byte || b.ms < a.ms) {
      throw new Error(
        'ced 锚点不单调（' + a.byte + '@' + a.ms + 'ms -> ' + b.byte + '@' + b.ms + 'ms）。' +
          '讯飞可能改了 ced 的含义，需要改用 whisper 做对齐。',
      )
    }
  }
  if (anchors.length < 2) throw new Error('ced 锚点太少（' + anchors.length + ' 个），无法推导时间')

  function timeAtByte(byte: number): number {
    const first = anchors[0]!
    if (byte <= first.byte) return Math.round((byte / first.byte) * first.ms)
    for (let i = 1; i < anchors.length; i++) {
      const a = anchors[i - 1]!
      const b = anchors[i]!
      if (byte <= b.byte) {
        const r = (byte - a.byte) / (b.byte - a.byte)
        return Math.round(a.ms + r * (b.ms - a.ms))
      }
    }
    return anchors[anchors.length - 1]!.ms
  }

  let b = 0
  const words: CharTiming[] = []
  for (const ch of text) {
    const len = Buffer.byteLength(ch, 'utf8')
    const startMs = timeAtByte(b)
    const endMs = timeAtByte(b + len)
    words.push({ text: ch, startMs, durationMs: Math.max(0, endMs - startMs) })
    b += len
  }

  return { words, anchors }
}