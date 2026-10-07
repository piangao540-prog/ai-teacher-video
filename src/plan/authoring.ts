// 「创作格式」→「渲染格式」的转换。
//
// ★ 为什么要分成两层
//
//   渲染格式（episode.ts）是：parts 是讲稿，scenes 里的元素写 { "part": 3 }
//   引用「第几段讲稿」。那是渲染器要的形状，一直没变，也不该变。
//
//   但让**模型**直接写这个形状，修过三次，每次都换了张脸回来：
//
//     1. 文章模式：某个场景的 part 集体早一段。整段画面比声音早一整句，
//        段号全部合法、递增、不越界 —— 校验一条都不报，躺在成片里很久。
//     2. 主题模式首跑：import 行在讲稿里没有对应的句子，
//        模型就**偷了一个本来属于下一行的段号**。从那一行起，每个元素晚一格。
//     3. 加完「铺垫行」出口之后：setup 行（const state = reactive(...)）
//        又是同一个病 —— 它没有自己的句子，模型于是把**下一行**的讲解挂到了它身上，
//        顺手把后面的编号也对齐了。数字自洽，**校验查不出来**。
//
//   三次的根源是同一个：模型要**同时维护两份清单**，而两份清单之间的对应关系
//   是隐式的、靠数数维持的。每次加规则只能拦住「已经写歪」的那一种形状，
//   拦不住下一种 —— 因为「第 3 段讲的到底是不是第 3 行」是语义，
//   没有便宜的规则能判。第三次的证据最硬：模型完全满足了那条约定，句子却在讲下一行。
//
//   所以改契约，而不是再加一条规则：**让句子和它描述的东西是同一个对象。**
//
//   创作格式里没有 parts，也没有任何段号 —— 模型写的每一句 say 就是讲稿，
//   顺序就是「从上往下读 JSON」的顺序。段号在这里推导出来，于是
//   「错一格」**在结构上不存在**：没有可数错的东西。
//
//   ★ 第四张脸：行号
//
//   改成创作格式之后的第一次真跑（`Vue3 响应式原理`）证明结构那一半确实锁死了：
//   28 段一段不差，没有任何「整段早一句」的漂移，铺垫行出口也被正确用在了 import 上。
//   但语义那一半原样回来了，而且是从**行号**钻进来的：
//   四个代码块里，有 setup 行的三个，都把「第一行」挂在了 setup 行上，
//   而那一句讲的是**下一行**；没有 setup 行的那一个，完全正确。
//   和第三次是同一张脸 —— 模型仍然先写一份带行号的讲解，再按位置塞给代码行。
//
//   所以这一轮把行号也收走：模型**不许写「第 N 行」**（validateAuthored 拦），
//   由 addLineNumbers 按「写了 say 的第 N 行」补上。理由和段号一模一样 ——
//   只要模型要维护一个计数器、再让它和物理顺序对上，就迟早会对不上；
//   而程序数的是自己刚摆好的顺序，**说出来的编号永远是真话**。
//   （第二次真跑 5 次全败，4 条错误就是「模型自己写的行号漂了 6 行」。）
//
//   还剩什么没治：句子**内容**说的是不是这一行。第三个代码块里那句
//   「effect 注册一个副作用函数」挂在 `const state` 上，行号收走之后它仍然是错的 ——
//   那是纯语义，机器判不了，仍然只有人读 `pnpm plan` 打完的那份对照。
//
//   推导出来的仍然是老格式，所以 render/、build-storyboard、字幕、编码
//   整条下游一行都不用改。分层换来的是：模型面对的东西不需要、也不允许有编号。

import { cnOrdinal, mentionsNthLine, narratedOrdinals, type Episode, type Part, type SceneSpec } from './episode'

/** 一句话，或几句话。场景和元素共用同一个字段名，模型不用选「这一句该填哪个字段」。 */
export type Say = string | string[]

export type AuthoredElement = {
  say?: Say
  [key: string]: unknown
}

export type AuthoredScene = {
  template?: string
  say?: Say
  props?: Record<string, unknown>
  [key: string]: unknown
}

export type AuthoredEpisode = { scenes: AuthoredScene[] }

/** 哪些 props 键下面装的是「会一个个出现的元素」。顺序就是出现的顺序。 */
const ELEMENT_KEYS = ['bullets', 'lines'] as const

// 把 say 归一成字符串数组。
//
// 传了 where + problems 就是「边取边报错」（校验用）；不传就是「只取能用的」（推导用）。
// 两处共用同一个取法，免得「校验认的」和「推导用的」是两套口径。**「不许自己写行号」
// 这条也在这里查**，理由相同：这是唯一一处把每句 say 过一遍的地方，
// 放别处就得在「场景级」「元素级」两个循环里各写一遍，迟早漂。
function toSentences(say: unknown, where?: string, problems?: string[]): string[] {
  if (say === undefined || say === null) return []
  const list = Array.isArray(say) ? say : [say]
  const out: string[] = []
  list.forEach((s, i) => {
    if (typeof s === 'string' && s.trim() !== '') {
      const text = s.trim()
      out.push(text)
      if (problems && where && mentionsNthLine(text)) {
        problems.push(
          where + (Array.isArray(say) ? '[' + i + ']' : '') + ' 里写了「第 N 行」。' +
            '**行号由程序补，你不要写** —— 你只消说这一行在做什么，' +
            '程序会按顺序加上「第 N 行，」（讲第二行的句子自然会带上「第二行，」）。' +
            '自己写会和程序补的重复，或者错位。',
        )
      }
      return
    }
    if (problems && where) {
      problems.push(where + (Array.isArray(say) ? '[' + i + ']' : '') + ' 不是一句非空的讲稿。')
    }
  })
  return out
}

function elementsOf(scene: AuthoredScene, key: (typeof ELEMENT_KEYS)[number]): unknown[] {
  const arr = scene.props?.[key]
  return Array.isArray(arr) ? arr : []
}

/**
 * 校验**创作格式**本身。返回问题列表，空数组表示没问题。
 *
 * 只管「这份 JSON 是不是创作格式」—— 内容和画面容量交给
 * deriveEpisode 之后那两个老校验器（validateEpisode / checkEditorial）。
 * 分开的理由：这里报的是「格式用错了」，那个报的是「内容装不下」，
 * 混在一起模型不知道该改哪一层。
 */
export function validateAuthored(input: unknown): string[] {
  const problems: string[] = []

  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return ['输出的不是一个 JSON 对象。']
  }
  const root = input as Record<string, unknown>

  if (root.parts !== undefined) {
    problems.push(
      '**这是旧格式**：输出里出现了 parts。新格式没有 parts —— ' +
        '讲稿就是每一处的 say，由程序按「从上往下读」的顺序拼起来。',
    )
  }

  if (!Array.isArray(root.scenes) || root.scenes.length === 0) {
    return [...problems, 'scenes 是空的（或者不是数组）。']
  }

  root.scenes.forEach((rawScene, si) => {
    const tag = 'scenes[' + si + ']'
    if (!rawScene || typeof rawScene !== 'object') {
      problems.push(tag + ' 不是一个对象。')
      return
    }
    const scene = rawScene as Record<string, unknown>

    // 段号哪怕写了对的也不放行。理由：只要允许它写，就会出现「模型写的」和
    // 「推导的」两份，而两份迟早对不上 —— 这一整类错误正是这么来的。
    if (scene.startPart !== undefined || scene.part !== undefined) {
      problems.push(
        tag + ' 写了段号（startPart / part）。**不要写任何段号** —— ' +
          '讲稿的顺序就是从上往下读 JSON 的顺序，段号由程序推导。',
      )
    }

    const sceneSay = toSentences(scene.say, tag + '.say', problems)
    let elementSentenceCount = 0

    for (const key of ELEMENT_KEYS) {
      elementsOf(scene as AuthoredScene, key).forEach((rawEl, j) => {
        const where = tag + '.props.' + key + '[' + j + ']'
        if (!rawEl || typeof rawEl !== 'object') {
          problems.push(where + ' 不是一个对象。')
          return
        }
        const el = rawEl as Record<string, unknown>

        if (el.part !== undefined) {
          problems.push(
            where + ' 写了 part。**不要写任何段号** —— ' +
              '元素有没有 part、是第几段，由程序按 say 的顺序推导。',
          )
        }

        const says = toSentences(el.say, where + '.say', problems)
        elementSentenceCount += says.length

        // 要点不写 say 时靠「跟场景开头一起出现」兜底，所以场景开头必须有话说。
        if (says.length === 0 && key === 'bullets' && sceneSay.length === 0) {
          problems.push(
            where + ' 没写 say，而这个场景的开头也没有 say。' +
              '**这条要点没有任何一句话可以跟**：要么给它自己写一句 say，' +
              '要么给场景写一句 say（它就会跟着那一句一起出现）。',
          )
        }
      })
    }

    if (sceneSay.length + elementSentenceCount === 0) {
      problems.push(
        tag + ' 一句话都没有：场景没写 say，里面的元素也都没写 say。' +
          '**每个场景至少要有一句讲稿**，否则它没有出现的时机。',
      )
    }
  })

  return problems
}

/**
 * 把创作格式推导成渲染格式。纯函数，不读盘、不校验。
 *
 * 规则只有三条，都在「从上往下读」这一个顺序里：
 *
 *   1. 场景的 say 先念，然后是它里面每个元素的 say —— 顺序就是数组顺序。
 *   2. 元素有 say → 给它编一个段号，那一段就是它的 say（数组的话是**第一句**）。
 *   3. 元素没 say →
 *        要点：跟场景开头那一句一起出现（part = 本场景的第一段）；
 *        代码行 / 终端输出行：不写 part，交给渲染器按打字顺序跟在上一行后面。
 *          —— 代码行这条就是「铺垫行」，上限和位置由 checkCodeNarration 那道栏杆管。
 */
export function deriveEpisode(authored: AuthoredEpisode): Episode {
  const parts: Part[] = []

  const scenes: SceneSpec[] = authored.scenes.map((scene) => {
    const startPart = parts.length

    for (const text of toSentences(scene.say)) parts.push({ text })

    const props: Record<string, unknown> = { ...(scene.props ?? {}) }
    for (const key of ELEMENT_KEYS) {
      const arr = props[key]
      if (!Array.isArray(arr)) continue

      props[key] = arr.map((rawEl) => {
        const el = { ...((rawEl ?? {}) as Record<string, unknown>) }
        const says = toSentences(el.say)
        // say 是创作格式专有的字段，不进 episode.json
        delete el.say

        if (says.length > 0) {
          el.part = parts.length
          for (const text of says) parts.push({ text })
        } else if (key === 'bullets') {
          el.part = startPart
        }
        return el
      })
    }

    return { template: scene.template ?? '', startPart, props }
  })

  return { parts, scenes }
}

/**
 * 给代码场景的讲解补上「第 N 行，」。纯函数，不校验、不读盘。
 *
 * N 数的是**本块里写了 say 的第 N 行**（铺垫行不数）—— 号由 narratedOrdinals 给，
 * 和 checkCodeNarration 的校验、**以及画面 gutter 上显示的那个数**，是同一份。
 * 数是程序自己刚摆好的顺序，所以「第 N 行」这句**永远是真话**：
 * 会数错的那个主体（模型）已经不参与这件事了。
 *
 * 为什么不放进 deriveEpisode：**它必须在校验之后跑**。
 * 校验器按模型写的那份算字数（总字数、单段 55 字上限），而前缀是程序补的 4 个字 ——
 * 先补再校验的话，模型写 898 字就会被「超过 900」打回，而它根本没有 898 字那么长，
 * 重试也永远改不对。分开之后两件事各归各位：**校验管模型写的，行号是程序的事。**
 *
 * 铺垫行（没写 part 的代码行）不数也不加 —— 它没有讲解。
 * Terminal 不加：那里的行是命令和输出，本来就不按「第几行」讲。
 * 幂等：已经带行号的段跳过，所以对一份手写的渲染格式剧本跑一遍也不会加两次。
 */
export function addLineNumbers(episode: Episode): Episode {
  const parts = episode.parts.map((p) => ({ ...p }))

  const scenes = episode.scenes.map((scene) => {
    if (scene.template !== 'CodeTyping') return scene
    const lines = (scene.props as { lines?: unknown }).lines
    if (!Array.isArray(lines)) return scene

    // 号从 narratedOrdinals 来（episode.ts）—— 和画面 gutter 上的号是**同一份**。
    // 这里曾经自己数一遍，于是旁白说「第一行」、画面 gutter 显示 2。
    const ordinals = narratedOrdinals(lines as Array<{ part?: number }>)

    lines.forEach((raw, i) => {
      const part = (raw as { part?: unknown } | null)?.part
      if (typeof part !== 'number') return
      const nth = ordinals[i]
      if (nth == null) return

      const text = parts[part]?.text
      if (typeof text !== 'string' || mentionsNthLine(text)) return
      parts[part] = { text: '第' + cnOrdinal(nth) + '行，' + text }
    })
    return scene
  })

  return { parts, scenes }
}
