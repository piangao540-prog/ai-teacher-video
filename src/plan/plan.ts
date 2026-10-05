import { copyFile, writeFile } from 'node:fs/promises'
import { addLineNumbers, deriveEpisode, validateAuthored, type AuthoredEpisode } from './authoring'
import { checkEditorial, validateEpisode, type Episode } from './episode'
import { SYSTEM_PROMPT, buildUserPrompt } from './prompt'
import { describeSource, persistTopic, resolveSource, type Source } from './source'

// 读 .env（Node 自带，不用装 dotenv）
try {
  process.loadEnvFile('.env')
} catch {
  // 没有 .env 也能跑，走默认值
}

const BASE_URL = (process.env.LLM_BASE_URL ?? '').replace(/\/+$/, '')
const API_KEY = process.env.LLM_API_KEY ?? ''
const MODEL = process.env.LLM_MODEL ?? ''
const TEMPERATURE = Number(process.env.LLM_TEMPERATURE ?? 0.7)
const MAX_ATTEMPTS = Number(process.env.LLM_ATTEMPTS ?? 3)

// 先把输入解析清楚（纯读盘，不碰网络）—— 这样 --dry 才能零成本看一眼判别结果。
const args = process.argv.slice(2).filter((a) => !a.startsWith('--'))
const DRY = process.argv.includes('--dry')
const source: Source = await resolveSource(args)

if (DRY) {
  console.log(describeSource(source))
  console.log('（--dry：只判别输入，不发请求、不写任何文件）')
  process.exit(0)
}

if (!BASE_URL || !API_KEY || !MODEL) {
  console.error('还没配好大模型。在 .env 里补上这三项：')
  console.error('')
  console.error('  LLM_BASE_URL=https://api.deepseek.com/v1')
  console.error('  LLM_API_KEY=你的key')
  console.error('  LLM_MODEL=deepseek-chat')
  console.error('')
  console.error('任何 OpenAI 兼容接口都行（DeepSeek / Moonshot / OpenAI / 本地 vLLM…）。')
  process.exit(1)
}

console.log('模型:   ' + MODEL)
console.log('接口:   ' + BASE_URL)
console.log(describeSource(source))

if (source.kind === 'topic') {
  // 主题落盘：输入永远躺在同一个位置，下次不带参数跑也能复现这次。
  // 备份只在「这次要盖掉的是一篇文章」时做 —— 理由见 source.ts 里 persistTopic 的注释。
  const backedUp = await persistTopic(source.text)
  console.log('已写入 corpus/source.md' + (backedUp ? '（原来那篇文章备份在 corpus/source.backup.md）' : ''))
}
console.log('')

type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string }

async function callLLM(messages: ChatMessage[]): Promise<string> {
  const res = await fetch(BASE_URL + '/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + API_KEY },
    body: JSON.stringify({ model: MODEL, temperature: TEMPERATURE, messages }),
  })

  if (!res.ok) {
    throw new Error('接口返回 ' + res.status + '：' + (await res.text()).slice(0, 600))
  }

  const json = (await res.json()) as {
    choices?: Array<{ message?: { content?: string }; finish_reason?: string }>
  }
  const content = json.choices?.[0]?.message?.content
  if (!content) throw new Error('接口没返回内容：' + JSON.stringify(json).slice(0, 600))
  if (json.choices?.[0]?.finish_reason === 'length') {
    console.warn('  ⚠ 输出被长度上限截断了，可能要缩短文章或减少场景')
  }
  return content
}

// 模型有时会把 JSON 包在 ```json 里，或者在前后加一句话。这里把它抠出来。
function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  const body = fenced ? fenced[1]! : text
  const start = body.indexOf('{')
  const end = body.lastIndexOf('}')
  if (start < 0 || end < 0) throw new Error('返回里找不到 JSON。原文开头：' + text.slice(0, 200))
  return JSON.parse(body.slice(start, end + 1))
}

// 把校验报错翻译成「具体怎么改」。
// 只报「找不到 cue f7」模型不知道该加还是该删，说清楚它才改得对。
function repairHint(problems: string[]): string {
  const hints: string[] = []

  // 格式用错了，先修格式再谈内容 —— 其它提示都建立在「这份 JSON 是创作格式」之上
  if (problems.some((p) => p.includes('旧格式') || p.includes('不要写任何段号'))) {
    hints.push(
      '- 「不要写任何段号」：新格式里**没有** parts / startPart / part。' +
        '讲稿就是每一处的 say，顺序就是「从上往下读 JSON」的顺序 —— ' +
        '先读场景的 say，再读它里面每个元素的 say。段号由程序推导，写了反而对不上。' +
        '请把整份 JSON 重写成 { "scenes": [ { "template": ..., "say": [……], "props": {……} } ] }。',
    )
  }
  if (problems.some((p) => p.includes('一句话都没有') || p.includes('没有任何一句话可以跟'))) {
    hints.push(
      '- 「场景一句话都没有」/「要点没有可以跟的那句话」：**每个场景至少要有一句 say**；' +
        '每条要点也要么自己写 say，要么让场景开头有一句 say（它就会跟着那一句一起出现）。',
    )
  }
  if (problems.some((p) => p.includes('永远不会出现'))) {
    hints.push(
      '- 「这个元素永远不会出现」：某个画面元素引用了下一场景里的段号。' +
        '要么把下一个场景的开始段往后挪（给本场景多一点时间），要么把这个元素删掉。',
    )
  }
  if (problems.some((p) => p.includes('覆盖了'))) {
    hints.push(
      '- 「场景挂太久」：说明中间有几段讲稿**没有配画面**，上一个场景就一直挂在屏幕上。' +
        '给那几段补一个新场景（幻灯片或代码场景都行）。这是音画不同步最常见的原因。',
    )
  }
  if (problems.some((p) => p.includes('个字符，超过'))) {
    hints.push(
      '- 「代码行太长」（超过 60 字符会被裁掉）：**拆成两行，或者抽中间变量**。例如\n' +
        '      const scale = Math.min(1, maxSize / Math.max(img.width, img.height))\n' +
        '  改成两行：\n' +
        '      const w = img.width, h = img.height\n' +
        '      const scale = Math.min(1, maxSize / Math.max(w, h))',
    )
  }
  if (problems.some((p) => p.includes('行，超过'))) {
    hints.push('- 「代码行太多」：**删掉次要的行**。代码演示不是把整个文件贴出来，只留最关键的那几行。')
  }
  if (problems.some((p) => p.includes('没有 part'))) {
    hints.push(
      '- 「要点没有 part」：说明这条要点和它所在的场景都没写 say。' +
        '**给它自己写一句 say**，或者给场景开头写一句 say（它就会跟着那一句一起出现）。' +
        '再不然，如果它不重要，就把它删掉。',
    )
  }
  if (problems.some((p) => p.includes('铺垫行'))) {
    hints.push(
      '- 「铺垫行」：import、setup 这种**讲稿里不专门讲它**的行，**不要给它写 part** —— ' +
        '直接写 { "code": "..." }，它会跟着场景开头那句过渡一起出现。' +
        '但它只能放在代码块**最前面**，而且一个代码块最多两行。',
    )
  }
  // 这里原来有一条「第 N 行对不上」的提示。行号收归程序（addLineNumbers）之后，
  // **它在 pnpm plan 这条路上永远触发不了**：校验跑在补行号之前，那时讲稿里没有行号；
  // 模型自己写行号则会被 validateAuthored 直接拦住（见下面那条）。
  // 留着一条永远不会被匹配上的提示，正是 README 里记过的「写了但没生效」的毛病。
  if (problems.some((p) => p.includes('行号由程序'))) {
    hints.push(
      '- 「行号由程序补」：不要说「第一行」「第二行」。你只消写这一行在做什么，' +
        '程序会按顺序自己补上「第 N 行，」—— 把句子开头那个「第 N 行，」删掉就行。',
    )
  }
  if (problems.some((p) => p.includes('上限'))) {
    hints.push('- 「超过上限」：画面或一口气装不下。拆页、删行、拆句 —— 把内容真的改短。')
  }
  if (problems.some((p) => p.includes('必须砍内容'))) {
    hints.push(
      '- 「讲稿太长」：**这是硬上限。**素材往往够讲十分钟，视频只有两分钟，所以必须取舍。' +
        '只讲**最有价值的 2 到 3 个点**，其余整段舍弃。' +
        '宁可少讲、讲透，不要全而浅。',
    )
  }
  if (problems.some((p) => p.includes('太短'))) {
    hints.push(
      '- 「讲稿太短」：只给了结论、没给过程。**每个点都要展开** —— ' +
        '它解决什么问题、最小的例子是什么、哪里最容易搞错。' +
        '宁可讲透一个点，也不要三个点各说一句。',
    )
  }

  return hints.join('\n')
}

// 把讲稿逐段 + 每个代码/终端场景的「每一行 ↔ 它的讲解」打出来。
//
// 为什么要在这一步打：这套校验只管结构（段号、长度、画面装不装得下），
// 管不了「模型编了一个不存在的 API」—— 讲稿的语义正确性一直靠模型自觉。
// 文章模式下事实来自原文，主题模式下是**凭空**写的，所以这是花钱之前唯一的闸门。
//
// build-storyboard 打的那份带时间，是另一个视角：那份查音画错位，这份查内容是不是编的。
function printEpisodeReview(ep: Episode): void {
  console.log('')
  console.log('--- 讲稿 ---')
  ep.parts.forEach((p, i) => {
    console.log('  [' + String(i).padStart(2) + '] ' + p.text)
  })

  ep.scenes.forEach((s) => {
    const props = s.props as Record<string, unknown>
    if (!Array.isArray(props.lines)) return
    console.log('')
    console.log('--- ' + s.template + ' 的每一行 ↔ 它的讲解 ---')
    const lines = props.lines as Array<{ code?: string; text?: string; kind?: string; part?: number }>
    for (const l of lines) {
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
    }
  })
}
const messages: ChatMessage[] = [
  { role: 'system', content: SYSTEM_PROMPT },
  { role: 'user', content: await buildUserPrompt(source.text, source.kind) },
]

let episode: Episode | null = null
let problems: string[] = []

// attempt 声明在循环外：成功之后要打印「第几次通过」，循环内的声明出了循环就没了
// （原来那句 `problems.length === 0 ? '' : ''` 两个分支都是空串，永远打印不出次数）。
let attempt = 0
for (attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
  console.log('第 ' + attempt + ' / ' + MAX_ATTEMPTS + ' 次生成…')
  const raw = await callLLM(messages)

  try {
    // 模型产出的是「创作格式」（scenes 里直接写 say，没有段号）；
    // 落盘和渲染要的是「渲染格式」（parts + startPart + part）。
    // 段号在这里推导 —— 所以模型没有可数错的东西，见 authoring.ts 的头注释。
    const parsed = extractJson(raw)
    const authored = validateAuthored(parsed)

    if (authored.length > 0) {
      // 创作格式本身就不对（多半是退回了旧格式），先修格式再谈内容：
      // 把一份旧格式硬推导出来只会报出一堆「段号越界」之类的次生错误。
      problems = authored
    } else {
      const derived = deriveEpisode(parsed as AuthoredEpisode)
      problems = [...validateEpisode(derived), ...checkEditorial(derived)]
      if (problems.length === 0) {
        // 行号在**过了校验之后**才补：校验管的是模型写的那份字数，
        // 而「第 N 行，」是程序加的 4 个字 —— 先补再校验会让模型为它改不对的东西挨重试。
        // 见 authoring.ts 里 addLineNumbers 的注释。
        episode = addLineNumbers(derived)
        break
      }
    }
  } catch (e) {
    problems = ['JSON 解析失败：' + String(e)]
  }

  console.log('  有 ' + problems.length + ' 个问题：')
  for (const p of problems) console.log('    - ' + p)

  if (attempt === MAX_ATTEMPTS) break
  messages.push({ role: 'assistant', content: raw })
  messages.push({
    role: 'user',
    content:
      '上面这份 JSON 有问题：\n' +
      problems.map((p) => '- ' + p).join('\n') +
      '\n\n修改方法：\n' +
      repairHint(problems) +
      '\n\n请重新输出**完整**的 JSON，不要输出解释文字。',
  })
}

if (!episode) {
  console.error('')
  console.error(MAX_ATTEMPTS + ' 次都没通过校验。没有覆盖 corpus/episode.json。')
  console.error('最后一次的问题：')
  for (const p of problems) console.error('  - ' + p)
  process.exit(1)
}

// 覆盖前先备份，改坏了好退回去
await copyFile('corpus/episode.json', 'corpus/episode.backup.json').catch(() => undefined)
await writeFile('corpus/episode.json', JSON.stringify(episode, null, 2) + '\n')

const text = episode.parts.map((p) => p.text).join('')
const seconds = Math.round(text.length / 5.3)

console.log('')
console.log('通过校验 ✓（第 ' + attempt + ' 次）')
console.log('讲稿: ' + episode.parts.length + ' 段 / ' + text.length + ' 字  （约 ' + seconds + ' 秒）')
console.log('场景: ' + episode.scenes.map((s) => s.template).join(' -> '))
console.log('')
console.log('已写入 corpus/episode.json（旧的备份在 episode.backup.json）')

// 花钱之前先让人过一眼 —— 校验查不出编造的 API，见上面 printEpisodeReview 的注释
printEpisodeReview(episode)

console.log('下一步：pnpm say  →  pnpm storyboard  →  pnpm video')