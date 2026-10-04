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

// ---- Terminal（终端演示）----

export type TermLine = { text: string; kind: 'command' | 'output'; atMs: number }

export type TermState = {
    /** 每行已经打出来的字符数。output 行要么 0（还没到）要么整行 */
    typed: number[]
    /** 正在打字的行下标；没有正在打字的行就是 -1 */
    typingLine: number
    /**
     * 光标当下是否可见。只有正在打字的那一行才会有光标，打完就消失。
     *
     * ★ 不做常驻闪烁：常驻的话每 530ms 就有一帧和上一帧不同，
     *   白白废掉一整段静态帧的复用，而画面上只是多了个空光标。
     */
    caret: boolean
}

/**
 * 一行在画面上占多久：command 逐字打出来，output 整行出现（不占时间）。
 *
 * ★ build-storyboard 也 import 它来推进「上一行什么时候结束」——
 *   「命令打多久」只有这一处定义，不会再出现两边各算一遍那个老毛病。
 */
export function termLineDurationMs(line: { text: string; kind: 'command' | 'output' }): number {
    return line.kind === 'command' ? line.text.length * CHAR_MS : 0
}

export function terminalStateAt(t: number, lines: TermLine[]): TermState {
    const typed: number[] = []
    let typingLine = -1

    for (let i = 0; i < lines.length; i++) {
        const l = lines[i]!
        const elapsed = t - l.atMs
        if (elapsed < 0) {
            typed.push(0)
            continue
        }
        const n = Math.min(Math.floor(elapsed / CHAR_MS), l.text.length)
        if (l.kind === 'command') {
            if (n < l.text.length) typingLine = i
            typed.push(n)
        } else {
            // 输出整行出现，不逐字打
            typed.push(l.text.length)
        }
    }

    return {
        typed,
        typingLine,
        caret: typingLine >= 0 && Math.floor(t / BLINK_MS) % 2 === 0,
    }
}