import styles from './Terminal.module.css'
import { terminalStateAt, type TermLine } from './sceneState'

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