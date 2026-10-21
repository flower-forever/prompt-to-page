import { create } from 'zustand'
import { CodeStream, extractCode } from '../shared/extract'
import { repairCode, streamForge } from './lib/api'
import type { Demo } from './lib/types'

export type Phase = 'idle' | 'thinking' | 'streaming' | 'compiling' | 'ready' | 'error' | 'repairing'
export type RepairState = 'idle' | 'running' | 'done' | 'failed'

export interface Metrics {
  ttfbMs: number | null
  firstCodeMs: number | null
  elapsedMs: number
  inputTokens: number
  outputTokens: number
  thinkingTokens: number
  tps: number
  costCny: number
  exact: boolean
}

const EMPTY_METRICS: Metrics = {
  ttfbMs: null,
  firstCodeMs: null,
  elapsedMs: 0,
  inputTokens: 0,
  outputTokens: 0,
  thinkingTokens: 0,
  tps: 0,
  costCny: 0,
  exact: false,
}

/** 元 / 百万 token */
const PRICE_IN = 1
const PRICE_OUT = 4
/** 粗略 token 估算：代码以英文为主，约 3.3 字符一个 token */
const CHARS_PER_TOKEN = 3.3
/** 回放时的时间轴预算：思考段最多 2.5s，代码段最多 15s */
const THINK_BUDGET_MS = 2500
const CODE_BUDGET_MS = 15000

let controller: AbortController | null = null
let replayTimer: number | null = null

export interface ForgeState {
  prompt: string
  code: string
  thinking: string
  phase: Phase
  source: 'live' | 'replay' | null
  error: string | null
  previewError: string | null
  repairState: RepairState
  metrics: Metrics
  running: boolean
  effort: string
  demoTitle: string | null

  setPrompt: (p: string) => void
  setEffort: (e: string) => void
  generate: () => Promise<void>
  cancel: () => void
  playDemo: (demo: Demo) => Promise<void>
  repairNow: () => Promise<void>
  setPreviewError: (msg: string | null) => void
  markCompiled: () => void
  markCompileFailed: (msg: string) => void
  loadCode: (code: string) => void
  loadDemo: (demo: Demo) => void
  reset: () => void
}

export const useForge = create<ForgeState>((set, get) => ({
  prompt: '',
  code: '',
  thinking: '',
  phase: 'idle',
  source: null,
  error: null,
  previewError: null,
  repairState: 'idle',
  metrics: EMPTY_METRICS,
  running: false,
  // 默认低思考档：实测 max 档会先思考 90 秒才开始吐代码，演示节奏会垮
  effort: 'low',
  demoTitle: null,

  setPrompt: (p) => set({ prompt: p }),
  setEffort: (e) => set({ effort: e }),

  cancel: () => {
    controller?.abort()
    controller = null
    if (replayTimer !== null) {
      clearInterval(replayTimer)
      replayTimer = null
    }
    set({ running: false, phase: get().code ? 'ready' : 'idle' })
  },

  reset: () =>
    set({
      code: '',
      thinking: '',
      phase: 'idle',
      error: null,
      previewError: null,
      repairState: 'idle',
      metrics: EMPTY_METRICS,
      demoTitle: null,
    }),

  setPreviewError: (msg) => set({ previewError: msg }),

  markCompiled: () =>
    set((s) => ({
      phase: s.running ? s.phase : 'ready',
      previewError: null,
    })),

  markCompileFailed: (msg) => set({ phase: 'error', error: msg }),

  loadCode: (code) =>
    set({
      code,
      phase: 'compiling',
      error: null,
      previewError: null,
      repairState: 'idle',
      source: null,
      demoTitle: null,
    }),

  /** 直接渲染一份录制好的成品（首屏用），并把录制时的指标也填上 */
  loadDemo: (demo) => {
    const codeText = extractCode(
      demo.events
        .filter((e) => e.type === 'code')
        .map((e) => e.text)
        .join(''),
    )
    const elapsed = demo.durationMs ?? (demo.events.length ? demo.events[demo.events.length - 1].t : 0)
    const chars = demo.events.reduce((n, e) => n + e.text.length, 0)
    const est = demo.usage?.output ?? Math.round(chars / CHARS_PER_TOKEN)
    set({
      code: codeText,
      phase: 'compiling',
      error: null,
      previewError: null,
      repairState: 'idle',
      source: 'replay',
      demoTitle: demo.title,
      prompt: demo.prompt,
      metrics: {
        ttfbMs: elapsed,
        firstCodeMs: elapsed,
        elapsedMs: elapsed,
        inputTokens: demo.usage?.input ?? 0,
        outputTokens: est,
        thinkingTokens: demo.usage?.thinking ?? 0,
        tps: elapsed > 0 ? est / (elapsed / 1000) : 0,
        costCny: ((demo.usage?.input ?? 0) * PRICE_IN + est * PRICE_OUT) / 1e6,
        exact: Boolean(demo.usage),
      },
    })
  },

  generate: async () => {
    const { prompt, effort, running } = get()
    if (running) return
    const p = prompt.trim()
    if (!p) return

    controller?.abort()
    const ctl = new AbortController()
    controller = ctl

    const extractor = new CodeStream()
    const t0 = performance.now()
    let firstTextAt: number | null = null
    let codeAt: number | null = null
    let est = 0
    // 高频增量做节流：模型能到 200+ TPS，逐帧 setState 会把主线程打满
    let codeBuf = ''
    let thinkBuf = ''
    let lastFlush = 0

    const flush = (force = false) => {
      const now = performance.now()
      if (!force && now - lastFlush < 60) return
      lastFlush = now
      const patch: Partial<ForgeState> = {}
      if (codeBuf) {
        patch.code = extractor.push(codeBuf)
        codeBuf = ''
      }
      if (thinkBuf) {
        patch.thinking = get().thinking + thinkBuf
        thinkBuf = ''
      }
      if (Object.keys(patch).length) set(patch)
    }

    set({
      running: true,
      phase: 'thinking',
      code: '',
      thinking: '',
      error: null,
      previewError: null,
      repairState: 'idle',
      source: 'live',
      demoTitle: null,
      metrics: EMPTY_METRICS,
    })

    const tick = setInterval(() => {
      const now = performance.now()
      const m = get().metrics
      const elapsed = now - t0
      const tps = codeAt ? est / ((now - codeAt) / 1000) : 0
      const cost = (m.inputTokens * PRICE_IN + est * PRICE_OUT) / 1e6
      set({ metrics: { ...m, elapsedMs: elapsed, tps, costCny: cost } })
    }, 120)

    try {
      for await (const evt of streamForge(p, { effort, signal: ctl.signal })) {
        const now = performance.now()
        switch (evt.type) {
          case 'thinking': {
            if (firstTextAt === null) {
              firstTextAt = now
              set({ phase: 'thinking', metrics: { ...get().metrics, ttfbMs: now - t0 } })
            }
            thinkBuf += evt.text
            flush()
            break
          }
          case 'code': {
            if (codeAt === null) {
              codeAt = now
              set({
                phase: 'streaming',
                metrics: {
                  ...get().metrics,
                  ttfbMs: get().metrics.ttfbMs ?? now - t0,
                  firstCodeMs: now - t0,
                },
              })
            }
            est += Math.max(1, Math.round(evt.text.length / CHARS_PER_TOKEN))
            codeBuf += evt.text
            flush()
            break
          }
          case 'usage': {
            const elapsed = now - t0
            const tps = elapsed > 0 ? evt.output / (elapsed / 1000) : 0
            const cost = (evt.input * PRICE_IN + evt.output * PRICE_OUT) / 1e6
            set({
              metrics: {
                ...get().metrics,
                inputTokens: evt.input,
                outputTokens: evt.output,
                thinkingTokens: evt.thinking,
                elapsedMs: elapsed,
                tps,
                costCny: cost,
                exact: true,
              },
            })
            break
          }
          case 'done': {
            set({ phase: 'compiling' })
            break
          }
          case 'error': {
            set({ phase: 'error', error: evt.message })
            break
          }
          default:
            break
        }
      }
      flush(true)
      if (get().phase === 'streaming' || get().phase === 'thinking') {
        set({ phase: 'compiling' })
      }
    } catch (err) {
      if (!ctl.signal.aborted) {
        set({ phase: 'error', error: (err as Error).message })
      }
    } finally {
      clearInterval(tick)
      if (controller === ctl) controller = null
      set({ running: false })
    }
  },

  /** 回放录制好的真实 token 流（无 key / 断网时的兜底） */
  playDemo: async (demo) => {
    controller?.abort()
    if (replayTimer !== null) clearInterval(replayTimer)

    // 时间轴压缩：真实录制里思考段可能长达一分钟，回放要压到能看的节奏
    const firstCode = demo.events.find((e) => e.type === 'code')?.t ?? 0
    const total = demo.events.length ? demo.events[demo.events.length - 1].t : 0
    const thinkScale = firstCode > THINK_BUDGET_MS ? THINK_BUDGET_MS / firstCode : 1
    const codeSpan = Math.max(0, total - firstCode)
    const codeScale = codeSpan > CODE_BUDGET_MS ? CODE_BUDGET_MS / codeSpan : 1
    const timeline = demo.events.map((e) => ({
      ...e,
      t: e.t < firstCode ? e.t * thinkScale : THINK_BUDGET_MS + (e.t - firstCode) * codeScale,
    }))

    const extractor = new CodeStream()
    const t0 = performance.now()
    let index = 0
    let est = 0

    set({
      running: true,
      phase: 'thinking',
      code: '',
      thinking: '',
      error: null,
      previewError: null,
      repairState: 'idle',
      source: 'replay',
      demoTitle: demo.title,
      prompt: demo.prompt,
      metrics: EMPTY_METRICS,
    })

    await new Promise<void>((resolve) => {
      replayTimer = window.setInterval(() => {
        const elapsed = performance.now() - t0
        while (index < timeline.length && timeline[index].t <= elapsed) {
          const ev = timeline[index++]
          if (ev.type === 'thinking') {
            set({ thinking: get().thinking + ev.text })
          } else {
            est += Math.max(1, Math.round(ev.text.length / CHARS_PER_TOKEN))
            set({ code: extractor.push(ev.text), phase: 'streaming' })
          }
        }
        const m = get().metrics
        set({
          metrics: {
            ...m,
            elapsedMs: elapsed,
            ttfbMs: m.ttfbMs ?? elapsed,
            firstCodeMs: m.firstCodeMs ?? elapsed,
            tps: est / (elapsed / 1000),
            costCny: (m.inputTokens * PRICE_IN + est * PRICE_OUT) / 1e6,
          },
        })
        if (index >= timeline.length) {
          if (replayTimer !== null) clearInterval(replayTimer)
          replayTimer = null
          set({ running: false, phase: 'compiling' })
          resolve()
        }
      }, 40)
    })
  },

  /** 把报错喂回模型，让它自己改 —— 演示 Agent 闭环的关键一步 */
  repairNow: async () => {
    const { code, previewError, error, running } = get()
    const message = previewError ?? error
    if (!code || !message || running) return

    set({ repairState: 'running', phase: 'repairing', error: null, previewError: null })
    try {
      const fixed = await repairCode(code, message)
      set({ code: fixed, repairState: 'done', phase: 'compiling' })
    } catch (err) {
      set({ repairState: 'failed', phase: 'error', error: (err as Error).message })
    }
  },
}))
