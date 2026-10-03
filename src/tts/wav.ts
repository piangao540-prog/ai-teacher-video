/**
 * 讯飞的 aue=raw 给的是裸 PCM（没有文件头），浏览器和 ffmpeg 都不认。
 * 这里手工补一个 44 字节的 WAV 头。
 */
export function pcmToWav(pcm: Buffer, sampleRate = 16000, channels = 1, bitsPerSample = 16): Buffer {
  const byteRate = (sampleRate * channels * bitsPerSample) / 8
  const blockAlign = (channels * bitsPerSample) / 8

  const header = Buffer.alloc(44)
  header.write('RIFF', 0)
  header.writeUInt32LE(36 + pcm.length, 4)
  header.write('WAVE', 8)
  header.write('fmt ', 12)
  header.writeUInt32LE(16, 16) // fmt 块长度
  header.writeUInt16LE(1, 20) // 1 = PCM
  header.writeUInt16LE(channels, 22)
  header.writeUInt32LE(sampleRate, 24)
  header.writeUInt32LE(byteRate, 28)
  header.writeUInt16LE(blockAlign, 32)
  header.writeUInt16LE(bitsPerSample, 34)
  header.write('data', 36)
  header.writeUInt32LE(pcm.length, 40)

  return Buffer.concat([header, pcm])
}

/** 生成一段静音，用来在试听文件里隔开不同音色 */
export function silence(ms: number, sampleRate = 16000, channels = 1, bitsPerSample = 16): Buffer {
  const bytes = Math.round((ms / 1000) * sampleRate * channels * (bitsPerSample / 8))
  return Buffer.alloc(bytes)
}