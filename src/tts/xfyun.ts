import { createHmac } from 'node:crypto'

const HOST = 'tts-api.xfyun.cn'
const PATH = '/v2/tts'

// 讯飞的鉴权是三段式：
//   1. 把 host / date / 请求行拼成一段字符串
//   2. 用 APISecret 做 HMAC-SHA256，再 base64
//   3. 把 api_key + 算法 + 签名拼起来，整个再 base64，塞进 URL 查询参数
// 照着官方文档的公式抄就行，不是什么黑魔法。
function buildAuthUrl(apiKey: string, apiSecret: string): string {
  const date = new Date().toUTCString() // 必须是 RFC1123 的 GMT 时间
  const signatureOrigin = 'host: ' + HOST + '\ndate: ' + date + '\nGET ' + PATH + ' HTTP/1.1'
  const signature = createHmac('sha256', apiSecret).update(signatureOrigin).digest('base64')
  const authOrigin =
    'api_key="' + apiKey + '", algorithm="hmac-sha256", headers="host date request-line", signature="' + signature + '"'
  const authorization = Buffer.from(authOrigin, 'utf8').toString('base64')

  const params = new URLSearchParams({ authorization, date, host: HOST })
  return 'wss://' + HOST + PATH + '?' + params.toString()
}

export type XfyunFrame = {
  // ced = 服务端「已合成文本的字节数」。注意它不是时间。
  ced: string
  audio: Buffer
}

export type XfyunSpeechOptions = {
  appId: string
  apiKey: string
  apiSecret: string
  vcn: string
  text: string
  speed?: number
  pitch?: number
  volume?: number
  timeoutMs?: number
}

export type XfyunSpeechResult = {
  /** 裸 PCM（16bit / 16kHz / 单声道），需要 pcmToWav 包一层 */
  pcm: Buffer
  sampleRate: number
  frames: XfyunFrame[]
}

export function synthesizeXfyun(opts: XfyunSpeechOptions): Promise<XfyunSpeechResult> {
  const url = buildAuthUrl(opts.apiKey, opts.apiSecret)
  const sampleRate = 16000

  return new Promise<XfyunSpeechResult>((resolve, reject) => {
    const frames: XfyunFrame[] = []
    let settled = false

    const ws = new WebSocket(url)
    const timer = setTimeout(() => fail(new Error('超时（' + (opts.timeoutMs ?? 60000) + 'ms）')), opts.timeoutMs ?? 60000)

    function cleanup() {
      clearTimeout(timer)
      try {
        ws.close()
      } catch {
        // 已经关了
      }
    }

    function fail(e: unknown) {
      if (settled) return
      settled = true
      cleanup()
      reject(e instanceof Error ? e : new Error(String(e)))
    }

    function done() {
      if (settled) return
      settled = true
      cleanup()
      resolve({ pcm: Buffer.concat(frames.map((f) => f.audio)), sampleRate, frames })
    }

    ws.addEventListener('open', () => {
      ws.send(
        JSON.stringify({
          common: { app_id: opts.appId },
          business: {
            // raw = 裸 PCM，不经过 mp3 压缩。
            // 之前用 lame(mp3) 只有 48kbps，那一层压缩就是「电音」的来源。
            aue: 'raw',
            auf: 'audio/L16;rate=' + sampleRate,
            vcn: opts.vcn,
            tte: 'UTF8',
            speed: opts.speed ?? 50,
            pitch: opts.pitch ?? 50,
            volume: opts.volume ?? 50,
          },
          data: {
            status: 2, // 固定 2：文本一次性传完
            text: Buffer.from(opts.text, 'utf8').toString('base64'),
          },
        }),
      )
    })

    ws.addEventListener('message', (ev: MessageEvent) => {
      const raw = typeof ev.data === 'string' ? ev.data : Buffer.from(ev.data as ArrayBuffer).toString('utf8')

      let msg: { code: number; message: string; data?: { audio?: string; status?: number; ced?: string } }
      try {
        msg = JSON.parse(raw)
      } catch {
        return // 服务端偶尔会返回拼不起来的帧，跳过
      }

      if (msg.code !== 0) {
        fail(new Error('讯飞返回错误 ' + msg.code + ': ' + msg.message))
        return
      }
      if (!msg.data) return // 文档说明 data 可能为 null，直接忽略

      if (msg.data.audio || msg.data.ced) {
        frames.push({ ced: msg.data.ced ?? '', audio: Buffer.from(msg.data.audio ?? '', 'base64') })
      }
      if (msg.data.status === 2) done()
    })

    ws.addEventListener('error', () => fail(new Error('WebSocket 连接失败（密钥、时间或网络问题）')))
    ws.addEventListener('close', () => {
      if (!settled) {
        if (frames.length > 0) done()
        else fail(new Error('连接被关闭，没有收到任何音频'))
      }
    })
  })
}