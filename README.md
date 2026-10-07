# ai-teacher

把一篇文章 —— 或者干脆一句话主题 —— 自动变成一条带配音、带字幕、带代码演示的教学视频。

自用的本地工具，CLI 优先；`pnpm dev` 另有一个生成面板 + 播放器。

## 一句话流程

```
corpus/source.md      你的输入：一篇文章，或一句话主题
      │
      ├─ pnpm plan         AI 写讲稿 + 分镜（带校验，不合格自动重试）
      │                    —— 模型写的那份里没有段号，段号由此推导出来
      ▼
corpus/episode.json   剧本：讲稿分段 + 画面配置
      │
      ├─ pnpm say          配音 + 词级时间戳
      ├─ pnpm storyboard   段号 → 真实时间（顺带切出字幕）
      └─ pnpm video        逐帧渲染 → 合成 mp4
      ▼
out/render/final.mp4
```

## 快速开始

```bash
pnpm install
pnpm exec playwright install chromium   # 逐帧渲染要用（只装一次）
cp .env.example .env                    # 填 LLM_API_KEY
```

`.env` 里两件事：`LLM_*` 是**任何 OpenAI 兼容接口**（默认指着 DeepSeek），`TTS_*` 选配音。
`edge` 免费、不用注册；`xfyun` 要另外三个 `XFYUN_*`。`.env` 已在 `.gitignore` 里。

然后二选一：

```bash
pnpm dev                               # 面板：输入一句话 → 出剧本 → 当场配音 → 当场能播
pnpm plan && pnpm say && pnpm storyboard && pnpm video   # 全 CLI
```

`pnpm dev` 跑完停在「能播」这一步，**不出 mp4** —— 那还是 `pnpm video` 的事。

## 命令

| 命令 | 作用 | 耗时 |
|---|---|---|
| `pnpm plan [文章\|主题]` | AI 写剧本。参数是**已存在的文件**就当文章，否则当一句话主题（例如 `pnpm plan "Vue3 响应式原理"`）；不带参数读 `corpus/source.md` | 1–4 分钟（含重试） |
| `pnpm plan --dry …` | 只判别「这次按文章还是按主题跑」，不调模型、不写文件 | 瞬间 |
| `pnpm say` | 生成配音 + 词级时间戳 | 30–60 秒 |
| `pnpm storyboard` | 把段号解析成真实时间 **+ 生成字幕**（含外挂 `.srt` / `.vtt`） | 瞬间 |
| `pnpm status` | **体检 `out/render/` 那五环是不是同一版**（剧本 → 配音 → 时间轴 → 画面 → 成片）。只报不拦，退出码永远是 0 | 1 秒 |
| `pnpm dev` | **生成面板 + 浏览器预览**：上半页输入一句话 → 生成剧本 → 自动配音、切时间轴（全程实时日志），下半页就能播这一版（有声音、可拖时间条、字幕可开关）。配音单独挂了「只重配音」按钮 | 生成几十秒 + 配音半分钟 |
| `pnpm video` | 一键出片（字幕烧进画面） | 3 分钟视频约 3.5 分钟 |
| `pnpm shot 20000` | 只截第 20000 毫秒那一帧（调试画面） | 几秒 |
| `pnpm shot:cue 3` | 截第 3 条字幕中间那一帧（**校对字幕最顺手**） | 几秒 |
| `pnpm check` | 创作格式与推导的自检（范例、反例、不变量）—— 纯函数，不调模型 | 几毫秒 |
| `pnpm typecheck` | 类型检查，应当是 0 错误 | 几秒 |

## 代码在哪儿

五个环，一节一个目录：

| 环节 | 目录 |
|---|---|
| 1、2 素材 → 剧本 | [src/plan/](src/plan/)（`authoring.ts` 是「模型写的格式 → 渲染格式」的推导） |
| 3 配音 | [src/tts/](src/tts/) |
| 4 画面 | [src/render/](src/render/)（`scenes/` 是场景组件，**你可以自己加**） |
| 5 合成 | [src/compose/](src/compose/) |
| 生成面板 | [src/plan-ui/](src/plan-ui/) + [src/server/](src/server/) |
| 主题、字体、配色 | [templates/](templates/)（观感 80% 在这里） |

逐文件的说明在 [DESIGN.md](DESIGN.md#目录)。

## 设计上几条不能破的规矩

**1. 画面 = 时间的纯函数。** 场景组件里禁止 `setTimeout` / `transition` / `animation`，
所有视觉状态都由 `t`（毫秒）算出来 —— 任意时刻都能点名渲染，逐帧才可复现。

**2. 播放器可以用真实时间，场景不行。** 预览以 `audio.currentTime` 为时钟，出片直接调
`window.__seek(t)`。

**3. audio-first。** 时长是从配音里量出来的：换音色、改语速，帧数自动跟着变，画面迁就声音。

**4. 对齐靠「句子和元素是同一个对象」，不靠数数。** 模型写的那份里一个段号都没有，
段号由程序推导。

**5. 每步产物落盘，改了什么只重跑那一步。** 改讲稿要重跑 `say`；只改画面不用重新配音。

**6. AI 的产出必须过校验才进管线。** 不过校验就不覆盖 `episode.json`，
并把问题清单喂回去让它自己改。

另外，六条之外还有一条是关于产物的：五份产物要互相认得出「是不是同一版」，
靠**内容指纹**而不是 mtime —— 所以「重跑了一遍但内容没变」不会被误报成换了一版。
`pnpm status` 看现状；`pnpm video` 出片前会拦住对不上的画面。

每一条的**为什么**、以及踩过的坑，都在 [DESIGN.md](DESIGN.md)。

## 文档

| 文件 | 讲什么 |
|---|---|
| 这份 | 是什么、怎么跑起来、代码在哪 |
| [DESIGN.md](DESIGN.md) | **为什么这么写**：设计约束、音画怎么对齐、字幕怎么切、指纹链、踩过的坑、渲染提速实测 |
| [HANDOFF.md](HANDOFF.md) | 现在到哪了、接下来干什么、动手前必须知道的几条（**开发前先读**） |
