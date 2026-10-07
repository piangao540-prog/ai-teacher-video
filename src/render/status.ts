// `pnpm status` —— 把 out/render/ 那五环是不是同一版，打成一屏人话。
//
// 它就是**给人看的**，所以：
//
// ★ 永远退出 0。别在这里加「对不上就非 0」的那种聪明 ——
//   跑完 A+（配音 + 时间轴）本来就还没出片，「画面 → 成片」这条边
//   必然对不上，于是这个命令**每次都非 0**，退出码就成了纯噪音，
//   还会顺手把 `pnpm status && 别的` 这种写法变成永远不执行。
//   要拦，去拦该拦的地方：encode 只卡「时间轴 → 画面」（见 compose/encode.ts）。
//
// 判据、为什么用指纹不用 mtime、每条边谁卡谁 —— 全在 artifacts.ts 的头注释里。
// 这个文件只负责把它印出来。

import { formatReport, inspect } from './artifacts'

const report = await inspect()

for (const line of formatReport(report)) console.log(line)
