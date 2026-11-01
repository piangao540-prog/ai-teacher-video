import { useState, useEffect, useRef } from "react"

export function useAudioPlayer() {
    const [t, setT] = useState(0)
    const [playing, setPlaying] = useState(false)
    const audioRef = useRef<HTMLAudioElement>(null)
    const playingRef = useRef(false)
    const rafRef = useRef(0)
    const resumeRef = useRef(false)

    // 暂停播放器
    function pause() {
        playingRef.current = false
        audioRef.current?.pause()
        cancelAnimationFrame(rafRef.current)
        setPlaying(false)
    }

    // 负责启动 RAF 时间更新循环
    function startTicking() {
        const tick = () => {
            const a = audioRef.current
            if (!a || !playingRef.current) return
            if (a.ended) {
                pause()
                return
            }
            setT(a.currentTime * 1000)
            rafRef.current = requestAnimationFrame(tick)
        }
        rafRef.current = requestAnimationFrame(tick)
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
        startTicking()
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

    useEffect(() => {
        return () => {
            cancelAnimationFrame(rafRef.current)
            audioRef.current?.pause()
        }
    }, [])

    return { t, playing, audioRef, toggle, seek, scrubStart, scrubChange, scrubEnd }
}