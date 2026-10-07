// `pnpm plan` 跑完打印的那份「人眼要读的东西」。
//
// 为什么值得单独一个文件：这份打印**没法靠校验替代** ——
// 校验只管结构（段号、长度、画面装不装得下），管不了「模型编了一个不存在的 API」
// 和「这句话说的是不是这一行」。文章模式下事实来自原文，主题模式下是**凭空**写的，
// 所以这是花钱之前、也是出片之前唯一的闸门。
//
// 剥出来还有一个更实际的理由：它以前是 plan.ts 里的一个局部函数，
// 想看一眼它长什么样就得**先烧一次模型调用** —— 这个项目在「写了但没生效过」
// 上栽过好几次（`repairHint` 里就有两条），所以打印也得能单独验。

import type { Episode } from './episode'
import { findMislaidNarration, formatMislaidNarration } from './narration-hint'

/** 讲稿逐段 + 每个代码/终端场景的「每一行 ↔ 它的讲解」，拼成一整块文本。
 *
 *  返回文本、不直接打印：CLI 印它，页面把它塞进 `<pre>` ——
 *  **同一份格式只写一遍**。（这个项目在「两处各算一遍」上栽过：
 *  复用判据抄了第二份公式，在两处必然错开。）
 *
 *  顺手标出「这句话可能在讲别的行」（narration-hint.ts）—— 一条启发式，
 *  只印 ⚠、不阻断。语义那半永远只能靠这一遍读，给它打上标记，
 *  人眼就不用把每一行都重新推一遍。 */
export function formatEpisodeReview(ep: Episode): string {
  const out: string[] = []
  const put = (s: string): void => {
    out.push(s)
  }

  put('')
  put('--- 讲稿 ---')
  ep.parts.forEach((p, i) => {
    put('  [' + String(i).padStart(2) + '] ' + p.text)
  })

  const hints = new Map(findMislaidNarration(ep).map((h) => [h.sceneIndex + ':' + h.lineIndex, h]))

  ep.scenes.forEach((s, si) => {
    const props = s.props as Record<string, unknown>
    if (!Array.isArray(props.lines)) return
    put('')
    put('--- ' + s.template + ' 的每一行 ↔ 它的讲解 ---')
    const lines = props.lines as Array<{ code?: string; text?: string; kind?: string; part?: number }>
    for (const [li, l] of lines.entries()) {
      const part = l.part
      const body = l.code ?? l.text ?? ''
      const narration =
        typeof part === 'number'
          ? (ep.parts[part]?.text ?? '⚠ 引用了不存在的 part ' + part)
          : /^[\s}\]\);,]*$/.test(body)
            ? '（收尾符号，紧接上一行出现）'
            : '（铺垫行：讲稿里不专门讲它，跟着场景开头那句过渡出现）'
      put('  ' + (l.kind === 'command' ? '$ ' : '') + body)
      put('      └ ' + narration)
      const hint = hints.get(si + ':' + li)
      if (hint) put('      ' + formatMislaidNarration(hint))
    }
  })

  return out.join('\n')
}

/** 打印那份对照。CLI 用。
 *
 *  走 `write` 而不是逐行 `console.log`：这里传的是**已经拼好的整块文本**，
 *  不想让 console 的格式化规则有机会插一脚。末尾补一个换行，
 *  输出和原来逐行 `console.log` 时**逐字节相同**。 */
export function printEpisodeReview(ep: Episode): void {
  process.stdout.write(formatEpisodeReview(ep) + '\n')
}

/** 生成成功之后那几行 —— CLI 逐行打印，页面也逐行显示，**同一个来源**。
 *
 *  剥出来是因为两边都要这几行（段数 / 字数 / 估算秒数 / 场景序列），
 *  而「字 ÷ 5.3」这个估算系数只能有一个出处。 */
export function describeResult(ep: Episode, attempt: number): string[] {
  const text = ep.parts.map((p) => p.text).join('')
  const seconds = Math.round(text.length / 5.3)
  return [
    '',
    '通过校验 ✓（第 ' + attempt + ' 次）',
    '讲稿: ' + ep.parts.length + ' 段 / ' + text.length + ' 字  （约 ' + seconds + ' 秒）',
    '场景: ' + ep.scenes.map((s) => s.template).join(' -> '),
    '',
    '已写入 corpus/episode.json（旧的备份在 episode.backup.json）',
  ]
}
