// 「编辑器 → 把字幕修订写回 corpus/cue-edits.json」的 POST 端点。
//
// ★ 为什么这一步必须有个后端：浏览器不能写磁盘。整条回流链里，
//   只有「把文件放回项目」这一下是浏览器做不到的。
//
// ★ 只挂在 dev server 的 configureServer 上 —— 生产构建里这个端点不存在。
//   这是本地单用户工具，不处理鉴权、并发、路径隔离之外的攻击面。
//   不要把它部署到公网。
//
// ★ 目标路径写死，不接受前端传路径。否则这个端点就等于「任意写盘」，
//   哪怕只在本机，也不该留这种口子。

import { writeFile } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import path from 'node:path'

const EDITS_FILE = path.resolve('corpus/cue-edits.json')

type Body = { timings: string | null; edits: Array<{ i: number; text: string }> }

/** 只认形状，不做业务校验（比如 i 是否越界）——越界的条目下游会自然忽略。 */
function isBody(v: unknown): v is Body {
  if (typeof v !== 'object' || v === null) return false
  const b = v as Record<string, unknown>
  if (b.timings !== null && typeof b.timings !== 'string') return false
  if (!Array.isArray(b.edits)) return false
  return b.edits.every((e) => {
    if (typeof e !== 'object' || e === null) return false
    const item = e as Record<string, unknown>
    return typeof item.i === 'number' && typeof item.text === 'string'
  })
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => chunks.push(c))
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

function reply(res: ServerResponse, status: number, payload: unknown): void {
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(payload))
}

/** 和 planApi() 一样：挂在中间件链上，按 URL 自己分流，不认识的交给 next()。 */
export function cueEditsApi() {
  return (req: IncomingMessage, res: ServerResponse, next: () => void): void => {
    const url = (req.url ?? '').split('?')[0]
    if (url !== '/api/cue-edits') return next()

    if (req.method !== 'POST') {
      res.setHeader('allow', 'POST')
      res.statusCode = 405
      res.end()
      return
    }

    // 不 await：中间件本身必须立刻返回
    void (async () => {
      let body: unknown
      try {
        body = JSON.parse(await readBody(req))
      } catch {
        reply(res, 400, { ok: false, error: 'body 不是合法 JSON' })
        return
      }

      if (!isBody(body)) {
        reply(res, 400, { ok: false, error: 'body 形状不对，需要 { timings, edits: [{ i, text }] }' })
        return
      }

      try {
        await writeFile(EDITS_FILE, JSON.stringify(body, null, 2) + '\n', 'utf8')
      } catch (e) {
        reply(res, 500, { ok: false, error: String(e) })
        return
      }

      reply(res, 200, { ok: true, count: body.edits.length })
    })()
  }
}
