import { copyFile, writeFile } from 'node:fs/promises'
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
  if (problems.some((p) => p.includes('必须严格递增'))) {
    hints.push(
      '- 「段号必须严格递增」：两条要点不能指向同一段。**要么给它们各自写一段讲解**，' +
        '要么把这两条要点合并成一条。不要指望它们同时出现。',
    )
  }
  if (problems.some((p) => p.includes('行代码，超过'))) {
    hints.push('- 「代码行太多」：**删掉次要的行**。代码演示不是把整个文件贴出来，只留最关键的那几行。')
  }
  if (problems.some((p) => p.includes('没有 part'))) {
    hints.push(
      '- 「某个元素没有 part」：**在 parts 里补一段专门讲它的讲解**，再把这个元素的 part 指向那一段。' +
        '或者，如果它不重要，就把它删掉。',
    )
  }
  if (problems.some((p) => p.includes('铺垫行'))) {
    hints.push(
      '- 「铺垫行」：import、setup 这种**讲稿里不专门讲它**的行，**不要给它写 part** —— ' +
        '直接写 { "code": "..." }，它会跟着场景开头那句过渡一起出现。' +
        '但它只能放在代码块**最前面**，而且一个代码块最多两行。',
    )
  }
  if (problems.some((p) => p.includes('第 N 行对不上'))) {
    hints.push(
      '- 「第 N 行对不上」：讲稿里的「第 N 行」数的是**写了 part 的行**。' +
        '对不上通常是因为有一行（import / setup 这种）白占了一个段号 —— ' +
        '把那一行改成铺垫行（不写 part），后面的行就各归各位了。',
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
    const parsed = extractJson(raw) as Episode
    problems = [...validateEpisode(parsed), ...checkEditorial(parsed)]
    if (problems.length === 0) {
      episode = parsed
      break
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