import styles from './Terminal.module.css'
import { terminalStateAt, type TermLine } from './sceneState'

// 终端演示：命令逐字打出来，输出整行出现。
//
// 和 CodeTyping 的分工：CodeTyping 讲「代码长什么样」，
// Terminal 讲「把它跑起来会发生什么」。
//
// 所有视觉状态由 sceneState.ts 的 terminalStateAt 从 t 算出来 ——
// 渲染器和复用判据调的是同一个函数，所以判据不可能和实际画面不一致。

type Props = {
    t: number
    title?: string
    prompt?: string
    lines: TermLine[]
}

export default function Terminal({ t, title, prompt, lines }: Props) {
    const state = terminalStateAt(t, lines)

    return (
        <div className={styles.scene}>
            <div className={styles.window}>
                <div className={styles.titlebar}>
                    <span className={`${styles.dot} ${styles.red}`}></span>
                    <span className={`${styles.dot} ${styles.yellow}`}></span>
                    <span className={`${styles.dot} ${styles.green}`}></span>
                    <span className={styles.title}>{title ?? '终端'}</span>
                </div>
                <div className={styles.body}>
                    {/* 所有行一直占着位置（只是内容还没打出来）——
                        这样后面的行不会往上跳，视频里排版是稳的 */}
                    {lines.map((line, i) => (
                        <div key={i} className={`${styles.line} ${styles[line.kind]}`}>
                            {line.kind === 'command' && (
                                <span className={styles.prompt}>{prompt ?? '$'}</span>
                            )}
                            <span className={styles.text}>{line.text.slice(0, state.typed[i])}</span>
                            {i === state.typingLine && state.caret && (
                                <span className={styles.caret}>█</span>
                            )}
                        </div>
                    ))}
                </div>
            </div>
        </div>
    )
}