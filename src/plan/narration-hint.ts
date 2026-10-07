// 「这句话可能在讲别的行」的启发式提示。
//
// ★ 这是**提示**，不是校验 —— 读它的地方只印 ⚠，不触发重试。
//
// 为什么要有它：四次「画面漂一格」最后都落到同一个语义问题上 ——
// **这句话说的是不是这一行**。结构那一半已经封死了（段号、行号都归程序，
// 模型写一个数就被拦），但语义那一半机器判不了，DESIGN 里那句
// 「兜底只有人眼逐行读」到现在仍然成立。上一轮真跑的唯一一处错
//（Terminal 里 `0 / 1 / 2` 和「解构丢响应式」反着讲）就是读出来的，校验一声没吭。
//
// 这条启发式只抓其中**一张固定的脸**：某行的讲解里出现了**只在这一行后面才出现**
// 的标识符，而这一行自己根本没有它。历史的翻车正是这张脸 ——
// `const state = reactive({ n: 0 })` 上挂着「effect 注册一个副作用函数」，
// 而 `effect` 在下一行。
//
// 判据的核心是「**还没登场**」：讲解里提到的名字，如果它在**这一行之前讲过的行**
// 里已经出现过，那是正常的回指（「再改 state 里的 n，effect 就会重新执行」——
// `effect` 在前面那行讲过）；只有**第一次登场就在后面**的名字，才说明这句话
// 提前讲了下一行的东西。（「讲过的行」这个口径很要紧，见下面 firstSeen 那一段。）
//
// 校准：拿 git 里那份**已知有错**的旧剧本（828992f 的 corpus/episode.json，
// setup 行偷下一行讲解那版）试过 —— 三个错处抓到两个，写对的那个没冤枉。
//
// 为什么不做成硬校验：它是启发式 —— 会**漏**（Terminal 那种输出值的语义它看不见，
// 它只认标识符），也可能**误报**，而误报会变成一次白跑的重试。
// 它的价值是把人眼那一遍从「逐行读 N 行」缩成「只看带 ⚠ 的几行」，
// 不是替掉那一遍。

import type { Episode } from './episode'

export type MislaidNarration = {
  sceneIndex: number
  /** 在 props.lines 里的下标 */
  lineIndex: number
  /** 这一行是「写了 say 的第 N 行」—— 和讲解里「第 N 行」同一个口径 */
  ordinal: number
  /** 这一行的代码（原文） */
  body: string
  narration: string
  /** 讲解里提到、却只在这一行后面才出现的标识符 */
  suspects: Array<{ name: string; body: string }>
}

// 代码里长得像标识符的 token。
// 排除关键字和几个到处都是的名字 —— 它们出现在讲解里说明不了任何事。
const IGNORED = new Set([
  'const', 'let', 'var', 'function', 'return', 'import', 'from', 'export', 'default',
  'true', 'false', 'null', 'undefined', 'if', 'else', 'for', 'while', 'new', 'typeof',
  'console', 'log', 'window', 'document', 'this',
])

const TOKEN = /[A-Za-z_$][A-Za-z0-9_$]*/g

function tokensOf(text: string): string[] {
  return text.match(TOKEN) ?? []
}

/** 只认 CodeTyping：这条启发式的判据是「代码行里的标识符」。
 *  Terminal 的 text 是命令行、输出行又没有讲解，套过来只会误报。 */
export function findMislaidNarration(ep: Episode): MislaidNarration[] {
  const out: MislaidNarration[] = []

  ep.scenes.forEach((scene, si) => {
    if (scene.template !== 'CodeTyping') return
    const props = scene.props as Record<string, unknown>
    if (!Array.isArray(props.lines)) return
    const lines = props.lines as Array<{ code?: string; part?: number }>

    const bodyOf = (l: { code?: string }): string => l.code ?? ''
    const namesPerLine = lines.map((l) => new Set(tokensOf(bodyOf(l))))

    // 每个名字**第一次**出现在哪一行 —— 用来区分「还没登场」和「回指」。
    //
    // ★ 只有**写了 part 的行**才算「引入」一个名字。铺垫行（`import` 那种）不算。
    //   这一条是拿旧剧本校准出来的：第一版把所有行都算进去，结果三个已知的翻车
    //   一个都没抓到 —— 因为「偷来的」那个名字（`effect` / `toRefs`）**恰好就写在
    //   `import` 那一行里**，于是被当成「前面见过」，直接放行。
    //   铺垫行是观众看得见、讲稿却从不讲的东西，不能拿它当「已经出现过」的依据。
    const firstSeen = new Map<string, number>()
    lines.forEach((l, k) => {
      if (typeof l.part !== 'number') return
      for (const name of namesPerLine[k]!) if (!firstSeen.has(name)) firstSeen.set(name, k)
    })

    // 「写了 say 的第 N 行」—— 和 addLineNumbers / checkCodeNarration 同一个口径，
    // 铺垫行不数进去。这里只用它把提示说得具体一点。
    let nth = 0
    const ordinals = new Map<number, number>()
    lines.forEach((l, j) => {
      if (typeof l.part !== 'number') return
      nth += 1
      ordinals.set(j, nth)
    })

    lines.forEach((l, j) => {
      if (typeof l.part !== 'number') return
      const narration = ep.parts[l.part]?.text
      if (!narration) return

      const suspects = new Map<string, string>()
      for (const name of tokensOf(narration)) {
        if (IGNORED.has(name)) continue
        if (namesPerLine[j]!.has(name)) continue // 这一行自己有 → 没话说
        const first = firstSeen.get(name)
        if (first === undefined || first <= j) continue // 前面出现过（或压根没有）→ 回指，正常
        suspects.set(name, bodyOf(lines[first]!).trim())
      }
      if (suspects.size === 0) return

      out.push({
        sceneIndex: si,
        lineIndex: j,
        ordinal: ordinals.get(j)!,
        body: bodyOf(l).trim(),
        narration,
        suspects: [...suspects].map(([name, body]) => ({ name, body })),
      })
    })
  })

  return out
}

/** 提示的打印文案。放这儿是为了 `pnpm plan` 和别处**说同一句话**。 */
export function formatMislaidNarration(h: MislaidNarration): string {
  const cut = (s: string): string => (s.length > 34 ? s.slice(0, 33) + '…' : s)
  const where = h.suspects.map((s) => '`' + s.name + '`（在后面的 `' + cut(s.body) + '` 上）').join('、')
  return '⚠ 讲解里提到 ' + where + '，这一行没有它 —— 核对一下这句说的是不是这一行'
}
