type Msg = {role: 'system' | 'user' | 'assistant'; content: string}

const messages: Msg[] = [
    {role: 'system', content: '你只输出JSON，不要解释'},
    {role: 'user', content: '把这句话转换为JSON：今天下雨'},
]

const reply = '{"weather": "rain"}'

console.log(messages.length, messages.map(m => m.role + ':' + m.content))