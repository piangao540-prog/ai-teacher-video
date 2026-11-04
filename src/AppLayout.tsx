import { NavLink, Outlet } from 'react-router'
import styles from './AppLayout.module.css'

/** NavLink 激活时换一套样式 */
const linkClass = ({ isActive }: { isActive: boolean }) =>
    isActive ? `${styles.link} ${styles.active}` : styles.link

/**
 * 布局路由：侧边栏常驻，右边的内容区由 URL 决定。
 *
 * <Outlet /> 就是「子路由渲染到哪儿」的答案 —— 它占的位置，
 * 就是下面 children 里那些页面出现的地方。
 */
export default function AppLayout() {
    return (
        <div className={styles.shell}>
            <nav className={styles.sidebar}>
                <div className={styles.brand}>AI 老师</div>
                <NavLink to="/" end className={linkClass}>播放器</NavLink>
                <NavLink to="/editor" className={linkClass}>字幕</NavLink>
                <NavLink to="/studio" className={linkClass}>剧本</NavLink>
            </nav>
            <main className={styles.content}>
                <Outlet />
            </main>
        </div>
    )
}
