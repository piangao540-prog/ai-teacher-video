import styles from './Subtitle.module.css'

export type SubtitleVariant = 'pill' | 'box' | 'glass' | 'bar'

type Cue = {i: number; startMs: number; endMs:number; text: string; lines: string[]}

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