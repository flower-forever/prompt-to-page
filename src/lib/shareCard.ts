import { TOKEN_COLOR, tokenize } from './tokenize'
import type { Metrics } from '../store'

const W = 1200
const H = 630

export interface ShareCardInput {
  prompt: string
  code: string
  metrics: Metrics
  model: string
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const lines: string[] = []
  let line = ''
  for (const ch of text) {
    const test = line + ch
    if (ctx.measureText(test).width > maxWidth) {
      lines.push(line)
      line = ch
      if (lines.length >= 6) return lines
    } else {
      line = test
    }
  }
  if (line) lines.push(line)
  return lines
}

export function drawShareCard(input: ShareCardInput): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')
  if (!ctx) return canvas

  // 背景
  ctx.fillStyle = '#0a0b0d'
  ctx.fillRect(0, 0, W, H)

  // 网格
  ctx.strokeStyle = 'rgba(255,255,255,0.035)'
  ctx.lineWidth = 1
  for (let x = 0; x <= W; x += 40) {
    ctx.beginPath()
    ctx.moveTo(x + 0.5, 0)
    ctx.lineTo(x + 0.5, H)
    ctx.stroke()
  }
  for (let y = 0; y <= H; y += 40) {
    ctx.beginPath()
    ctx.moveTo(0, y + 0.5)
    ctx.lineTo(W, y + 0.5)
    ctx.stroke()
  }

  // 顶部渐晕
  const glow = ctx.createRadialGradient(W * 0.12, 0, 10, W * 0.12, 0, 520)
  glow.addColorStop(0, 'rgba(255,159,69,0.16)')
  glow.addColorStop(1, 'rgba(255,159,69,0)')
  ctx.fillStyle = glow
  ctx.fillRect(0, 0, W, H)

  // 品牌
  ctx.fillStyle = '#ff9f45'
  ctx.fillRect(64, 56, 4, 26)
  ctx.fillStyle = '#e8ecf2'
  ctx.font = '600 21px Inter, "PingFang SC", "Microsoft YaHei", sans-serif'
  ctx.fillText('实时造物工坊', 80, 77)
  ctx.fillStyle = '#8a94a3'
  ctx.font = '13px "JetBrains Mono", monospace'
  ctx.fillText(`LIVE FORGE · ${input.model}`, 80, 96)

  // Prompt
  ctx.fillStyle = '#e8ecf2'
  ctx.font = '500 30px Inter, "PingFang SC", "Microsoft YaHei", sans-serif'
  const promptLines = wrap(ctx, input.prompt || '（空）', W - 128).slice(0, 3)
  promptLines.forEach((l, i) => ctx.fillText(l, 64, 156 + i * 42))

  // 代码面板
  const panelY = 300
  const panelH = 246
  ctx.fillStyle = 'rgba(255,255,255,0.028)'
  roundRect(ctx, 64, panelY, W - 128, panelH, 16)
  ctx.fill()
  ctx.strokeStyle = 'rgba(255,255,255,0.08)'
  ctx.stroke()

  ctx.fillStyle = '#5d6773'
  ctx.font = '12px "JetBrains Mono", monospace'
  ctx.fillText('App.tsx', 88, panelY + 30)

  const segments = tokenize(input.code)
  ctx.font = '13px "JetBrains Mono", ui-monospace, monospace'
  ctx.textBaseline = 'alphabetic'
  const lineHeight = 20
  const maxX = W - 152
  const maxY = panelY + panelH - 14
  let x = 88
  let y = panelY + 58

  for (const seg of segments) {
    const parts = seg.text.split('\n')
    for (let pi = 0; pi < parts.length; pi++) {
      if (pi > 0) {
        x = 88
        y += lineHeight
      }
      const text = parts[pi]
      if (!text) continue
      if (y > maxY) break
      const w = ctx.measureText(text).width
      if (x + w > maxX) {
        x = 88
        y += lineHeight
        if (y > maxY) break
      }
      ctx.fillStyle = TOKEN_COLOR[seg.type]
      ctx.fillText(text, x, y)
      x += w
    }
    if (y > maxY) break
  }

  // 指标
  const m = input.metrics
  const stats: [string, string][] = [
    ['耗时', `${(m.elapsedMs / 1000).toFixed(1)}s`],
    ['输出', `${m.outputTokens.toLocaleString('en-US')} tok`],
    ['TPS', m.tps ? m.tps.toFixed(0) : '—'],
    ['成本', `¥${m.costCny.toFixed(4)}`],
  ]
  let sx = 64
  for (const [label, value] of stats) {
    ctx.fillStyle = '#5d6773'
    ctx.font = '12px Inter, "PingFang SC", sans-serif'
    ctx.fillText(label, sx, H - 44)
    ctx.fillStyle = '#e8ecf2'
    ctx.font = '600 20px "JetBrains Mono", monospace'
    ctx.fillText(value, sx, H - 20)
    sx += 150
  }

  ctx.fillStyle = '#5d6773'
  ctx.font = '12px Inter, "PingFang SC", sans-serif'
  ctx.fillText('minimax.cn · 一句话，页面当场长出来', W - 340, H - 20)

  return canvas
}

export function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), 'image/png'))
}
