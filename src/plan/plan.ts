// `pnpm plan` 的**外壳**：解析参数、读 .env、打印、落盘、定 exit code。
//
// 生成本身（调模型 + 校验 + 重试）在 generate.ts 里，打印格式在 review.ts 里。
// 剥出去是为了 `pnpm dev` 的页面能复用同一条链路 —— 页面不能 process.exit、
// 不能把日志直接推进终端。**这里只管命令行这一侧。**
//
// ★ 剥的时候守的规矩：**外部行为一个字都不许变**。下面每一行的措辞、
//   顺序、走 stdout 还是 stderr，都和剥之前逐字相同。

import { generate, isConfigured, loadLlmConfig, MISSING_CONFIG_HELP, persistEpisode } from './generate'
import { describeResult, printEpisodeReview } from './review'
import { describeSource, persistTopic, resolveSource, type Source } from './source'

// 先把输入解析清楚（纯读盘，不碰网络）—— 这样 --dry 才能零成本看一眼判别结果。
const args = process.argv.slice(2).filter((a) => !a.startsWith('--'))
const DRY = process.argv.includes('--dry')
const source: Source = await resolveSource(args)

if (DRY) {
  console.log(describeSource(source))
  console.log('（--dry：只判别输入，不发请求、不写任何文件）')
  process.exit(0)
}

const cfg = loadLlmConfig()

if (!isConfigured(cfg)) {
  for (const line of MISSING_CONFIG_HELP) console.error(line)
  process.exit(1)
}

console.log('模型:   ' + cfg.model)
console.log('接口:   ' + cfg.baseUrl)
console.log(describeSource(source))

if (source.kind === 'topic') {
  // 主题落盘：输入永远躺在同一个位置，下次不带参数跑也能复现这次。
  // 备份只在「这次要盖掉的是一篇文章」时做 —— 理由见 source.ts 里 persistTopic 的注释。
  const backedUp = await persistTopic(source.text)
  console.log('已写入 corpus/source.md' + (backedUp ? '（原来那篇文章备份在 corpus/source.backup.md）' : ''))
}
console.log('')

// 日志原样转发：onLog 收到的就是原来 console.log / console.warn 的那些原文。
const outcome = await generate(source, cfg, (line, level) => {
  if (level === 'warn') console.warn(line)
  else console.log(line)
})

if (!outcome.ok) {
  console.error('')
  console.error(outcome.attempts + ' 次都没通过校验。没有覆盖 corpus/episode.json。')
  console.error('最后一次的问题：')
  for (const p of outcome.problems) console.error('  - ' + p)
  process.exit(1)
}

await persistEpisode(outcome.episode)

for (const line of describeResult(outcome.episode, outcome.attempt)) console.log(line)

// 花钱之前先让人过一眼 —— 校验查不出编造的 API，见 review.ts 的头注释
printEpisodeReview(outcome.episode)

console.log('下一步：pnpm say  →  pnpm storyboard  →  pnpm video')
