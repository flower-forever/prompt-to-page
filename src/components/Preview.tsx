import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import { buildShell } from '../lib/previewShell'

export interface PreviewHandle {
  render: (js: string) => void
  reset: () => void
}

interface Props {
  onError: (message: string, stack?: string) => void
  onReady?: () => void
  className?: string
}

export const Preview = forwardRef<PreviewHandle, Props>(function Preview(
  { onError, onReady, className },
  ref,
) {
  const frameRef = useRef<HTMLIFrameElement>(null)
  const [shellReady, setShellReady] = useState(false)
  const pending = useRef<string | null>(null)
  const shell = useMemo(() => buildShell(window.location.origin), [])

  const post = (js: string) => {
    frameRef.current?.contentWindow?.postMessage({ type: 'render', js }, window.location.origin)
  }

  useImperativeHandle(
    ref,
    () => ({
      render(js: string) {
        if (shellReady) post(js)
        else pending.current = js
      },
      reset() {
        pending.current = null
      },
    }),
    [shellReady],
  )

  useEffect(() => {
    const handler = (e: MessageEvent) => {
      if (e.origin !== window.location.origin) return
      const d = e.data
      if (!d || typeof d !== 'object') return
      if (d.type === 'preview-shell-ready') {
        setShellReady(true)
        if (pending.current) {
          post(pending.current)
          pending.current = null
        }
      } else if (d.type === 'preview-error') {
        onError(String(d.message ?? '预览运行出错'), d.stack ? String(d.stack) : undefined)
      } else if (d.type === 'preview-ready') {
        onReady?.()
      }
    }
    window.addEventListener('message', handler)
    return () => window.removeEventListener('message', handler)
  }, [onError, onReady])

  return (
    <iframe
      ref={frameRef}
      srcDoc={shell}
      title="生成结果预览"
      sandbox="allow-scripts allow-same-origin allow-popups allow-forms"
      className={className}
    />
  )
})
