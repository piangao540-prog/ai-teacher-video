<script setup lang="ts">
// 「输入一句话 → 生成剧本 → 配音 → 切时间轴」的面板，挂在播放器上方。
//
// 它只做显示和转发：请求交给 POST /api/plan（或 /api/render），
// 进度和结果从 SSE 流里读回来。密钥、写盘、调模型、起 TTS 子进程全在 Node 侧
// —— 浏览器这一侧没有、也不该有任何秘密。
//
// 格式（讲稿 + 逐行对照）是**服务端拼好的整块文本**，这里原样塞进 <pre>。
// 这是刻意的：先跑通，别一上来就做结构化渲染 —— 让 CLI 和页面印的是同一份东西，
// 才不会出现「命令行看着对、页面看着不对」。

import { nextTick, ref, watch } from 'vue'

type ServerMsg =
  | { type: 'log'; line: string; level?: 'info' | 'warn' }
  | { type: 'done'; attempt: number; summary: string[]; review: string; stale: string[] }
  | { type: 'fail'; problems: string[] }

type Done = Extract<ServerMsg, { type: 'done' }>

const topic = ref('')
const busy = ref(false)
const logs = ref<string[]>([])
const done = ref<Done | null>(null)
const failed = ref<string[]>([])

const logBox = ref<HTMLElement | null>(null)

// 日志一直往下走，停在顶部会让人以为卡住了
watch(
  () => logs.value.length,
  async () => {
    await nextTick()
    const el = logBox.value
    if (el) el.scrollTop = el.scrollHeight
  },
)

function apply(msg: ServerMsg): void {
  if (msg.type === 'log') logs.value.push(msg.line)
  else if (msg.type === 'done') done.value = msg
  else failed.value = msg.problems
}

/** POST 一个端点，把 SSE 一路读到底。
 *
 *  POST 不能用 EventSource，所以自己按 SSE 的规矩切：一条消息以空行结束，
 *  数据在 `data: ` 后面（一行一条 JSON）。 */
async function streamFrom(path: string, body: unknown): Promise<void> {
  if (busy.value) return
  busy.value = true
  logs.value = []
  done.value = null
  failed.value = []

  try {
    const res = await fetch(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })

    if (res.status === 409) {
      failed.value = ['上一次还在跑，等它跑完再来。']
      return
    }
    if (!res.ok || !res.body) {
      failed.value = ['端点出错：HTTP ' + res.status]
      return
    }

    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buf = ''

    for (;;) {
      const { value, done: eof } = await reader.read()
      if (eof) break
      buf += decoder.decode(value, { stream: true })

      let cut = buf.indexOf('\n\n')
      while (cut >= 0) {
        const block = buf.slice(0, cut)
        buf = buf.slice(cut + 2)
        for (const line of block.split('\n')) {
          if (line.startsWith('data: ')) apply(JSON.parse(line.slice(6)) as ServerMsg)
        }
        cut = buf.indexOf('\n\n')
      }
    }
  } catch (e) {
    failed.value = ['连不上端点：' + String(e)]
  } finally {
    busy.value = false
  }
}

async function run(): Promise<void> {
  const text = topic.value.trim()
  if (!text) return
  await streamFrom('/api/plan', { topic: text })
}

/** 剧本没动，只重跑配音和时间轴（配音失败时用这个，不用把模型再烧一遍）。 */
async function rerender(): Promise<void> {
  await streamFrom('/api/render', {})
}

/** 模板里拿不到 `window.location`（作用域是组件实例），包一层。 */
function reload(): void {
  window.location.reload()
}
</script>

<template>
  <div class="plan">
    <form class="ask" @submit.prevent="run">
      <input
        v-model="topic"
        type="text"
        placeholder="一句话主题，例如：Vue3 响应式原理"
        :disabled="busy"
      />
      <button type="submit" :disabled="busy || !topic.trim()">
        {{ busy ? '跑着呢…' : '生成' }}
      </button>
      <button type="button" class="ghost" :disabled="busy" title="剧本不动，只重跑配音和时间轴" @click="rerender">
        只重配音
      </button>
    </form>

    <p class="note">
      一句话 → 剧本 → 配音 → 时间轴，一步到位；好了就能在下面播放。
      生成几十秒 + 配音半分钟，下面会实时打日志。<b>出片（mp4）不在这里</b>，还在终端里跑
      <code>pnpm video</code>。
    </p>

    <pre v-if="logs.length" ref="logBox" class="logs">{{ logs.join('\n') }}</pre>

    <div v-if="failed.length" class="box fail">
      <div class="head">✗ 没跑完</div>
      <pre>{{ failed.join('\n') }}</pre>
    </div>

    <div v-if="done" class="box ok">
      <pre v-if="done.summary.length" class="summary">{{ done.summary.join('\n') }}</pre>

      <!-- stale 是**服务端算好的几行人话**（判据在 render/artifacts.ts），
           不是这里的布尔值。分成「是旧的」和「不知道是哪一版」两种说法 ——
           加指纹之前生成的产物属于后者，说成「旧的」是在冤枉它。 -->
      <p v-if="done.stale.length" class="stale">
        ⚠ 剧本换了，但<b>下面播的还不是这一版</b>。<br />
        <span v-for="(line, i) in done.stale" :key="i" class="edge">{{ line }}</span>
      </p>
      <p v-else class="ready">
        ✓ 配音和时间轴都刷新了。<b>刷新页面</b>就能在下面听到、看到这一版。
        <button type="button" class="ghost" @click="reload">刷新页面</button>
      </p>

      <template v-if="done.review">
        <p class="remind">
          校验只管结构（段号、长度、画面装不装得下）。<b>「这句话说的是不是这一行」机器判不了</b>
          —— 下面这份要逐行读，带 ⚠ 的先看。
        </p>

        <details open>
          <summary>讲稿 + 逐行对照</summary>
          <pre class="review">{{ done.review }}</pre>
        </details>
      </template>
    </div>
  </div>
</template>

<style scoped>
.plan {
  width: 960px;
  margin: 0 auto;
  padding: 24px 0 8px;
  font-family: system-ui, sans-serif;
  color: #ddd;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.ask {
  display: flex;
  gap: 8px;
}
.ask input {
  flex: 1;
  padding: 10px 12px;
  font-size: 15px;
  color: #eee;
  background: #1c1c1c;
  border: 1px solid #3a3a3a;
  border-radius: 8px;
  outline: none;
}
.ask input:focus {
  border-color: #5a7;
}
.ask button {
  padding: 10px 20px;
  font-size: 15px;
  color: #eaeaea;
  background: #2c5c46;
  border: 1px solid #3d7a5e;
  border-radius: 8px;
  cursor: pointer;
}
.ask button:disabled {
  opacity: 0.5;
  cursor: default;
}
.ghost {
  background: transparent !important;
  border-color: #444 !important;
  color: #aaa !important;
  font-size: 13px !important;
  padding: 4px 10px !important;
}
.note {
  margin: 0;
  font-size: 13px;
  color: #888;
}
.logs {
  margin: 0;
  padding: 12px;
  max-height: 260px;
  overflow-y: auto;
  background: #161616;
  border: 1px solid #2a2a2a;
  border-radius: 8px;
  font-size: 13px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
}
.box {
  padding: 12px 14px;
  border-radius: 8px;
  border: 1px solid #2a2a2a;
  background: #161616;
  font-size: 14px;
}
.box pre {
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
  font-size: 13px;
  line-height: 1.6;
}
.box .head {
  margin-bottom: 6px;
}
.fail {
  border-color: #6b2b2b;
}
.ok {
  border-color: #2f6b46;
}
.summary {
  color: #cfe9d8;
}
.stale,
.ready {
  margin: 10px 0 0;
  padding: 8px 10px;
  font-size: 13px;
  line-height: 1.7;
}
.stale {
  border-left: 3px solid #b8860b;
  background: #241f10;
  color: #e6cf95;
}
.ready {
  border-left: 3px solid #2f6b46;
  background: #10201a;
  color: #b9e0cb;
}
.remind {
  margin: 10px 0 0;
  font-size: 13px;
  color: #999;
  line-height: 1.7;
}
.stale .edge {
  display: block;
  margin-top: 2px;
  font-family: ui-monospace, Consolas, monospace;
  font-size: 12px;
  color: #c9ab63;
}
.stale b,
.remind b,
.ready b {
  color: #eee;
}
code {
  padding: 1px 5px;
  background: #000;
  border-radius: 4px;
  font-size: 12px;
}
details {
  margin-top: 10px;
}
summary {
  cursor: pointer;
  font-size: 13px;
  color: #bbb;
}
.review {
  margin: 8px 0 0;
  max-height: 420px;
  overflow-y: auto;
  white-space: pre-wrap;
  word-break: break-word;
  font-size: 13px;
  line-height: 1.6;
  color: #ccc;
}
</style>
