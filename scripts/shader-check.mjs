/**
 * Shader 闭环验证：注入一个「GLSL 漏写 uniform 声明」的真实坏样本，
 * 检查报错 → 模型自己改 → 重编译 → 画面真的动起来 这一整条回路。
 *   npm run shader-check   [需要 dev server 或 npm start]
 *
 * 用坏样本而不是直接生成来测：结果可复现，而且这正是要验证的闭环本身。
 */
import { chromium } from 'playwright'
import { PNG } from 'pngjs'
import fs from 'node:fs'
import path from 'node:path'

const BASE = process.env.BASE_URL ?? 'http://localhost:5173'
const fixture = path.resolve('scripts/fixtures/bad-shader.json')
const demo = JSON.parse(fs.readFileSync(fixture, 'utf8'))

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const logs = []
page.on('console', (m) => {
  if (m.type() === 'error') logs.push(`[console.error] ${m.text()}`)
})
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`))

const t0 = Date.now()
const step = (m) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s] ${m}`)
const fail = (msg) => {
  console.error(`✗ ${msg}`)
  if (logs.length) console.error(logs.slice(-6).join('\n'))
  process.exit(1)
}

await page.goto(BASE, { waitUntil: 'commit' })
await page.waitForTimeout(2500)

const hook = await page.evaluate(() => Boolean(window.__forge?.setState))
if (!hook) fail('需要 dev server（__forge 钩子只在 dev 下暴露）；生产预览请改跑 npm run e2e')

// 注入坏样本：只给 code，让 Stage 的编译流水线自己接手
const badCode = demo.code
await page.evaluate(
  ({ code, prompt }) => {
    window.__forge.setState({
      code,
      prompt,
      running: false,
      error: null,
      previewError: null,
      repairState: 'idle',
      phase: 'compiling',
      source: 'replay',
    })
  },
  { code: badCode, prompt: demo.prompt },
)
step(`注入坏样本 ${badCode.length} 字符`)

// 1. 静态检查必须立刻报错（而不是静默黑屏）
await page
  .waitForFunction(() => document.body.innerText.includes('未声明'), undefined, { timeout: 15000 })
  .then(() => step('静态检查报出了「未声明的 u_resolution」'))
  .catch(() => fail('坏样本没触发报错 —— 静态检查失效，会静默黑屏'))

// 2. 闭环：报错自动回喂模型修复
await page
  .waitForFunction(() => window.__forge?.getState?.().repairState === 'running', undefined, {
    timeout: 20000,
  })
  .then(() => step('修复回路已启动'))
  .catch(() => fail('报错后没有进入自动修复'))

// 3. 等修好
await page
  .waitForFunction(() => window.__forge?.getState?.().running === false && window.__forge?.getState?.().phase === 'ready', undefined, {
    timeout: 180000,
  })
  .then(() => step('修复完成'))
  .catch(() => fail('修复超时'))

const after = await page.evaluate(() => window.__forge.getState().code)
step(`修复后代码 ${after.length} 字符`)

// 4. 修好的代码必须真的补上了声明
if (!/uniform\s+vec2\s+u_resolution/.test(after)) fail('修复后仍缺 uniform vec2 u_resolution 声明')
step('✓ u_resolution 声明已补上')

// 5. 画面必须在动
await page.waitForTimeout(1500)
if (await page.evaluate(() => document.body.innerText.includes('预览报错'))) {
  fail('修复后仍报预览错')
}

const canvas = await page.evaluate(() => {
  const c = document.querySelector('iframe')?.contentDocument?.querySelector('canvas')
  if (!c) return null
  return { w: c.width, h: c.height }
})
if (!canvas) fail('预览里没有 canvas')
if (canvas.w < 100 || canvas.h < 100) fail(`canvas 尺寸异常 ${canvas.w}x${canvas.h}（resize 没跑）`)
step(`✓ canvas ${canvas.w}x${canvas.h}`)

const el = await page.$('iframe')
const shots = []
for (let i = 0; i < 3; i++) {
  shots.push(await el.screenshot())
  await page.waitForTimeout(700)
}
const distinct = new Set(shots.map((b) => b.toString('base64'))).size
if (distinct < 2) fail('连续截图完全相同 —— 渲染循环没跑')

// 像素必须真有内容
const png = PNG.sync.read(shots[0])
let dark = 0
let total = 0
const hue = new Set()
for (let i = 0; i < png.data.length; i += 4 * 137) {
  const r = png.data[i]
  const g = png.data[i + 1]
  const b = png.data[i + 2]
  total++
  if ((r + g + b) / 3 < 16) dark++
  hue.add(`${Math.round(r / 40)}-${Math.round(g / 40)}-${Math.round(b / 40)}`)
}
if (dark / total > 0.95) fail('画面几乎全黑')
if (hue.size < 4) fail(`色彩太少（${hue.size} 组）`)
step(`✓ 画面在动（${distinct} 帧不同）· 暗像素 ${(dark / total * 100).toFixed(0)}% · 色组 ${hue.size}`)

await page.screenshot({ path: path.resolve('shader-check.png') })
console.log('\n✓ Shader 闭环通过（截图 shader-check.png）')
if (logs.length) console.log('⚠ 控制台:\n' + logs.slice(-4).join('\n'))
await browser.close()
