// 场景
export type Scene = {
    id: string
    template: string
    startMs: number
    endMs: number
    props: Record<string, unknown>
}

// 故事板
export type Storyboard = {
    durationMs: number
    audioFile: string
    scenes: Scene[]
    cues?: Cue[]
    builtFrom?: {
        episode?: string | null
        timings?: string | null
    }
}

// 字幕
export type Cue = { i: number; startMs: number; endMs: number; text: string; lines: string[] }
