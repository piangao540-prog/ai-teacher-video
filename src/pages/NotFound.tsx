import { Link } from "react-router"
import styles from "./NotFound.module.css"

export default function NotFound(){
    return(
        <div className={styles.page}>
            <h1 className={styles.code}>404</h1>
            <p className={styles.text}>这个页面不存在</p>
            <Link to={"/"} className={styles.link}>回首页</Link>
        </div>
    )
}
