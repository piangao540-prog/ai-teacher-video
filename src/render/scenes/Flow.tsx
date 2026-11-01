import { Fragment } from "react"
import { flowStateAt } from "./sceneState"
import styles from './Flow.module.css'


type Props = {
    t: number
    title?: string
    titleAtMs: number
    steps: Array<{text:string; atMs: number}>
}

export default function Flow(props: Props){
    const {title, steps} = props
    const state = flowStateAt(props.t, props)

    return (
        <div className={styles.flow}>
            {title && (
                <h1 className={styles.title} style={{opacity: state.titleOpacity}}>
                    {title}
                </h1>
            )}
            <div className={styles.row}>
                {steps.map((step,i) => (
                    <Fragment key={i}>
                        {i > 0 && (
                            <span className={styles.arrow} style={{ opacity: state.arrowOpacity[i - 1] }}>
                                →
                            </span>
                        )}
                        <div className={styles.step} style={{ opacity: state.stepOpacity[i] }}>
                            <span className={styles.num}>{i + 1}</span>
                            <span>{step.text}</span>
                        </div>
                    </Fragment>
                ))}
            </div>
        </div>
    )
}