export type ForgeEvent =
  | { type: 'start'; id: string; model: string }
  | { type: 'thinking'; text: string }
  | { type: 'code'; text: string }
  | { type: 'usage'; input: number; output: number; thinking: number }
  | { type: 'done'; stopReason: string; durationMs: number }
  | { type: 'error'; message: string }

export interface DemoEvent {
  t: number
  type: 'thinking' | 'code'
  text: string
}

export interface Demo {
  id: string
  title: string
  prompt: string
  code: string
  usage?: { input: number; output: number; thinking: number }
  durationMs?: number
  events: DemoEvent[]
}

export interface HealthInfo {
  ok: boolean
  hasKey: boolean
  model: string
  baseUrl: string
  pricing: { input: number; output: number; cacheRead: number }
}
