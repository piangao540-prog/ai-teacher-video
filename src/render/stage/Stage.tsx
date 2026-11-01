import { useEffect, useRef, useState, type ComponentType } from "react"
import styles from './Stage.module.css'
import CodeTyping from "../scenes/CodeTyping"
import SlideBullets from "../scenes/SlideBullets"
import Terminal from "../scenes/Terminal"
import Flow from "../scenes/Flow"
import Subtitle, { type SubtitleVariant } from "./Subtitle"




const params = new URLSearchParams(location.search)
const isRender = params.has('render')

// 字幕外观。只影响样式，不参与任何时间计算。
// 出片走 ?subs=xxx（shot.ts 拼的），预览可用 &subs=xxx 或工具栏那个下拉。
const VARIANTS: SubtitleVariant[] = ['pill', 'box', 'glass', 'bar']
const asVariant = (v:string | null): SubtitleVariant | null => 
    VARIANTS.includes(v as SubtitleVariant) ? (v as SubtitleVariant) : null

/**
 * 进度条步长（毫秒）。
 *
 * ★ 它不只是 step，还定义了「多接近片尾才算播完」：
 *   step 会把值吸附到 16 的整数倍，拖到最右端落在的是
 *   floor(duration/16)*16，比 duration 小。拿 t >= duration 判播完，
 *   拖到片尾再按播放就只播十几毫秒，看着像按钮坏了。
 *   留一个 step 的余量刚好盖住这个吸附差。
 */
const SCRUB_STEP_MS = 16

const TEMPLATES: Record<string, ComponentType<any>> = {
    SlideBullets, CodeTyping, Terminal, Flow,
}

// 场景
type Scene = {
    id: string
    template: string
    startMs: number
    endMs: number
    props: Record<string, unknown>
}

// 故事板
type Storyboard = {
    durationMs: number
    audioFile: string
    scenes: Scene[]
    cues?: Cue[]
}

// 字幕
type Cue = { i: number; startMs: number; endMs: number; text: string; lines: string[] }

// 
type StaleEdge = { edge: string; label: string; verdict: 'ok' | 'mismatch' | 'unknown'; detail: string }


export default function Stage(){
    const [storyboard, setStoryboard] = useState<Storyboard | null>(null)
    const [t, setT] = useState(0)
    // 按钮上显示 ⏸ 还是 ▶，就看这一个。它是 UI 状态，不进画面 ——
    // 出片时整条工具栏都不在 DOM 里（!isRender）。
    const [playing, setPlaying] = useState(false)
    const [showSubs, setShowSubs] = useState(true)
    const [staleEdges, setStaleEdges] = useState<StaleEdge[]>([])
    const [subtitleVariant, setSubtitleVariant] = useState<SubtitleVariant>(asVariant(params.get('subs')) ?? 'pill')

    const audioEl = useRef<HTMLAudioElement>(null)

    // 挂载-拉取分镜配置文件
    useEffect(() => {
        void (async () => {
            const res = await fetch('./storyboard.json')
            if (!res.ok) throw new Error('取不到 storyboard.json：' + res.status + '（先跑 pnpm storyboard）')
            setStoryboard((await res.json()) as Storyboard)
        })()
    }, [])

    // 「这一版是不是当前剧本的」那一小块提示。单独一个 effect，不并进上面那个：
    // 查不到就什么都不说，绝不能因为「状态没查到」把 storyboard 的加载也带崩。
    // 出片模式不查：那条路径上 .controls 根本不在 DOM 里，查了也白查。
    useEffect(() => {
        if(isRender) return
        void(async () =>{
            try{
                const res = await fetch('/api/status')
                if(!res.ok) return
                setStaleEdges(((await res.json()) as {edges?: StaleEdge[]}).edges ?? [])
            }catch{
                // 查不到就闭嘴。把「查不到」显示成「有问题」比不显示更坏。
            }
        })()
    },[])

    const duration = storyboard?.durationMs ?? 0

    // 字幕是独立的一层：跟着配音走，不属于任何场景，所以跨场景连续。
    const cues = storyboard?.cues ?? []

    // 出片时字幕必须开（不然白做）。预览也默认开着 ——
    // 不然打开 dev 看不见字幕，会以为没生效；想对比观感再关掉。
    const subtitleOn = showSubs && cues.length > 0

    // 音频也在 out/render/audio 里，由服务器直接喂过来
    const audioSrc = storyboard ? './audio/' + storyboard.audioFile: ''

    /** 某一时刻正在演的是哪个场景（取最后一个已经开始的） */
    function sceneAt(ms:number): Scene | null {
        const list = storyboard?.scenes ?? []
        let found: Scene | null = null 
        for(const s of list) if (ms >= s.startMs) found = s
        return found ?? list[0] ?? null
    }

    const current = sceneAt(t)
    const CurrentComponent = current ? (TEMPLATES[current.template] ?? null): null
    const localT = current ? t - current.startMs : 0

    /** 标签上那句话。「不知道是哪一版」和「是旧的」必须分开说 ——
     *  加指纹之前生成的产物属于前者，说成后者是在冤枉它。 */
    const staleTag = () => {
        const e = staleEdges
        if (!e.length) return ''
        const where = e.map((x) => x.label).join('、')
        return e.every((x) => x.verdict === 'unknown')
            ? '⚠ ' + where + '：不知道是哪一版（自检之前生成的）'
            : '⚠ ' + where + ' 没跟上剧本'
    }

    /** 毫秒 → 分:秒.毫秒。定长，拖进度条时数字不会左右抖 */
    function timecode(ms: number): string {
        const v = Math.max(0, Math.round(ms))
        const pad = (n: number) => String(n).padStart(2, '0')
        return `${pad(Math.floor(v / 60000))}:${pad(Math.floor(v / 1000) % 60)}.${String(v % 1000).padStart(3, '0')}`
    }

    const playingRef = useRef(false)
    const raf = useRef(0)
    const scrubbing = useRef(false)
    const resumeAfterScrub = useRef(false)

    function setPlayingBoth(v: boolean){
        playingRef.current = v
        setPlaying(v)
    }

    function stopTicking() {
        if(raf.current) cancelAnimationFrame(raf.current)
        raf.current = 0
    }

    // 预览时以「音频」为时钟：t 跟着 audio.currentTime 走，
    // 听到的和看到的自然在同一条时间线上。
    function play() {
        // ★ 只停上一轮的时钟，**不** pause 音频：
        //   调 pause() 等于「停音频、seek、再播」三次状态切换，
        //   中间浏览器不一定来得及把 seek 应用上去。
        stopTicking()
        const from = t >= duration - SCRUB_STEP_MS ? 0 : t
        setPlayingBoth(true)
        const audio = audioEl.current

        if(audio){
            audio.currentTime = from / 1000
            // 播不起来（自动播放被拦、音频 404）就把按钮弹回 ▶，
            // 否则按钮一直显示 ⏸、画面纹丝不动 —— 按钮在撒谎。
            void audio.play().catch(() => setPlayingBoth(false))

            const tick = () => {
                const next = Math.min(audio.currentTime * 1000, duration)
                setT(next)
                // 用自己这份 playing 判「还该不该往下走」，不用 audio.paused：
                // play() 是异步的，刚调完那一瞬 audio.paused 还是 true，
                // 拿它当判据会让按钮在播起来的第一帧就弹回去。
                if(next >= duration || !playingRef.current) {
                    setPlayingBoth(false)
                    return
                }
                raf.current = requestAnimationFrame(tick)
            }
            raf.current = requestAnimationFrame(tick)
            return 
        }

        // 出片模式没有 audio 元素，退回真实时间
        const startedAt = performance.now()
        const tick = (now: number) => {
            const next = Math.min(from + (now - startedAt), duration)
            setT(next)
            if (next < duration && playingRef.current) {
                raf.current = requestAnimationFrame(tick)
            } else {
                setPlayingBoth(false)
            }
        }
        raf.current = requestAnimationFrame(tick)
    }

    // 暂停 —— 不是「停止」：t 不归零，从哪儿停的从哪儿接着播。
    function pause(){
        stopTicking()
        audioEl.current?.pause()
        setPlayingBoth(false)
    }

    // 播放/暂停是同一个开关：读 ref 而不是 state，免得纠结这轮闭包里是哪个快照
    function toggle() {
        if (playingRef.current) pause()
        else play()
    }

    // 进度条拖动过程中。
    // ★「本来在播吗」只在**第一次** input 时记：拖一次会连发几十个 input，
    //   而每一个都会走到下面的 pause() —— 第二次之后 playing 已经是 false，
    //   再记就只会记成「本来没在播」，松手也就不接着播了。
    function onScrub(e: React.ChangeEvent<HTMLInputElement>){
        const value = Number(e.target.value)
        if(!scrubbing.current){
            scrubbing.current = true
            resumeAfterScrub.current = playingRef.current
        }
        pause()
        setT(value)
        if(audioEl.current) audioEl.current.currentTime = value/1000
    }

    /** 松手（或键盘松开方向键）。
     *  拖动本身不该是个「暂停」操作 —— 本来在播就接着播。 */
    function onScrubEnd() {
        scrubbing.current = false
        if (!resumeAfterScrub.current) return
        resumeAfterScrub.current = false
        play()
    }

    useEffect(() => () => pause(), [])


    // storyboard 是异步取的，__seek 必须等它到齐再动，
    // 否则截图脚本会在画面还是空白的时候就把图截走。
    // Promise 用 ref 懒初始化，保证跨渲染是同一个闸门。
    const resolveReady = useRef<(() => void) | null>(null)
    const readyRef = useRef<Promise<void> | null>(null)

    if(readyRef.current === null){
        readyRef.current = new Promise<void>((resolve) => {
            resolveReady.current = resolve
        })
    }

    useEffect(() => {
        if(storyboard) resolveReady.current?.()
    },[storyboard])

    /** 给出片脚本用：跳到第 ms 毫秒，并等到画面真的画出来。
     *  双 rAF 替代了 Vue 的 nextTick —— setT 之后 React 会在微任务里提交 DOM，
     *  两帧足够覆盖。 */
    async function seek(ms:number) {
        pause()
        await readyRef.current
        setT(ms)
        await new Promise<void>((resolve) => {
            requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
        })
    }

    // 把入口挂到 window 上：出片脚本在页面外面，只够得着 window。
    // __static 恒为 false = 不做静态帧复用（简化实现），每帧都老实截。
    useEffect(() => {
        const w = window as unknown as {
            __seek: (ms: number) => Promise<void>
            __static: (cur: number, prev:number) => boolean
        }
        w.__seek = seek
        w.__static = () => false
    },[])

    // staleTag 是个函数，JSX 里要调用它；先算一次，渲染里两处都能用
    const staleText = staleTag()

    return (
        <div className={`${styles.page} ${isRender ? styles.render : ''}`}>
            <div className={styles.viewport}>
                <div className={styles.frame}>
                    {/* 场景：组件 + 场景内相对时间 + 剧本里的 props */}
                    {current && CurrentComponent && (
                        <CurrentComponent t={localT} {...current.props} />
                    )}
                    {/* 字幕盖在场景上面。注意它吃的是全片时间 t，不是 localT */}
                    {subtitleOn && (
                        <Subtitle t={t} cues={cues} variant={subtitleVariant} />
                    )}
                </div>
            </div>

            {/* 工具栏只在预览时存在：出片要的是纯画面，没有按钮没有文字 */}
            {!isRender && (
                <div className={styles.controls}>
                    <div className={styles.bar}>
                        <button
                            className={styles.play}
                            title={playing ? '暂停' : '播放'}
                            onClick={toggle}
                        >
                            {playing ? '⏸' : '▶'}
                        </button>

                        {/* onChange = 拖动中（React 把它定义成原生 input 事件），
                            松手要靠 onPointerUp —— 原生 change 语义在 React 里不叫这个名字 */}
                        <input
                            className={styles.scrub}
                            type="range"
                            min={0}
                            max={duration}
                            step={SCRUB_STEP_MS}
                            value={t}
                            onChange={onScrub}
                            onPointerUp={onScrubEnd}
                            onKeyUp={onScrubEnd}
                        />

                        <span className={styles.t}>{timecode(t)}</span>
                        <span className={styles.sep} />

                        <label className={styles.toggle}>
                            <input
                                type="checkbox"
                                checked={showSubs}
                                onChange={(e) => setShowSubs(e.target.checked)}
                            />
                            <span className={styles.box} />
                            字幕
                        </label>

                        <select
                            className={styles.variant}
                            value={subtitleVariant}
                            onChange={(e) => setSubtitleVariant(e.target.value as SubtitleVariant)}
                        >
                            {VARIANTS.map((v) => (
                                <option key={v} value={v}>{v}</option>
                            ))}
                        </select>
                    </div>

                    <p className={styles.scene}>
                        {current?.id} · {current?.template}
                    </p>

                    {/* 平时不出现：只有产物没跟上剧本时才冒出来 */}
                    {staleText && (
                        <p className={styles.stale} title={staleEdges.map((e) => e.detail).join('\n')}>
                            {staleText}
                        </p>
                    )}
                </div>
            )}

            {/* 只在预览时挂 audio。出片模式不挂：声音由 ffmpeg 混 */}
            {!isRender && audioSrc && (
                <audio ref={audioEl} src={audioSrc} preload="auto" />
            )}
        </div>
    )
}

