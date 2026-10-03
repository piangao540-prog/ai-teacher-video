import { execFileSync } from 'node:child_process'
import { access } from 'node:fs/promises'
import { createRequire } from 'node:module'

export async function exists(p: string): Promise<boolean> {
  try {
    await access(p)
    return true
  } catch {
    return false
  }
}

// 找 ffmpeg，优先级从高到低。
//
// 注意：不要用 Playwright 自带的那个 ffmpeg。
// 它是为录制 webm 专门编译的精简版，没有 mp4 封装器、也没有 libx264，
// 传 -movflags 会直接报 "Unrecognized option"。
export async function findFfmpeg(): Promise<string> {
  if (process.env.FFMPEG_PATH) return process.env.FFMPEG_PATH

  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' })
    return 'ffmpeg'
  } catch {
    // PATH 上没有，继续找
  }

  // @ffmpeg-installer/ffmpeg 内部已经按平台解析好了路径，
  // 不要自己去猜 node_modules 结构：pnpm 是隔离式布局，猜不准。
  try {
    const require = createRequire(import.meta.url)
    const installer = require('@ffmpeg-installer/ffmpeg') as { path?: string }
    if (installer.path && (await exists(installer.path))) return installer.path
  } catch {
    // 没装这个包
  }

  throw new Error('找不到可用的 ffmpeg。装 @ffmpeg-installer/ffmpeg，或用 FFMPEG_PATH 指定。')
}

// 读媒体文件时长。ffmpeg 把信息打在 stderr 上，而且会以非 0 退出，
// 所以这里必须 catch 住再解析，不能指望它正常返回。
export function probeDurationMs(ffmpeg: string, file: string): number {
  let stderr = ''
  try {
    execFileSync(ffmpeg, ['-hide_banner', '-i', file], { stdio: ['ignore', 'ignore', 'pipe'] })
  } catch (e) {
    stderr = String((e as { stderr?: unknown }).stderr ?? '')
  }
  const m = stderr.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/)
  if (!m) throw new Error('读不出时长: ' + file)
  return Math.round((Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3])) * 1000)
}
