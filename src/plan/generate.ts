// 「生成剧本」这件事本身：调模型 → 校验 → 重试 → 落盘。
//
// ★ 这个文件是**为了能被第二个人调用**才存在的：以前这些代码全在 plan.ts 的顶层，
//   而 plan.ts 是「一 import 就当场执行」的 CLI 脚本 —— 读 .env、解析 argv、
//   直接 console.log、失败就 process.exit。`pnpm dev` 的页面要复用同一条生成链路时，
//   那些副作用一件都不能带过去（页面不能 exit 掉 dev server，页面的日志也不能
//   直接推进终端）。所以把纯逻辑剥出来，CLI 外壳留在 plan.ts。
//
//   这跟把 printEpisodeReview 剥成 review.ts、把启发式剥成 narration-hint.ts
//   是同一个动作，只是动机从「能单独验」变成「能被服务调用」。
//
// ★ 剥的时候守一条死规矩：**`pnpm plan` 的外部行为一个字都不许变**。
//   所以这里不打印 —— 日志走 onLog 回调，收到的**就是原来 console.log 的那些原文**，
//   CLI 外壳原样转发。等级的区分也是为这个：原来那条「输出被截断」走 console.warn
//   （stderr），不能混进 stdout。

import { copyFile, writeFile } from 'node:fs/promises'
import { addLineNumbers, deriveEpisode, validateAuthored, type AuthoredEpisode } from './authoring'
import { checkEditorial, validateEpisode, type Episode } from './episode'
import { SYSTEM_PROMPT, buildUserPrompt } from './prompt'
import type { Source } from './source'

export type LlmConfig = {
  baseUrl: string
  apiKey: string
  model: string
  temperature: number
  attempts: number
}

/** 读 .env（Node 自带，不用装 dotenv）并取出配置。
 *
 *  调用方负责判断配全了没有 —— `--dry` 不需要配置，所以这一步不能混进 resolveSource。 */
export function loadLlmConfig(): LlmConfig {
  try {
    process.loadEnvFile('.env')
  } catch {
    // 没有 .env 也能跑，走默认值
  }
  return {
    baseUrl: (process.env.LLM_BASE_URL ?? '').replace(/\/+$/, ''),
    apiKey: process.env.LLM_API_KEY ?? '',
    model: process.env.LLM_MODEL ?? '',
    temperature: Number(process.env.LLM_TEMPERATURE ?? 0.7),
    attempts: Number(process.env.LLM_ATTEMPTS ?? 3),
  }
}

export function isConfigured(cfg: LlmConfig): boolean {
  return Boolean(cfg.baseUrl && cfg.apiKey && cfg.model)
}

/** 缺配置时的那段提示。CLI 打到 stderr，页面推到日志区 —— 同一份文本。 */
export const MISSING_CONFIG_HELP = [
  '还没配好大模型。在 .env 里补上这三项：',
  '',
  '  LLM_BASE_URL=https://api.deepseek.com/v1',
  '  LLM_API_KEY=你的key',
  '  LLM_MODEL=deepseek-chat',
  '',
  '任何 OpenAI 兼容接口都行（DeepSeek / Moonshot / OpenAI / 本地 vLLM…）。',
]

/** 一行日志。`level` 决定它原来走的是 stdout 还是 stderr —— 转发时别搞混。 */
export type GenLog = (line: string, level?: 'info' | 'warn') => void

export type GenerateOutcome =
  | { ok: true; episode: Episode; attempt: number }
  | { ok: false; problems: string[]; attempts: number }

type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string }

async function callLLM(cfg: LlmConfig, messages: ChatMessage[], onLog: GenLog): Promise<string> {
  const res = await fetch(cfg.baseUrl + '/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + cfg.apiKey },
    body: JSON.stringify({ model: cfg.model, temperature: cfg.temperature, messages }),
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
    onLog('  ⚠ 输出被长度上限截断了，可能要缩短文章或减少场景', 'warn')
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

/**
 * 把一份输入生成成剧本。**不打印、不落盘、不 exit** —— 日志走 onLog，产物给调用方。
 *
 * 失败返回 `{ ok: false, problems }` 而不是 `process.exit(1)`：CLI 外壳拿它去定
 * exit code，页面拿它去渲染「最后一次的问题」。**这个函数决定不了进程的生死。**
 *
 * 注意：网络错误（接口 4xx/5xx、连不上）是**抛出来**的，跟原来一样 ——
 * 那是「这一次调用残了」，不是「模型写了 5 遍都不合格」，两者的收场本来就不同。
 */
export async function generate(
  source: Source,
  cfg: LlmConfig,
  onLog: GenLog = () => {},
): Promise<GenerateOutcome> {
  const messages: ChatMessage[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: await buildUserPrompt(source.text, source.kind) },
  ]

  let episode: Episode | null = null
  let problems: string[] = []

  // attempt 声明在循环外：成功之后要打印「第几次通过」，循环内的声明出了循环就没了
  // （原来那句 `problems.length === 0 ? '' : ''` 两个分支都是空串，永远打印不出次数）。
  let attempt = 0
  for (attempt = 1; attempt <= cfg.attempts; attempt++) {
    onLog('第 ' + attempt + ' / ' + cfg.attempts + ' 次生成…')
    const raw = await callLLM(cfg, messages, onLog)

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

    onLog('  有 ' + problems.length + ' 个问题：')
    for (const p of problems) onLog('    - ' + p)

    if (attempt === cfg.attempts) break
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

  return episode
    ? { ok: true, episode, attempt }
    : { ok: false, problems, attempts: cfg.attempts }
}

/** 覆盖前先备份，改坏了好退回去。
 *
 *  CLI 和页面走的是**同一份** —— 这段要是有两个版本，迟早只改一处。 */
export async function persistEpisode(episode: Episode): Promise<void> {
  await copyFile('corpus/episode.json', 'corpus/episode.backup.json').catch(() => undefined)
  await writeFile('corpus/episode.json', JSON.stringify(episode, null, 2) + '\n')
}
