// 场景的[帧签名]：给一个时刻，交出这一帧画面上所有随时间变化的值
// 这个文件是唯一的事实来源：组件用它来渲染，渲染器的复用判据也用它来判断

export const CHAR_MS = 45
export const BLINK_MS = 530
export const SLIDE_FADE_MS = 400
export const SLIDE_TITLE_FADE_MS = 600

export type CodeLine = { code: string; atMs: number }

export type CodeState = { activeLine: number; caret: boolean; typed: number[] }

export function codeStateAt(t: number, lines: CodeLine[]): CodeState {
    // 当前激活到第几行
    let activeLine = -1
    for (let i = 0; i < lines.length; i++) {
        if (t >= lines[i]!.atMs) activeLine = i
    }

    // 每行已经打出了多少个字
    const typed = lines.map((l) => {
        const elapsed = t - l.atMs
        if (elapsed <= 0) return 0
        return Math.min(Math.floor(elapsed / CHAR_MS), l.code.length)
    })

    // 光标闪烁
    const caret = Math.floor(t / BLINK_MS) % 2 === 0
    return { activeLine, caret, typed }
}

export type SlideProps = {
    titleAtMs: number
    bullets: Array<{ atMs: number }>
}

export type SlideState = { titleOpacity: number; bulletOpacity: number[] }

export function slideStateAt(t: number, p: SlideProps): SlideState {
    const fade = (startAtMs: number, ms: number) => 
        Math.max(0, Math.min((t - startAtMs) / ms, 1))
    return {
        titleOpacity: fade(p.titleAtMs, SLIDE_TITLE_FADE_MS),
        bulletOpacity: p.bullets.map((b) => fade(b.atMs, SLIDE_FADE_MS)),
    }
    
}