import { loadLlmConfig } from "../src/plan/generate"
import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'

const readFileTool = {
    type: 'function',
    function: {
        name: 'readFile',
        description: '读取项目内的一个文件的全部内容，需要查看实际内容时，不列目录，不读二进制',
        parameters: {
            type: 'object',
            properties: {
                path: { type: 'string', description: '相对于项目的根目录的路径' },
            },
            required: ['path'],
            additionalProperties: false,
        }
    }
}

const listDirTool = {
    type: 'function',
    function: {
        name: 'listDir',
        description: '列出一个目录下有哪些文件，需要查看目录下的文件时，不读文件，不读二进制',
        parameters: {
            type: 'object',
            properties: {
                path: { type: 'string', description: '相对于项目的根目录的路径' },
            },
            required: ['path'],
            additionalProperties: false,
        }
    }
}

const cfg = loadLlmConfig()
const messages: any[] = [
    { role: 'user', content: '读一下 corpus/report.md 的开头，告诉我它写了什么' },
]
const tools = [readFileTool, listDirTool]



// → 逐个执行
for (let step = 1; step <= 10; step++) {
    const r = await fetch(cfg.baseUrl + '/chat/completions', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: 'Bearer ' + cfg.apiKey },
        body: JSON.stringify({
            model: cfg.model,
            temperature: 0,
            messages,
            tools
        })
    })
    if (!r.ok) {                              // ← 先检查，再解析
        console.error('接口返回', r.status, (await r.text()).slice(0, 500))
        break
    }
    const j = await r.json()
    const msg = j.choices[0].message

    console.log(`--- 第 ${step} 轮，finish_reason: ${j.choices[0].finish_reason}`)
    messages.push(msg)                       // ← 每一轮都要塞回去，不只第一轮

    if (!msg.tool_calls?.length) {           // ← 终止条件
        console.log(msg.content)
        break
    }

    for (const call of msg.tool_calls) {
        const args = JSON.parse(call.function.arguments)
        let content: string

        try {
            content = call.function.name === 'readFile'
                ? await readFile(path.resolve(args.path), 'utf8')
                : (await readdir(path.resolve(args.path))).join('\n')
        } catch (e) {
            content = '工具执行失败：' + (e as Error).message   // 失败也是"结果"
        }

        messages.push({ role: 'tool', tool_call_id: call.id, content })   // ← 只此一处
    }

}



