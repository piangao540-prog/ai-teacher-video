import { codeStateAt, type CodeLine } from "./sceneState"
import styles from './CodeTyping.module.css'


type Props = {
    t: number
    fileName: string
    lines: CodeLine[]
}

export default function CodeTyping({ t, fileName, lines }: Props) {
    const state = codeStateAt(t, lines)

    return (
        <div className={styles.scene}>
            <div className={styles.window}>
                <div className={styles.titlebar}>
                    <span className={`${styles.dot} ${styles.red}`}></span>
                    <span className={`${styles.dot} ${styles.yellow}`}></span>
                    <span className={`${styles.dot} ${styles.green}`}></span>
                    <span className={styles.filename}>{fileName}</span>
                </div>
                <div className={styles.body}>
                    {lines.map((line, i) => (
                        <div key={i} className={`${styles.line} ${state.activeLine === i ? styles.active : ''}`}>
                            <span className={styles.gutter}>{line.step ?? ''}</span>
                            <span className={styles.text}>{line.code.slice(0, state.typed[i])}</span>
                            {state.activeLine === i && state.caret && (
                                <span className={styles.caret}>▌</span>
                            )}
                        </div>
                    ))}
                </div>
            </div>
        </div>
    )
}