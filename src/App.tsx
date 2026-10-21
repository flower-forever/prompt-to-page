import { useCallback, useEffect, useState } from 'react'
import { CinemaExit } from './components/CinemaExit'
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
  // 小屏默认收起代码面板：它会盖住预览
  const [codeOpen, setCodeOpen] = useState(
    () => typeof window === 'undefined' || window.innerWidth >= 768,
  )
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

  const toggleCinema = useCallback(() => setCinema((v) => !v), [])

  // 全屏跟着演示模式走，而不是反过来：全屏只是手段，cinema 才是状态
  useEffect(() => {
    const root = document.documentElement
    if (cinema) {
      if (!document.fullscreenElement) void root.requestFullscreen?.().catch(() => {})
    } else if (document.fullscreenElement) {
      void document.exitFullscreen?.().catch(() => {})
    }
  }, [cinema])

  // 浏览器抢先退出全屏时（Esc / F11 / 手势），跟着退出演示模式。
  // 少了这一步，顶栏和输入区会永远藏起来 —— 用户就被锁在演示画面里了。
  useEffect(() => {
    const onFullscreenChange = () => {
      if (!document.fullscreenElement) setCinema(false)
    }
    document.addEventListener('fullscreenchange', onFullscreenChange)
    return () => document.removeEventListener('fullscreenchange', onFullscreenChange)
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        // 演示模式才是「藏起外壳」的那一层，Esc 先退它，再退分享卡
        if (cinema) setCinema(false)
        else setShareOpen(false)
        return
      }
      if (e.key === 'f' && e.target === document.body) toggleCinema()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [cinema, toggleCinema])

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

      <CinemaExit visible={cinema} onExit={() => setCinema(false)} />

      <ShareSheet open={shareOpen} onClose={() => setShareOpen(false)} />
    </div>
  )
}
