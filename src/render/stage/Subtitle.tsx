import styles from './Subtitle.module.css'

// 字幕层。它和场景一样，是**时间的纯函数**：给一个 t，就能算出该显示哪条字幕。
// 没有定时器、没有过渡动画 —— 所以逐帧渲染出来的每一帧都可复现。
//
// 它挂在 Stage 里、场景之上：字幕不属于任何一个场景，
// 它跟着配音走，跨场景连续。

/**
 * 字幕外观。纯样式差异，不影响任何时间计算 ——
 * 所以预览看到的和出片烧进去的必然一致。
 *
 *   pill     深色胶囊 + 细描边（★ 默认，明暗底都最稳）
 *   box      半透明圆角底板，比 pill 轻
 *   glass    毛玻璃半透明底板（现代感）
 *   bar      贴底通栏渐变黑条（自媒体感）
 *
 * ★ 为什么没有「无底板白字描边」那一版：试过了，在白底幻灯片上
 *   白字彻底糊掉、不可读。这个项目的场景一会儿白底一会儿深底，
 *   所以字幕底板必须是**自带对比度**的，不能指望底下的画面配合。
 */
export type SubtitleVariant = 'pill' | 'box' | 'glass' | 'bar'

type Cue = {i: number; startMs: number; endMs:number; text: string; lines: string[]}

// 淡入：只在前 120ms 里做，够顺眼又不会拖
const FADE_MS = 120

type Props = {
    t: number
    cues: Cue[]
    variant?: SubtitleVariant
}

export default function Subtitle({t, cues, variant = 'pill'} : Props){
    const active = cues.find((c) => t >= c.startMs && t < c.endMs ) ?? null

    const opacity = active ? Math.max(0, Math.min((t - active.startMs) / FADE_MS, 1)) : 0

    return (
        <div className={`${styles.layer} ${styles[`v-${variant}`]}`}>
            {active && (
                <div className={styles.cue} style={{opacity}}>
                    {active.lines.map((line, i) => (
                        <div key={i} className={styles.line}>{line}</div>
                    ))}
                </div>
            )}
        </div>
    )
}