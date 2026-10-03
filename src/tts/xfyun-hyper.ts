import { createHmac } from 'node:crypto'

// 讯飞「超拟人语音合成」——和老的「在线语音合成」是两个完全不同的接口。
//   老接口: wss://tts-api.xfyun.cn/v2/tts          采样率最高 16000
//   新接口: wss://cbm01.cn-huabei-1.xf-yun.com/...  采样率支持 24000
//
// 新接口还多给一样东西：rhy=1 时返回「音素时长」，
// 也就是每个字的精确发音长度（单位 5 毫秒）——
// 这样就不用再拿 ced 去猜时间了。
const HOST = 'cbm01.cn-huabei-1.xf-yun.com'
const PATH = '/v1/private/mcd9m97e6'

function buildAuthUrl(apiKey: string, apiSecret: string): string {
  const date = new Date().toUTCString()
  const signatureOrigin = 'host: ' + HOST + '\ndate: ' + date + '\nGET ' + PATH + ' HTTP/1.1'
  const signature = createHmac('sha256', apiSecret).update(signatureOrigin).digest('base64')
  const authOrigin =
    'api_key="' + apiKey + '", algorithm="hmac-sha256", headers="host date request-line", signature="' + signature + '"'
  const authorization = Buffer.from(authOrigin, 'utf8').toString('base64')
  return 'wss://' + HOST + PATH + '?' + new URLSearchParams({ authorization, date, host: HOST }).toString()
}

export type HyperOptions = {
  appId: string
  apiKey: string
  apiSecret: string
  vcn: string
  text: string
  sampleRate?: 8000 | 16000 | 24000
  speed?: number
  pitch?: number
  volume?: number
  oralLevel?: 'high' | 'mid' | 'low'
  timeoutMs?: number
}

export type HyperResult = {
  pcm: Buffer
  sampleRate: number
  /** 官方返回的音素标注原文，形如 sil:6;欢[=huan1]-h1:16;@-uan1:24;... */
  phonemes: string
  frames: number
}

export function synthesizeHyper(opts: HyperOptions): Promise<HyperResult> {
  const url = buildAuthUrl(opts.apiKey, opts.apiSecret)
  const sampleRate = opts.sampleRate ?? 24000

  return new Promise<HyperResult>((resolve, reject) => {
    const audioChunks: Buffer[] = []
    let phonemes = ''
    let frameCount = 0
    let settled = false

    const ws = new WebSocket(url)
    const timer = setTimeout(
      () => fail(new Error('超时（' + (opts.timeoutMs ?? 60000) + 'ms）')),
      opts.timeoutMs ?? 60000,
    )

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
      resolve({ pcm: Buffer.concat(audioChunks), sampleRate, phonemes, frames: frameCount })
    }

    ws.addEventListener('open', () => {
      ws.send(
        JSON.stringify({
          header: { app_id: opts.appId, status: 2 },
          parameter: {
            oral: { oral_level: opts.oralLevel ?? 'mid' },
            tts: {
              vcn: opts.vcn,
              speed: opts.speed ?? 50,
              volume: opts.volume ?? 50,
              pitch: opts.pitch ?? 50,
              bgs: 0,
              reg: 0,
              rdn: 0,
              rhy: 1, // 关键：要求返回音素标注，里面有每个字的发音时长
              audio: {
                encoding: 'raw', // 无损 PCM
                sample_rate: sampleRate,
                channels: 1,
                bit_depth: 16,
                frame_size: 0,
              },
            },
          },
          payload: {
            // 坑：官方文档示例里 text 是明文，但实测必须是 base64，
            // 否则返回 10163 "must be encode to base64 string"。
            text: {
              encoding: 'utf8',
              compress: 'raw',
              format: 'plain',
              status: 2,
              seq: 0,
              text: Buffer.from(opts.text, 'utf8').toString('base64'),
            },
          },
        }),
      )
    })

    ws.addEventListener('message', (ev: MessageEvent) => {
      const raw = typeof ev.data === 'string' ? ev.data : Buffer.from(ev.data as ArrayBuffer).toString('utf8')

      let msg: {
        header?: { code: number; message: string }
        payload?: {
          audio?: { audio?: string; status?: number }
          pybuf?: { text?: string }
        }
      }
      try {
        msg = JSON.parse(raw)
      } catch {
        return
      }

      const code = msg.header?.code
      if (code !== undefined && code !== 0) {
        fail(new Error('超拟人返回错误 ' + code + ': ' + (msg.header?.message ?? '')))
        return
      }
      if (!msg.payload) return

      frameCount++

      if (msg.payload.audio?.audio) {
        audioChunks.push(Buffer.from(msg.payload.audio.audio, 'base64'))
      }
      if (msg.payload.pybuf?.text) {
        phonemes += Buffer.from(msg.payload.pybuf.text, 'base64').toString('utf8')
      }
      if (msg.payload.audio?.status === 2) done()
    })

    ws.addEventListener('error', () => fail(new Error('WebSocket 连接失败')))
    ws.addEventListener('close', () => {
      if (!settled) {
        if (audioChunks.length > 0) done()
        else fail(new Error('连接被关闭，没收到音频（接口未开通？发音人未授权？）'))
      }
    })
  })
}

/**
 * 解析音素标注，得到每个字的发音时长。
 *
 * 原文形如：
 *   sil:6;欢[=huan1]-h1:16;@-uan1:24;迎[=ying2]-ing2:20;@-ing2:20;
 *
 * 规则：
 *   - 用 ; 分隔
 *   - 带 [=拼音] 的 token 是一个新字的开头，方括号前就是那个字
 *   - 以 @ 开头的 token 是上一个字的下一个音素
 *   - 末尾的 :数字 是音素帧数，1 帧 = 5 毫秒
 *   - sil / sp 是静音，不算字
 */
export function parsePhonemes(phonemes: string): Array<{ text: string; durationMs: number }> {
  const out: Array<{ text: string; durationMs: number }> = []

  for (const token of phonemes.split(';')) {
    const trimmed = token.trim()
    if (!trimmed) continue

    const frames = Number(trimmed.slice(trimmed.lastIndexOf(':') + 1))
    const ms = Number.isFinite(frames) ? frames * 5 : 0

    const bracket = trimmed.indexOf('[=')
    if (bracket > 0) {
      const ch = trimmed.slice(0, bracket)
      if (ch === 'sil' || ch === 'sp') continue
      out.push({ text: ch, durationMs: ms })
      continue
    }

    if (trimmed.startsWith('@') && out.length > 0) {
      out[out.length - 1]!.durationMs += ms
    }
  }

  return out
}