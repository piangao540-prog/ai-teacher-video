import { lazy, Suspense } from 'react'
import Stage from '../render/stage/Stage'

// 生成面板只有首页要，lazy 让它单独成一个 chunk —— 出片路径用不到它。
const Plan = lazy(() => import('../plan-ui/Plan'))

/** 首页：生成面板 + 播放器，上下叠着。 */
export default function Home() {
    return (
        <>
            <Suspense fallback={null}>
                <Plan />
            </Suspense>
            <Stage />
        </>
    )
}
