// 「输入一句话 → 生成剧本 → 配音 → 切时间轴」的面板，挂在播放器上方。
//
// 它只做显示和转发：请求交给 POST /api/plan（或 /api/render），
// 进度和结果从 SSE 流里读回来。密钥、写盘、调模型、起 TTS 子进程全在 Node 侧
// —— 浏览器这一侧没有、也不该有任何秘密。
//
// 格式（讲稿 + 逐行对照）是**服务端拼好的整块文本**，这里原样塞进 <pre>。
// 这是刻意的：先跑通，别一上来就做结构化渲染 —— 让 CLI 和页面印的是同一份东西，
// 才不会出现「命令行看着对、页面看着不对」。

import { useState, useRef, useEffect } from 'react'
import styles from './Plan.module.css'


type ServerMsg =
    | { type: 'log'; line: string; level?: 'info' | 'warn' }
    | { type: 'done'; attempt: number; summary: string[]; review: string; stale: string[] }
    | { type: 'fail'; problems: string[] }

type Done = Extract<ServerMsg, { type: 'done' }>

export default function Plan() {
    const [topic, setTopic] = useState('')
    const [busy, setBusy] = useState(false)
    const [logs, setLogs] = useState<string[]>([])
    const [done, setDone] = useState<Done | null>(null)
    const [failed, setFailed] = useState<string[]>([])

    function apply(msg: ServerMsg): void {
        if (msg.type === 'log') {
            setLogs((prev) => [...prev, msg.line])
        } else if (msg.type === 'done') {
            setDone(msg)
        } else {
            setFailed(msg.problems)
        }
    }

    const logBox = useRef<HTMLPreElement>(null)

    // 日志一直往下走，停在顶部会让人以为卡住了。
    // （useEffect 本身就在 DOM 更新完之后跑，所以 Vue 版的 await nextTick() 不需要。）
    useEffect(() => {
        const el = logBox.current
        if (el) el.scrollTop = el.scrollHeight
    }, [logs.length])

    /** POST 一个端点，把 SSE 一路读到底。
     *
     *  POST 不能用 EventSource，所以自己按 SSE 的规矩切：一条消息以空行结束，
     *  数据在 `data: ` 后面（一行一条 JSON）。 */
    async function streamFrom(path: string, body: unknown): Promise<void> {
        if (busy) return
        setBusy(true)
        setLogs([])
        setDone(null)
        setFailed([])

        try {
            const res = await fetch(path, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify(body),
            })

            if (res.status === 409) {
                setFailed(['上一次还在跑，等它跑完再来。'])
                return
            }
            if (!res.ok || !res.body) {
                setFailed(['端点出错：HTTP ' + res.status])
                return
            }

            const reader = res.body.getReader()
            const decoder = new TextDecoder()
            let buf = ''

            for (; ;) {
                const { value, done: eof } = await reader.read()
                if (eof) break
                buf += decoder.decode(value, { stream: true })

                let cut = buf.indexOf('\n\n')
                while (cut >= 0) {
                    const block = buf.slice(0, cut)
                    buf = buf.slice(cut + 2)
                    for (const line of block.split('\n')) {
                        if (line.startsWith('data: ')) apply(JSON.parse(line.slice(6)) as ServerMsg)
                    }
                    cut = buf.indexOf('\n\n')
                }
            }
        } catch (e) {
            setFailed(['连不上端点：' + String(e)])
        } finally {
            setBusy(false)
        }
    }

    async function run(): Promise<void> {
        const text = topic.trim()
        if (!text) return
        await streamFrom('/api/plan', { topic: text })
    }

    /** 剧本没动，只重跑配音和时间轴（配音失败时用这个，不用把模型再烧一遍）。 */
    async function rerender(): Promise<void> {
        await streamFrom('/api/render', {})
    }

    // Vue 版是因为模板里拿不到 window 才包的这一层；React 里直接内联也行，
    // 留着只是叫得出名字、读起来整齐。
    function reload(): void {
        window.location.reload()
    }

    return (
        <div className={styles.plan}>
            <form className={styles.ask} onSubmit={(e) => {e.preventDefault(); run()}}>
            <input
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                type="text"
                placeholder="一句话主题，例如：Vue3 响应式原理"
                disabled={busy}
            />
            <button type="submit" disabled={busy || !topic.trim()}>
                { busy ? '跑着呢…' : '生成' }
            </button>
            <button type="button" className={styles.ghost} disabled={busy} title="剧本不动，只重跑配音和时间轴" onClick={rerender} >
                只重配音
            </button >
            </form >

            <p className={styles.note}>
                一句话 → 剧本 → 配音 → 时间轴，一步到位；好了就能在下面播放。
                生成几十秒 + 配音半分钟，下面会实时打日志。<b>出片（mp4）不在这里</b>，还在终端里跑
                <code>pnpm video</code>。
            </p>

            {logs.length > 0 && (
                <pre ref={logBox} className={styles.logs}>
                    {logs.join('\n')}
                </pre>
            )}

            {failed.length > 0 && (
                <div className={`${styles.box} ${styles.fail}`}>
                    <div className={styles.head}>✗ 没跑完</div>
                    <pre>{failed.join('\n')}</pre>
                </div>
            )}

            {done && (
                <div className={`${styles.box} ${styles.ok}`}>
                    {done.summary.length > 0 && (
                        <pre className={styles.summary}>{done.summary.join('\n')}</pre>
                    )}

                    {/* stale 是**服务端算好的几行人话**（判据在 render/artifacts.ts），
                        不是这里的布尔值。分成「是旧的」和「不知道是哪一版」两种说法 ——
                        加指纹之前生成的产物属于后者，说成「旧的」是在冤枉它。 */}
                    {done.stale.length > 0 ? (
                        <p className={styles.stale}>
                            ⚠ 剧本换了，但<b>下面播的还不是这一版</b>。<br />
                            {done.stale.map((line, i) => (
                                <span key={i} className={styles.edge}>{line}</span>
                            ))}
                        </p>
                    ) : (
                        <p className={styles.ready}>
                            ✓ 配音和时间轴都刷新了。<b>刷新页面</b>就能在下面听到、看到这一版。
                            <button type="button" className={styles.ghost} onClick={reload}>刷新页面</button>
                        </p>
                    )}

                    {done.review && (
                        <>
                            <p className={styles.remind}>
                                校验只管结构（段号、长度、画面装不装得下）。<b>「这句话说的是不是这一行」机器判不了</b>
                                —— 下面这份要逐行读，带 ⚠ 的先看。
                            </p>
                            <details open>
                                <summary>讲稿 + 逐行对照</summary>
                                <pre className={styles.review}>{done.review}</pre>
                            </details>
                        </>
                    )}
                </div>
            )}
        </div>
    ) 
}

