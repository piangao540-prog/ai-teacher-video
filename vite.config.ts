import path from 'node:path'
import { defineConfig, type Plugin } from 'vite'
import vue from '@vitejs/plugin-vue'
import { planApi } from './src/server/plan-api'
import { sendFile } from './src/server/send-file'

const MIME: Record<string, string> = {
  '.json': 'application/json; charset=utf-8',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
}

// 开发服务器默认不认识 /storyboard.json 和 /audio/* ——
// 它们不在 public 里，是每次渲染才生成的。
// 这里挂个中间件，让 pnpm dev 也能预览，而且能听到声音。
//
// ★ 走 sendFile 而不是自己 readFile 整个发出去：音频**必须**支持 HTTP Range。
//   不支持的话 <audio> 的 seekable 范围是 0，`currentTime = X` 会被静默忽略 ——
//   拖进度条不跳、暂停再播从头开始。详见 src/server/send-file.ts。
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
          const root = path.resolve('out/render/audio')
          const file = path.resolve(root, decodeURIComponent(url.slice('/audio/'.length)))
          // 别让 ../../ 跑到音频目录外面去
          if (!file.startsWith(root)) {
            res.statusCode = 403
            return res.end()
          }
          target = file
        }

        if (!target) return next()

        const file: string = target
        void sendFile(req, res, file, MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream')
      })
    },
  }
}

// 「输入一句话 → 生成剧本」的 POST 端点。
// 和 stageDataPlugin 是同一个路数：接着往同一条中间件链上挂一段，
// 不另起服务器、不引入框架。业务逻辑在 src/server/plan-api.ts。
function planApiPlugin(): Plugin {
  return {
    name: 'plan-api',
    configureServer(server) {
      server.middlewares.use(planApi())
    },
  }
}

export default defineConfig({
  // 用 file:// 直接打开构建产物时必须是相对路径
  base: './',
  plugins: [vue(), stageDataPlugin(), planApiPlugin()],
})