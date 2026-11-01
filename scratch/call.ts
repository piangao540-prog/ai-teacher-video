import { loadLlmConfig } from '../src/plan/generate'

const cfg = loadLlmConfig()
const res = await fetch(cfg.baseUrl + '/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + cfg.apiKey },
    body: JSON.stringify({
        model: cfg.model,
        temperature: 1.5,
        messages: [{ role: 'user', content: '用一句话解释什么是token' }],
    })
})

const json = await res.json()
console.log(json.choices[0].message.content)
console.log(json.usage)