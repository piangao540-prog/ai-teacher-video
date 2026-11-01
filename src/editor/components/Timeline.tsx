import type { Scene } from '../../type/storyboard'
import styles from './Timeline.module.css'

const COLORS: Record<string, string> = {
    SlideBullets: '#1f6feb',
    CodeTyping: '#238636',
    Terminal: '#8957e5',
}

type Props = {
    scenes: Scene[]
    durationMs: number
    activeId?:string
}

export default function Timeline({ scenes, durationMs, activeId}: Props) {
    return (
        <div className={styles.track}>
            {scenes.map((scene) => {
                const left = (scene.startMs / durationMs) * 100
                const width = ((scene.endMs - scene.startMs) / durationMs) * 100

                return (
                    <div
                        key={scene.id}
                        className={`${styles.segment} ${scene.id === activeId ? styles.active : ''}`}
                        title={`${scene.id} · ${scene.template}`}
                        style={{
                            left: `${left}%`,
                            width: `${width}%`,
                            background: COLORS[scene.template] ?? '#30363d',
                        }}
                    >
                        {scene.id}
                    </div>
                )
            })}
        </div>
    )
}
