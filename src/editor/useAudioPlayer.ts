import { useState, useEffect, useRef, type RefObject} from "react"

export function useAudioPlayer(audioRef: RefObject<HTMLAudioElement | null>) {
    const [t, setT] = useState(0)
    const [playing, setPlaying] = useState(false)
    const playingRef = useRef(false)
    const resumeRef = useRef(false)

    // 暂停播放器
    function pause() {
        playingRef.current = false
        audioRef.current?.pause()
        setPlaying(false)
    }

    // 启动
    function play(fromMs?: number) {
        if (playingRef.current) return
        const audio = audioRef.current
        if (!audio) return
        if (fromMs !== undefined) audio.currentTime = fromMs / 1000
        void audio.play()
        playingRef.current = true
        setPlaying(true)
    }

    // 切换状态
    function toggle() {
        if (playingRef.current) pause()
        else play(t)
    }

    // 跳到某个时间点，本来在播就继续播
    function seek(ms: number) {
        const wasPlaying = playingRef.current
        pause()
        setT(ms)
        if (audioRef.current) audioRef.current.currentTime = ms / 1000
        if (wasPlaying) play()
    }

    function scrubStart() {
        resumeRef.current = playingRef.current
    }

    function scrubChange(ms: number) {
        pause()
        setT(ms)
        if (audioRef.current) audioRef.current.currentTime = ms / 1000
    }

    function scrubEnd() {
        if (!resumeRef.current) return
        resumeRef.current = false
        play()
    }

    // 时间更新循环：playing 变 true 时建，变 false 或卸载时拆。
    // 暂停音频也放在清理里 —— 建了什么就拆什么，一个 effect 管到底。
    useEffect(() => {
        if (!playing) return

        const audio = audioRef.current
        if (!audio) return

        let raf = 0
        const tick = () => {
            if (audio.ended) {
                // 不在这里调 pause()：setPlaying(false) 会触发清理，
                // 清理里本来就要 pause 音频。少一条依赖，也就少一个陷阱。
                playingRef.current = false
                setPlaying(false)
                return
            }
            setT(audio.currentTime * 1000)
            raf = requestAnimationFrame(tick)
        }
        raf = requestAnimationFrame(tick)

        return () => {
            cancelAnimationFrame(raf)
            audio.pause()
        }
    }, [playing,audioRef])

    return { t, playing, audioRef, toggle, seek, scrubStart, scrubChange, scrubEnd }
}
