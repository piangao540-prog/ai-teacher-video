// 创作格式与推导的自检（`pnpm check`）。
//
// 纯函数，不调模型、不读时间戳、不写任何文件 —— 几毫秒跑完，随便跑。
//
// 为什么要有这么一个文件：`pnpm plan` 那套「校验 + 重试」只告诉你**产物**合不合格，
// 推导这一步出了错，你只能靠读代码猜是哪一层。
// 这个项目吃过「要验一件事就得先烧一次 LLM 调用」的亏（所以才有 `plan --dry`）——
// 推导同样该能单独验。
//
// 它管三件事：
//   1. 范例（模型学的那个「形状」）自己必须是合法的创作格式；
//   2. 反例必须被拦住 —— 尤其是**旧格式**（模型退回写 parts / part）；
//   3. 推出来的东西必须满足不变量。**最要紧的一条**：每个写了 say 的元素，
//      它的 part 必须正好指向**它自己那一句** —— 这就是整套设计的那句承诺。
//   4. 行号（「第 N 行，」）只能是程序加的：模型写了要被拦，程序加的位置和顺序要对。

import { readFile } from 'node:fs/promises'
import { addLineNumbers, deriveEpisode, validateAuthored, type AuthoredEpisode } from './authoring'
import { checkEditorial, cnOrdinal, validateEpisode, type Episode } from './episode'

const ok: string[] = []
const bad: string[] = []
const check = (pass: boolean, what: string) => (pass ? ok : bad).push(what)

// ---- 1. 范例：模型主要靠它学「形状」，它自己必须先合法 ----
const example = JSON.parse(await readFile('corpus/example-episode.json', 'utf8'))
const exampleAuthored = validateAuthored(example)
check(exampleAuthored.length === 0, '范例是合法的创作格式' + (exampleAuthored[0] ?? ''))

const exampleEpisode = deriveEpisode(example as AuthoredEpisode)

const exampleStructural = validateEpisode(exampleEpisode)
check(exampleStructural.length === 0, '范例推导后过结构校验' + (exampleStructural[0] ?? ''))

// 范例是 few-shot，本来就比正式产出短 —— 只放行「太短」这一条
const exampleEditorial = checkEditorial(exampleEpisode).filter((p) => !p.includes('太短'))
check(exampleEditorial.length === 0, '范例推导后过编辑校验（除字数下限）' + (exampleEditorial[0] ?? ''))

// ---- 2. 不变量 ----
//
// 这条是整个改契约的**唯一承诺**：句子和它描述的元素是同一个对象。
// 只要它成立，「漂一格」就没有立足之地 —— 所以它必须被机器盯着。
function assertSameObject(authored: AuthoredEpisode, derived: Episode): string[] {
  const problems: string[] = []
  const sentences = (say: unknown): string[] =>
    typeof say === 'string' ? [say] : Array.isArray(say) ? say.filter((s) => typeof s === 'string') : []

  let lastStart = -1
  authored.scenes.forEach((scene, si) => {
    const out = derived.scenes[si]
    if (!out) {
      problems.push(`scenes[${si}] 推导后不见了`)
      return
    }
    if (out.startPart <= lastStart) problems.push(`scenes[${si}] 的 startPart 没有严格递增`)
    lastStart = out.startPart

    for (const key of ['bullets', 'lines'] as const) {
      const before = scene.props?.[key]
      const after = (out.props as Record<string, unknown>)[key]
      if (!Array.isArray(before) || !Array.isArray(after)) continue

      before.forEach((rawEl, j) => {
        const el = (rawEl ?? {}) as Record<string, unknown>
        const got = (after[j] ?? {}) as Record<string, unknown>
        const says = sentences(el.say)
        const where = `scenes[${si}].props.${key}[${j}]`

        if (says.length > 0) {
          // ★ 有 say 的元素：part 必须指向它自己的第一句
          if (got.part !== undefined && derived.parts[got.part as number]?.text !== says[0]) {
            problems.push(`${where} 的 part 没指向它自己那句 say`)
          } else if (got.part === undefined) {
            problems.push(`${where} 写了 say 却没有 part`)
          }
        }
        if ('say' in got) problems.push(`${where} 的 say 漏进了渲染格式`)
      })
    }
  })
  return problems
}

const invariantProblems = assertSameObject(example as AuthoredEpisode, exampleEpisode)
check(invariantProblems.length === 0, '范例：每个元素 ↔ 它自己的那句话' + (invariantProblems[0] ?? ''))

// 范例还得演示出两件新东西，否则模型学不到
const exampleCodeLines = (exampleEpisode.scenes[1]!.props as { lines: Array<{ part?: number }> }).lines
check(typeof exampleCodeLines[0]!.part !== 'number', '范例里 import 是铺垫行（没有 part）')
const exampleTermLines = (exampleEpisode.scenes[2]!.props as { lines: Array<{ part?: number }> }).lines
check(typeof exampleTermLines[1]!.part !== 'number', '范例里终端输出行没有 part')

// ---- 2.5 行号：模型不写，程序按顺序补 ----
//
// 这一节盯的是「编号只有一个主人」。序数检查（checkCodeNarration）能防「忘了重编号」，
// 防不了「编号自洽、句子在讲下一行」—— 第四次真跑就是这么回来的，
// 所以行号从模型手里也收走了。收走之后要保证两件事：
// 补的位置对（只补有讲解的代码行、按顺序、铺垫行不碰），以及补出来的东西自洽。
const numbered = addLineNumbers(exampleEpisode)
const narratedLines = exampleCodeLines.filter((l) => typeof l.part === 'number')
check(
  narratedLines.every((l, i) => numbered.parts[l.part!]!.text.startsWith('第' + cnOrdinal(i + 1) + '行，')),
  '补行号：有讲解的代码行按顺序拿到「第 N 行，」',
)
check(
  numbered.parts[narratedLines[0]!.part!]!.text.startsWith('第一行，用 ref'),
  '补行号：前缀加在句子最前面（原句一个字没动）',
)
check(typeof exampleCodeLines[0]!.part !== 'number', '补行号：铺垫行还是没 part（行号碰不到它）')
check(
  JSON.stringify(numbered.scenes[2]) === JSON.stringify(exampleEpisode.scenes[2]),
  '补行号：Terminal 场景不受影响',
)
check(
  JSON.stringify(addLineNumbers(numbered)) === JSON.stringify(numbered),
  '补行号是幂等的（跑两遍不会加两次）',
)
// 程序补的号必须自己就过得了那条序数检查 —— 否则「收走行号」等于把 bug 换了个位置。
const numberedEditorial = checkEditorial(numbered).filter((p) => !p.includes('太短'))
check(numberedEditorial.length === 0, '补完行号后过编辑校验（含「第 N 行」自洽）' + (numberedEditorial[0] ?? ''))

// ---- 3. 反例：这些必须被拦住 ----
//
// 第一条最要紧：模型完全可能退回旧格式（它见过的旧约定太多了），
// 而旧格式如果被当成合法输入推导，会报出一堆「段号越界」之类的次生错误，
// 反而盖住了真问题。
const rejects: Array<[string, unknown]> = [
  ['旧格式（带 parts）', { parts: [{ text: 'a' }], scenes: [{ template: 'SlideBullets', startPart: 0, props: {} }] }],
  ['场景写了 startPart', { scenes: [{ template: 'SlideBullets', startPart: 0, say: ['a'], props: {} }] }],
  ['元素写了 part', { scenes: [{ template: 'CodeTyping', say: ['a'], props: { lines: [{ code: 'x', part: 0 }] } }] }],
  ['场景一句话都没有', { scenes: [{ template: 'SlideBullets', props: { title: 'x', bullets: [{ text: 'y' }] } }] }],
  [
    '要点没有可以跟的那句话',
    { scenes: [{ template: 'SlideBullets', props: { title: 'x', bullets: [{ text: 'y', say: 'z' }, { text: 'w' }] } }] },
  ],
  ['say 是空串', { scenes: [{ template: 'SlideBullets', say: [''], props: {} }] }],
  // 行号的两个入口都要堵：元素上写（挂在错的行上）、场景上写（整句讲的是代码行，
  // 却出现在幻灯片里 —— 第四次真跑里那半句「第四行，副作用重新执行」就是这么跑掉的）
  [
    '元素 say 里写了「第 N 行」',
    { scenes: [{ template: 'CodeTyping', say: ['a'], props: { lines: [{ code: 'x', say: '第一行，y' }] } }] },
  ],
  ['场景 say 里写了「第 N 行」', { scenes: [{ template: 'SlideBullets', say: ['第一行，y'], props: {} }] }],
  ['scenes 是空的', { scenes: [] }],
  ['根本不是对象', '不是对象'],
]

for (const [name, input] of rejects) {
  check(validateAuthored(input).length > 0, `拦住反例：${name}`)
}

// ---- 汇总 ----
for (const m of ok) console.log('  ✓ ' + m)
for (const m of bad) console.log('  ✗ ' + m)
console.log('')
console.log(bad.length === 0 ? `创作格式自检通过（${ok.length} 项）` : `${bad.length} 项失败`)
process.exit(bad.length === 0 ? 0 : 1)
