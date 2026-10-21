import { useMemo } from 'react'
import { TOKEN_CLASS, tokenize } from '../lib/tokenize'
import { escapeHtml } from '../lib/highlight'

interface Props {
  code: string
  streaming: boolean
  onClose: () => void
}

export function CodePanel({ code, streaming, onClose }: Props) {
  const html = useMemo(() => {
    const segments = tokenize(code)
    return segments
      .map((s) => `<span class="${TOKEN_CLASS[s.type]}">${escapeHtml(s.text)}</span>`)
      .join('')
  }, [code])

  const lines = useMemo(() => code.split('\n').length, [code])

  return (
    <aside className="flex h-full min-h-0 w-full flex-col bg-panel/85 backdrop-blur-xl">
      <header className="flex h-10 shrink-0 items-center justify-between border-b border-line/80 px-3">
        <div className="flex items-center gap-2 text-[11px] text-fog">
          <span className="font-mono text-chalk">App.tsx</span>
          <span className="text-fog-dim">/</span>
          <span className="font-mono">{lines} 行</span>
          {streaming && <span className="text-ember">写入中…</span>}
        </div>
        <button
          onClick={onClose}
          className="rounded-md px-2 py-1 text-[11px] text-fog transition-colors hover:bg-white/5 hover:text-chalk"
        >
          收起
        </button>
      </header>
      <div className="scroll-thin min-h-0 flex-1 overflow-auto px-3 py-3">
        <pre
          className="t-code m-0 whitespace-pre-wrap break-words"
          dangerouslySetInnerHTML={{ __html: html + (streaming ? '<span class="caret"></span>' : '') }}
        />
      </div>
    </aside>
  )
}
