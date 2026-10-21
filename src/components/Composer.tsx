import { useEffect, useRef } from 'react'
import { useForge } from '../store'
import { PRESETS } from '../lib/presets'
import { Hud } from './Hud'

const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const

export function Composer() {
  const prompt = useForge((s) => s.prompt)
  const setPrompt = useForge((s) => s.setPrompt)
  const generate = useForge((s) => s.generate)
  const cancel = useForge((s) => s.cancel)
  const running = useForge((s) => s.running)
  const effort = useForge((s) => s.effort)
  const setEffort = useForge((s) => s.setEffort)
  const metrics = useForge((s) => s.metrics)
  const phase = useForge((s) => s.phase)
  const source = useForge((s) => s.source)
  const areaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    const el = areaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`
  }, [prompt])

  const submit = () => {
    if (running) {
      cancel()
      return
    }
    void generate()
  }

  return (
    <div className="shrink-0 border-t border-line/70 bg-void/95 px-3 py-3 backdrop-blur md:px-5">
      <div className="mx-auto flex max-w-6xl flex-col gap-2.5">
        <div className="scroll-thin flex items-center gap-1.5 overflow-x-auto pb-0.5">
          {PRESETS.map((p) => (
            <button
              key={p.id}
              onClick={() => setPrompt(p.prompt)}
              className="shrink-0 rounded-full border border-line bg-panel/60 px-3 py-1 text-[11.5px] text-fog transition-colors hover:border-fog-dim hover:text-chalk"
            >
              {p.title}
            </button>
          ))}
          <span className="ml-1 shrink-0 text-[11px] text-fog-dim">
            预设只填输入框，回车生成
          </span>
        </div>

        <div className="flex items-end gap-2">
          <div className="flex min-h-[46px] flex-1 items-end rounded-xl border border-line bg-panel/70 px-3 py-2 transition-colors focus-within:border-fog-dim">
            <textarea
              ref={areaRef}
              rows={1}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  submit()
                }
              }}
              placeholder="描述一个界面，比如：做一个深色的播客订阅页，有定价方案对比和常见问题折叠…"
              className="scroll-thin max-h-40 w-full resize-none bg-transparent text-[13.5px] leading-relaxed text-chalk outline-none placeholder:text-fog-dim"
            />
          </div>

          <div className="hidden shrink-0 items-center gap-1 rounded-lg border border-line bg-panel/60 p-0.5 sm:flex">
            {EFFORTS.map((e) => (
              <button
                key={e}
                onClick={() => setEffort(e)}
                className={`rounded-md px-2 py-1 font-mono text-[11px] transition-colors ${
                  effort === e ? 'bg-ember/15 text-ember' : 'text-fog-dim hover:text-fog'
                }`}
                title={`思考深度：${e}`}
              >
                {e}
              </button>
            ))}
          </div>

          <button
            onClick={submit}
            disabled={!prompt.trim() && !running}
            className={`flex h-[46px] shrink-0 items-center gap-2 rounded-xl px-4 text-[13px] font-medium transition-all ${
              running
                ? 'bg-ember text-void hover:brightness-110'
                : 'bg-chalk text-void hover:bg-white disabled:cursor-not-allowed disabled:opacity-30'
            }`}
          >
            {running ? (
              <>
                <span className="h-2 w-2 animate-pulse rounded-sm bg-void" />
                停止
              </>
            ) : (
              <>
                生成
                <span className="font-mono text-[11px] opacity-60">⏎</span>
              </>
            )}
          </button>
        </div>

        <Hud metrics={metrics} phase={phase} source={source} />
      </div>
    </div>
  )
}
