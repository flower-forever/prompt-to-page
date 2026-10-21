import { useCallback, useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useForge } from '../store'
import { compileTsx } from '../lib/compile'
import { useMediaQuery } from '../lib/useMediaQuery'
import { CodePanel } from './CodePanel'
import { Preview, type PreviewHandle } from './Preview'
import { ThinkingPanel } from './ThinkingPanel'

interface Props {
  codeOpen: boolean
  onToggleCode: () => void
}

export function Stage({ codeOpen, onToggleCode }: Props) {
  const code = useForge((s) => s.code)
  const running = useForge((s) => s.running)
  const phase = useForge((s) => s.phase)
  const thinking = useForge((s) => s.thinking)
  const error = useForge((s) => s.error)
  const repairState = useForge((s) => s.repairState)
  const markCompiled = useForge((s) => s.markCompiled)
  const setPreviewError = useForge((s) => s.setPreviewError)
  const repairNow = useForge((s) => s.repairNow)

  const previewRef = useRef<PreviewHandle>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const [hasOutput, setHasOutput] = useState(false)
  const isDesktop = useMediaQuery('(min-width: 768px)')

  // 编译流水线：代码变化 → 120ms 后编译 → 推给沙箱
  useEffect(() => {
    if (!code.trim()) return
    let cancelled = false
    const timer = window.setTimeout(async () => {
      const result = await compileTsx(code)
      if (cancelled) return
      if (result.ok) {
        previewRef.current?.render(result.js)
        setFailure(null)
        setHasOutput(true)
        markCompiled()
      } else if (!running) {
        // 流式过程中的语法错误是正常的，只有结束后才算失败
        setFailure(result.error)
        useForge.getState().markCompileFailed(result.error)
      }
    }, 120)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [code, running, markCompiled])

  const handlePreviewError = useCallback(
    (message: string) => {
      setFailure(message)
      setPreviewError(message)
    },
    [setPreviewError],
  )

  // Agent 闭环：流结束后仍有错误 → 把错误喂回模型让它自己改
  useEffect(() => {
    if (running || !failure || repairState !== 'idle') return
    const timer = window.setTimeout(() => void repairNow(), 500)
    return () => window.clearTimeout(timer)
  }, [running, failure, repairState, repairNow])

  return (
    <div className="flex min-h-0 flex-1 gap-3 p-3 md:p-4">
      <div className="relative min-w-0 flex-1 overflow-hidden rounded-xl border border-line bg-panel shadow-[0_30px_80px_-40px_rgba(0,0,0,0.9)]">
        <Preview
          ref={previewRef}
          onError={handlePreviewError}
          className="absolute inset-0 h-full w-full bg-void"
        />

        {!hasOutput && (
          <div className="pointer-events-none absolute inset-0 grid place-items-center">
            <div className="text-center">
              <div className="grid-noise mx-auto mb-6 h-24 w-24 rounded-2xl opacity-40" />
              <p className="m-0 text-[14px] text-fog">描述一个界面，页面会当场长出来</p>
              <p className="m-0 mt-1.5 font-mono text-[11px] text-fog-dim">
                one prompt · one page · no build step
              </p>
            </div>
          </div>
        )}

        {phase === 'compiling' && (
          <div className="pointer-events-none absolute left-1/2 top-4 -translate-x-1/2 rounded-full border border-line bg-panel/85 px-3 py-1 font-mono text-[11px] text-fog backdrop-blur">
            编译中…
          </div>
        )}

        <ThinkingPanel thinking={thinking} active={phase === 'thinking'} />

        <AnimatePresence>
          {error && (
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 12 }}
              className="glass absolute inset-x-3 bottom-3 rounded-xl border border-rose/30 p-3 md:inset-x-auto md:right-3 md:bottom-3 md:w-[420px]"
            >
              <div className="flex items-start gap-2.5">
                <span className="mt-0.5 text-rose">▲</span>
                <div className="min-w-0 flex-1">
                  <div className="text-[12px] font-medium text-chalk">
                    {repairState === 'running' ? '正在让模型自己修…' : '预览报错'}
                  </div>
                  <pre className="scroll-thin mt-1 max-h-24 overflow-auto whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-rose/80">
                    {error}
                  </pre>
                </div>
                <button
                  onClick={() => void repairNow()}
                  className="shrink-0 rounded-md border border-line px-2 py-1 text-[11px] text-fog transition-colors hover:text-chalk"
                >
                  再修一次
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <AnimatePresence initial={false}>
        {codeOpen && isDesktop && (
          <motion.aside
            key="code"
            initial={{ opacity: 0, width: 0 }}
            animate={{ opacity: 1, width: 'min(440px, 34vw)' }}
            exit={{ opacity: 0, width: 0 }}
            transition={{ type: 'spring', stiffness: 260, damping: 30 }}
            className="overflow-hidden rounded-xl border border-line"
          >
            <CodePanel code={code} streaming={running} onClose={onToggleCode} />
          </motion.aside>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {codeOpen && !isDesktop && (
          <motion.div
            key="code-sheet"
            initial={{ opacity: 0, y: 40 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 40 }}
            className="glass fixed inset-x-2 bottom-2 z-40 h-[54vh] overflow-hidden rounded-xl border border-line"
          >
            <CodePanel code={code} streaming={running} onClose={onToggleCode} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
