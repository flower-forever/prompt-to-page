import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import fs from 'node:fs/promises'
import path from 'node:path'
import 'dotenv/config'
import { extractCode } from '../shared/extract'
import { REPAIR_PROMPT, SYSTEM_PROMPT, buildUserPrompt } from './prompt'

const PORT = Number(process.env.PORT ?? 8787)
const API_KEY = process.env.MINIMAX_API_KEY ?? ''
const BASE_URL = process.env.MINIMAX_BASE_URL ?? 'https://api.minimaxi.com/anthropic'
const MODEL = process.env.MINIMAX_MODEL ?? 'MiniMax-M3.1-Flash'
const MAX_TOKENS = Number(process.env.MINIMAX_MAX_TOKENS ?? 40000)
const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const

/** 定价（元 / 百万 token）：输入 1，输出 4，缓存读 0.1 */
const PRICE = { input: 1, output: 4, cacheRead: 0.1 }

type ForgeEvent =
  | { type: 'start'; id: string; model: string }
  | { type: 'thinking'; text: string }
  | { type: 'code'; text: string }
  | { type: 'usage'; input: number; output: number; thinking: number }
  | { type: 'done'; stopReason: string; durationMs: number }
  | { type: 'error'; message: string }

const app = new Hono()

// ── 简易限流（按 IP） ─────────────────────────────────────────
const hits = new Map<string, number[]>()
function rateLimited(ip: string, limit = 20, windowMs = 60_000): boolean {
  const now = Date.now()
  const list = (hits.get(ip) ?? []).filter((t) => now - t < windowMs)
  list.push(now)
  hits.set(ip, list)
  return list.length > limit
}

// ── 上游调用：把 Anthropic 兼容事件翻译成前端协议 ────────────────
async function* upstream(
  body: Record<string, unknown>,
  signal: AbortSignal,
): AsyncGenerator<ForgeEvent> {
  const res = await fetch(`${BASE_URL}/v1/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      'Content-Type': 'application/json',
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
    signal,
  })
  if (!res.ok || !res.body) {
    const detail = await res.text().catch(() => '')
    throw new Error(`上游返回 ${res.status}：${detail.slice(0, 300) || res.statusText}`)
  }

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
      const raw = line.slice(5).trim()
      if (!raw || raw === '[DONE]') continue
      let evt: Record<string, any>
      try {
        evt = JSON.parse(raw)
      } catch {
        continue
      }
      for (const mapped of mapEvent(evt)) yield mapped
    }
  }
}

function mapEvent(evt: Record<string, any>): ForgeEvent[] {
  const out: ForgeEvent[] = []
  switch (evt.type) {
    case 'message_start':
      out.push({ type: 'start', id: evt.message?.id ?? '', model: evt.message?.model ?? MODEL })
      break
    case 'content_block_delta': {
      const d = evt.delta ?? {}
      if (d.type === 'text_delta' && d.text) out.push({ type: 'code', text: d.text })
      else if (d.type === 'thinking_delta' && d.thinking) out.push({ type: 'thinking', text: d.thinking })
      break
    }
    case 'message_delta': {
      const u = evt.usage
      if (u) {
        out.push({
          type: 'usage',
          input: u.input_tokens ?? 0,
          output: u.output_tokens ?? 0,
          thinking: u.output_tokens_details?.thinking_tokens ?? 0,
        })
      }
      if (evt.delta?.stop_reason) {
        out.push({ type: 'done', stopReason: evt.delta.stop_reason, durationMs: 0 })
      }
      break
    }
    case 'error':
      out.push({ type: 'error', message: evt.error?.message ?? '上游返回错误' })
      break
    default:
      break
  }
  return out
}

// ── 路由 ──────────────────────────────────────────────────────
app.get('/api/health', (c) =>
  c.json({
    ok: true,
    hasKey: Boolean(API_KEY),
    model: MODEL,
    baseUrl: BASE_URL,
    pricing: PRICE,
  }),
)

app.get('/api/demos', async (c) => {
  const dir = path.join(process.cwd(), 'public', 'demos')
  try {
    const files = await fs.readdir(dir)
    const demos = []
    for (const f of files.filter((f) => f.endsWith('.json'))) {
      const raw = await fs.readFile(path.join(dir, f), 'utf8')
      const parsed = JSON.parse(raw)
      demos.push({ id: parsed.id, title: parsed.title, prompt: parsed.prompt })
    }
    return c.json({ demos })
  } catch {
    return c.json({ demos: [] })
  }
})

app.post('/api/stream', async (c) => {
  const body = await c.req
    .json<{ prompt?: string; effort?: string }>()
    .catch(() => ({ prompt: undefined, effort: undefined }))
  const prompt = (body.prompt ?? '').trim()
  if (!prompt) return c.json({ error: 'prompt 不能为空' }, 400)
  if (!API_KEY) return c.json({ error: '服务端未配置 MINIMAX_API_KEY，请看 README' }, 503)

  const ip = c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || 'local'
  if (rateLimited(ip)) return c.json({ error: '请求过于频繁，请稍后再试' }, 429)

  const effort = EFFORTS.includes(body.effort as (typeof EFFORTS)[number])
    ? (body.effort as string)
    : 'max'

  return streamSSE(c, async (stream) => {
    const controller = new AbortController()
    stream.onAbort(() => controller.abort())
    const t0 = Date.now()
    try {
      for await (const evt of upstream(
        {
          model: MODEL,
          max_tokens: MAX_TOKENS,
          stream: true,
          output_config: { effort },
          system: SYSTEM_PROMPT,
          messages: [{ role: 'user', content: buildUserPrompt(prompt) }],
        },
        controller.signal,
      )) {
        if (evt.type === 'done') evt.durationMs = Date.now() - t0
        await stream.writeSSE({ data: JSON.stringify(evt) })
      }
    } catch (err) {
      const message = controller.signal.aborted ? '已取消' : (err as Error).message
      await stream.writeSSE({ data: JSON.stringify({ type: 'error', message } satisfies ForgeEvent) })
    }
  })
})

app.post('/api/repair', async (c) => {
  const body = await c.req
    .json<{ code?: string; error?: string }>()
    .catch(() => ({ code: undefined, error: undefined }))
  if (!API_KEY) return c.json({ error: '服务端未配置 MINIMAX_API_KEY' }, 503)
  if (!body.code || !body.error) return c.json({ error: '缺少 code 或 error' }, 400)

  const ip = c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || 'local'
  if (rateLimited(ip, 30)) return c.json({ error: '请求过于频繁' }, 429)

  try {
    const res = await fetch(`${BASE_URL}/v1/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        'Content-Type': 'application/json',
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        output_config: { effort: 'medium' },
        system: REPAIR_PROMPT.replace('{error}', body.error).replace('{code}', body.code),
        messages: [{ role: 'user', content: '请输出修复后的完整代码。' }],
      }),
    })
    if (!res.ok) throw new Error(`上游返回 ${res.status}`)
    const json = await res.json()
    const text: string =
      json?.content?.find((b: { type: string }) => b.type === 'text')?.text ?? ''
    return c.json({ code: extractCode(text) })
  } catch (err) {
    return c.json({ error: (err as Error).message }, 502)
  }
})

// 生产环境下同时托管前端静态资源
app.use('/assets/*', serveStatic({ root: './dist' }))
app.use('/vendor/*', serveStatic({ root: './dist' }))
app.use('/demos/*', serveStatic({ root: './dist' }))
app.get('/*', serveStatic({ path: './dist/index.html' }))

serve({ fetch: app.fetch, port: PORT }, (info) => {
  console.log(`[forge] API  http://127.0.0.1:${info.port}`)
  console.log(`[forge] 模型 ${MODEL} @ ${BASE_URL}  key=${API_KEY ? '已配置' : '缺失'}`)
})
