# ai-teacher

把一篇文章自动变成一条带配音和代码演示的教学视频。自用工具，CLI 优先。

## 一句话流程

```
corpus/source.md      你的文章
      │
      ├─ pnpm plan         AI 写讲稿 + 分镜（带校验，不合格自动重试）
      ▼
corpus/episode.json   剧本：讲稿分段 + 画面配置
      │
      ├─ pnpm say          配音 + 词级时间戳
      ├─ pnpm storyboard   段号 → 真实时间
      └─ pnpm video        逐帧渲染 → 合成 mp4
      ▼
out/render/final.mp4
```

## 命令

| 命令 | 作用 | 耗时 |
|---|---|---|
| `pnpm plan [文章]` | AI 写剧本（默认读 `corpus/source.md`） | 1–4 分钟（含重试） |
| `pnpm say` | 生成配音 + 词级时间戳 | 30–60 秒 |
| `pnpm storyboard` | 把段号解析成真实时间 | 瞬间 |
| `pnpm dev` | 浏览器预览（**有声音**、可拖时间条） | — |
| `pnpm video` | 一键出片 | 3 分钟视频约 8 分钟 |
| `pnpm shot 20000` | 只截第 20000 毫秒那一帧（调试画面） | 几秒 |

## 六条设计约束

**1. 画面 = 时间的纯函数。**
场景组件里**禁止** `setTimeout` / `setInterval` / CSS `transition` / `animation`。
所有视觉状态都由 `t`（毫秒）算出来。这样任意时刻都能「点名渲染」——
逐帧截图才有可复现性。

**2. 播放器可以用真实时间，场景不行。**
预览时以 `audio.currentTime` 为时钟（音画天然同步）；
出片时程序直接调 `window.__seek(t)`。边界就在这一层，别越界。

**3. audio-first：时长是从配音里量出来的，不是拍脑袋定的。**
换音色、改语速，帧数自动跟着变。画面迁就声音，不能反过来。

**4. 画面靠「段号」对齐，不靠名字。**（详见下一节）

**5. 每步产物落盘，改了什么只重跑那一步。**
改讲稿要重跑 `say`；只改画面不用重新配音。

**6. AI 的产出必须过校验才能进管线。**
不过校验就不覆盖 `episode.json`，并把问题清单喂回去让它自己改。

## 画面怎么和声音对齐（核心）

讲稿被切成一段一段（`parts`）。**每一段有一个段号，从 0 开始。**
画面元素写 `"part": 3`，意思就是「念到第 3 段的时候，这个元素出现」。

```json
{
  "parts": [
    { "text": "先说压缩，图片是页面体积的大头。" },
    { "text": "第一行，取出原图的宽和高。" }
  ],
  "scenes": [
    {
      "template": "CodeTyping",
      "startPart": 0,
      "props": {
        "fileName": "compress.js",
        "lines": [
          { "code": "const w = img.width, h = img.height", "part": 1 },
          { "code": "}" }
        ]
      }
    }
  ]
}
```

**为什么不用名字？** 一开始的做法是给段落起名字（`cue`），画面再引用那个名字。
结果是灾难：模型要同时维护两份清单，实测它的命名和顺序几乎每次都错，
而且错法五花八门（名字拼错、标了没人用、顺序颠倒、`startCue` 写成别的场景的）。
写了一堆校验规则也压不住 —— 因为**我们是在让模型做一件它不擅长的事**。

换成段号之后，那一整类错误**在结构上就不可能发生**：段号是程序数出来的，
模型只需要数对；顺序由「段号不能倒退」一条规则管住。

## 目录

```
corpus/
  source.md              输入文章
  narration.txt          派生的纯文本讲稿（看一眼用的）
  episode.json           ★ 剧本（AI 生成，也可以手改）
  episode.backup.json    上一次的剧本（覆盖前自动备份）
  example-episode.json   给 AI 看的范例（few-shot）
src/
  plan/                  第 1、2 环：文章 → 剧本
    plan.ts              LLM 调用 + 校验 + 重试
    prompt.ts            提示词（改这里来调内容取向）
    episode.ts           ★ 格式定义与全部校验规则
    build-storyboard.ts  段号 → 真实时间
  tts/                   第 3 环：配音
    speak.ts             统一入口（按 .env 选供应商）
  render/                第 4 环：画面
    scenes/              场景组件（你可以自己加）
    stage/Stage.vue      舞台：按时间轴切场景
    frames.ts            逐帧渲染
  compose/               第 5 环：ffmpeg 合成
templates/               主题、字体、配色（观感 80% 在这里）
out/render/              产物：音频、frames、storyboard.json、final.mp4
```

## 配置（`.env`，不提交）

```
# TTS：edge（免费、24kHz、官方词级时间戳）或 xfyun
TTS_PROVIDER=edge
TTS_VOICE=zh-CN-XiaoxiaoNeural

# 大模型：任何 OpenAI 兼容接口
LLM_BASE_URL=https://api.deepseek.com/v1
LLM_API_KEY=
LLM_MODEL=deepseek-chat
LLM_ATTEMPTS=5
```

## 踩过的坑（这些比代码值钱）

**渲染**

- **不能用 `file://` 打开构建产物。** 浏览器会以跨域为由拦掉 `<script type="module">`，
  页面根本不启动。必须在脚本里起一个本地静态服务器。
- **Playwright 自带的 ffmpeg 是精简版**，没有 mp4 封装器、没有 libx264，
  传 `-movflags` 直接报 `Unrecognized option`。装 `@ffmpeg-installer/ffmpeg`。
- **TTS 返回的词表里没有标点和空格。** 拿讲稿原文去比对永远对不上，
  两边都得先「只保留汉字/字母/数字」再比。
- **PowerShell 的 `Set-Location` 不改变 .NET 的工作目录。**
  用 `[System.IO.File]::WriteAllText()` 传相对路径会写到别的目录去。
  一定用绝对路径。
- **PowerShell 5.1 的 `-Encoding utf8` 会写 BOM。** ffmpeg 的 concat 列表、
  `.gitignore` 都会被 BOM 弄坏。
- **`Get-Content` 读无 BOM 的 UTF-8 会按 GBK 解**，中文注释会被写坏。
  用 `[System.Text.Encoding]::UTF8` 显式读。

**音画对齐**

- **要点/代码行的出现时机必须绑到某一段讲解上。** 没绑的元素会按固定间隔自己冒出来，
  而讲解早就讲到别处了。
- **场景不能挂太久。** 如果某几段讲解没有对应画面，上一个场景会一直挂在屏幕上 ——
  观众听到新话题、看到旧画面。这是「音画不同步」最常见的原因。
- **场景引用的段号不能越过下一个场景的开始**，否则那个元素永远不会出现。
- **「第一行/第二行」这类序号很脆弱。** 模型很容易从第 2 行开始数。
  改成直接描述这行在做什么更稳。

**AI 生成**

- **提示词里写了却没校验的约束，等于没写。** 例如「全片不超过 900 字」——
  不加校验器，模型超了也没人管。
- **校验报错要翻译成「具体怎么改」。** 只说「找不到 cue」模型不知道该加还是该删；
  说清楚「要么补一段讲解，要么把这个字段删掉」它才改得对。
- **每一次翻车都应该变成一条机器能自动检查的规则。** 跑几轮之后，
  那一类错误就再也溜不到渲染阶段了。

## 已知限制

- 一条 3 分钟视频要渲染约 8 分钟，**比实时还慢**（每帧约 90ms）。
  可优化方向：多场景并行渲染、静止段复用帧、换 CDP 截图。
- 画面类型只有两种：幻灯片、代码打字。
- 没有字幕（词级时间戳已经在 `timings.json` 里，成本很低）。
- 讲稿的语义正确性靠模型自觉，程序只能保证结构正确
  和「每行代码都有对应讲解」。