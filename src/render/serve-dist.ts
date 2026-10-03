import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import path from 'node:path'

// 注意：不能用 file:// 打开构建产物。
// file:// 下浏览器会以跨域为由拦掉 <script type="module">，页面根本不会启动。
const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
  '.woff2': 'font/woff2',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
}

function mimeOf(file: string): string {
  return MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream'
}

// storyboard 和音频都不在 dist 里 —— 它们是每次渲染才生成的，
// 所以由服务器直接从 out/render 喂给页面，不打进构建产物。
function resolveGenerated(url: string): string | null {
  if (url === '/storyboard.json') return path.resolve('out/render/storyboard.json')
  if (url.startsWith('/audio/')) {
    return path.resolve('out/render/audio', decodeURIComponent(url.slice('/audio/'.length)))
  }
  return null
}

export async function startStageServer(): Promise<{ url: string; close: () => void }> {
  const distDir = path.resolve('dist')
  const audioRoot = path.resolve('out/render/audio')

  const server = createServer(async (req, res) => {
    const { pathname } = new URL(req.url ?? '/', 'http://127.0.0.1')

    const generated = resolveGenerated(pathname)
    if (generated) {
      // 别让 ../../ 跑到音频目录外面去
      if (pathname.startsWith('/audio/') && !generated.startsWith(audioRoot)) {
        res.writeHead(403)
        res.end()
        return
      }
      try {
        const body = await readFile(generated)
        res.writeHead(200, { 'content-type': mimeOf(generated) })
        res.end(body)
      } catch {
        res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
        res.end('还没生成：' + generated + '（先跑 pnpm say / pnpm storyboard）')
      }
      return
    }

    const rel = pathname === '/' ? 'index.html' : decodeURIComponent(pathname).replace(/^\/+/, '')
    const file = path.join(distDir, rel)

    if (!file.startsWith(distDir)) {
      res.writeHead(403)
      res.end()
      return
    }

    try {
      const body = await readFile(file)
      res.writeHead(200, { 'content-type': mimeOf(file) })
      res.end(body)
    } catch {
      res.writeHead(404, { 'content-type': 'text/plain' })
      res.end('not found')
    }
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as { port: number }).port

  return { url: 'http://127.0.0.1:' + port + '/', close: () => server.close() }
}