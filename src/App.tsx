import { useCallback, useEffect, useState } from 'react'
import { Composer } from './components/Composer'
import { ShareSheet } from './components/ShareSheet'
import { Stage } from './components/Stage'
import { TopBar } from './components/TopBar'
import { fetchDemo, fetchDemoList, fetchHealth } from './lib/api'
import type { Demo, HealthInfo } from './lib/types'
import { useForge } from './store'

export default function App() {
  const [health, setHealth] = useState<HealthInfo | null>(null)
  const [demos, setDemos] = useState<Demo[]>([])
  const [codeOpen, setCodeOpen] = useState(true)
  const [cinema, setCinema] = useState(false)
  const [shareOpen, setShareOpen] = useState(false)
  const loadDemo = useForge((s) => s.loadDemo)
  const playDemo = useForge((s) => s.playDemo)

  useEffect(() => {
    void fetchHealth().then(setHealth)
  }, [])

  // 首屏：直接渲染一份真实录制好的成品，别让访客对着空屏
  useEffect(() => {
    void (async () => {
      const list = await fetchDemoList()
      if (!list.length) return
      const first = await fetchDemo(list[0].id)
      if (!first) return
      setDemos([first])
      loadDemo(first)
    })()
  }, [loadDemo])

  const replay = useCallback(() => {
    const demo = demos[0]
    if (demo) void playDemo(demo)
  }, [demos, playDemo])

  const toggleCinema = useCallback(() => {
    setCinema((v) => {
      const next = !v
      const root = document.documentElement
      if (next && !document.fullscreenElement) void root.requestFullscreen?.().catch(() => {})
      if (!next && document.fullscreenElement) void document.exitFullscreen?.().catch(() => {})
      return next
    })
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'f' && e.target === document.body) toggleCinema()
      if (e.key === 'Escape') setShareOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [toggleCinema])

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-void">
      {!cinema && (
        <TopBar
          health={health}
          codeOpen={codeOpen}
          onToggleCode={() => setCodeOpen((v) => !v)}
          onShare={() => setShareOpen(true)}
          onReplay={replay}
          cinema={cinema}
          onCinema={toggleCinema}
        />
      )}

      <Stage codeOpen={codeOpen} onToggleCode={() => setCodeOpen((v) => !v)} />

      {!cinema && <Composer />}

      <ShareSheet open={shareOpen} onClose={() => setShareOpen(false)} />
    </div>
  )
}
