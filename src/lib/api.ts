import type { Demo, ForgeEvent, HealthInfo } from './types'

export async function* streamForge(
  prompt: string,
  opts: { effort?: string; signal?: AbortSignal },
): AsyncGenerator<ForgeEvent> {
  const res = await fetch('/api/stream', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, effort: opts.effort ?? 'max' }),
    signal: opts.signal,
  })

  if (!res.ok) {
    const detail = await res.json().catch(() => ({}) as { error?: string })
    throw new Error(detail.error || `请求失败（${res.status}）`)
  }
  if (!res.body) throw new Error('浏览器不支持流式响应')

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buf = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    const chunks = buf.split('\n\n')
    buf = chunks.pop() ?? ''
    for (const chunk of chunks) {
      for (const line of chunk.split('\n')) {
        if (!line.startsWith('data:')) continue
        const raw = line.slice(5).trim()
        if (!raw) continue
        try {
          yield JSON.parse(raw) as ForgeEvent
        } catch {
          /* 忽略坏帧 */
        }
      }
    }
  }
}

export async function repairCode(code: string, error: string): Promise<string> {
  const res = await fetch('/api/repair', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code, error }),
  })
  const json = (await res.json()) as { code?: string; error?: string }
  if (!res.ok || !json.code) throw new Error(json.error || '修复失败')
  return json.code
}

export async function fetchHealth(): Promise<HealthInfo | null> {
  try {
    const res = await fetch('/api/health')
    if (!res.ok) return null
    return (await res.json()) as HealthInfo
  } catch {
    return null
  }
}

export async function fetchDemo(id: string): Promise<Demo | null> {
  try {
    const res = await fetch(`/demos/${id}.json`)
    if (!res.ok) return null
    return (await res.json()) as Demo
  } catch {
    return null
  }
}

export async function fetchDemoList(): Promise<{ id: string; title: string; prompt: string }[]> {
  try {
    const res = await fetch('/api/demos')
    if (!res.ok) return []
    const json = (await res.json()) as { demos: { id: string; title: string; prompt: string }[] }
    return json.demos
  } catch {
    return []
  }
}
