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
/** 回放时的时间轴预算：思考段最多 2.5s */
const THINK_BUDGET_MS = 2500
/**
 * 回放代码段的速率天花板（字符/秒）。
 * 以「一屏约 30 行 × 55 字符 ≈ 1650 字符」计，700 字符/秒 ≈ 每秒 0.42 屏，
 * 慢到这个程度眼睛才跟得住最新流出的代码。
 * 只减速、不加速：真实速率低于它的录制件保持原速，只有更快的才被摊开。
 */
const REPLAY_MAX_CPS = 700
/**
 * 代码段时长上限，也是回放节奏的实际决定者。
 * 真实生成能到七八十秒，回放没法照搬；两份现有录制件的真实速率
 * （481 / 414 字符/秒）都低于天花板，所以起作用的是这个上限：
 * 788 行的 landing 被压到 30s，153 行的番茄钟基本原速（13.4s）。
 * 代价是会反过来突破天花板（1211 > 700）——演示必须有终点，
 * 超大件仍会偏快，这是刻意留的权衡。
 */
const CODE_MAX_MS = 30000
/**
 * 代码段时间轴的平滑比例（0 = 完全保留真实节奏，1 = 完全按字符匀速）。
 * 真实流突发明显（landing 峰均比 1.8），等比压缩会把起伏一起放大；
 * 掺入匀速轴压平峰值（0.83 屏/秒 vs 原实现 2.20），但保留一点真实节奏，
 * 不至于像打字机那样机械。
 */
const REPLAY_SMOOTHING = 0.75

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

    // 时间轴重排。
    // 原做法是给代码段一个固定预算（15s）、整段等比压缩 —— 于是代码量和观感直接挂钩：
    // 788 行的 landing 被压到 2422 字符/秒（2.2 屏/秒），153 行的番茄钟却只有 414 字符/秒。
    // 改成速率天花板 + 时长上限后，landing 峰值降到 0.83 屏/秒，
    // 两者的速率差距从 5.9 倍收窄到 2.9 倍（行速 6.9 → 2.9 倍）；
    // 但时长上限会让超大件突破天花板（1211 > 700），所以并未完全拉平 —— 演示必须有终点。
    const firstCode = demo.events.find((e) => e.type === 'code')?.t ?? 0
    const total = demo.events.length ? demo.events[demo.events.length - 1].t : 0
    const codeSpan = Math.max(0, total - firstCode)
    const codeChars = demo.events.reduce(
      (n, e) => (e.type === 'code' ? n + e.text.length : n),
      0,
    )
    // 时长取「真实时长」与「按速率天花板摊开所需时长」的较大者 —— 即只减速、不加速；
    // 再受时长上限约束，避免真实生成七八十秒的录制件原速回放。
    const wantedMs = Math.max(codeSpan, (codeChars / REPLAY_MAX_CPS) * 1000)
    const codeBudget = Math.min(wantedMs, CODE_MAX_MS)
    const codeScale = codeSpan > 0 && codeSpan > codeBudget ? codeBudget / codeSpan : 1

    // 字符进度 → 时间。真实流的速率本就不均匀（landing 峰均比 1.8），
    // 等比压缩会把这种起伏一起放大，所以掺入匀速轴把峰值压平（见 REPLAY_SMOOTHING）。
    const thinkScale = firstCode > THINK_BUDGET_MS ? THINK_BUDGET_MS / firstCode : 1
    let charsBefore = 0
    const timeline = demo.events.map((e) => {
      if (e.type === 'thinking') return { ...e, t: e.t * thinkScale }
      // 用事件「吐出前」的进度定位：字符是这一段逐渐出现的，
      // 若按吐出后算，每段的起始时刻会被自己推后，整体节奏偏慢。
      const linear = codeChars > 0 ? (charsBefore / codeChars) * (codeSpan * codeScale) : 0
      const scaled = (e.t - firstCode) * codeScale
      charsBefore += e.text.length
      return {
        ...e,
        t: THINK_BUDGET_MS + linear * REPLAY_SMOOTHING + scaled * (1 - REPLAY_SMOOTHING),
      }
    })

    // HUD 指标必须来自录制时的真实数据，不能用回放墙钟算。
    // 原实现按回放耗时算 TPS：时间轴压到 17.5s 时算出 615，而真实只有 131 ——
    // 演示的核心数字被自己改成了假的。这里把回放进度映射回真实时间轴，
    // 终态与首屏 loadDemo 完全一致，回放结束时数字不会跳。
    const playTotalMs = timeline.length ? timeline[timeline.length - 1].t : 0
    const playCodeMs = Math.max(0, playTotalMs - THINK_BUDGET_MS)
    const realOutput = demo.usage?.output ?? Math.round(codeChars / CHARS_PER_TOKEN)
    const realInput = demo.usage?.input ?? 0
    const realThinking = demo.usage?.thinking ?? 0
    // 真实总时长含最后一段事件之后的收尾（durationMs 比末事件晚约 200ms），
    // 用它做终点，回放结束时的耗时 / token / 成本才与首屏一致。
    const realTotalMs = demo.durationMs ?? total

    /** 回放墙钟 → 录制时的真实时刻（分段映射：思考段、代码段各自线性还原） */
    const toRealClock = (ms: number) => {
      if (ms <= THINK_BUDGET_MS) return (ms / THINK_BUDGET_MS) * firstCode
      const into = playCodeMs > 0 ? (ms - THINK_BUDGET_MS) / playCodeMs : 1
      return firstCode + into * Math.max(0, realTotalMs - firstCode)
    }

    const extractor = new CodeStream()
    const t0 = performance.now()
    let index = 0
    let emittedChars = 0

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
      metrics: {
        ...EMPTY_METRICS,
        inputTokens: realInput,
        thinkingTokens: realThinking,
        // 首字延迟取录制时的真实值：回放里思考段被压到 2.5s，用墙钟会把首字算快
        ttfbMs: demo.events.find((e) => e.type === 'thinking')?.t ?? null,
        firstCodeMs: firstCode,
        exact: Boolean(demo.usage),
      },
    })

    await new Promise<void>((resolve) => {
      replayTimer = window.setInterval(() => {
        const elapsed = performance.now() - t0
        while (index < timeline.length && timeline[index].t <= elapsed) {
          const ev = timeline[index++]
          if (ev.type === 'thinking') {
            set({ thinking: get().thinking + ev.text })
          } else {
            emittedChars += ev.text.length
            set({ code: extractor.push(ev.text), phase: 'streaming' })
          }
        }
        // 指标映射回录制时的真实时间轴：稳态即真实值，与首屏 loadDemo 一致
        const realElapsed = toRealClock(Math.min(elapsed, playTotalMs))
        const realTokens =
          codeChars > 0 ? Math.min(realOutput, (emittedChars / codeChars) * realOutput) : 0
        const m = get().metrics
        set({
          metrics: {
            ...m,
            elapsedMs: realElapsed,
            outputTokens: Math.round(realTokens),
            tps: realElapsed > 0 ? realTokens / (realElapsed / 1000) : 0,
            costCny: (realInput * PRICE_IN + realTokens * PRICE_OUT) / 1e6,
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
