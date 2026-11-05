import { NavLink, Outlet } from 'react-router'
import { useStudioStore } from './store/studio'
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
    const collapsed = useStudioStore((s) => s.collapsed)
    const toggle = useStudioStore((s) => s.toggleCollapsed)

    return (
        <div className={styles.shell}>
            <nav className={`${styles.sidebar} ${collapsed ? styles.collapsed : ''}`}>
                <div className={styles.brand}>{collapsed ? 'AI' : 'AI 老师'}</div>
                <NavLink to="/" end className={linkClass} title='播放器'>
                    <span className={styles.icon}>▶</span>
                    <span className={styles.label}>播放器</span>
                </NavLink>
                <NavLink to="/editor" className={linkClass} title="字幕">
                    <span className={styles.icon}>✎</span>
                    <span className={styles.label}>字幕</span>
                </NavLink>
                <NavLink to="/studio" className={linkClass} title="剧本">
                    <span className={styles.icon}>▤</span>
                    <span className={styles.label}>剧本</span>
                </NavLink>

                <button
                    className={styles.toggle}
                    onClick={toggle}
                    title={collapsed ? '展开' : '收起'}
                >
                    {collapsed ? '»' : '«'}
                </button>
            </nav>
            <main className={styles.content}>
                <Outlet />
            </main>
        </div>
    )
}
