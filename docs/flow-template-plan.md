# 新增 Flow（示意图）模板 —— 实施计划

> 这份文档是给**新会话**看的。目标是把「示意图」做成第四个场景模板，
> 让模型能生成 `A → B → C` 这种流程画面，而不是只能动文字。
>
> 仓库：`E:\ai-teacher`。所有命令在仓库根目录跑。
> 不要改 `?render=1` 的行为，不要动 `src/editor/`，不要跑 `pnpm plan` / `pnpm say`
> （会覆盖剧本、烧 LLM/TTS 调用），除非用户明确要求。

---

## 0. 一句话目标

新增模板 `Flow`：一排方框 + 箭头，按讲稿顺序逐个淡入。
模型只写「每一步的文字 + 讲那句话」，**不写坐标、不写颜色、不写段号**。

---

## 1. 长什么样

### 1.1 创作格式（模型写的）

```json
{
  "template": "Flow",
  "say": ["一条视频从讲稿到成片，要经过四步。"],
  "props": {
    "title": "从讲稿到成片",
    "steps": [
      { "text": "写讲稿", "say": "第一步，先把要讲的内容写成讲稿。" },
      { "text": "配音", "say": "第二步，把讲稿交给语音合成，拿到每句话的时间。" },
      { "text": "画面对齐", "say": "第三步，画面元素卡在每句话开口的瞬间。" },
      { "text": "合成出片", "say": "最后，把画面和声音合在一起。" }
    ]
  }
}
```

规则：

- `steps` 是**线性**的，3 到 4 步（校验允许 2–4 步）。
- 每一步的 `text` 最多 **12 个字**。
- **每一步必须写自己的 `say`**。它不能像幻灯片要点那样「跟场景开头一起出现」，
  否则所有框会同时亮，流程图就失去意义了。
- 每一步只写**一句** `say`（可以写数组，但会占场景的 6 段额度，提示词里不鼓励）。
- 标题可选，最多 20 个字，和 SlideBullets 一致。

### 1.2 时间语义

- 标题：场景开始时淡入（`titleAtMs = 0`）。
- 第 `i` 步：`partTimes[step.part] - scene.startMs` 时开始淡入，400ms 淡完。
- 第 `i` 个箭头（连接第 `i` 步和第 `i+1` 步）：**下一步出现时**和它一起淡入。
- 所有框和箭头从第一帧就占好位置，**只变 `opacity`**，不做位移、不做条件渲染。
  这样不会出现布局跳动，也符合「画面是 `t` 的纯函数」。

### 1.3 为什么不做自由坐标

一旦允许模型写 `x` / `y` / `width`，它会写出重叠、越界、箭头指错方向的图，
而且校验很难便宜地判断。先把「线性流程」这一种做对；
真需要分支图，再单开一个模板，那是另一份契约。

---

## 2. 动手前先读这些

按顺序读，不要全文背：

1. `src/render/scenes/SlideBullets.tsx` + `SlideBullets.module.css`
   —— 最接近的模板：标题 + 逐个淡入的元素。
2. `src/render/scenes/sceneState.ts`
   —— 所有随时间变化的值都必须写在这里。
3. `src/plan/authoring.ts`
   —— `ELEMENT_KEYS`、`validateAuthored`、`deriveEpisode`。
4. `src/plan/episode.ts`
   —— `TEMPLATE_NAMES`、`LIMITS`、`checkEditorial`。
5. `src/plan/build-storyboard.ts`
   —— `SlideBullets` 那个分支就是照抄的样板。
6. `src/plan/prompt.ts`
   —— 模板文档和硬性要求。
7. `src/plan/authoring.check.ts`
   —— `pnpm check` 的自检。
8. `src/render/stage/Stage.tsx`
   —— `TEMPLATES` 注册表。

---

## 3. 注册点清单（漏一处会怎样）

| 文件 | 改什么 | 漏了会怎样 |
|---|---|---|
| `src/render/scenes/sceneState.ts` | `flowStateAt` | 组件没法算透明度 |
| `src/render/scenes/Flow.tsx` | 新组件 | 画面空白 |
| `src/render/scenes/Flow.module.css` | 新样式 | 画面空白/无样式 |
| `src/render/stage/Stage.tsx` | import + `TEMPLATES.Flow` | **画面静默空白**，不报错 |
| `src/plan/episode.ts` | `TEMPLATE_NAMES` + `LIMITS` + `checkEditorial` | 校验不认这个模板；`build-storyboard` 才抛错 |
| `src/plan/authoring.ts` | `ELEMENT_KEYS` 加 `'steps'` + `validateAuthored` | 步骤的 `say` 不会变成讲稿段 |
| `src/plan/build-storyboard.ts` | `Flow` 分支 | 抛「不认识的场景模板」 |
| `src/plan/prompt.ts` | 模板示例 + 硬性要求 | 模型不知道有这个模板 |
| `src/plan/authoring.check.ts` | 正例/反例 | 以后改坏了没人发现 |
| `src/editor/components/Timeline.tsx` | 颜色（可选） | 时间轴上这条是灰色，不影响功能 |

---

## 4. 分步实现

每做完一步都跑一次 `pnpm typecheck`。不要一口气全改完再排错。

### Step 1：`sceneState.ts` 加纯函数

文件末尾追加：

```ts
// ---- Flow（示意图）----

export type FlowStep = { atMs: number }

export type FlowState = {
    titleOpacity: number
    /** 第 i 个框的透明度 */
    stepOpacity: number[]
    /** 第 i 个箭头的透明度，连接第 i 步和第 i+1 步 */
    arrowOpacity: number[]
}

/**
 * 示意图在时刻 t 的全部透明度。
 *
 * 箭头跟着**下一步**出现：下一步的框开始淡入时，它前面那个箭头一起淡入。
 * 所有元素从第一帧就占好位置，这里只算 opacity —— 不做位移、不做条件渲染，
 * 所以布局永远不跳。
 */
export function flowStateAt(
    t: number,
    p: { titleAtMs: number; steps: FlowStep[] },
): FlowState {
    const fade = (startAtMs: number, ms: number) =>
        Math.max(0, Math.min((t - startAtMs) / ms, 1))
    return {
        titleOpacity: fade(p.titleAtMs, SLIDE_TITLE_FADE_MS),
        stepOpacity: p.steps.map((s) => fade(s.atMs, SLIDE_FADE_MS)),
        arrowOpacity: p.steps.slice(1).map((s) => fade(s.atMs, SLIDE_FADE_MS)),
    }
}
```

> 复用 `SLIDE_FADE_MS` / `SLIDE_TITLE_FADE_MS` 是故意的：四个模板的淡入速度
> 应该是同一档。不要另写一个 400。

### Step 2：`Flow.tsx`

新建 `src/render/scenes/Flow.tsx`：

```tsx
import { Fragment } from 'react'
import { flowStateAt } from './sceneState'
import styles from './Flow.module.css'

type Props = {
  t: number
  title?: string
  titleAtMs: number
  steps: Array<{ text: string; atMs: number }>
}

export default function Flow(props: Props) {
  const { title, steps } = props
  const state = flowStateAt(props.t, props)

  return (
    <div className={styles.flow}>
      {title && (
        <h1 className={styles.title} style={{ opacity: state.titleOpacity }}>
          {title}
        </h1>
      )}
      <div className={styles.row}>
        {steps.map((step, i) => (
          <Fragment key={i}>
            {i > 0 && (
              <span className={styles.arrow} style={{ opacity: state.arrowOpacity[i - 1] }}>
                →
              </span>
            )}
            <div className={styles.step} style={{ opacity: state.stepOpacity[i] }}>
              <span className={styles.num}>{i + 1}</span>
              <span>{step.text}</span>
            </div>
          </Fragment>
        ))}
      </div>
    </div>
  )
}
```

注意：

- **不要**写 `{state.stepOpacity[i] > 0 && <div .../>}`。条件渲染会让后面的框
  往前挤，箭头也跟着跳。永远渲染，只改 `opacity`。
- **不要**用 CSS `transition` / `animation` / `setTimeout`。
- `Fragment` 必须带 `key`，否则 React 会警告。

### Step 3：`Flow.module.css`

新建 `src/render/scenes/Flow.module.css`。尺寸按 **1920×1080** 设计
（`?render=1` 时 `.frame` 不缩放）：

```css
.flow {
    box-sizing: border-box;
    width: 100%;
    height: 100%;
    padding: 110px 140px;
    background: #0d1117;
    color: #e6edf3;
    display: flex;
    flex-direction: column;
}

.title {
    font-size: 88px;
    line-height: 1.2;
    margin: 0 0 72px;
    flex: 0 0 auto;
}

/* 和 SlideBullets 同一个视觉锚点：标题下一条绿色短横线 */
.title::after {
    content: '';
    display: block;
    width: 128px;
    height: 6px;
    margin-top: 30px;
    border-radius: 3px;
    background: #3fb950;
}

.row {
    flex: 1 1 auto;
    min-height: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 40px;
}

.step {
    box-sizing: border-box;
    flex: 1 1 0;
    max-width: 360px;
    min-height: 220px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 16px;
    padding: 28px 24px;
    border: 3px solid #30363d;
    border-radius: 24px;
    background: #161b22;
    font-size: 40px;
    line-height: 1.35;
    text-align: center;
}

.num {
    flex: 0 0 auto;
    width: 56px;
    height: 56px;
    border-radius: 50%;
    background: #3fb950;
    color: #0d1117;
    font-size: 32px;
    font-weight: 700;
    display: flex;
    align-items: center;
    justify-content: center;
}

.arrow {
    flex: 0 0 auto;
    font-size: 64px;
    line-height: 1;
    color: #3fb950;
}
```

**这些类名全部是静态样式**：没有 `transition`，没有 `animation`，没有随 `t` 变的值。

### Step 4：注册到 Stage

`src/render/stage/Stage.tsx`：

```tsx
import Flow from "../scenes/Flow"

const TEMPLATES: Record<string, ComponentType<any>> = {
    SlideBullets, CodeTyping, Terminal, Flow,
}
```

只改这两处。`?render=1` 那条分支不用动 —— Flow 和其他模板走同一条渲染路径。

### Step 5：创作格式（`authoring.ts`）

1. `ELEMENT_KEYS` 加 `'steps'`，并 **export**（自检文件要复用同一份清单）：

```ts
export const ELEMENT_KEYS = ['bullets', 'lines', 'steps'] as const
```

2. `validateAuthored` 里，在元素的 `says` 算完之后加：

```ts
if (says.length === 0 && key === 'steps') {
  problems.push(
    where + ' 没写 say。**示意图的每一步都必须写一句 say** —— ' +
      '这句话开口的瞬间，这个框才会出现。不写的话它永远不会亮。',
  )
}
```

3. `deriveEpisode` 的注释补一句：

```
 *        示意图步骤：和要点不同，**不允许不写 say**（validateAuthored 拦），
 *                    所以不存在「跟场景开头一起出现」的兜底。
```

`deriveEpisode` 的逻辑本身不用改：`ELEMENT_KEYS` 加进去之后，
带 `say` 的 step 会自动拿到 `part`。

### Step 6：校验和约束（`episode.ts`）

1. `TEMPLATE_NAMES`：

```ts
export const TEMPLATE_NAMES = ['SlideBullets', 'CodeTyping', 'Terminal', 'Flow']
```

2. `LIMITS` 追加：

```ts
  // 示意图：一排方框。超过 4 个，1920 宽就放不下 12 个字的框了。
  minFlowSteps: 2,
  maxFlowSteps: 4,
  maxStepChars: 12,
```

3. `checkEditorial` 里，在 `props.bullets` 那一段后面加：

```ts
if (Array.isArray(props.steps)) {
  const steps = props.steps as Array<{ text?: string; part?: number }>
  if (steps.length > LIMITS.maxFlowSteps) {
    problems.push(
      tag + ' 有 ' + steps.length + ' 步，超过 ' + LIMITS.maxFlowSteps +
        ' 步上限，一排放不下。拆成两个场景，或者合并相邻的步骤。',
    )
  }
  if (steps.length < LIMITS.minFlowSteps) {
    problems.push(
      tag + ' 只有 ' + steps.length + ' 步，示意图至少要 ' + LIMITS.minFlowSteps +
        ' 步（一步就只是一个标签，画不成流程）。',
    )
  }
  steps.forEach((st, j) => {
    const text = typeof st.text === 'string' ? st.text : ''
    if (text.trim() === '') {
      problems.push(tag + ' steps[' + j + '] 没有 text。')
    } else if (text.length > LIMITS.maxStepChars) {
      problems.push(
        tag + ' steps[' + j + ']「' + text + '」有 ' + text.length +
          ' 个字，超过 ' + LIMITS.maxStepChars + ' 上限，框里会折行，改短。',
      )
    }
    if (typeof st.part !== 'number') {
      problems.push(
        tag + ' steps[' + j + '] 没有 part。**示意图的每一步都要有自己的 say**，' +
          '否则它没有出现的时机。',
      )
    }
  })
}
```

> 两条检查分工不同：
> `validateAuthored` 拦住「模型没写 say」，`checkEditorial` 兜住「手写的渲染格式缺 part」。
> 两条都要有。

### Step 7：`build-storyboard.ts`

在 `Terminal` 分支后面、`else` 前面加：

```ts
} else if (s.template === 'Flow') {
  const p = s.props as {
    title?: string
    steps: Array<{ text: string; part: number }>
  }
  props = {
    title: p.title,
    titleAtMs: 0,
    steps: p.steps.map((st) => ({
      text: st.text,
      atMs: Math.max(0, partTimes[st.part]! - startMs),
    })),
  }
}
```

再在文件末尾的调试输出里，`p.bullets` 那段旁边加：

```ts
if (Array.isArray(p.steps)) {
  for (const st of p.steps as Array<{ text: string; atMs: number }>) {
    console.log('    +' + String(st.atMs).padStart(6) + 'ms   ' + st.text)
  }
}
```

这样 `pnpm storyboard` 会把每一步的时间和文字打出来，一眼能看出对齐对不对。
顺手把错误信息里的 `Stage.vue` 改成 `Stage.tsx`（这个文件早就是 tsx 了）。

### Step 8：提示词（`prompt.ts`）

1. 在 `### Terminal（终端演示）` 的代码块之后、`# 硬性要求` 之前，加：

````md
### Flow（示意图）

把「A → B → C」这种**线性流程**画成一排方框。不要拿它画代码或终端输出。

{
  "template": "Flow",
  "say": ["一条视频从讲稿到成片，要经过四步。"],
  "props": {
    "title": "从讲稿到成片",
    "steps": [
      { "text": "写讲稿", "say": "第一步，先把要讲的内容写成讲稿。" },
      { "text": "配音", "say": "第二步，把讲稿交给语音合成，拿到每句话的时间。" },
      { "text": "画面对齐", "say": "第三步，画面元素卡在每句话开口的瞬间。" },
      { "text": "合成出片", "say": "最后，把画面和声音合在一起。" }
    ]
  }
}

- 3 到 4 步最合适，最多 4 步；每步文字最多 12 个字。
- **每一步都要写自己的 say**，一句话就够了。不要给步骤写 say 数组 ——
  一张图占满 6 段讲稿，后面就没法展开别的了。
- 方框和箭头由程序排布。不要写位置、坐标、颜色、箭头。
````

2. `### 不写 say 的元素` 的最后，「除了这三种，……」之前补一句：

```
示意图的步骤**不在这三种里**：每一步都必须写 say，否则它没有出现的时机。
```

3. 硬性要求第 3 条，加一条：

```
   - 示意图至少 2 步、最多 4 步，每步文字最多 12 个字；**每一步都必须写 say**。
```

4. 硬性要求第 8 条，补一句：

```
   要讲「一个过程分成几步」，用 Flow；它画的是流程，不是代码，也不是终端输出。
```

> 提示词里的数字必须和 `LIMITS` 完全一致：2 / 4 / 12。
> 改了 `LIMITS` 就回来改这里，否则模型会反复撞墙。

### Step 9：范例（`corpus/example-episode.json`）

**在数组末尾**追加一个 3 步的 Flow 场景（不要插在中间 ——
`authoring.check.ts` 里有 `scenes[1]` / `scenes[2]` 的位置引用）：

```json
{
  "template": "Flow",
  "say": ["最后看一条视频要经过哪几步。"],
  "props": {
    "title": "从讲稿到成片",
    "steps": [
      { "text": "写讲稿", "say": "第一步，先把内容写成讲稿。" },
      { "text": "配音", "say": "第二步，把讲稿交给语音合成。" },
      { "text": "出片", "say": "第三步，把画面和声音合起来。" }
    ]
  }
}
```

范例是 few-shot，模型主要靠它学形状。加在最后，不会再影响前面两个按位置取的代码场景。

### Step 10：自检（`authoring.check.ts`）

1. import 里加 `ELEMENT_KEYS`：

```ts
import { ELEMENT_KEYS, addLineNumbers, deriveEpisode, validateAuthored, type AuthoredEpisode } from './authoring'
```

2. `assertSameObject` 里把

```ts
for (const key of ['bullets', 'lines'] as const) {
```

改成

```ts
for (const key of ELEMENT_KEYS) {
```

这样 Flow 的 `steps` 自动被同一个不变量盯着 —— 以后再加元素类型也不会漏。

3. 在 `assertSameObject` 定义之后、反例列表之前，加：

```ts
// ---- Flow：示意图 ----
const flowAuthored: AuthoredEpisode = {
  scenes: [{
    template: 'Flow',
    say: ['看一条视频要经过哪几步。'],
    props: {
      title: '从讲稿到成片',
      steps: [
        { text: '写讲稿', say: '第一步，先把内容写成讲稿。' },
        { text: '配音', say: '第二步，把讲稿交给语音合成。' },
        { text: '出片', say: '第三步，把画面和声音合起来。' },
      ],
    },
  }],
}

const flowAuthoredProblems = validateAuthored(flowAuthored)
check(flowAuthoredProblems.length === 0, 'Flow 是合法的创作格式' + (flowAuthoredProblems[0] ?? ''))

const flowEpisode = deriveEpisode(flowAuthored)
const flowStructural = validateEpisode(flowEpisode)
check(flowStructural.length === 0, 'Flow 推导后过结构校验' + (flowStructural[0] ?? ''))
check(assertSameObject(flowAuthored, flowEpisode).length === 0, 'Flow：每一步 ↔ 它自己的那句话')

const flowSteps = (flowEpisode.scenes[0]!.props as { steps: Array<{ text: string; part: number }> }).steps
check(flowSteps[1]!.part === 2, 'Flow：第二步指向讲稿第 2 段（场景 say 占第 0 段）')

const flowEditorial = checkEditorial(flowEpisode).filter((p) => !p.includes('太短'))
check(flowEditorial.length === 0, 'Flow 过编辑校验（除字数下限）' + (flowEditorial[0] ?? ''))

// 超过 4 步要能被拦住
const tooManySteps = structuredClone(flowEpisode)
const tooManyProps = tooManySteps.scenes[0]!.props as { steps: Array<{ text: string; part: number }> }
tooManyProps.steps.push({ text: '第四步', part: 0 }, { text: '第五步', part: 0 })
check(
  checkEditorial(tooManySteps).some((p) => p.includes('步上限')),
  '拦住：Flow 超过 4 步',
)
```

4. 反例列表里加一条：

```ts
['Flow 步骤没写 say', { scenes: [{ template: 'Flow', say: ['a'], props: { steps: [{ text: 'x' }] } }] }],
```

### Step 11（可选）：编辑器时间轴颜色

`src/editor/components/Timeline.tsx`：

```ts
const COLORS: Record<string, string> = {
    SlideBullets: '#1f6feb',
    CodeTyping: '#238636',
    Terminal: '#8957e5',
    Flow: '#d29922',
}
```

不加也只是灰色，不影响功能。

---

## 5. 验证

按这个顺序跑，前一步不过不要往下走。

### 5.1 纯函数和类型

```bash
pnpm check
pnpm typecheck
```

- `pnpm check` 必须全 ✓，包括：范例合法、Flow 正例、Flow 缺 say 的反例、超过 4 步的反例。
- `pnpm typecheck` 必须无输出。

### 5.2 画面冒烟测试（不花 LLM / TTS）

`pnpm shot` 和 `pnpm frames` 读的是 `dist/`，所以渲染相关改动必须先构建：

```bash
pnpm vite build
```

然后临时改 `out/render/storyboard.json`（**生成产物，不会被 git 记录**）：

1. 备份：`cp out/render/storyboard.json out/render/storyboard.backup.json`
2. 在 `scenes` 数组**末尾**追加一个 Flow 场景：

```json
{
  "id": "flow-test",
  "template": "Flow",
  "startMs": 0,
  "endMs": 6000,
  "props": {
    "title": "从讲稿到成片",
    "titleAtMs": 0,
    "steps": [
      { "text": "写讲稿", "atMs": 0 },
      { "text": "配音", "atMs": 2000 },
      { "text": "画面对齐", "atMs": 4000 },
      { "text": "合成出片", "atMs": 6000 }
    ]
  }
}
```

> `startMs` / `endMs` 只是占位，截图用；下面的截图时间都按 0–6s 算。

3. 截图：

```bash
pnpm shot 300 1
pnpm shot 2300 1
pnpm shot 4300 1
```

4. 打开 `out/shots/` 里的三张图，确认：
   - 0.3s：标题 + 第 1 个框，箭头还没出来；
   - 2.3s：第 2 个框和第 1 个箭头；
   - 4.3s：第 3 个框和第 2 个箭头；
   - 框不重叠、不越界，文字不折成三行。

5. 恢复：

```bash
mv out/render/storyboard.backup.json out/render/storyboard.json
```

> 也可以直接跑 `pnpm storyboard` 重新生成 —— 它只读现有的
> `corpus/episode.json` 和 `timings.json`，不调 LLM、不调 TTS。
> 但前提是这两份文件都是最新的；不确定就先用备份还原。

### 5.3 端到端（可选，贵）

只有用户明确要求时才做：

```bash
pnpm plan        # 会让模型重新写剧本，可能用上 Flow
pnpm say         # 重新配音
pnpm storyboard  # 看日志里 Flow 每一步的 +atMs
pnpm vite build
pnpm video       # 几分钟
```

跑之前先备份 `corpus/episode.json` 和 `corpus/source.md`。
`pnpm plan` 不保证模型一定选 Flow —— 想强制看效果，可以临时在素材里
明确写「用一个示意图展示 A 到 B 到 C 的流程」，但不要把这种话留在正式素材里。

---

## 6. 验收标准

- [ ] `pnpm check` 全过，`pnpm typecheck` 无输出。
- [ ] 冒烟截图里 3–4 个框横向排开，箭头在两个框之间，逐个淡入。
- [ ] 任意两个相邻帧之间，框的位置没有变过（只有透明度变化）。
- [ ] `Flow.tsx` / `Flow.module.css` / `sceneState.ts` 里没有
      `transition` / `animation` / `setTimeout` / `requestAnimationFrame`。
- [ ] `?render=1` 下截图正常；`?edit=1` 和普通预览不受影响。
- [ ] 现有三个模板的行为、输出没有变化。
- [ ] 提示词里的 2 / 4 / 12 和 `LIMITS` 一致。
- [ ] `pnpm storyboard` 的日志里能看到 Flow 每一步的 `+atMs` 和文字。
- [ ] 删掉 `Flow` 的注册（模拟拼错模板名）时，`validateEpisode` 能报错，
      而不是画面静默空白。

---

## 7. 容易踩的坑

1. **条件渲染导致布局跳。** 只改 `opacity`，永远把所有框和箭头渲染出来。
2. **用 CSS transition 做淡入。** 出片是逐帧 seek，CSS 动画不跟 `t` 走，
   截出来的帧会闪、会重复。所有随时间变化的值必须来自 `flowStateAt`。
3. **给 `steps` 写坐标。** 不要。布局由 flex 自动排，模型只写文字。
4. **`ELEMENT_KEYS` 只改一处。** 它同时被 `validateAuthored` 和 `deriveEpisode` 用；
   自检里的 `assertSameObject` 也要改成读它，否则 Flow 的「句子 ↔ 元素」不变量没人盯。
5. **步骤没 say 却进了 `build-storyboard`。** `part` 是 `undefined`，
   `partTimes[undefined]` 会算出 `NaN`，画面永远不出现。两道校验都要有。
6. **一步写了两三句 say。** 场景的 `maxSceneParts` 是 6：
   4 步 × 2 句 + 场景 say = 9，直接被编辑校验打回。提示词里明确「一步一句」。
7. **12 个字在 4 个框里会折行。** CSS 按 4 步 × 12 字的最坏情况调；
   冒烟测试就用 4 个长标签，不要拿 2 个字测完就算。
8. **忘了 `pnpm vite build`。** `shot` / `frames` 服务的是 `dist/`，不是 dev server。
   只改源码不重建，截出来还是旧画面。
9. **漏了 `Stage.tsx` 的注册。** `TEMPLATES[name] ?? null` 会让画面**安静地空白**，
   控制台不报错。这是最隐蔽的一种。
10. **动了 `?render=1` 的分支。** 不需要。Flow 和其他模板共用同一条路径。
11. **在范例中间插 Flow。** `authoring.check.ts` 用 `scenes[1]` / `scenes[2]` 取代码和终端，
    插中间会让自检指向错误场景。追加到末尾。
12. **提示词和 `LIMITS` 漂了。** 模型写 5 步 → 校验打回 → 重试还写 5 步 → 死循环。
    数字只改一处是不够的。

---

## 8. 新会话开场白（直接复制）

```text
仓库 E:\ai-teacher。请按 docs/flow-template-plan.md 实现 Flow（示意图）模板。

要求：
- 严格按文档里的顺序做，每完成一步跑 pnpm typecheck。
- 不要跑 pnpm plan / pnpm say（会覆盖剧本、花 LLM/TTS 调用）。
- 不要动 src/editor 和 ?render=1 的分支。
- 先读文档第 2 节列出的文件，再动手。
- 做完跑 pnpm check、pnpm typecheck，并按第 5.2 节做一次画面冒烟测试。
- 遇到文档没覆盖的情况，先停下来问我，不要自己扩大范围。
```
