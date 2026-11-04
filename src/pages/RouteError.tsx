import { useRouteError, isRouteErrorResponse, Link } from "react-router"
import styles from "./RouteError.module.css"

export default function RouteError() {
    const error = useRouteError()

    const message = isRouteErrorResponse(error)
        ? `${error.status} ${error.statusText}`
        : error instanceof Error ? error.message : String(error)

    return (
        <div className={styles.page}>
            <h1 className={styles.title}>出错了</h1>
            <pre className={styles.message}>{message}</pre>
            <Link to={"/"} className={styles.link}>回首页</Link>
        </div>
    )
}
