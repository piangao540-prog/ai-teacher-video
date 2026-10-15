import { useState } from 'react'
import CodeTyping from '../render/scenes/CodeTyping'
import SlideBullets from '../render/scenes/SlideBullets'
import Terminal from '../render/scenes/Terminal'
import type { CodeLine, TermLine } from '../render/scenes/sceneState'

const demoLines: CodeLine[] = [
    { code: 'const a = 1', atMs: 0, step: 1 },
    { code: 'const b = 2', atMs: 1200, step: 2 },
    { code: 'console.log(a + b)', atMs: 2600, step: 3 },
]

const demoBullets = [
    { text: '响应式是 Proxy 拦截读取', atMs: 800 },
    { text: '依赖是被谁读到才被登记', atMs: 2200 },
    { text: '所以 computed 能自动缓存', atMs: 3600 },
]

const demoTerms: TermLine[] = [
    { text: 'pnpm dev', kind: 'command', atMs: 0 },
    { text: 'VITE v8 ready in 312 ms', kind: 'output', atMs: 800 },
    { text: 'pnpm build', kind: 'command', atMs: 2000 },
    { text: '✓ built in 2.14s', kind: 'output', atMs: 3000 },
]

export default function SceneLab() {
    const [t, setT] = useState(0)
    const [scene, setScene] = useState<'code' | 'slide' | 'term'>('code')

    return (
        <div style={{ padding: 16, background: '#111', minHeight: '100vh' }}>
            <div style={{ marginBottom: 12, color: '#ddd' }}>
                <input
                    type="range"
                    min={0}
                    max={8000}
                    step={40}
                    value={t}
                    onChange={(e) => setT(Number(e.target.value))}
                    style={{ width: 400, verticalAlign: 'middle' }}
                />
                <span style={{ marginLeft: 12 }}>t = {t} ms</span>
            </div>

            <div style={{ marginBottom: 12 }}>
                <button onClick={() => setScene('code')}>代码</button>
                <button onClick={() => setScene('slide')}>幻灯片</button>
                <button onClick={() => setScene('term')}>终端</button>
            </div>

            <div
                style={{
                    width: 960,
                    height: 540,
                    position: 'relative',
                    overflow: 'hidden',
                    border: '1px solid #333',
                }}
            >
                <div
                    style={{
                        width: 1920,
                        height: 1080,
                        position: 'absolute',
                        transform: 'scale(0.5)',
                        transformOrigin: 'top left',
                    }}
                >
                    {scene === 'code' && <CodeTyping t={t} fileName="demo.ts" lines={demoLines} />}
                    {scene === 'slide' && (
                        <SlideBullets t={t} title="Vue3 响应式原理" titleAtMs={0} bullets={demoBullets} />
                    )}
                    {scene === 'term' && <Terminal t={t} lines={demoTerms} />}
                </div>
            </div>
        </div>
    )
}
