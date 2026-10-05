// 这次的输入是什么：一篇文章，还是一句话主题？
//
// 这是整条管线的入口契约，所以单独一个文件、而且尽量做成纯函数 ——
// 「认不认得出主题」这件事不该靠烧一次 LLM 调用才能确认。
// （和 subtitle-export.ts、sceneState.ts 一个路子：有判断的逻辑抽出来单独放。）

import { existsSync } from 'node:fs'
import { copyFile, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

export type SourceKind = 'article' | 'topic'

export type Source = {
  kind: SourceKind
  /** 文章模式是文件内容；主题模式就是命令行里那句话 */
  text: string
  /** 只有文章模式有来源文件 */
  file?: string
}

const DEFAULT_FILE = 'corpus/source.md'
const TOPIC_MARKER = '<!-- topic -->'

/**
 * 认文件头那行标记，认出就返回主题模式。
 *
 * 为什么需要这行标记：主题落盘时也写进 source.md（输入永远在同一个位置），
 * 但主题和文章落到同一个文件之后，光看内容就分不出来了 ——
 * 下次不带参数跑 `pnpm plan`，一句主题会被当成一篇文章，
 * 于是「自己决定讲哪几个点」那套引导就失效了。
 * 这行标记让文件**自己声明自己是什么**，判别不靠猜。
 */
export function parseSourceFile(raw: string): { kind: SourceKind; body: string } {
  const text = raw.trim()
  const lines = text.split(/\r?\n/)
  if (lines[0]?.trim() !== TOPIC_MARKER) return { kind: 'article', body: text }
  return { kind: 'topic', body: lines.slice(1).join('\n').trim() }
}

/** 文件里存的已经是主题吗？（备份时用，免得把原来那篇文章的备份挤掉） */
export function isTopicFile(raw: string): boolean {
  return parseSourceFile(raw).kind === 'topic'
}

/**
 * 命令行参数说的是一个文件，还是一句话主题？
 *
 * 纯函数：文件存不存在由调用方查好传进来 —— 这样这个判断才好单独验。
 */
export function classifyArg(arg: string, fileExists: boolean): 'article-file' | 'topic' | 'looks-like-path' {
  if (fileExists) return 'article-file'
  // 像路径却不存在 —— 多半是打错了文件名。**不猜**，直接报错，
  // 否则一个拼错的路径会被静默当成主题喂给模型。
  if (/[\\/]/.test(arg) || /\.(md|txt)$/i.test(arg)) return 'looks-like-path'
  return 'topic'
}

/**
 * 把命令行参数解析成输入。**只读，不写盘** —— 落盘是 persistTopic 的事，
 * 这样 `--dry` 才能在不动任何文件的前提下看判别结果。
 */
export async function resolveSource(args: string[]): Promise<Source> {
  const arg = args.find((a) => a !== '')

  if (arg === undefined) {
    let raw: string
    try {
      raw = await readFile(DEFAULT_FILE, 'utf8')
    } catch {
      throw new Error(
        '没有 ' + DEFAULT_FILE + '。两个办法：\n' +
          '  · 写一篇文章放进去，或者把文章路径当参数：pnpm plan corpus/你的文章.md\n' +
          '  · 直接给一句话主题：pnpm plan "Vue3 响应式原理"',
      )
    }
    const { kind, body } = parseSourceFile(raw)
    if (!body) throw new Error('输入是空的：' + path.resolve(DEFAULT_FILE))
    return kind === 'topic' ? { kind, text: body } : { kind, text: body, file: DEFAULT_FILE }
  }

  switch (classifyArg(arg, existsSync(arg))) {
    case 'article-file': {
      const text = (await readFile(arg, 'utf8')).trim()
      if (!text) throw new Error('文件是空的：' + path.resolve(arg))
      return { kind: 'article', text, file: arg }
    }
    case 'looks-like-path':
      throw new Error(
        '找不到这个文件：' + path.resolve(arg) + '\n' +
          '（如果你想讲的是一句话主题，就别带路径分隔符，也别用 .md / .txt 结尾。）',
      )
    case 'topic':
      return { kind: 'topic', text: arg }
  }
}

/**
 * 把主题写进 source.md，让输入永远躺在同一个位置。
 *
 * 返回值：这次有没有备份（调用方要拿它决定日志怎么写）。
 */
export async function persistTopic(topic: string): Promise<boolean> {
  // 只在「这次要盖掉的是一篇文章」时备份。
  // 上次跑的就是主题的话，再备一次没有意义，还会把你原来那篇文章的备份挤掉。
  const current = await readFile(DEFAULT_FILE, 'utf8').catch(() => null)
  let backedUp = false
  if (current !== null && !isTopicFile(current)) {
    await copyFile(DEFAULT_FILE, path.join(path.dirname(DEFAULT_FILE), 'source.backup.md')).catch(() => undefined)
    backedUp = true
  }
  await writeFile(DEFAULT_FILE, TOPIC_MARKER + '\n' + topic.trim() + '\n')
  return backedUp
}

/** 一行日志：这次按哪种理解跑的。看到它就知道没有暗箱。 */
export function describeSource(source: Source): string {
  return source.kind === 'topic'
    ? '主题:   ' + source.text
    : '文章:   ' + path.resolve(source.file ?? '') + '  (' + source.text.length + ' 字)'
}
