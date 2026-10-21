/**
 * 录制一次真实的生成过程，存成回放文件。
 *
 * 用法：
 *   npm run record -- "做一个深色的播客订阅页" podcast
 *
 * 产出 public/demos/<id>.json：
 *   - code   最终完整代码（带 ```tsx 围栏），用于首屏直接渲染
 *   - events 带时间戳的增量事件，用于「回放模式」
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import 'dotenv/config'
import { extractCode } from '../shared/extract'
import { SYSTEM_PROMPT, buildUserPrompt } from '../server/prompt'

const prompt = process.argv[2]
const id = process.argv[3] ?? 'demo'
const title = process.argv[4] ?? id
const effort = process.env.RECORD_EFFORT ?? 'max'

if (!prompt) {
  console.error('用法: npm run record -- "<prompt>" <id> [title]')
  process.exit(1)
}

const key = process.env.MINIMAX_API_KEY
if (!key) {
  console.error('缺少 MINIMAX_API_KEY')
  process.exit(1)
}

const base = process.env.MINIMAX_BASE_URL ?? 'https://api.minimaxi.com/anthropic'
const model = process.env.MINIMAX_MODEL ?? 'MiniMax-M3.1-Flash'

const t0 = Date.now()
const res = await fetch(`${base}/v1/messages`, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
    'anthropic-version': '2023-06-01',
  },
  body: JSON.stringify({
    model,
    max_tokens: 40000,
    stream: true,
    output_config: { effort },
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: buildUserPrompt(prompt) }],
  }),
})

if (!res.ok || !res.body) {
  console.error('请求失败', res.status, await res.text())
  process.exit(1)
}

type DemoEvent = { t: number; type: 'thinking' | 'code'; text: string }
const events: DemoEvent[] = []
let raw = ''
let usage = { input: 0, output: 0, thinking: 0 }

const reader = res.body.getReader()
const decoder = new TextDecoder()
let buf = ''

while (true) {
  const { done, value } = await reader.read()
  if (done) break
  buf += decoder.decode(value, { stream: true })
  const parts = buf.split('\n\n')
  buf = parts.pop() ?? ''
  for (const part of parts) {
    const line = part.split('\n').find((l) => l.startsWith('data:'))
    if (!line) continue
    const payload = line.slice(5).trim()
    if (!payload || payload === '[DONE]') continue
    let evt: any
    try {
      evt = JSON.parse(payload)
    } catch {
      continue
    }
    const t = Date.now() - t0
    if (evt.type === 'content_block_delta') {
      const d = evt.delta ?? {}
      if (d.type === 'thinking_delta' && d.thinking) {
        events.push({ t, type: 'thinking', text: d.thinking })
      } else if (d.type === 'text_delta' && d.text) {
        events.push({ t, type: 'code', text: d.text })
        raw += d.text
      }
    } else if (evt.type === 'message_delta' && evt.usage) {
      usage = {
        input: evt.usage.input_tokens ?? 0,
        output: evt.usage.output_tokens ?? 0,
        thinking: evt.usage.output_tokens_details?.thinking_tokens ?? 0,
      }
    }
  }
}

const dir = path.join(process.cwd(), 'public', 'demos')
await fs.mkdir(dir, { recursive: true })
const file = path.join(dir, `${id}.json`)
await fs.writeFile(
  file,
  JSON.stringify(
    {
      id,
      title,
      prompt,
      code: `\`\`\`tsx\n${extractCode(raw)}\n\`\`\``,
      recordedAt: new Date().toISOString(),
      usage,
      durationMs: Date.now() - t0,
      events,
    },
    null,
    2,
  ),
  'utf8',
)

console.log(`已录制 ${file}`)
console.log(`  事件 ${events.length} 条 · 用时 ${((Date.now() - t0) / 1000).toFixed(1)}s`)
