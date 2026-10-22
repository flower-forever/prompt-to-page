/**
 * 录制演示 GIF（README / 社媒用）。
 *   node scripts/capture.mjs [out.gif]
 *
 * 走「回放」模式，不依赖 API key，结果可复现。
 * 逐帧截图 → pngjs 解码 → gifenc 编码（Playwright 自带的 ffmpeg 不带 gif 编码器）。
 *
 * 参数（环境变量）：
 *   GIF_WIDTH   宽，默认 800。低于这个值代码区就没法读了。
 *   GIF_COLORS  调色板颜色数，默认 32。语法高亮在 32 色下依然可辨。
 *   GIF_FPS     目标帧率，默认 10。实际帧率受截图速度限制（~340ms/帧）。
 *   GIF_SECONDS 录制窗口秒数，0 = 录到回放结束。回放现在有 32.6s，
 *               想更小的体积就截一段。
 */
import { chromium } from 'playwright'
import gifenc from 'gifenc'
import { PNG } from 'pngjs'
import fs from 'node:fs'
import path from 'node:path'

const { GIFEncoder, quantize, applyPalette } = gifenc

const out = process.argv[2] ?? 'docs/demo.gif'
const W = Number(process.env.GIF_WIDTH ?? 800)
const H = Math.round((W * 9) / 16)
const FPS = Number(process.env.GIF_FPS ?? 10)
const COLORS = Number(process.env.GIF_COLORS ?? 32)
/**
 * 录制窗口（秒）。0 = 录到回放结束。
 * 帧数减不下来 —— 逐帧截图本身有 ~340ms 开销，体积只能靠缩短窗口来压。
 */
const SECONDS = Number(process.env.GIF_SECONDS ?? 0)

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
await page.goto('http://localhost:5173', { waitUntil: 'commit' })
await page.waitForTimeout(2500)

// 先点回放，再切演示模式（演示模式下顶栏会隐藏，回放按钮也就没了）
await page.click('button:has-text("回放")').catch(() => {})
await page.waitForTimeout(400)
await page.click('button:has-text("演示模式")').catch(() => {})

const gif = GIFEncoder()
const delay = Math.round(1000 / FPS)
const frameInterval = 1000 / FPS
let frames = 0
let last = Date.now()
const t0 = Date.now()

const deadline = SECONDS > 0 ? t0 + SECONDS * 1000 : t0 + 45_000
while (Date.now() < deadline) {
  const now = Date.now()
  if (now - last >= frameInterval) {
    last = now
    const png = PNG.sync.read(await page.screenshot({ type: 'png' }))
    // 缩放到目标尺寸（最近邻，够用且快）
    const rgba = new Uint8Array(W * H * 4)
    for (let y = 0; y < H; y++) {
      const sy = Math.min(png.height - 1, Math.floor((y * png.height) / H))
      for (let x = 0; x < W; x++) {
        const sx = Math.min(png.width - 1, Math.floor((x * png.width) / W))
        const si = (sy * png.width + sx) * 4
        const di = (y * W + x) * 4
        rgba[di] = png.data[si]
        rgba[di + 1] = png.data[si + 1]
        rgba[di + 2] = png.data[si + 2]
        rgba[di + 3] = 255
      }
    }
    const palette = quantize(rgba, COLORS, { format: 'rgb444' })
    const index = applyPalette(rgba, palette, 'rgb444')
    gif.writeFrame(index, W, H, { palette, delay })
    frames++
  }
  const done = await page.evaluate(() => window.__forge?.getState?.().running === false)
  if (done && frames > 10) break
  await page.waitForTimeout(16)
}
await browser.close()
gif.finish()
fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true })
fs.writeFileSync(path.resolve(out), Buffer.from(gif.bytes()))
const size = (fs.statSync(path.resolve(out)).size / 1024 / 1024).toFixed(2)
console.log(
  `已生成 ${out}：${frames} 帧 · ${W}×${H} · ${size} MB · 用时 ${((Date.now() - t0) / 1000).toFixed(1)}s`,
)
