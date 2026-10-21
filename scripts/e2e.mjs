/**
 * 端到端验证：输入 prompt → 真实调用 MiniMax → 观察流式 → 预览出图。
 *   node scripts/e2e.mjs "<prompt>" [outPrefix]
 *
 * 断言只依赖 DOM（不依赖 dev 专属的调试钩子），所以生产构建也能跑。
 * 任何一步不满足就以非 0 退出，CI 才能真正兜住回归。
 */
import { chromium } from 'playwright'
import path from 'node:path'

const prompt = process.argv[2] ?? '做一个极简的番茄钟计时器页面'
const prefix = process.argv[3] ?? 'e2e'
const BASE = process.env.BASE_URL ?? 'http://localhost:5173'
const READY = '已就绪'

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const logs = []
page.on('console', (m) => {
  if (m.type() === 'error') logs.push(`[console.error] ${m.text()}`)
})
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`))

const t0 = Date.now()
const fail = (msg) => {
  console.error(`✗ ${msg}`)
  if (logs.length) console.error(logs.slice(-8).join('\n'))
  process.exit(1)
}

try {
  await page.goto(BASE, { waitUntil: 'commit', timeout: 30000 })
  await page.waitForTimeout(2500)

  await page.fill('textarea', prompt)
  await page.click('button:has-text("生成")')

  // 1) 生成必须真的开始：HUD 里的「已就绪」消失
  await page.waitForFunction(
    (r) => !document.body.innerText.includes(r),
    READY,
    { timeout: 30000 },
  )
  console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s] 生成已启动`)

  // 2) 代码必须开始流出来
  await page.waitForFunction(
    () => (document.querySelector('aside pre')?.textContent?.length ?? 0) > 100,
    undefined,
    { timeout: 120000 },
  )
  console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s] 代码开始流出`)

  // 3) 必须跑完：重新出现「已就绪」
  await page.waitForFunction(
    (r) => document.body.innerText.includes(r),
    READY,
    { timeout: 240000 },
  )
  console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s] 生成完成`)

  // 4) 预览里必须有真实内容，且不是报错
  await page.waitForTimeout(1500)
  const result = await page.evaluate(() => {
    const iframe = document.querySelector('iframe')
    let preview = ''
    let htmlLen = 0
    try {
      preview = iframe?.contentDocument?.body?.innerText ?? ''
      htmlLen = iframe?.contentDocument?.body?.innerHTML?.length ?? 0
    } catch (e) {
      preview = `ERR ${e.message}`
    }
    const body = document.body.innerText
    return {
      preview: preview.slice(0, 240).replace(/\s+/g, ' '),
      htmlLen,
      hasError: body.includes('预览报错'),
      codeLen: document.querySelector('aside pre')?.textContent?.length ?? 0,
      hud: body.split('\n').slice(-2).join(' | '),
    }
  })

  if (result.hasError) fail('页面出现「预览报错」')
  if (result.htmlLen < 500) fail(`预览内容过少（HTML ${result.htmlLen} 字节）`)
  if (result.codeLen < 500) fail(`代码内容过少（${result.codeLen} 字符）`)

  await page.screenshot({ path: path.resolve(`${prefix}-done.png`) })

  console.log('✓ 端到端通过')
  console.log(`  预览文本：${result.preview}`)
  console.log(`  预览 DOM：${result.htmlLen} 字节 · 代码 ${result.codeLen} 字符`)
  console.log(`  HUD：${result.hud}`)
  console.log(`  用时 ${((Date.now() - t0) / 1000).toFixed(1)}s`)
} catch (err) {
  fail(err.message)
} finally {
  await browser.close()
}
