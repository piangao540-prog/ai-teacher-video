// 字幕：把 TTS 的词级时间戳切成一条条「能看的」字幕。
//
// ★ 这里最反直觉的一点：词级时间戳**不是**时间戳那么简单。
//
//   它只告诉你「每个词什么时候开始念」，而一条字幕的结束时刻，
//   往往落在某个词念到一半的地方 —— 因为逗号、句号这些停顿
//   在词表里根本不存在（DESIGN 里记过这个坑）。
//
//   所以字级时间要**插值**出来：一个词读 350ms、有三个字，
//   第 2 个字就落在 +117ms 附近。有了字级时间，切在哪都不怕。
//
// 另一个决定：字幕断句用的是讲稿**原文**，不是词表。
//   词表里没有标点，拿它拼出来的字幕会是一坨没有标点的字。
//   原文有标点，切出来才是人话。
//
// ★ 坐标系统（这是这个文件里最容易搞混、也最容易出 bug 的地方）：
//
//   「字坐标」 讲稿里第 i 个**保留字**（汉字/字母/数字），标点不占格子。
//   「原文下标」 讲稿里第 i 个**字符**，标点占一格。
//
//   两者在有标点的地方就会错开：「给博客加图片，本以为很简单，…」
//   第 22 个字在原文里已经是第 25 个字符。
//
//   所以规矩定死：
//     - 断句、合并、判断位置 → 一律用**字坐标**
//     - 取原文（带标点）      → 用 ctx.adjust 在**原文**里数标点
//   混用会造成「边界晚一个词」「句号被吞」这类很难查的错。

export type Word = { text: string; startMs: number; durationMs: number }

export type Cue = {
  /** 第几条（调试用） */
  i: number
  startMs: number
  endMs: number
  /** 带标点的字幕文字 */
  text: string
  /** 折好行，渲染时直接用 —— 免得每一帧都重算。正常情况只有一行 */
  lines: string[]
}

// ---- 断句与显示参数 ----
//
// ★ 断句的第一原则：**句号优先，逗号其次，绝不在句子中间硬切。**
//
//   第一版是「凑够 18 个字就切」，实测切出来的是这种东西：
//       给博客加图片，本以为很简单， / 结果做出一条完整管线。这
//       条管线有三层：上传前压缩、上传后存储、 / 渲染时懒加载。先
//   一句话被劈成两条，前一条末尾还挂着下一句的开头（「这」「先」「条」）。
//   观众读到的永远是半句话。
//
//   现在改成：在一个预算窗口里**回头找**标点 —— 找到句号就收在句号上
//   （哪怕这条短一些），找不到就退到逗号，连逗号都没有（长串英文、
//   没有标点的一整段）才硬切。
//
// ★ 一条字幕 = 一行。
//   字数上限直接对齐「一行放得下多少字」，于是一条字幕不再折行。
//   26 字是渲染出来量过的：52px 字号下约占 1400px，画面宽 1920px，留得住边距。
//
//   代价要说清楚：为了守住「一行」，偶尔会切出偏短的一条，实测有 3 条
//   落在 1.5~2.0 秒（「的 images 表。」「href 和 tokens。」这种）。
//
//   这是**故意接受的**取舍，因为另一边更糟：
//     切碎 → 只是这一条短一点，句子本身还是完整读得下去的
//     折行 → 排版乱掉，而且短的那一行只有两三个字，更难看
//
//   想反过来（宁可折行也不要短字幕），把 MIN_CUE_MS / MIN_CUE_CHARS 调大。
//   也别把 MIN_CUE_CHARS 调太小 —— 试过 5，断句确实更自然
//   （能切成「images 表。」而不是「的 images 表。」），但短碎片从 3 条
//   涨到 6 条、最短掉到 1.2 秒。8 是这两头的平衡点。
const MAX_LINE_CHARS = 26
const MIN_CUE_CHARS = 8
const MAX_CUE_CHARS = MAX_LINE_CHARS
const MAX_CUE_MS = 7000
const MIN_CUE_MS = 1300
// 最后一个字念完之后的那点静音，不显示字幕
const TAIL_MS = 400
// 相邻字幕之间小于这个缝就直接连上，免得字幕闪一下黑
const STITCH_MS = 120

// 句末：优先收在这些标点之后
const STRONG = '。！？；：…'
// 句内停顿：退而求其次收在这里
const WEAK = '，、,'
const CLOSERS = '」』”’）)》】'

const PUNCT = STRONG + WEAK + CLOSERS

export const norm = (s: string): string => s.replace(/[^\p{Script=Han}\p{L}\p{N}]/gu, '')

const isPunct = (ch: string): boolean => PUNCT.includes(ch)

const isLatin = (ch: string): boolean => /[A-Za-z0-9]/.test(ch)

/** 显示宽度：汉字算 1，英文/数字/空格算 0.55。英文比汉字窄得多，不能按字数当宽度 */
const displayWidth = (s: string): number => {
  let w = 0
  for (const ch of s) w += isLatin(ch) || /\s/.test(ch) ? 0.55 : 1
  return w
}

type Tok = { startMs: number; durationMs: number; len: number }

/**
 * 字级坐标轴。
 *
 * ★ 坐标轴上的第 i 格 = 讲稿原文里第 i 个**保留字**。
 *   rawAt[i] 就是它在原文里的下标 —— 一一对应，没有歧义。
 */
type Ctx = {
  text: string
  rawAt: number[]
  total: number
  charAt: (pos: number) => string
  seekMs: (pos: number) => number
  /** 每个词的第 0 个字在字坐标里的位置 —— 合法的切点只有这些 */
  wordStarts: number[]
  /**
   * 切开之后，每一侧该把哪些**标点**算进去。
   *
   * ★ 为什么非要单独一张表：字坐标里没有标点（一个标点占 0 格），
   *   所以「这个句号属于谁」在字坐标里根本表达不出来。
   *   这里反复翻车过 —— 句号要么被两条字幕都丢掉
   *   （「…做出一条完整管线」没有句号），要么被下一条字幕吃掉。
   *
   *   规矩只有一条，而且是对称的：**标点跟着它前面的那个字。**
   *   所以边界处往前收标点（end 右移），往后跳过标点（start 左移）。
   */
  adjust: Array<{ start: number; end: number }>
  /** 字坐标 → 这个位置能不能断开（词首，或原文里本来就有空格/标点） */
  breakable: boolean[]
  /** 原文下标 → 字坐标 */
  posAtRaw: (raw: number) => number
}

export function buildCtx(text: string, words: Word[]): Ctx {
  const toks: Tok[] = []
  const rawAt: number[] = []
  const flatTok: number[] = []
  const flatPos: number[] = []
  const wordStarts: number[] = []
  const posFromRaw: number[] = []
  for (let i = 0; i < text.length; i++) posFromRaw.push(-1)

  let raw = 0

  for (const w of words) {
    const n = norm(w.text)
    if (!n) {
      // 纯标点的词条不占坐标，但原文下标要跟着往前走
      raw += w.text.length
      continue
    }

    const ti = toks.length
    toks.push({ startMs: w.startMs, durationMs: w.durationMs, len: n.length })
    wordStarts.push(rawAt.length)

    for (let d = 0; d < n.length; d++) {
      // 原文里跳过标点，找到跟这个词第 d 个字对齐的那个字
      while (raw < text.length && norm(text[raw]!) === '') raw++
      if (raw >= text.length) break
      posFromRaw[raw] = rawAt.length
      rawAt.push(raw)
      flatTok.push(ti)
      flatPos.push(d)
      raw++
    }
  }

  const total = rawAt.length

  const charAt = (pos: number): string => {
    const r = rawAt[pos]
    return r === undefined ? '' : (text[r] ?? '')
  }

  // 某个字的时间。用「下一个词的起点」当边界 ——
  // 实测比用 start+duration 稳：相邻词条之间偶尔有缝，用 duration 会飘。
  const seekMs = (pos: number): number => {
    if (total === 0) return 0
    if (pos <= 0) return toks[0]!.startMs
    if (pos >= total) {
      const last = toks[toks.length - 1]!
      return last.startMs + last.durationMs
    }
    const ti = flatTok[pos]!
    const t = toks[ti]!
    const next = toks[ti + 1]
    const end = next ? next.startMs : t.startMs + t.durationMs
    const frac = flatPos[pos]! / t.len
    return Math.round(t.startMs + (end - t.startMs) * frac)
  }

  /**
   * 原文下标 → 字坐标（找不到就往后取第一个已知的位置）。
   *
   * ★ 段边界必须走这条路，**不能**用时刻去反推词边界。
   *   曾经用「第一个在 t 之后开口的词」当边界，结果被 Edge 的词条粒度坑了：
   *   「…完整管线。」和「这条管线…」被并成了同一个词条，边界落到句号**后面**，
   *   于是上一条字幕的句号被切给了下一条。覆盖率检查抓不到（一个字没少），
   *   但画面上就是「完整管线」少一个句号。
   */
  const posAtRaw = (target: number): number => {
    for (let i = Math.max(0, target); i < posFromRaw.length; i++) {
      const p = posFromRaw[i]
      if (p !== undefined && p >= 0) return p
    }
    return total
  }

  // 边界处的标点归属：往前收（end 右移）、往后跳（start 左移）。
  const adjust: Array<{ start: number; end: number }> = []
  for (let p = 0; p <= total; p++) {
    const here = (p < total ? rawAt[p] : text.length) ?? text.length

    // 往前收：p 之前的那些标点属于「p 左边的那个字」
    let back = p > 0 ? (rawAt[p - 1] ?? -1) + 1 : 0
    if (p > 0) {
      for (let guard = 0; guard < 64 && back < here; guard++) {
        if (!isPunct(text[back] ?? '')) break
        back++
      }
    }

    // 往后跳：p 处如果是一串标点，说明它们是「p 左边那个字」的尾巴
    let fwd = here
    for (let guard = 0; guard < 64 && fwd < text.length; guard++) {
      if (!isPunct(text[fwd] ?? '')) break
      fwd++
    }

    adjust.push({ start: fwd, end: back })
  }

  // 哪些字坐标位置可以断开：词与词之间的缝。
  //
  // 折行必须用它 —— 否则会把一个词劈成两半：
  //   「实测一张纯色图从一百五十 / 四KB压到零点六KB。」
  //   「第二行，image 方法从 token / 里解构出 href 和 tokens。」
  // 跟着 TTS 给的词边界断，就不会出现半个数词、半个英文单词。
  const breakable: boolean[] = []
  for (let p = 0; p <= total; p++) {
    if (p === 0 || p === total) {
      breakable.push(true)
      continue
    }
    const prev = rawAt[p - 1] ?? 0
    const next = rawAt[p] ?? text.length

    // 两个保留字之间隔了空格或标点 → 本来就是个断点
    let ok = false
    for (let i = prev + 1; i < next; i++) {
      const ch = text[i] ?? ''
      if (/\s/.test(ch) || isPunct(ch)) {
        ok = true
        break
      }
    }
    // 词与词的缝：只要有一侧是英文/数字，就在这儿断。
    // 「canvas」「dataURL」「loading」必须整体换行，断成 canva/s 最扎眼。
    if (!ok && (isLatin(text[prev] ?? '') || isLatin(text[next] ?? ''))) ok = true
    breakable.push(ok)
  }

  return { text, rawAt, total, charAt, seekMs, wordStarts, adjust, breakable, posAtRaw }
}

/**
 * 断句时用的探针。
 *
 * isStart(p) 回答「第 p 格是不是一个词的开头」—— 唯一的合法切点。
 * 之所以是探针而不是直接读 ctx：段内断句用的是**局部坐标**，
 * 调用方可以用一个带偏移的探针把局部坐标映射回全局。
 */
type Probe = {
  charAt: (p: number) => string
  seekMs: (p: number) => number
  isStart: (p: number) => boolean
}

/** 取回 [a, b) 这段字在**原文**里的样子（带标点、带空格） */
function rawSlice(ctx: Ctx, a: number, b: number): string {
  if (b <= a) return ''
  const first = ctx.adjust[a]?.start ?? ctx.rawAt[a]
  const last = ctx.adjust[b]?.end ?? ((ctx.rawAt[b - 1] ?? 0) + 1)
  if (first === undefined || last === undefined) return ''
  return ctx.text.slice(first, last).trim()
}

/**
 * 挑一个断点：尽量不把英文单词/数字从中间劈开。
 *
 * 讲稿里有「serverless」「base64」「loading 等于 lazy」这种，
 * 断在字母中间（serv|erless）比断在汉字中间难看得多。
 */
function avoidMidWord(p: Probe, start: number, want: number, limit: number): number {
  let b = Math.max(start + 1, Math.min(want, limit))
  let guard = 0
  while (b > start + 1 && b < limit && guard++ < 24) {
    if (isLatin(p.charAt(b - 1)) && isLatin(p.charAt(b))) {
      b--
      continue
    }
    break
  }
  return b
}

/** 在一个窗口里回头找最好的断点：先找句号，再找逗号，都没有就返回 -1 */
function bestBreak(p: Probe, from: number, to: number): number {
  let weak = -1

  for (let q = to; q > from; q--) {
    const ch = p.charAt(q - 1)
    if (STRONG.includes(ch) || CLOSERS.includes(ch)) return q
    if (WEAK.includes(ch) && weak < 0) weak = q
  }

  return weak
}

/**
 * 第一轮：按标点断句。
 *
 * 全部用**局部坐标**（0 到 to）。字符和时间都通过 p 取，
 * 所以调用方用一个带偏移的探针就能把局部坐标映射回全局。
 *
 * ★ 候选切点**只从词首里取**，切完之后再吸附一次。
 *
 *   这是被两次事故逼出来的写法：
 *   1) 一开始是「谁离预算近就切谁」，结果切在词中间 ——
 *      切出过「六百五十|九KB」「canva|s」。上限 44 字时切得少没撞上，
 *      收到 26 字（一条字幕一行）后立刻暴露。
 *   2) 改成「先算出位置、再往前吸附到词首」，还是漏 ——
 *      因为窗口里可能**一个词首都没有**，那时 snap 只能退化成 start+1，
 *      又回到了切在词中间。
 *
 *   所以现在不猜位置了：直接拿着词首列表挑。挑不出来就说明这一段
 *   本来就不该在这里断，那就整段收下。
 */
function splitChunks(p: Probe, to: number): Array<[number, number]> {
  const out: Array<[number, number]> = []
  let start = 0
  let guard = 0

  // 这一段里所有合法的切点（词首），一次算好
  const legal: number[] = []
  for (let k = 1; k <= to; k++) if (p.isStart(k)) legal.push(k)
  if (legal.length === 0) return to > 0 ? [[0, to]] : []

  while (start < to && guard++ < 1000) {
    const startMs = p.seekMs(start)

    // 字数和时间两个预算，取更长的那一个
    let softEnd = start + MIN_CUE_CHARS
    while (softEnd < to && p.seekMs(softEnd) - startMs < MIN_CUE_MS) softEnd++

    let hardEnd = softEnd
    while (hardEnd < to && hardEnd - start < MAX_CUE_CHARS && p.seekMs(hardEnd) - startMs <= MAX_CUE_MS) {
      hardEnd++
    }

    let end = to

    if (hardEnd < to) {
      // 只认窗口内的词首
      const inWindow = legal.filter((k) => k > start && k >= softEnd && k <= hardEnd)

      // 1) 优先收在句末标点上
      let picked = -1
      for (const k of inWindow) {
        const ch = p.charAt(k - 1)
        if (STRONG.includes(ch) || CLOSERS.includes(ch)) picked = k
      }
      // 2) 退而求其次：句内停顿
      if (picked < 0) {
        for (const k of inWindow) {
          if (WEAK.includes(p.charAt(k - 1))) picked = k
        }
      }
      // 3) 连标点都没有：取窗口里最后一个词首（英文长句走这条）
      if (picked < 0 && inWindow.length > 0) picked = inWindow[inWindow.length - 1]!

      // 4) 窗口里一个词首都没有 —— 这一刀不合法，把整段收下
      if (picked > start) end = picked
    }

    if (end <= start) end = to
    out.push([start, end])
    start = end
  }

  return out
}

/** 第二轮：把太短的碎片并进邻居 —— 五六个字的字幕一闪而过，眼睛跟不上 */
function mergeChunks(chunks: Array<[number, number]>): Array<[number, number]> {
  const out: Array<[number, number]> = []

  for (const c of chunks) {
    const prev = out[out.length - 1]
    if (prev && c[1] - c[0] < MIN_CUE_CHARS && c[1] - prev[0] <= MAX_CUE_CHARS) {
      prev[1] = c[1]
      continue
    }
    out.push([c[0], c[1]])
  }

  // ★ 段末太短的尾巴一律并回前一条（反复并，直到长度够或只剩一条）。
  //
  //   实测「…存本地文件实例一换就 / 丢。」——「丢。」只有两个字、0.8 秒，
  //   观众刚看见就没了。这种尾巴比「前一条折成两行」难看得多。
  //   注意这里**不看**字数上限：并回去会让前一条变长（甚至要折行），
  //   但那是可以接受的代价，而把话切成「丢。」不可以。
  while (out.length >= 2) {
    const last = out[out.length - 1]!
    if (last[1] - last[0] >= MIN_CUE_CHARS) break
    const prev = out[out.length - 2]!
    prev[1] = last[1]
    out.pop()
  }

  return out
}

/**
 * 折行：只在**词边界**断开，并让两行尽量一样长。
 *
 * @param opts.canBreak 逐字符的断行许可 —— 由 buildCues 算好（词与词之间的缝）。
 *                      不传就退化成「按空格/标点断」，只在没有词表时用得上。
 *
 * ★ 为什么非要词边界：只按字符数切会切出这种
 *       实测一张纯色图从一百五十 / 四KB压到零点六KB。
 *       第二行，image 方法从 token / 里解构出 href 和 tokens。
 *   把数词和英文单词都劈开了。词边界是 TTS 免费给的，跟着它断就不会错。
 */
export function wrapCue(
  text: string,
  opts: { canBreak?: boolean[]; maxChars?: number } = {},
): string[] {
  const maxChars = opts.maxChars ?? MAX_LINE_CHARS
  const mask = opts.canBreak

  if (displayWidth(text) <= maxChars) return [text]

  const candidates: number[] = []
  for (let k = 1; k < text.length; k++) {
    const ch = text[k - 1] ?? ''
    if (mask ? mask[k] === true : /\s/.test(ch) || /[，。！？；：、,.]/.test(ch) || CLOSERS.includes(ch)) {
      candidates.push(k)
    }
  }

  // 挑断点：先要「两行都放得下」，再要「两行一样长」
  let cut = -1
  let bestScore = Infinity
  for (const k of candidates) {
    const a = displayWidth(text.slice(0, k).trim())
    const b = displayWidth(text.slice(k).trim())
    if (a > maxChars || b > maxChars) continue
    const score = Math.abs(a - b)
    if (score < bestScore) {
      bestScore = score
      cut = k
    }
  }

  // 没有能让两行都放得下的断点：只要前半截放得下就行
  // （宁可第二行短一点，也不要在词中间硬切）
  if (cut < 0) {
    for (const k of candidates) {
      if (displayWidth(text.slice(0, k).trim()) <= maxChars) cut = k
    }
  }

  // 一个候选都没有：只能在词中间切了
  if (cut < 0) cut = Math.max(1, Math.min(text.length - 1, Math.round(text.length / 2)))

  // 最后一道保险：断点如果落在英文单词中间，往最近的词边界挪
  if (isLatin(text[cut - 1] ?? '') && isLatin(text[cut] ?? '')) {
    let lo = cut
    while (lo > 1 && isLatin(text[lo - 1] ?? '')) lo--
    let hi = cut
    while (hi < text.length && isLatin(text[hi] ?? '')) hi++
    if (lo > 1 && displayWidth(text.slice(0, lo).trim()) <= maxChars) cut = lo
    else if (hi < text.length && displayWidth(text.slice(hi).trim()) <= maxChars) cut = hi
  }

  const head = text.slice(0, cut).trim()
  const rest = text.slice(cut).trim()
  if (!head || !rest) return [text]
  // 后半截重新折行时不再带掩码：掩码是按整条字幕的下标算的，换到后半截就对不上了
  return [head, ...wrapCue(rest, { maxChars })]
}

/**
 * 主入口：讲稿 + 词级时间戳 + 段落文字 → 字幕条。
 *
 * 段（parts）在这里当**不可跨越的边界**：一条字幕绝不跨段并排，
 * 否则它会把两件事糊在屏幕底下。段本来就是按语气切的，
 * 这比任何启发式规则都靠谱。
 *
 * 传的是段的**文字**而不是时刻：文字能给出确定的字符边界，
 * 用时刻反推词边界会被 TTS 的词条粒度坑（见 posAtRaw 的注释）。
 */
export function buildCues(text: string, words: Word[], parts?: string[]): Cue[] {
  if (words.length === 0) return []

  const ctx = buildCtx(text, words)
  if (ctx.total === 0) return []

  // 每段开头在**字坐标**里的位置：顺序查找，只往前走。
  //
  // indexText 是全部保留字拼成的串（没有标点），它的下标就是字坐标 ——
  // 所以 indexOf 的结果可以直接当切点用，不需要任何换算。
  // （在这里做过一次「原文下标 → 字坐标」的转换，是把两套下标搞混了：
  //   有标点的讲稿里，第 22 个字在原文里是第 25 个字符，转一次就全错了。）
  const indexText = ctx.rawAt.map((_, i) => ctx.charAt(i)).join('')
  const cuts: number[] = []
  if (parts && parts.length > 1) {
    let cursor = 0
    for (let i = 1; i < parts.length; i++) {
      const needle = norm(parts[i] ?? '')
      if (!needle) continue
      const at = indexText.indexOf(needle, cursor)
      if (at < 0) continue // 对不上就不断在这里（覆盖率检查会兜住）
      cursor = at + needle.length
      if (at > (cuts[cuts.length - 1] ?? 0)) cuts.push(at)
    }
  }

  // 段的边界：[起点, 终点)。终点取「下一段的第一个字」，
  // 所以段末标点天然归上一段所有。
  const starts = [...cuts, ctx.total]
  const segments: Array<[number, number]> = []
  for (let k = 0; k < starts.length; k++) {
    const from = k === 0 ? 0 : starts[k - 1]!
    const to = starts[k]!
    if (to > from) segments.push([from, to])
  }

  // 每一段内部独立断句。段边界是硬的：不合并、不跨越。
  const spans: Array<[number, number]> = []
  const wordStartSet = new Set(ctx.wordStarts)

  for (const [a, b] of segments) {
    const probe: Probe = {
      charAt: (p) => ctx.charAt(a + p),
      seekMs: (p) => ctx.seekMs(a + p),
      isStart: (p) => wordStartSet.has(a + p),
    }
    // mergeChunks 返回的是**局部**坐标，这里统一转回全局
    for (const [s, e] of mergeChunks(splitChunks(probe, b - a))) spans.push([a + s, a + e])
  }

  // 断句正确性自检：每个切点都必须落在**词的开头**。
  //
  // 这条抓的是「切在词中间」这一整类错 —— 覆盖率检查发现不了它
  // （字一个都没少，只是被划到隔壁字幕去了），但画面上就是半截字。
  for (const [s] of spans) {
    if (!wordStartSet.has(s)) {
      throw new Error('字幕断句出错：起点 #' + s + ' 不在任何词的开头（切在词中间了）。')
    }
  }

  // 原文下标 → 字坐标，用来把「字幕里的第几个字符」对回「第几个保留字」
  const rawToFlat: number[] = []
  for (let i = 0; i < ctx.text.length; i++) rawToFlat.push(-1)
  for (let i = 0; i < ctx.total; i++) {
    const r = ctx.rawAt[i]
    if (r !== undefined && r >= 0) rawToFlat[r] = i
  }

  const cues: Cue[] = []
  const masks: boolean[][] = []

  for (const [a, e] of spans) {
    // 这一段在**原文**里的样子，以及逐字符的断行许可。
    //
    // 掩码必须按**字幕文字**的下标来建，不能按字坐标来建 ——
    // 字幕文字里带标点（「给博客加图片，…」第 25 个字符），
    // 字坐标里没有标点（同一条只有 23 格）。用字坐标建出来的掩码，
    // 下标和文字错位两位，折行就会挑到错的位置（把「简单」劈开）。
    const build = (from: number, to: number): { text: string; mask: boolean[]; map: number[] } | null => {
      if (to <= from || ctx.seekMs(to) <= ctx.seekMs(from)) return null
      const firstRaw = ctx.adjust[from]?.start ?? ctx.rawAt[from] ?? 0
      const lastRaw = ctx.adjust[to]?.end ?? ((ctx.rawAt[to - 1] ?? 0) + 1)
      const raw = ctx.text.slice(firstRaw, lastRaw)
      const lead = raw.length - raw.trimStart().length
      const body = raw.trim()
      if (!body || norm(body) === '') return null

      const mask: boolean[] = []
      const map: number[] = []
      for (let k = 0; k <= body.length; k++) {
        const flat = rawToFlat[firstRaw + lead + k]
        map.push(flat !== undefined ? flat : -1)
        mask.push(flat !== undefined && flat >= 0 ? (ctx.breakable[flat] ?? false) : false)
      }
      return { text: body, mask, map }
    }

    let from = a
    let guard = 0

    // ★ 一条字幕 = 一行。
    //
    // 断句用的是「字数」（26 字），而放不放得下取决于**显示宽度**
    // （汉字宽、英文窄）再加字距 —— 两把尺子不一致时，断句觉得刚好的句子，
    // 渲染出来会顶出画框。所以这里按真实宽度复核：超了就**再切一刀**
    // （新起一条字幕），而不是折行。
    while (from < e && guard++ < 64) {
      const one = build(from, e)
      if (!one) break

      const lines = wrapCue(one.text, { canBreak: one.mask })

      // 候选**从词首里挑**，而不是从掩码里挑 —— 掩码标的是「字与字之间的缝」，
      // 和「第几个字符」差一格就会切在词中间。
      //
      // ★ 这里**不能**在「头超宽」时 break。
      //   之前写成 break，于是头一到上限就整个放弃，永远找不到
      //   「切早一点、给尾巴留够长度」的位置。实测后果：
      //     第二行，算出缩放比例， / 最长边压到九百像素，小图不放大。
      //   其实切在「…九百像素，」就能切成两条一行、两条都够长。
      //
      // 分两轮挑，优先级从高到低：
      //   ① 切点后面紧跟标点的 —— 这种切法句子天然完整，所以**不必**满足
      //      尾巴长度要求，可以切得更自然。实测靠这条把
      //        「所以我把 base64 字符串直接存进 / 的 images 表。」
      //      变成了
      //        「所以我把 base64 字符串 / 的 images 表。」
      //   ② 退回到任意词首，这时才用三条硬约束筛：
      //      头不超宽、前一条不短于 MIN_CUE_MS、尾巴不短于 MIN_CUE_CHARS
      let cut = -1
      if (lines.length > 1) {
        const fits = (k: number): boolean => wrapCue(one.text.slice(0, k).trim()).length <= 1
        const longEnough = (flat: number): boolean => ctx.seekMs(flat) - ctx.seekMs(from) >= MIN_CUE_MS

        for (let k = 1; k < one.map.length; k++) {
          const flat = one.map[k]
          if (flat === undefined || flat < 0 || !wordStartSet.has(flat)) continue
          if (!fits(k) || !longEnough(flat)) continue
          if (PUNCT.includes(ctx.charAt(flat))) cut = k // 收在标点上，优先
        }

        if (cut < 0) {
          for (let k = 1; k < one.map.length; k++) {
            const flat = one.map[k]
            if (flat === undefined || flat < 0 || !wordStartSet.has(flat)) continue
            if (e - flat < MIN_CUE_CHARS) continue
            if (!fits(k) || !longEnough(flat)) continue
            cut = k
          }
        }
      }

      // 没有合适的切点（整条就是一个长词，或切了会闪一下就没了）—— 老实折行
      if (cut <= 0) {
        cues.push({
          i: cues.length,
          startMs: Math.max(0, ctx.seekMs(from)),
          endMs: ctx.seekMs(e),
          text: one.text,
          lines: [],
        })
        masks.push(one.mask)
        break
      }

      const flat = one.map[cut]!
      const head = build(from, flat)
      if (!head) break
      cues.push({
        i: cues.length,
        startMs: Math.max(0, ctx.seekMs(from)),
        endMs: ctx.seekMs(flat),
        text: head.text,
        lines: [],
      })
      masks.push(head.mask)
      from = flat
    }
  }

  // 尾巴：最后一个字念完之后是静音，字幕不该还挂着
  const lastWord = words[words.length - 1]!
  const voiceEnd = lastWord.startMs + lastWord.durationMs

  for (const cue of cues) {
    if (cue.endMs > voiceEnd && cue.endMs - voiceEnd < 1000) cue.endMs = voiceEnd
  }

  // 相邻字幕之间别留缝，否则中间会闪一下「没有字幕」
  for (let i = 0; i < cues.length - 1; i++) {
    const cur = cues[i]!
    const later = cues[i + 1]!
    if (later.startMs - cur.endMs <= STITCH_MS && later.startMs > cur.startMs) cur.endMs = later.startMs
  }

  cues.forEach((cue, i) => {
    cue.lines = wrapCue(cue.text, { canBreak: masks[i] })
  })

  return cues.filter((c) => c.endMs > c.startMs)
}
