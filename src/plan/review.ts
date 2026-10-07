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

/** 讲稿逐段 + 每个代码/终端场景的「每一行 ↔ 它的讲解」。
 *
 *  顺手标出「这句话可能在讲别的行」（narration-hint.ts）—— 一条启发式，
 *  只印 ⚠、不阻断。语义那半永远只能靠这一遍读，给它打上标记，
 *  人眼就不用把每一行都重新推一遍。 */
export function printEpisodeReview(ep: Episode): void {
  console.log('')
  console.log('--- 讲稿 ---')
  ep.parts.forEach((p, i) => {
    console.log('  [' + String(i).padStart(2) + '] ' + p.text)
  })

  const hints = new Map(findMislaidNarration(ep).map((h) => [h.sceneIndex + ':' + h.lineIndex, h]))

  ep.scenes.forEach((s, si) => {
    const props = s.props as Record<string, unknown>
    if (!Array.isArray(props.lines)) return
    console.log('')
    console.log('--- ' + s.template + ' 的每一行 ↔ 它的讲解 ---')
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
      console.log('  ' + (l.kind === 'command' ? '$ ' : '') + body)
      console.log('      └ ' + narration)
      const hint = hints.get(si + ':' + li)
      if (hint) console.log('      ' + formatMislaidNarration(hint))
    }
  })
}
