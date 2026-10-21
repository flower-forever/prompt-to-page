import type { HealthInfo } from '../lib/types'

interface Props {
  health: HealthInfo | null
  codeOpen: boolean
  onToggleCode: () => void
  onShare: () => void
  onReplay: () => void
  cinema: boolean
  onCinema: () => void
}

export function TopBar({
  health,
  codeOpen,
  onToggleCode,
  onShare,
  onReplay,
  cinema,
  onCinema,
}: Props) {
  const online = health?.ok ?? false
  const hasKey = health?.hasKey ?? false

  return (
    <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-line/70 px-3 md:px-5">
      <div className="flex min-w-0 items-center gap-3">
        <div className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-ember/12 ring-1 ring-ember/30">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
            <path
              d="M8 1.5 9.6 6l4.4 1.6L9.6 9.2 8 13.7 6.4 9.2 2 7.6 6.4 6 8 1.5Z"
              fill="currentColor"
              className="text-ember"
            />
          </svg>
        </div>
        <div className="min-w-0">
          <h1 className="truncate text-[13.5px] font-semibold tracking-tight text-chalk">
            实时造物工坊
          </h1>
          <p className="hidden truncate font-mono text-[10.5px] text-fog-dim sm:block">
            Live Forge · 一句话，页面当场长出来
          </p>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        <div className="hidden items-center gap-2 rounded-lg border border-line bg-panel/60 px-2.5 py-1.5 md:flex">
          <span
            className={`h-1.5 w-1.5 rounded-full ${online ? (hasKey ? 'bg-mint' : 'bg-ember') : 'bg-fog-dim'}`}
          />
          <span className="font-mono text-[11px] text-fog">
            {health?.model ?? 'MiniMax-M3.1-Flash'}
          </span>
          <span className="text-[10.5px] text-fog-dim">
            {online ? (hasKey ? '在线' : '仅回放') : '离线'}
          </span>
        </div>

        <button
          onClick={onToggleCode}
          className={`rounded-lg border px-2.5 py-1.5 text-[12px] transition-colors ${
            codeOpen
              ? 'border-fog-dim/60 bg-white/5 text-chalk'
              : 'border-line text-fog hover:text-chalk'
          }`}
        >
          代码
        </button>
        <button
          onClick={onReplay}
          className="rounded-lg border border-line px-2 py-1.5 text-[11.5px] text-fog transition-colors hover:text-chalk sm:px-2.5 sm:text-[12px]"
          title="按原始时间轴回放一次真实生成"
        >
          ▶ 回放
        </button>
        <button
          onClick={onShare}
          className="rounded-lg border border-line px-2 py-1.5 text-[11.5px] text-fog transition-colors hover:text-chalk sm:px-2.5 sm:text-[12px]"
        >
          分享卡
        </button>
        <button
          onClick={onCinema}
          className={`rounded-lg border px-2 py-1.5 text-[11.5px] transition-colors sm:px-2.5 sm:text-[12px] ${
            cinema
              ? 'border-ember/50 bg-ember/12 text-ember'
              : 'border-line text-fog hover:text-chalk'
          }`}
        >
          演示模式
        </button>
      </div>
    </header>
  )
}
