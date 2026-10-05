// 外挂字幕：把 cues 写成 .srt / .vtt，给 B 站、YouTube 这些平台用。
//
// 画面里那份字幕是**烧进去**的（Subtitle.vue 那一层，逐帧渲染天然带上），
// 这两个文件是**同一份数据**的另一种出口 —— 数据来源都是 storyboard 的 cues，
// 所以不会出现「画面上一句、外挂文件里另一句」。
//
// 两种格式的差别（就三处，但每一处错了播放器就不认）：
//
//   SRT                               VTT
//   ------------------------------    ------------------------------
//   第一行是序号 1、2、3…              序号可以省略（这里省略）
//   时间用**逗号**分隔毫秒             时间用**点**分隔毫秒
//   没有文件头                        第一行必须是 WEBVTT
//
// ★ 关于换行：这里用 cue.text，**不用** cue.lines。
//   lines 是给 1080p 画面折好的行（一条字幕一行，26 字上限），
//   那是为固定宽度的画布算的。播放器自己会按窗口宽度折行，
//   硬塞进去反而可能折出更难看的结果。

import type { Cue } from './subtitle'

/** 毫秒 → `HH:MM:SS,mmm`（VTT 用 '.' 代替 ','） */
export function formatTimecode(ms: number, sep: ',' | '.' = ','): string {
  const t = Math.max(0, Math.round(ms))
  const h = Math.floor(t / 3_600_000)
  const m = Math.floor((t % 3_600_000) / 60_000)
  const s = Math.floor((t % 60_000) / 1000)
  const milli = t % 1000
  const pad = (n: number, w: number): string => String(n).padStart(w, '0')
  return pad(h, 2) + ':' + pad(m, 2) + ':' + pad(s, 2) + sep + pad(milli, 3)
}

/**
 * SRT。
 *
 * 序号这里按**数组位置**重新数（从 1 开始），不用 cue.i ——
 * cue.i 是渲染层从 0 数的调试编号。两者现在恰好只差 1，
 * 但拿它当 SRT 序号是把两套编号绑在一起，将来动一处就会悄悄错位。
 */
export function toSrt(cues: Cue[]): string {
  const blocks = cues.map((c, i) => {
    return (
      String(i + 1) + '\n' +
      formatTimecode(c.startMs, ',') + ' --> ' + formatTimecode(c.endMs, ',') + '\n' +
      c.text
    )
  })
  return blocks.join('\n\n') + '\n'
}

/** VTT。除了文件头和点分隔，正文和 SRT 是同一份东西 */
export function toVtt(cues: Cue[]): string {
  const blocks = cues.map((c) => {
    return (
      formatTimecode(c.startMs, '.') + ' --> ' + formatTimecode(c.endMs, '.') + '\n' +
      c.text
    )
  })
  return 'WEBVTT\n\n' + blocks.join('\n\n') + '\n'
}
