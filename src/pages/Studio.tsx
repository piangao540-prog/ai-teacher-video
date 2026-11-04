import { useState, useEffect } from 'react'
import {
    Card, Alert, Col, Row, Statistic, Table, ConfigProvider,
    type TableColumnsType, type ThemeConfig
} from 'antd'
import { useNavigate } from 'react-router'
import { useStudioStore } from '../store/studio'
import type { Storyboard } from '../type/storyboard'
import styles from './Studio.module.css'

type Scene = Storyboard['scenes'][number]

function segmentCount(scene: Scene) {
    const { bullets, lines } = scene.props
    if (Array.isArray(bullets)) return bullets.length
    if (Array.isArray(lines)) return lines.length
    return 0
}

const studioTheme: ThemeConfig = {
    token: {
        colorPrimary: '#ec4899',
        colorLink: '#db2777',
        colorTextHeading: '#831843',
        borderRadius: 12,
    },
    components: {
        Table: {
            headerBg: '#fff0f6',
            headerColor: '#9d174d',
            rowHoverBg: '#fff5f9',
            borderColor: '#fbd5e5',
        },
        Statistic: {
            contentFontSize: 30,
        },
    },
}


const columns: TableColumnsType<Scene> = [
    { title: '场景', dataIndex: 'id', key: 'id' },
    { title: '模板', dataIndex: 'template', key: 'template' },
    {
        title: '开始',
        dataIndex: 'startMs',
        key: 'startMs',
        render: (ms: number) => fmt(ms),
        sorter: (a, b) => a.startMs - b.startMs,
    },
    { title: '时长', key: 'duration', render: (_, scene) => fmt(scene.endMs - scene.startMs) },
    { title: '段数', key: 'segments', render: (_, scene) => segmentCount(scene) },
]

function fmt(ms: number) {
    const total = Math.floor(ms / 1000)
    const m = Math.floor(total / 60)
    const s = total % 60
    return `${m}:${String(s).padStart(2, '0')}`
}

export default function Studio() {
    const [storyboard, setStoryboard] = useState<Storyboard | null>(null)
    const [error, setError] = useState<string | null>(null)

    const navigate = useNavigate()
    const setFocus = useStudioStore((s) => s.setFocus)

    useEffect(() => {
        void (async () => {
            try {
                const res = await fetch('/storyboard.json')
                if (!res.ok) throw new Error('HTTP' + res.status)
                setStoryboard((await res.json()) as Storyboard)
            } catch (e) {
                setError(String(e))
            }
        })()
    }, [])

    if (error) return (
        <div className={styles.page}>
            <Alert type="error" title={'加载失败：' + error} />
        </div>
    )

    if (!storyboard) return (
        <div className={styles.page}>
            <Card loading title="剧本概览" />
        </div>
    )


    return (
        <ConfigProvider theme={studioTheme}>
            <div className={styles.page}>
                <header className={styles.header}>
                    <h1 className={styles.title}>剧本概览</h1>
                    <p className={styles.meta}>数据来源：out/render/storyboard.json</p>
                </header>

                <Row className={styles.stats} gutter={16}>
                    <Col span={8}><Card className={styles.statCard}><Statistic title="总时长" value={storyboard.durationMs / 1000} precision={1} suffix="秒" /></Card></Col>
                    <Col span={8}><Card className={styles.statCard}><Statistic title="场景" value={storyboard.scenes.length} /></Card></Col>
                    <Col span={8}><Card className={styles.statCard}><Statistic title="字幕" value={storyboard.cues?.length ?? 0} /></Card></Col>
                </Row>

                <Card title="场景列表">
                    <Table<Scene>
                        columns={columns}
                        dataSource={storyboard.scenes}
                        rowKey="id"
                        size="middle"
                        pagination={{ pageSize: 5, showSizeChanger: false }}
                        onRow={(scene) => ({
                            onClick:() => {
                                setFocus(scene.startMs)
                                navigate('/editor')
                            },
                            style:{cursor:'pointer'}
                        })}
                    />
                </Card>
            </div>
        </ConfigProvider>

    )
}