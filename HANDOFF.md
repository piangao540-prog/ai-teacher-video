# 交接：给新会话的说明

这份是**接续用的**，不是设计文档。设计、命令用法、踩过的坑都在
[README.md](README.md) 里 —— 先读它，这份只讲「现在到哪了、接下来干什么」。

## 第一件事，按顺序做

1. 读 `README.md`（全部设计说明 + 所有踩过的坑）
2. `git log --oneline -6` 看最近做了什么
3. `git show HEAD` 看最后一次改动**为什么**这么改（提交信息里写了）
4. 跑一次 `pnpm typecheck` —— 应该是 0 错误

**别跳过第 2、3 步。** 提交信息里记的是「为什么」，
README 只记「是什么」，只看 README 会重犯已经踩过的坑。

## 现在是什么状态

一篇文章 → 一条带配音、带字幕、带代码演示的教学视频，全流程通了。

| | |
|---|---|
| 命令 | `pnpm plan` / `say` / `storyboard` / `video`（详见 README） |
| 当前成片 | 162.3 秒，8 个场景（6 个幻灯片 + 2 个代码打字） |
| 字幕 | 39 条，**全部一行** |
| 渲染 | 代码场景也能复用了；前 60 秒 233s → 73s，复用 78%（**全片未实测**） |
| 版本控制 | 已建，用 `feat:` / `fix:` / `perf:` 规范词 |

提交历史（从旧到新）：

```
43aa144  能跑通的第一版：文章 -> 讲稿 -> 配音 -> 画面 -> 成片
b8a9c18  feat: 加字幕（词级时间戳 → 一条一行，烧进画面）
e1433ea  fix: 删掉 plan.ts 里引用已废弃 cue 字段的死代码
46368b0  feat: 字幕收敛成一条一行（39/39）
b5980b9  perf: 渲染提速 2.7 倍（静止帧复用）
38ae25e  docs: 加 HANDOFF.md（换会话交接用）+ 修 README 过期的耗时
96eb193  perf: 代码场景也能复用（判据改成帧签名）
```

**注意**：`out/render/final.mp4` 是旧的（没有字幕）。要出片跑 `pnpm video`。

## 接下来可以做什么

按价值排序：

1. **全片对拍一次**。前 60 秒已经验过（1800 帧 MD5 0 差异、复用 78%），
   但全片还有第二个代码场景 s6（105 秒）和后面几段幻灯片没覆盖 ——
   走的是同一条代码路径，可本项目的纪律是全片跑一次才算数。
2. **画面类型只有两种**：幻灯片、代码打字。加模板要看看注册机制
   （`Stage.vue` 的 `TEMPLATES`）够不够松 —— 现在还得在 `SIGNATURES`
   里登记一份帧签名，**两个表要同时改**，漏了就会画面卡住。
3. **字幕只有画面内烧录**，没有 `.srt` / `.vtt`。想传 B 站/YouTube 需要导出
   （数据现成：`storyboard.json` 的 `cues`）。

## 动手前必须知道的几条

这些是 README 里最容易被忽略、但一犯就出事的：

- **场景组件禁止 `setTimeout` / `setInterval` / CSS `transition` / `animation`。**
  出片是逐帧截图，任何绑在真实时钟上的进度都不可复现。
  视觉状态必须由 `t` 算出来。要动效就走「从 t 算」这条路。
- **改源码不要用 PowerShell 的 `Get-Content` / `Set-Content` 中转。**
  它会把 UTF-8 读成 GBK 写坏文件（我为此重写过一整个文件）。
  用编辑工具直接改。
- **改渲染相关的东西，必须做逐帧对拍。**
  关掉复用跑一遍，再正常跑一遍，逐帧比 MD5，必须完全一致：

  ```powershell
  # pnpm frames [fps] [时长ms] —— 给了时长就只跑前 N 毫秒，调试时很省时间
  $env:FRAMES_NO_REUSE='1'; pnpm frames 30 60000
  Get-ChildItem out/render/frames/*.png | Sort-Object Name |
    Get-FileHash -Algorithm MD5 | ForEach-Object Hash | Set-Content -Encoding ascii $env:TEMP\naive.txt

  $env:FRAMES_NO_REUSE='0'; pnpm frames 30 60000
  Get-ChildItem out/render/frames/*.png | Sort-Object Name |
    Get-FileHash -Algorithm MD5 | ForEach-Object Hash | Set-Content -Encoding ascii $env:TEMP\opt.txt

  if (Compare-Object (gc $env:TEMP\naive.txt) (gc $env:TEMP\opt.txt)) { '对拍失败' } else { '对拍通过' }
  ```

  **存哈希清单，别把 `frames` 整个复制留底** —— 全片近 5000 张 1080p PNG，
  复制一份要占几个 G，而哈希清单只有几百 KB。
  （这里用 PowerShell 的 `Get-Content`/`Set-Content` 是安全的：
  前面那条「会写坏中文」的警告针对的是**源码文件**，
  这两份清单是纯 ASCII 的十六进制。）

  这个开关就是为验证存在的。不加对拍就提交的话，成片里会有画面卡住 ——
  我实测跑出过 502 帧不一致。
- **对拍只能证明「没错」，不能证明「有效」。** 两个都要测：
  对拍查正确性，`__static` 的命中率查有效性。
  （这个功能第一版复用率恒为 0%，而对拍照样全绿。）
- **网页要 `pnpm vite build` 之后再跑。** 只改源码不重建的话，
  页面用的是旧 `dist` —— 我因此被旧产物骗了一轮，连续几次「改了没效果」。

## 怎么跟这个项目的 AI 说话

给**可验证的完成条件**，别给过程描述：

```
✅ 目标：代码打字场景也能复用，且全片逐帧字节一致
   验收：pnpm frames 全片跑完 < 2 分钟，FRAMES_NO_REUSE=1 对拍 0 差异

❌ 目标：优化一下渲染
```

前半句让它知道去哪，后半句让它知道什么时候算完。
