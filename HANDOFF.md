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
| 当前成片 | 162.3 秒，8 个场景（5 个幻灯片 + 2 个代码打字 + 1 个终端演示） |
| 字幕 | 39 条，**全部一行** |
| 渲染 | 静止帧复用：前 60 秒 233s → 73s（78%），Terminal 场景 45s → 11s（80%）（**全片未实测**） |
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
19e0ec2  feat: 加第三个画面模板 Terminal（终端演示）
bbee276  feat: 第 7 个场景改用 Terminal，并修掉 s6/s7 的音画错位
31e21aa  docs: HANDOFF 里最新提交的 hash 写错了
```

**注意**：`out/render/final.mp4` **落后 `episode.json` 三个改动** ——
没有字幕、s6/s7 的音画还是错位的、第 7 个场景还是幻灯片。
`episode.json` 才是真相。要出片跑 `pnpm vite build && pnpm video`。

## 接下来可以做什么

按价值排序：

1. **出一版新片**：`pnpm vite build && pnpm video`（约 3~5 分钟）。
   磁盘上那份 `final.mp4` 落后三个改动，见上面那条注意。
   出片前想先目视检查，用 `pnpm dev` 拖时间轴（不用 build）。
2. **全片对拍一次**。已经验过两段 —— 前 60 秒（1800 帧 MD5 0 差异）、
   Terminal 场景（540 帧 0 差异）—— 但**从没跑过全片**。
   本项目的纪律是「全片跑一次才算数」，约 15 分钟（两遍全片）。
3. **字幕只有画面内烧录**，没有 `.srt` / `.vtt`。想传 B 站/YouTube 需要导出
   （数据现成：`storyboard.json` 的 `cues`）。

## 动手前必须知道的几条

这些是 README 里最容易被忽略、但一犯就出事的：

- **场景组件禁止 `setTimeout` / `setInterval` / CSS `transition` / `animation`。**
  出片是逐帧截图，任何绑在真实时钟上的进度都不可复现。
  视觉状态必须由 `t` 算出来。要动效就走「从 t 算」这条路。
- **改画面不用重配音，改讲稿才要。** 只动 `scenes`（模板、props、part 引用）
  → 跑 `pnpm storyboard` 就够，几秒钟；动了 `parts` → 必须重跑 `pnpm say`，
  而它会重切段号，全套都得再来一遍。所以**试新模板的正确姿势是找一个讲稿
  内容刚好合适的场景，只换 template**，别去改讲稿迁就画面。
  Terminal 就是这么用上的（s7，讲稿本来就在讲图片懒加载）。
- **part 整体错一段，校验查不出来。** 校验只管「递增、不越界、不跨场景」——
  某个场景的 part 全部统一 -1 照样条条合法，但画面会比声音早一整句。
  s6/s7 就这样在成片里躺了很久才被发现。唯一的查法是 `pnpm storyboard`
  打印的那份「元素 ↔ 讲解」对照，**逐行读**，不要只看时间。
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
