import { copyFile, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { checkEditorial, validateEpisode, type Episode } from './episode'
import { SYSTEM_PROMPT, buildUserPrompt } from './prompt'

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

const sourceFile = process.argv[2] ?? 'corpus/source.md'
const source = (await readFile(sourceFile, 'utf8')).trim()
if (!source) throw new Error('文章是空的：' + path.resolve(sourceFile))

console.log('模型:   ' + MODEL)
console.log('接口:   ' + BASE_URL)
console.log('文章:   ' + path.resolve(sourceFile) + '  (' + source.length + ' 字)')
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
  if (problems.some((p) => p.includes('上限'))) {
    hints.push('- 「超过上限」：画面或一口气装不下。拆页、删行、拆句 —— 把内容真的改短。')
  }
  if (problems.some((p) => p.includes('必须砍内容'))) {
    hints.push(
      '- 「讲稿太长」：**这是硬上限。**文章能讲十分钟，视频只能讲两分钟，所以必须取舍。' +
        '通读文章，挑出**最有价值的 2 到 3 个点**，只讲这些，其余整段舍弃。' +
        '宁可少讲、讲透，不要全而浅。',
    )
  }

  return hints.join('\n')
}
const messages: ChatMessage[] = [
  { role: 'system', content: SYSTEM_PROMPT },
  { role: 'user', content: await buildUserPrompt(source) },
]

let episode: Episode | null = null
let problems: string[] = []

for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
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
const cued = episode.parts.filter((p) => p.cue).length

console.log('')
console.log('通过校验 ✓（第 ' + (problems.length === 0 ? '' : '') + '次）')
console.log('讲稿: ' + episode.parts.length + ' 段 / ' + text.length + ' 字  （约 ' + seconds + ' 秒）')
console.log('场景: ' + episode.scenes.map((s) => s.template).join(' -> '))
console.log('cue:  ' + cued + ' 个')
console.log('')
console.log('已写入 corpus/episode.json（旧的备份在 episode.backup.json）')
console.log('下一步：pnpm say  →  pnpm storyboard  →  pnpm video')