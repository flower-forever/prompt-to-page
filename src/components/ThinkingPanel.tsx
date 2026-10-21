import { useEffect, useState } from 'react'

interface Props {
  thinking: string
  active: boolean
}

export function ThinkingPanel({ thinking, active }: Props) {
  const [open, setOpen] = useState(true)

  // 思考时展开，代码开始流出来时自动收起，别挡住生成结果
  useEffect(() => {
    setOpen(active)
  }, [active])

  if (!thinking.trim() && !active) return null

  return (
    <div className="glass pointer-events-auto absolute bottom-3 left-3 w-[min(460px,72%)] rounded-xl border border-line/80 shadow-2xl">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-3 py-2 text-left"
      >
        <span className="flex items-center gap-2 text-[11.5px] text-fog">
          {active ? (
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-ember" />
          ) : (
            <span className="h-1.5 w-1.5 rounded-full bg-fog-dim" />
          )}
          {active ? '模型正在思考…' : '思考过程'}
          {thinking.trim() && (
            <span className="font-mono text-[10px] text-fog-dim">
              {thinking.length.toLocaleString('en-US')} 字符
            </span>
          )}
        </span>
        <span className="text-[11px] text-fog-dim">{open ? '收起' : '展开'}</span>
      </button>
      {open && thinking.trim() && (
        <div className="scroll-thin max-h-36 overflow-auto border-t border-line/70 px-3 py-2.5">
          <p className="m-0 whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-fog-dim">
            {thinking.trim()}
          </p>
        </div>
      )}
    </div>
  )
}
