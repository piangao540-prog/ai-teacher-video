import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { defineConfig, type Plugin } from 'vite'
import vue from '@vitejs/plugin-vue'

const MIME: Record<string, string> = {
  '.json': 'application/json; charset=utf-8',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
}

// 开发服务器默认不认识 /storyboard.json 和 /audio/* ——
// 它们不在 public 里，是每次渲染才生成的。
// 这里挂个中间件，让 pnpm dev 也能预览，而且能听到声音。
function stageDataPlugin(): Plugin {
  return {
    name: 'stage-data',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = (req.url ?? '').split('?')[0] ?? ''

        let target: string | null = null
        if (url === '/storyboard.json') {
          target = path.resolve('out/render/storyboard.json')
        } else if (url.startsWith('/audio/')) {
          target = path.resolve('out/render/audio', decodeURIComponent(url.slice('/audio/'.length)))
        }

        if (!target) return next()

        const file = target
        readFile(file)
          .then((data) => {
            res.setHeader('content-type', MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream')
            res.end(data)
          })
          .catch(() => {
            res.statusCode = 404
            res.end('还没生成：' + file)
          })
      })
    },
  }
}

export default defineConfig({
  // 用 file:// 直接打开构建产物时必须是相对路径
  base: './',
  plugins: [vue(), stageDataPlugin()],
})