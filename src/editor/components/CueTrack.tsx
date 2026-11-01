import type { Cue } from '../../type/storyboard'
import styles from './CueTrack.module.css'

type Props = {
    cues: Cue[]
    durationMs: number
}

export default function CueTrack({ cues, durationMs }: Props) {
    return (
        <div className={styles.track}>
            {cues.map((cue) => {
                const left = (cue.startMs / durationMs) * 100
                const width = ((cue.endMs - cue.startMs) / durationMs) * 100

                return (
                    <div
                    key={cue.i}
                    className={styles.cue}
                    title={cue.text}
                    style={{left: `${left}%`,width: `${width}%`}}
                    />    
                )
            })}
        </div>
    )
}