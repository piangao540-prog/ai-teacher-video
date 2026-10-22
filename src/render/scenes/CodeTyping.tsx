import { codeStateAt, type CodeLine } from "./sceneState"
import styles from './CodeTyping.module.css'

// 逐字打字 + 光标闪烁 + 当前行高亮。
// 这三个视觉状态全部由 sceneState.ts 的 codeStateAt 从 t 算出来 ——
// 渲染器判断「这一帧能不能复用上一帧」时调的是同一个函数，
// 所以判据不可能和实际画面不一致。


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
                            {/* 号是 line.step，**不是 i + 1**：
                                step 由 build-storyboard 用 narratedOrdinals 算好写进
                                storyboard.json，和旁白念的「第 N 行」是同一个数。
                                没讲解的行 step 是 null，这一格留空（它仍然要读，只是不占号）。
                                step 缺失（storyboard 还是旧格式）时也留空 —— 看得见，
                                好过回退成 i + 1 那个**已知是错的**答案。 */}
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