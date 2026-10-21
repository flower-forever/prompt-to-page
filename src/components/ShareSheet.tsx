import { useEffect, useState } from 'react'
import { useForge } from '../store'
import { drawShareCard } from '../lib/shareCard'

interface Props {
  open: boolean
  onClose: () => void
}

export function ShareSheet({ open, onClose }: Props) {
  const prompt = useForge((s) => s.prompt)
  const code = useForge((s) => s.code)
  const metrics = useForge((s) => s.metrics)
  const [url, setUrl] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    const canvas = drawShareCard({
      prompt,
      code,
      metrics,
      model: 'MiniMax M3.1 Flash',
    })
    setUrl(canvas.toDataURL('image/png'))
  }, [open, prompt, code, metrics])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/75 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-3xl rounded-2xl border border-line bg-panel p-4 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <div>
            <div className="text-[13px] font-medium text-chalk">分享卡</div>
            <div className="font-mono text-[11px] text-fog-dim">1200 × 630 PNG</div>
          </div>
          <button
            onClick={onClose}
            className="rounded-md px-2 py-1 text-[12px] text-fog transition-colors hover:bg-white/5 hover:text-chalk"
          >
            关闭
          </button>
        </div>

        {url ? (
          <img src={url} alt="分享卡预览" className="w-full rounded-xl border border-line" />
        ) : (
          <div className="grid h-64 place-items-center rounded-xl border border-line text-[12px] text-fog-dim">
            生成中…
          </div>
        )}

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <a
            href={url ?? '#'}
            download="live-forge.png"
            className="rounded-lg bg-chalk px-3 py-1.5 text-[12px] font-medium text-void transition-opacity hover:opacity-90"
          >
            下载 PNG
          </a>
          <button
            onClick={() => void navigator.clipboard?.writeText(prompt)}
            className="rounded-lg border border-line px-3 py-1.5 text-[12px] text-fog transition-colors hover:text-chalk"
          >
            复制 prompt
          </button>
          <button
            onClick={() => void navigator.clipboard?.writeText(code)}
            className="rounded-lg border border-line px-3 py-1.5 text-[12px] text-fog transition-colors hover:text-chalk"
          >
            复制代码
          </button>
        </div>
      </div>
    </div>
  )
}
