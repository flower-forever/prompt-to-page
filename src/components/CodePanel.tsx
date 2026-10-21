import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { TOKEN_CLASS, tokenize } from '../lib/tokenize'
import { escapeHtml } from '../lib/highlight'

interface Props {
  code: string
  streaming: boolean
  onClose: () => void
}

/** 距底部小于这个距离就算「在底部」：够宽松，免得最后一行的行高把判定顶掉 */
const BOTTOM_SLACK_PX = 24

export function CodePanel({ code, streaming, onClose }: Props) {
  const html = useMemo(() => {
    const segments = tokenize(code)
    return segments
      .map((s) => `<span class="${TOKEN_CLASS[s.type]}">${escapeHtml(s.text)}</span>`)
      .join('')
  }, [code])

  const lines = useMemo(() => code.split('\n').length, [code])

  const scrollRef = useRef<HTMLDivElement>(null)
  // 流式输出时跟住最新代码 —— 让人手动拉滚动条才能看到新代码是不合逻辑的。
  // 但用户主动往上翻看时要让开，翻回底部再恢复跟随。
  //
  // 判定必须同步读 DOM，不能用 state：代码每 40ms 更新一次，而 scroll 事件
  // 要等下一帧才派发，用 state 的话下一次更新会抢在前面把用户拽回底部。
  const followRef = useRef(true)
  /** 上次自动贴底后的 scrollTop：内容追加在下方时它不会变，因此可用来识别用户上翻 */
  const pinnedTopRef = useRef(0)
  /** 上一帧的内容高度，用于识别「新一轮生成把代码清空了」而非用户上翻 */
  const lastHeightRef = useRef(0)
  // 仅用于渲染「跳到最新」按钮
  const [following, setFollowing] = useState(true)

  const setFollow = useCallback((v: boolean) => {
    if (followRef.current === v) return
    followRef.current = v
    setFollowing(v)
  }, [])

  const pin = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
    pinnedTopRef.current = el.scrollTop
  }, [])

  // 只在流式期间跟随：首屏直接渲染成品时（loadDemo）应当停在文件开头
  useEffect(() => {
    const el = scrollRef.current
    if (!el || !streaming) return
    // 新一轮开始时代码被清空，高度回缩会把 scrollTop 夹回 0 ——
    // 这是内容重置，不是人动的手，必须照常贴底，否则会被误判成「用户上翻」。
    const shrank = el.scrollHeight < lastHeightRef.current - 1
    lastHeightRef.current = el.scrollHeight
    if (shrank) {
      pin()
      return
    }
    if (!followRef.current) return
    // 用户上翻的位移 = 上次贴底的位置 - 当前位置。内容只会追加在下方，
    // 不会改变 scrollTop，所以这个差值大于容差就说明是人动的手，此时让开。
    if (pinnedTopRef.current - el.scrollTop > BOTTOM_SLACK_PX) {
      setFollow(false)
      return
    }
    pin()
  }, [code, streaming, setFollow, pin])

  // 新一轮生成开始时重新跟随，否则上一轮翻上去过就一直不跟了
  useEffect(() => {
    if (!streaming) return
    followRef.current = true
    setFollowing(true)
    pin()
  }, [streaming, pin])

  const onScroll = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < BOTTOM_SLACK_PX
    setFollow(atBottom)
    if (atBottom) pinnedTopRef.current = el.scrollTop
  }, [setFollow])

  const jumpToLatest = useCallback(() => {
    setFollow(true)
    pin()
  }, [setFollow, pin])

  return (
    <aside className="relative flex h-full min-h-0 w-full flex-col bg-panel/85 backdrop-blur-xl">
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
      <div
        ref={scrollRef}
        onScroll={streaming ? onScroll : undefined}
        className="scroll-thin relative min-h-0 flex-1 overflow-auto px-3 py-3"
      >
        <pre
          className="t-code m-0 whitespace-pre-wrap break-words"
          dangerouslySetInnerHTML={{ __html: html + (streaming ? '<span class="caret"></span>' : '') }}
        />
      </div>

      {streaming && !following && (
        <button
          onClick={jumpToLatest}
          className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full border border-ember/40 bg-panel/90 px-3 py-1 text-[11px] text-ember backdrop-blur transition-colors hover:bg-ember/10"
        >
          ↓ 跳到最新
        </button>
      )}
    </aside>
  )
}
