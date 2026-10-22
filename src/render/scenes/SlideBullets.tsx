import { slideStateAt } from './sceneState'
import styles from './SlideBullets.module.css'

type Props = {
  t: number
  title: string
  titleAtMs: number
  bullets: Array<{ text: string; atMs: number }>
}

// 本帧全部透明度，从 t 算出来。
// 「减掉开始时间、除以耗时、夹到 0~1」这套算法住在 sceneState.ts 里，
// 渲染器和复用判据共用同一份 —— 不碰 setTimeout、不碰 CSS transition，
// 所以画面在任意时刻都可复现。
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



