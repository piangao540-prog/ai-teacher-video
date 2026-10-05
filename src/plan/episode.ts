// 剧本（episode）的格式定义和校验。
//
// 这是「AI 生成」和「渲染」之间的契约，也是整个项目里最重要的一个文件。
//
// ★ 核心设计：画面元素靠「第几段讲稿」来对齐，不靠名字。
//
//   讲稿被切成一段一段（parts）。要让某个画面元素在「念到第三段时」出现，
//   就写 { "part": 3 }。就这么简单。
//
//   曾经的做法是给段落起名字（cue），画面再引用那个名字。结果是灾难：
//   模型要同时维护两份清单（讲稿里的名字、画面里的引用），
//   实测它的命名和顺序几乎每次都错，而且错法五花八门
//   （名字拼错、标了没人用、顺序颠倒、startCue 写成了别的场景的）。
//   我们花了好几轮去写校验规则，越写越多，模型反而越改越乱。
//
//   改成段号之后，那些错误**在结构上就不可能发生**了：
//   - 段号是程序算出来的，模型不可能拼错
//   - 顺序由「段号必须递增」一条规则管住，检查起来是纯数学
//   - 没有名字，就没有「这个名字指哪个」的问题

export type Part = { text: string }

export type SceneSpec = {
  template: string
  /** 这个场景从第几段讲稿开始出现 */
  startPart: number
  props: Record<string, unknown>
}

export type Episode = {
  parts: Part[]
  scenes: SceneSpec[]
}

// 已知的画面模板。
//
// ★ 在这之前**没有任何一处校验模板名是否合法** —— template 就是个裸 string，
//   名字写错了会一路穿过校验，到 build-storyboard 才抛错；更糟的是
//   Stage.vue 找不到组件时 `TEMPLATES[name] ?? null` 会让画面**安静地空白**。
//   加新模板时这里、build-storyboard 的分支、Stage.vue 的两张表都要同步。
export const TEMPLATE_NAMES = ['SlideBullets', 'CodeTyping', 'Terminal']

export function narrationOf(episode: Episode): string {
  return episode.parts.map((p) => p.text).join('')
}

// 把 props 里所有 part 引用收集出来（不管嵌多深、在哪个数组里），按出现顺序
export function collectPartRefs(value: unknown, out: number[] = []): number[] {
  if (Array.isArray(value)) {
    for (const v of value) collectPartRefs(v, out)
  } else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      if (k === 'part' && typeof v === 'number') out.push(v)
      else collectPartRefs(v, out)
    }
  }
  return out
}

/** 结构校验。返回问题列表，空数组表示没问题 */
export function validateEpisode(episode: Episode): string[] {
  const problems: string[] = []

  if (!Array.isArray(episode.parts) || episode.parts.length === 0) return ['parts 是空的']
  if (!Array.isArray(episode.scenes) || episode.scenes.length === 0) return ['scenes 是空的']

  episode.parts.forEach((p, i) => {
    if (typeof p.text !== 'string' || p.text.trim() === '') problems.push('parts[' + i + '].text 是空的')
  })

  const lastPart = episode.parts.length - 1
  let lastStart = -1

  episode.scenes.forEach((s, si) => {
    if (!s.template) {
      problems.push('scenes[' + si + '] 缺 template')
    } else if (!TEMPLATE_NAMES.includes(s.template)) {
      problems.push(
        'scenes[' + si + '] 的 template「' + s.template + '」不是已知的画面模板。' +
          '可用的只有：' + TEMPLATE_NAMES.join(' / ') + '。' +
          '（拼错的话 Stage.vue 找不到组件，画面会一片空白而且不报错 —— 所以在这里就拦住。）',
      )
    }
    if (typeof s.startPart !== 'number' || !Number.isInteger(s.startPart)) {
      problems.push('scenes[' + si + '] 的 startPart 必须是整数')
      return
    }
    if (s.startPart < 0 || s.startPart > lastPart) {
      problems.push('scenes[' + si + '] 的 startPart=' + s.startPart + ' 越界（讲稿一共 ' + episode.parts.length + ' 段）')
      return
    }
    if (s.startPart <= lastStart) {
      problems.push(
        'scenes[' + si + '] 的 startPart=' + s.startPart + ' 不比上一个场景大。场景必须按讲稿顺序排列。',
      )
    }
    lastStart = Math.max(lastStart, s.startPart)

    // 场景内引用的段号：不能早于 startPart，必须递增，而且不能越过下一个场景
    const next = episode.scenes[si + 1]
    const limit = next ? next.startPart : episode.parts.length + 1

    let prev = s.startPart - 1
    for (const p of collectPartRefs(s.props)) {
      if (p < 0 || p > lastPart) {
        problems.push('scenes[' + si + '] 引用了不存在的段号 ' + p + '（讲稿一共 ' + episode.parts.length + ' 段）')
        continue
      }
      if (next && p >= limit) {
        problems.push(
          'scenes[' + si + '] 引用了第 ' + p + ' 段，但从第 ' + limit + ' 段开始已经是 scenes[' + (si + 1) + '] 了。' +
            '**这个元素永远不会出现**（画面还没轮到它就切走了）。' +
            '要么把下一个场景往后挪，要么把这个元素去掉。',
        )
        continue
      }
      if (p < prev) {
        problems.push(
          'scenes[' + si + '] 里的画面元素必须按讲稿顺序引用段号：' +
            '第 ' + prev + ' 段之后又引用了第 ' + p + ' 段。段号不能倒退。',
        )
      }
      prev = Math.max(prev, p)
    }
  })

  return problems
}

// ---- 编辑约束 ----
//
// 这些不是「结构错误」，而是「这样写画面会难看」：
// 要点太多会溢出画框、一行代码太长会折行、一段旁白太长一口气念不完。
//
// 单独一个函数，因为它只用来约束 AI 的输出。
// 你手写剧本时想突破这些限制也可以（只是画面可能真的溢出）。

export const LIMITS = {
  maxTitleChars: 20,
  maxBullets: 6,
  maxBulletChars: 22,
  maxLines: 8,
  // 一个代码块里最多几行「铺垫行」—— 没写 part、讲稿里不专门讲它的行（import、setup）。
  // 定成 2 是照着真实代码块来的：一句 import 加一行 setup。
  // 再多就说明模型在拿铺垫行当「不写讲解」的出口了。
  maxPreambleLines: 2,
  maxCodeChars: 60,
  maxPartChars: 55,
  // 全片总字数的上下限。按每秒 5.3 个字估算：900 字约 2 分 50 秒，300 字约 57 秒。
  // 提示词里给模型的目标是 **800–900**，这两个数只是兜底 ——
  // 因为给「范围」它就会贴着下沿写（实测 325 字，比下限只高 8%，成片 55 秒）。
  //
  // 下限为什么也要校验：提示词里一直写着「大约 300 到 900 字」，
  // 但以前只查了上限 —— 按 README「提示词里写了却没校验的约束，等于没写」，
  // 那个 300 一直是句空话。
  // 文章模式下这不出事（一篇文章的体量天然把产出顶上去），
  // 但主题模式下没有东西撑长度，模型只讲 40 秒就收工是完全可能的，
  // 而旧校验会一声不吭地放行。
  minTotalChars: 300,
  maxTotalChars: 900,
  // 一个场景最多覆盖几段讲稿。
  // 一个场景挂太久（画面一动不动几十秒），观众会以为卡住了。
  maxSceneParts: 6,
}

export function checkEditorial(episode: Episode): string[] {
  const problems: string[] = []

  const total = episode.parts.reduce((n, p) => n + p.text.length, 0)
  if (total > LIMITS.maxTotalChars) {
    problems.push(
      '讲稿总共 ' + total + ' 个字，超过 ' + LIMITS.maxTotalChars + ' 字上限。' +
        '按每秒 5.3 个字算，现在是约 ' + Math.round(total / 5.3) + ' 秒，上限约 ' + Math.round(LIMITS.maxTotalChars / 5.3) + ' 秒。' +
        '**必须砍内容**：只保留最有价值的 2 到 3 个点，次要的细节合并或者直接删掉。',
    )
  }

  // 太短。文案里刻意**避开「上限」二字** —— repairHint 用 p.includes('上限')
  // 匹配「装不下」那一类问题，撞上会给出完全不相关的提示。
  if (total < LIMITS.minTotalChars) {
    problems.push(
      '讲稿总共只有 ' + total + ' 个字，太短了。按每秒 5.3 个字算约 ' + Math.round(total / 5.3) + ' 秒，' +
        '下限是 ' + LIMITS.minTotalChars + ' 字（约 ' + Math.round(LIMITS.minTotalChars / 5.3) + ' 秒）。' +
        '**内容不够**：讲 2 到 3 个点，每个点都要有展开 —— ' +
        '它解决什么问题、最小的例子是什么、哪里最容易搞错。' +
        '宁可讲透一个点，也不要三个点各说一句。',
    )
  }

  // 场景不能「挂」太久。
  //
  // 这条是为了防一种很隐蔽的错：AI 为某段内容写了讲解，
  // 却忘了给它配画面 —— 于是上一个场景一直挂在屏幕上，
  // 观众听到的是新话题，看到的还是旧画面。这就是「文字和声音不匹配」。
  episode.scenes.forEach((s, i) => {
    const next = episode.scenes[i + 1]
    const covered = (next ? next.startPart : episode.parts.length) - s.startPart
    if (covered > LIMITS.maxSceneParts) {
      problems.push(
        'scenes[' + i + ']（' + s.template + '）从第 ' + s.startPart + ' 段一直挂到第 ' +
          (s.startPart + covered - 1) + ' 段，覆盖了 ' + covered + ' 段讲稿，超过 ' + LIMITS.maxSceneParts +
          ' 段上限。**说明中间有一段内容你没有给它配画面**，观众会听到新话题、却还看着旧画面。' +
          '把那几段拆成一个新场景（幻灯片或代码场景都行）。',
      )
    }
  })

  episode.parts.forEach((p, i) => {
    if (p.text.length > LIMITS.maxPartChars) {
      problems.push('parts[' + i + '] 有 ' + p.text.length + ' 个字，超过 ' + LIMITS.maxPartChars + ' 上限，一口气念不完，拆成两段。')
    }
  })

  episode.scenes.forEach((s, i) => {
    const props = s.props as Record<string, unknown>
    const tag = 'scenes[' + i + ']（' + s.template + '）'

    if (typeof props.title === 'string' && props.title.length > LIMITS.maxTitleChars) {
      problems.push(tag + ' 的标题有 ' + props.title.length + ' 个字，超过 ' + LIMITS.maxTitleChars + ' 上限，改短。')
    }

    if (Array.isArray(props.bullets)) {
      const bullets = props.bullets as Array<{ text?: string; part?: number }>
      if (bullets.length > LIMITS.maxBullets) {
        problems.push(
          tag + ' 有 ' + bullets.length + ' 条要点，超过 ' + LIMITS.maxBullets + ' 条上限，**画面会溢出到看不见**。拆成两页。',
        )
      }
      bullets.forEach((b, j) => {
        if (typeof b.text === 'string' && b.text.length > LIMITS.maxBulletChars) {
          problems.push(tag + ' bullets[' + j + '] 有 ' + b.text.length + ' 个字，超过 ' + LIMITS.maxBulletChars + ' 上限，改短。')
        }
        if (typeof b.part !== 'number') {
          problems.push(
            tag + ' bullets[' + j + '] 没有 part。**幻灯片里每一条要点都必须写 part**（第几段讲稿念到时出现），否则它会和声音错开。',
          )
        }
      })
    }

    if (Array.isArray(props.lines)) {
      const lines = props.lines as Array<{ code?: string; text?: string; kind?: string; part?: number }>
      const isTerminal = s.template === 'Terminal'
      // 两种模板共用 lines 这个字段名，正文取 code 或 text
      const bodyOf = (l: { code?: string; text?: string }): string => l.code ?? l.text ?? ''

      if (lines.length > LIMITS.maxLines) {
        problems.push(tag + ' 有 ' + lines.length + ' 行，超过 ' + LIMITS.maxLines + ' 行上限，删减。')
      }
      lines.forEach((l, j) => {
        const body = bodyOf(l)

        if (isTerminal) {
          // 终端：命令必须绑讲解；输出是程序吐出来的，不写 part。
          if (l.kind !== 'command' && l.kind !== 'output') {
            problems.push(
              tag + ' lines[' + j + ']「' + body.trim() + '」的 kind 必须是 "command" 或 "output"。' +
                '"command" 是敲进去的命令（会逐字打出来），' +
                '"output" 是这条命令打印出来的结果（整行出现）。',
            )
          } else if (l.kind === 'command' && typeof l.part !== 'number') {
            problems.push(
              tag + ' lines[' + j + ']「' + body.trim() + '」是命令但没有 part。' +
                '**每条命令都要写 part**，也就是讲稿里要有一段专门讲这条命令。' +
                '（输出行不用写 part —— 它紧跟在自己那条命令后面出现。）',
            )
          }
        }

        if (body.length > LIMITS.maxCodeChars) {
          problems.push(tag + ' lines[' + j + '] 有 ' + body.length + ' 个字符，超过 ' + LIMITS.maxCodeChars + ' 上限，会折行。')
        }
      })

      // 代码行的「讲解 ↔ 出现」契约。终端已有自己的一套（命令要 part、输出不要），
      // 所以这里只管 CodeTyping。
      if (!isTerminal) checkCodeNarration(tag, lines, episode, problems)
    }
  })

  return problems
}

// ---- 代码行的「讲解 ↔ 出现」契约 ----
//
// 这是全片最容易翻车、也最难查的一块，所以单独一个函数。
//
// ★ 为什么必须给「铺垫行」留出口
//
//   以前的要求是「除了纯收尾符号，每一行代码都要有自己的 part」。
//   可 import、setup 这种**只为交代上下文**的行，讲稿里根本没有、也不该有
//   专门讲它的句子（没人想看「下面我们 import 两个 API」）。
//   实测模型不会因此失败 —— 它会**偷一个本来属于别的行的段号**把规则圆过去，
//   于是从那一行往后，**每个画面元素都晚一格**。
//   而段号合法、递增、不越界，validateEpisode 一条都不报。
//
//   这不是模型不听话，是规则本身做不到。所以：给它一个明确的出口，
//   再把这个出口围上栏杆（位置 + 数量）。
//
// ★ 为什么还要查「第 N 行」
//
//   上面那道栏杆防的是「起因」，防不了「已经写歪了」。
//   「漂一格」属于语义层，便宜规则查不出来 —— 但**用序数说话的那一半能查**：
//   讲稿里说「第三行」，那一段就必须挂在写了 part 的第 3 行上。
//   今天这个 bug 正是这么露的马脚：import 白占了一个段号，
//   「第三行」于是挂到了第 4 个有 part 的行上。
function checkCodeNarration(
  tag: string,
  lines: Array<{ code?: string; part?: number }>,
  episode: Episode,
  problems: string[],
): void {
  const bodyOf = (l: { code?: string }): string => l.code ?? ''
  const hasPart = (l: { part?: number }): boolean => typeof l.part === 'number'
  // 纯收尾符号：} / }) / ); 这类，没有讲解也说得过去
  const isCloser = (b: string): boolean => /^[\s}\]\);,]*$/.test(b)
  // 铺垫行：没写 part，又不是纯收尾符号 —— 只为交代上下文，讲稿里没有专门讲它的那句
  const isPreamble = (l: { code?: string; part?: number }): boolean => !hasPart(l) && !isCloser(bodyOf(l))

  // ---- 铺垫行的栏杆：数量 + 位置 ----
  const preambles = lines.map((l, j) => (isPreamble(l) ? j : -1)).filter((j) => j >= 0)
  const firstParted = lines.findIndex(hasPart)

  if (preambles.length > LIMITS.maxPreambleLines) {
    problems.push(
      tag + ' 有 ' + preambles.length + ' 行没写 part（按铺垫行算），最多只能是 ' + LIMITS.maxPreambleLines + ' 行。' +
        '**铺垫行是给 import、setup 这类「讲稿里不专门讲它」的行留的出口，不是不写讲解的通道**：' +
        '没有讲解的行只能自己按打字速度冒出来，观众听到的和看到的就错开了。' +
        '其余的行都要写 part，并在讲稿里补一段专门讲它的讲解。',
    )
  }
  for (const j of preambles) {
    if (firstParted >= 0 && j > firstParted) {
      problems.push(
        tag + ' lines[' + j + ']「' + bodyOf(lines[j]!).trim() + '」没写 part（按铺垫行算），' +
          '但它排在已经写了 part 的行后面。' +
          '**铺垫行只能出现在代码块最前面** —— 它是「正文还没开始」的上下文，' +
          '会跟着场景开头那句过渡一起出现。排在中间就无处安放了：' +
          '要么给它写 part（讲稿里补一句专门讲它），要么把它挪到最前面。',
      )
    }
  }

  // ---- 「第 N 行」自洽 ----
  // 讲稿说「第 N 行」，那一段就必须挂在**写了 part 的第 N 行**上（铺垫行不数进去）。
  const ordinalOfPart = new Map<number, number>()
  let nth = 0
  for (const l of lines) {
    if (!hasPart(l)) continue
    nth += 1
    if (!ordinalOfPart.has(l.part!)) ordinalOfPart.set(l.part!, nth)
  }

  for (const [part, ordinal] of ordinalOfPart) {
    const text = episode.parts[part]?.text ?? ''
    // 一句话里出现两个行号时，多半是在比较两行（「第一行和第二行合并成一行」），不去猜。
    if (text.match(ALL_NTH_LINE)?.length !== 1) continue
    const n = parseNthLine(text)
    if (n === null || n === ordinal) continue
    problems.push(
      '**第 N 行对不上**：第 ' + part + ' 段讲稿说「第 ' + n + ' 行」，' +
        '但它挂在**写了 part 的第 ' + ordinal + ' 行**上，相差 ' + Math.abs(ordinal - n) + ' 行。' +
        '多半是有一行（import、setup 这种）白占了一个段号。' +
        '那一行讲稿里没有专门讲它，就**不要给它写 part**（当铺垫行），' +
        '让「第 N 行」数的是真正讲过的行。铺垫行只能放在代码块最前面。',
    )
  }
}

// 「第 N 行」：N 可以是中文数字（代码块最多 8 行，单个字够用）或阿拉伯数字。
const ALL_NTH_LINE = /第\s*([一二三四五六七八九十]|\d+)\s*行/g
const NTH_LINE = /第\s*([一二三四五六七八九十]|\d+)\s*行/
const CN_NUM: Record<string, number> = {
  一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10,
}

function parseNthLine(text: string): number | null {
  const m = NTH_LINE.exec(text)
  if (!m) return null
  const s = m[1]!
  if (/^\d+$/.test(s)) return Number(s)
  return CN_NUM[s] ?? null
}