import { useState, useEffect,useRef, type MouseEvent } from "react"
import type { Storyboard } from "../type/storyboard"
import { useStudioStore } from "../store/studio"
import { useAudioPlayer } from './useAudioPlayer'
import styles from './Editor.module.css'
import Timeline from './components/Timeline'
import CueTrack from './components/CueTrack'
import CueList from "./components/CueList"
import { wrapCue } from "../plan/subtitle"
import { downloadJson } from "./download"


export default function Editor(){
    const [storyboard, setStoryboard] = useState<Storyboard | null>(null)
    const [error, setError] =  useState<string | null>(null)
    const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
    const audioRef = useRef<HTMLAudioElement>(null)
    const player = useAudioPlayer(audioRef)

    const focusMs = useStudioStore((s) => s.focusMs)
    const setFocus = useStudioStore((s) => s.setFocus)

    useEffect(() => {
        if (focusMs === null || !storyboard) return
        player.seek(focusMs)
        setFocus(null)
    }, [focusMs, storyboard])

    useEffect(() => {
        void(async () => {
            try{
                const res = await fetch('./storyboard.json')
                if(!res.ok) throw new Error('HTTP ' + res.status)
                setStoryboard((await res.json()) as Storyboard)
            }catch(e){
                setError(String(e))
            }
        })()
    },[])



    if (error) return <p className={styles.status}>加载失败：{error}</p>
    if (!storyboard) return <p className={styles.status}>加载中…</p>

    const handleSeek = (e: MouseEvent<HTMLDivElement>) => {
        const rect = e.currentTarget.getBoundingClientRect()
        const ratio = Math.min(Math.max((e.clientX - rect.left) / rect.width, 0), 1)
        player.seek(ratio * storyboard.durationMs)
    }

    const updateCueText = (i:number, text:string) => {
        setSaveState('idle')   // 改过之后，之前的"已保存"就不作数了
        setStoryboard((prev) => {
            if(!prev?.cues) return prev
            return {
                ...prev,
                cues: prev.cues.map((c) =>
                    c.i === i ? {...c, text, lines:wrapCue(text)} : c
                )
            }
        })
    }

    // 全量快照：管线每次从讲稿重建，修订文件是人工改动的唯一记录，
    // 所以导出/保存的必须是"当前所有字幕的最终文字"，不能只导改动的那几条。
    const buildCueEdits = () => {
        const cues = storyboard.cues ?? []
        return {
            timings: storyboard.builtFrom?.timings ?? null,
            edits: cues.map((c) => ({ i: c.i, text: c.text })),
        }
    }

    const exportCueEdits = () => {
        const payload = buildCueEdits()
        if (payload.edits.length === 0) return
        downloadJson(payload, 'cue-edits.json')
    }

    // 写回 corpus/cue-edits.json。只有 pnpm dev 有这个端点。
    const saveCueEdits = async () => {
        setSaveState('saving')
        try {
            const res = await fetch('/api/cue-edits', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify(buildCueEdits()),
            })
            if (!res.ok) throw new Error('HTTP ' + res.status)
            setSaveState('saved')
        } catch {
            setSaveState('error')
        }
    }

    const currentScene = storyboard.scenes.find(
        (s) => player.t >= s.startMs && player.t < s.endMs,
    )
    const currentCue = storyboard.cues?.find(
        (c) => player.t >= c.startMs && player.t < c.endMs,
    )

    return (
        <div className={styles.page}>
            <h1 className={styles.title}>字幕编辑</h1>
            <p className={styles.meta}>
                时长 {storyboard.durationMs} ms · 场景 {storyboard.scenes.length} · 字幕{' '}
                {storyboard.cues?.length ?? 0} 条
            </p>

            <div className={styles.toolbar}>
                <button className={styles.btn} onClick={() => downloadJson(storyboard, 'storyboard.json')}>导出 JSON</button>
                <button className={styles.btn} onClick={exportCueEdits}>导出字幕修订</button>
                <button className={styles.btn} onClick={saveCueEdits} disabled={saveState === 'saving'}>
                    {saveState === 'saving' ? '保存中…' : '保存修订'}
                </button>
                {saveState === 'saved' && (
                    <span className={styles.hint}>已写入 corpus/cue-edits.json，跑 pnpm storyboard 生效</span>
                )}
                {saveState === 'error' && (
                    <span className={styles.hintError}>保存失败</span>
                )}
            </div>

            <div className={styles.timeline} onClick={handleSeek}>
                <Timeline
                    scenes={storyboard.scenes}
                    durationMs={storyboard.durationMs}
                    activeId={currentScene?.id}
                />
                <CueTrack
                    cues={storyboard.cues ?? []}
                    durationMs={storyboard.durationMs}
                />
                {/* 播放头 */}
                <div
                    className={styles.playhead}
                    style={{ left: `${(player.t / storyboard.durationMs) * 100}%` }}
                />
            </div>

            <input
                className={styles.scrub}
                type="range"
                min={0}
                max={storyboard.durationMs}
                step={16}
                value={player.t}
                onPointerDown={player.scrubStart}
                onChange={(e) => player.scrubChange(Number(e.target.value))}
                onPointerUp={player.scrubEnd}
            />

            <div className={styles.transport}>
                <button className={styles.btn} onClick={player.toggle}>
                    {player.playing ? '暂停' : '▶ 播放'}
                </button>
                <span className={styles.time}>{Math.floor(player.t / 1000)}s</span>
            </div>

            <CueList
                cues={storyboard.cues ?? []}
                activeI={currentCue?.i}
                onTextChange={updateCueText}
            />

            <audio
                ref={audioRef}
                src={'./audio/' + storyboard.audioFile}
                preload="auto"
            ></audio>
        </div>
    )
}
