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
| 当前成片 | 162.3 秒，8 个场景（5 个幻灯片 + 2 个代码打字 + 1 个终端演示），**已核实与 `episode.json` 一致** |
| 字幕 | 39 条，**全部一行** |
| 渲染 | 静止帧复用：**全片 4869 帧 481s → 138s（80%，3.5 倍），逐帧 MD5 0 差异** |
| 版本控制 | 已建，用 `feat:` / `fix:` / `perf:` 规范词 |

提交历史（从旧到新；**刷新这份文档的那次提交不会列在里面**，这是正常的）：

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
4089a1e  docs: HANDOFF 刷新到最新状态（成片落后、待办重排、两条新教训）
4e408ab  feat: 导出外挂字幕 .srt / .vtt（pnpm storyboard 顺带写）
635dfcb  chore: 删掉三条指向空 src/cli 的死脚本
```

**注意（2026-10-05 核对过）**：`out/render/final.mp4` **已经是最新的** ——
时长 162.30s 与 `storyboard.json` 的 `durationMs` 完全一致，片内既有字幕、
也有 Terminal 场景，和现在的 `episode.json` 对得上。
改了 `scenes` 或源码之后才需要重出片：`pnpm vite build && pnpm video`。

> 上一版这份文档在这里写着「落后三个改动」，是**过期的** ——
> 成片在文档改完之后又出过一次。别信「产物落后于源码」这类话，
> 包括这一段，验一下只要 10 秒（见下面那条教训）。

## 接下来可以做什么

按价值排序：

1. 渲染还能再快：多场景并行、换 CDP 截图绕开 Playwright 的封装。

### 已知、且是**刻意接受**的（别去「修」）

- **s8 的「总结」幻灯片和它的第一条要点，都比自己的讲解早一段**（约 3.1 秒）：
  幻灯片在「往下滚才逐个加载…」那句上场，第一条要点落在过渡句
  「最后总结这条管线的三层思路」上。
  **上一版这份文档把它写成待办，是判断错了** —— 收尾时提前推出总结页
  本来就是常见的转场节奏，一行行读下来并不突兀。
  两个「修法」各有代价，都不划算：
  只把要点挪到 part 31 → 光一个「总结」标题空挂 7.6 秒；
  连 `startPart` 一起挪到 30 → Terminal 要多挂 3.1 秒（一共 13.4 秒不动）。
  **不是错位，别动它。**（它也不属于「整体错一段」—— 三条要点落在
  30/31/32，第三条是准的；校验本来就不该管这种分寸。）
- **39 条字幕里有 3 条是故意切短的**（最短 1.475 秒），为的是守住
  「一条 = 一行」。取舍写在 README「字幕怎么来的」里。

### 已经做完的（别再重复做）

- ~~出一版新片~~ —— 2026-10-05 的 `final.mp4` 已是最新，见上面那条注意。
- ~~全片对拍~~ —— 4869 帧逐帧 MD5 **完全一致**；
  关复用 481s → 开复用 138s，复用率 **80%**（不是 0% 那种假绿）。
  之前只验过前 60 秒和 Terminal 两段，现在全片覆盖了。
- ~~导出外挂字幕~~ —— `pnpm storyboard` 顺带写 `out/render/subtitles.srt`
  和 `.vtt`（39 条，UTF-8 无 BOM）。往返解析与 cues 逐条比对过。
  格式化在 `src/plan/subtitle-export.ts`，没单独开命令。

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
- **磁盘上的产物到底「落后没落后」，自己验，别信文档 —— 包括这份。**
  这份文档曾写着「`final.mp4` 落后三个改动」，实际早已是最新。
  下一个会话照着它排了一趟 12 分钟的活（出片 + 全片对拍合在一起）——
  幸好当时把它们合并了，那趟顺带把「全片对拍」验掉了；
  但「成片落后」这个前提本身是错的，单为出片是不必跑那 12 分钟的。
  验起来只要两条命令：

  ```powershell
  # 时长对不对：和 out/render/storyboard.json 的 durationMs 比
  ffmpeg -hide_banner -i out/render/final.mp4 2>&1 | Select-String Duration
  # 特征场景在不在：第 140 秒应当是 Terminal（s7）
  ffmpeg -y -ss 140 -i out/render/final.mp4 -frames:v 1 out/render/_check.png
  ```

  这条和上一条是**同一类错**：看到的不是最新的，却当成最新的。
  文档里的数字（成片状态、实测耗时、复用率）改完顺手更新，
  否则下一个接手的人（或 AI）会照着过期的话白干。

## 怎么跟这个项目的 AI 说话

给**可验证的完成条件**，别给过程描述：

```
✅ 目标：代码打字场景也能复用，且全片逐帧字节一致
   验收：pnpm frames 全片跑完 < 3 分钟（实测 138s），FRAMES_NO_REUSE=1 对拍 0 差异

❌ 目标：优化一下渲染
```

前半句让它知道去哪，后半句让它知道什么时候算完。
