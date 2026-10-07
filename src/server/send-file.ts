// 把磁盘上的文件发给浏览器，**支持 HTTP Range**。
//
// ★ 为什么非支持 Range 不可：`<audio>` 能不能 seek，是由 `seekable` 范围决定的，
//   而那个范围由服务器认不认 `Range` 头决定。不支持的时候有个很反直觉的现象 ——
//   浏览器**明明已经把整个文件缓冲完了**（`buffered.end(0)` 一直到片尾），
//   `seekable.end(0)` 却仍然是 0。于是 `audio.currentTime = X` 被**静默忽略**：
//   不报错、不抛异常，就是不跳。
//
//   这个坑的伪装性在于：画面那一半（t）是 Vue 自己算的，跳得好好的，
//   只有声音没跳 —— 于是「暂停再播放从头开始」「拖进度条声音不跟」，
//   看起来像播放器的逻辑 bug，实际是 HTTP 头的问题。
//
// ★ 用流发、不用 readFile：Range 的意义就是**不**把整个文件读出来。
//   每次 seek 都全量读一遍音频是白费的。
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'

/** `bytes=0-1023` / `bytes=500-` / `bytes=-500` 三种都认 */
function parseRange(header: string, size: number): { start: number; end: number } | null {
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim())
  if (!m) return null
  const [, rawStart, rawEnd] = m
  if (rawStart === '' && rawEnd === '') return null

  let start: number
  let end: number
  if (rawStart === '') {
    // `-500`：最后 500 字节
    start = Math.max(0, size - Number(rawEnd))
    end = size - 1
  } else {
    start = Number(rawStart)
    end = rawEnd === '' ? size - 1 : Math.min(Number(rawEnd), size - 1)
  }

  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= size) return null
  return { start, end }
}

export async function sendFile(
  req: IncomingMessage,
  res: ServerResponse,
  file: string,
  mime: string,
): Promise<void> {
  let size: number
  try {
    size = (await stat(file)).size
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
    res.end('还没生成：' + file)
    return
  }

  // ★ 这一行是整个文件里最要紧的一行。不声明 `accept-ranges`，
  //   浏览器根本不会来问 Range，下面 206 那个分支永远走不到。
  const base = { 'content-type': mime, 'accept-ranges': 'bytes' }

  const range = req.headers.range
  const span = range ? parseRange(range, size) : null

  if (!span) {
    // 没有 Range（或者 Range 不合法）：整份发出去。
    // 注意这里也要带 `accept-ranges` —— 浏览器是先看这一眼，
    // 才知道「下次可以带 Range 来问」。
    res.writeHead(200, { ...base, 'content-length': String(size) })
    if (req.method === 'HEAD') {
      res.end()
      return
    }
    createReadStream(file).on('error', () => res.end()).pipe(res)
    return
  }

  res.writeHead(206, {
    ...base,
    'content-length': String(span.end - span.start + 1),
    'content-range': 'bytes ' + span.start + '-' + span.end + '/' + size,
  })
  if (req.method === 'HEAD') {
    res.end()
    return
  }
  createReadStream(file, span).on('error', () => res.end()).pipe(res)
}
