import { slideStateAt } from './sceneState'
import styles from './SlideBullets.module.css'

type Props = {
  t: number
  title: string
  titleAtMs: number
  bullets: Array<{ text: string; atMs: number }>
}

export default function SlideBullets(props :Props){
    const state = slideStateAt(props.t, props)
    return (
        <div className={styles.slide}>
            <h1 className={styles.title} style={{ opacity: state.titleOpacity }}>{ props.title }</h1>
            <ul className={styles.list}>
                {props.bullets.map((b,i) => (
                    <li key={i} className={styles.item} style={{opacity: state.bulletOpacity[i]}}>{b.text}</li>
                ))}
            </ul>
        </div >
    )
}



