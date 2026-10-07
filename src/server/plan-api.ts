// 「输入一句话 → 生成剧本 → 配音 → 切时间轴」的 POST 端点，
// 挂在 vite dev server 的中间件上。
//
// ★ 为什么这件事必须有后端：`pnpm plan` 干的活浏览器一件都干不了 ——
//   读 .env 里的 LLM_API_KEY（密钥不能下发到浏览器，页面上的一切用户都看得见）、
//   往 corpus/ 写文件、调 LLM、起子进程做 TTS。**浏览器能算的只有「画面 = t 的函数」。**
//   这个文件就是那条边界在服务端的一侧。
//
// ★ 为什么挂在 vite 中间件上、而不是另起一个服务器：同源，不用配代理；
//   而且 seed 已经有了（vite.config.ts 的 stageDataPlugin 已经在服务
//   /storyboard.json 和 /audio/*，用的是同一段 connect 中间件）。不引入框架。
//
// ★ 前提写死：**这是自己用的本地工具**（key 继续躺在 .env 里，单用户，
//   不管并发和成本）。所以「并发生成」不用设计，直接拒掉就完事。
//   哪天要给别人用，那就不是加端点的事 —— 要处理 key 托管、并发、成本，
//   是另一个量级的决定，停下来重新谈。

import { spawn } from 'node:child_process'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { generate, isConfigured, loadLlmConfig, MISSING_CONFIG_HELP, persistEpisode } from '../plan/generate'
import { describeResult, formatEpisodeReview } from '../plan/review'
import { describeSource, persistTopic, resolveSource } from '../plan/source'
import { EDGE_LABEL, formatBroken, inspect, PAGE_EDGES, type EdgeResult } from '../render/artifacts'

// 一次只允许跑一个。多按一次按钮不该变成两份账单（也不该有两份 TTS 在抢同一个输出目录）。
let running = false

/** SSE 写一行。连接可能已经被用户关掉了（刷新页面），写之前先看一眼。 */
function send(res: ServerResponse, payload: unknown): void {
  if (res.writableEnded || res.destroyed) return
  res.write('data: ' + JSON.stringify(payload) + '\n\n')
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => chunks.push(c))
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

/**
 * 起一个 CLI 脚本，把它的输出**按行**转成 SSE 日志。
 *
 * ★ 为什么这一步走子进程，而不是像 generate 那样剥成函数：`say` / `storyboard`
 *   本来就是独立的 CLI（各有自己的 `process.exit`），而这里只是**换个地方调用它们**。
 *   用子进程就保证了页面跑的和你手动敲的**是同一条路径** ——
 *   不会出现「页面能过、命令行不过」这种两套。
 *   （`plan` 当初必须剥，是因为浏览器要的是**数据**——讲稿和对照；
 *   而配音和时间轴的产物都在磁盘上，页面只是等它跑完。）
 *
 * ★ 按行切要自己缓冲：chunk 的边界会落在一行中间，把每个 chunk 当成一行
 *   会切出半句话 —— 和字幕那个「切点必须落在词首」是同一类坑。
 *
 * ★ `cmd` 传**一整条命令**、args 留空，是有意的：Windows 上 pnpm 是 pnpm.cmd，
 *   必须过 shell 才找得到；而 `shell: true` 配非空 args 会触发 Node 的
 *   DEP0190 警告（每次点按钮在终端喷一行）。命令是我们自己写死的字面量，
 *   没有注入面。
 */
function runStep(cmd: string, onLine: (line: string) => void): Promise<{ code: number; tail: string[] }> {
  return new Promise((resolve) => {
    const child = spawn(cmd, [], {
      shell: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    const tail: string[] = []
    let buf = ''
    let settled = false

    const emit = (text: string): void => {
      if (!text) return
      tail.push(text)
      if (tail.length > 15) tail.shift()
      onLine(text)
    }
    const feed = (chunk: Buffer): void => {
      buf += chunk.toString('utf8')
      let i = buf.indexOf('\n')
      while (i >= 0) {
        emit(buf.slice(0, i).replace(/\r$/, ''))
        buf = buf.slice(i + 1)
        i = buf.indexOf('\n')
      }
    }
    const finish = (code: number): void => {
      if (settled) return
      settled = true
      emit(buf.replace(/\r$/, '')) // 最后一行可能没有换行
      resolve({ code, tail })
    }

    child.stdout.on('data', feed)
    child.stderr.on('data', feed)
    child.on('error', (e) => {
      emit(String(e))
      finish(-1)
    })
    child.on('close', (code) => finish(code ?? -1))
  })
}

/** 配音 + 切时间轴。两步都过了才算数 —— 中间挂了就把退出的那一截报上去。 */
async function runRenderPipeline(log: (line: string, level?: 'info' | 'warn') => void): Promise<string[] | null> {
  log('--- pnpm say：配音 + 词级时间戳（30–60 秒，这期间没有输出是正常的）---')
  const say = await runStep('pnpm say', log)
  if (say.code !== 0) {
    return ['配音失败了（pnpm say 退出码 ' + say.code + '）。剧本没动，改完可以只重跑配音。', ...say.tail.slice(-8)]
  }

  log('--- pnpm storyboard：段号 → 真实时间 + 字幕 ---')
  const sb = await runStep('pnpm storyboard', log)
  if (sb.code !== 0) {
    return ['切时间轴失败了（pnpm storyboard 退出码 ' + sb.code + '）。', ...sb.tail.slice(-8)]
  }

  return null
}

/** 跑完 say + storyboard 之后，画面和声音就都是这一版剧本的了 —— 但**画面不是**
 *  （它要等 pnpm video）。这里把断掉的那几条边报给页面。
 *
 *  ★ 只取 PAGE_EDGES 那三条，**不含「画面 → 成片」**：A+ 本来就不跑 video，
 *    把成片算进去会让标签**一直**亮着，纯噪音。
 *  ★ 判据是**内容指纹**，不是 mtime（替掉了原来那个比 mtime 的 isStale）——
 *    分得出「重跑了一遍但内容没变」和「真的换了一版」。见 render/artifacts.ts。
 *  ★ **不缓存结论**：这个项目在「把旧的当成最新的」上栽过不止一次。 */
async function pageBroken(): Promise<EdgeResult[]> {
  const report = await inspect()
  return report.edges.filter((e) => PAGE_EDGES.includes(e.edge) && e.verdict !== 'ok')
}

async function runPlan(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const body = JSON.parse(await readBody(req)) as { topic?: string }
  const topic = (body.topic ?? '').trim()
  if (!topic) {
    send(res, { type: 'fail', problems: ['没有输入主题。'] })
    return
  }

  const cfg = loadLlmConfig()
  if (!isConfigured(cfg)) {
    // 配置缺失不是「模型写错了」，直接把它当成失败回给页面，别去烧重试
    send(res, { type: 'fail', problems: MISSING_CONFIG_HELP })
    return
  }

  // 和 CLI 走同一个 resolveSource：输入像路径（带 / 或以 .md 结尾）时一样会报错，
  // 不会把打错的路径静默当成主题喂给模型。
  const source = await resolveSource([topic])

  const log = (line: string, level: 'info' | 'warn' = 'info'): void => {
    send(res, { type: 'log', line, level })
  }

  log('模型:   ' + cfg.model)
  log('接口:   ' + cfg.baseUrl)
  log(describeSource(source))

  if (source.kind === 'topic') {
    const backedUp = await persistTopic(source.text)
    log('已写入 corpus/source.md' + (backedUp ? '（原来那篇文章备份在 corpus/source.backup.md）' : ''))
  }
  log('')

  const outcome = await generate(source, cfg, log)

  if (!outcome.ok) {
    send(res, { type: 'fail', problems: outcome.problems })
    return
  }

  await persistEpisode(outcome.episode)
  log('')

  // ★ 到这里剧本已经是新的了，但页面上的画面还来自**上一版** storyboard.json。
  //   接着把配音和时间轴也跑掉 —— 这就是 A+。
  const failed = await runRenderPipeline(log)
  if (failed) {
    send(res, { type: 'fail', problems: failed })
    return
  }

  send(res, {
    type: 'done',
    attempt: outcome.attempt,
    summary: describeResult(outcome.episode, outcome.attempt),
    review: formatEpisodeReview(outcome.episode),
    stale: formatBroken(await pageBroken()),
  })
}

/** 只重跑配音 + 时间轴（剧本不动）。
 *
 *  为什么单独开一个：`say` 失败时（断网、TTS 抽风）剧本是好的，
 *  重新点「生成」等于把模型再烧一遍。 */
async function runRender(_req: IncomingMessage, res: ServerResponse): Promise<void> {
  const log = (line: string, level: 'info' | 'warn' = 'info'): void => {
    send(res, { type: 'log', line, level })
  }

  const failed = await runRenderPipeline(log)
  if (failed) {
    send(res, { type: 'fail', problems: failed })
    return
  }

  send(res, {
    type: 'done',
    attempt: 0,
    summary: [],
    review: '',
    stale: formatBroken(await pageBroken()),
  })
}

async function handle(req: IncomingMessage, res: ServerResponse, plan: boolean): Promise<void> {
  running = true
  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
  })
  res.flushHeaders?.()

  try {
    await (plan ? runPlan(req, res) : runRender(req, res))
  } catch (e) {
    // 网络错误（接口 4xx/5xx、连不上）会从 generate 里抛出来 —— 那是「这一次调用残了」，
    // 不是「模型写了 N 遍都不合格」，收场不同：这里如实报给页面。
    send(res, { type: 'fail', problems: [String(e)] })
  } finally {
    running = false
    if (!res.writableEnded) res.end()
  }
}

/** `GET /api/status` —— 只回**页面关心的那三条边**（PAGE_EDGES），
 *  `stale` 是空的就代表「配音/时间轴/画面都跟得上剧本」。
 *
 *  这是给控制栏那个安静的小标签用的：A+ 跑完之后它不亮，只有 pipeline
 *  半路挂了（比如配音抽风）才亮 —— 那时候它本来就该亮。
 *
 *  ★ 不套 `running` 那个 409：正在跑的时候恰恰是最该看得见状态的时候。 */
async function runStatus(res: ServerResponse): Promise<void> {
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  try {
    // 回结构化的一条一条，不是拼好的整句 —— 两个消费者要的东西不一样：
    // Plan.vue 直接印 `formatBroken` 的人话（走 SSE），Stage.vue 那个小标签
    // 只要 label + verdict + 悬停用的 detail。
    const broken = await pageBroken()
    res.end(JSON.stringify({ edges: broken.map((e) => ({ ...e, label: EDGE_LABEL[e.edge] })) }))
  } catch (e) {
    // 体检本身不该崩（它读的都是 JSON），真崩了也别让页面以为「一切正常」
    res.statusCode = 500
    res.end(JSON.stringify({ error: String(e) }))
  }
}

/**
 * connect 中间件：只接 `POST /api/plan`、`POST /api/render`、`GET /api/status`，
 * 其余一律 `next()`。
 *
 * 挂的位置是 vite.config.ts 的 configureServer —— 那里 use 的中间件跑在
 * Vite 内置中间件**之前**，所以这几个端点不会被它自己的静态服务拦掉；
 * 而我们对别的 URL 都放行，不会影响页面和 HMR。
 */
export function planApi() {
  return (req: IncomingMessage, res: ServerResponse, next: () => void): void => {
    const url = (req.url ?? '').split('?')[0]
    const plan = url === '/api/plan'
    const render = url === '/api/render'
    const status = url === '/api/status'
    if (!plan && !render && !status) return next()

    if (status) {
      if (req.method !== 'GET') {
        res.statusCode = 405
        res.setHeader('allow', 'GET')
        res.end()
        return
      }
      // 不 await：中间件必须立刻返回（下面那个 handle 同理）
      void runStatus(res)
      return
    }

    if (req.method !== 'POST') {
      res.statusCode = 405
      res.setHeader('allow', 'POST')
      res.end()
      return
    }

    if (running) {
      res.statusCode = 409
      res.setHeader('content-type', 'application/json; charset=utf-8')
      res.end(JSON.stringify({ error: '上一次还在跑，等它跑完再来' }))
      return
    }

    // 不 await：中间件必须立刻返回，SSE 的写在 handle 里慢慢来
    void handle(req, res, plan)
  }
}
