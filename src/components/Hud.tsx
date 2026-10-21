import type { Metrics, Phase } from '../store'

interface Props {
  metrics: Metrics
  phase: Phase
  source: 'live' | 'replay' | null
}

function fmt(n: number, digits = 0): string {
  return n.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })
}

export function Hud({ metrics, phase, source }: Props) {
  const estOutput = Math.max(metrics.outputTokens, Math.round(metrics.tps * (metrics.elapsedMs / 1000)))
  const items: { label: string; value: string; tone?: 'ember' | 'mint' }[] = [
    { label: '首字', value: metrics.ttfbMs ? `${(metrics.ttfbMs / 1000).toFixed(2)}s` : '—' },
    { label: '耗时', value: `${(metrics.elapsedMs / 1000).toFixed(1)}s` },
    { label: '输出', value: `${fmt(estOutput)} tok` },
    { label: 'TPS', value: metrics.tps ? fmt(metrics.tps) : '—', tone: 'ember' },
    { label: '成本', value: `¥${metrics.costCny.toFixed(4)}`, tone: 'mint' },
  ]

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[11px] text-fog-dim">
      {items.map((it) => (
        <span key={it.label} className="flex items-baseline gap-1.5">
          <span>{it.label}</span>
          <span
            className={
              it.tone === 'ember'
                ? 'text-ember'
                : it.tone === 'mint'
                  ? 'text-mint'
                  : 'text-fog'
          }
          >
            {it.value}
          </span>
        </span>
      ))}
      {metrics.thinkingTokens > 0 && (
        <span className="flex items-baseline gap-1.5">
          <span>思考</span>
          <span className="text-fog">{fmt(metrics.thinkingTokens)} tok</span>
        </span>
      )}
      {source === 'replay' && (
        <span className="rounded border border-line px-1.5 py-0.5 text-[10px] text-fog">回放模式</span>
      )}
      {phase === 'ready' && <span className="text-mint">✓ 已就绪</span>}
      {phase === 'repairing' && <span className="text-ember">自动修复中…</span>}
    </div>
  )
}
