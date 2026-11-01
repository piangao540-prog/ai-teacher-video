import type { Cue } from '../../type/storyboard'

type Props = {
    cues: Cue[]
    activeI?: number
    onTextChange: (i: number, text: string) => void
}

export default function CueList({ cues, activeI, onTextChange }: Props) {
    return (
        <ul style={{ listStyle: 'none', padding: 0 }}>
            {cues.map((cue) => (
                <li
                    key={cue.i}
                    style={{
                        display: 'flex',
                        gap: 12,
                        padding: 6,
                        background: cue.i === activeI ? '#1f6feb33' : 'transparent',
                    }}
                >
                    <span style={{ fontFamily: 'monospace', width: 110 }}>
                        {cue.startMs}–{cue.endMs}
                    </span>
                    <input
                        value={cue.text}
                        onChange={(e) => onTextChange(cue.i, e.target.value)}
                        style={{ flex: 1 }}
                    />
                </li>
            ))}
        </ul>
    )
}
