/**
 * 端到端验证：输入 prompt → 真实调用 MiniMax → 观察流式 → 预览出图。
 *   node scripts/e2e.mjs "做一个极简的番茄钟计时器页面" [outPrefix]
 */
import { chromium } from 'playwright'
import path from 'node:path'

const prompt = process.argv[2] ?? '做一个极简的番茄钟计时器页面'
const prefix = process.argv[3] ?? 'e2e'

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const logs = []
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`))
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`))

await page.goto('http://localhost:5173', { waitUntil: 'commit' })
await page.waitForTimeout(2500)

page.on('request', (r) => {
  if (r.url().includes('/api/')) console.log('→ 请求', r.method(), r.url())
})
page.on('response', (r) => {
  if (r.url().includes('/api/')) console.log('← 响应', r.status(), r.url())
})

await page.fill('textarea', prompt)
await page.waitForTimeout(300)
console.log(
  '按钮状态',
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find((x) => x.textContent?.includes('生成'))
    return b ? { disabled: b.disabled, text: b.textContent } : 'not found'
  }),
)
await page.click('button:has-text("生成")')

const t0 = Date.now()
const marks = []
for (let i = 0; i < 90; i++) {
  await page.waitForTimeout(1000)
  const state = await page.evaluate(() => {
    const iframe = document.querySelector('iframe')
    const pre = document.querySelector('aside pre')
    const s = window.__forge?.getState?.()
    return {
      hud: document.body.innerText.split('\n').slice(-1)[0],
      codeLen: pre?.textContent?.length ?? 0,
      store: s
        ? {
            phase: s.phase,
            running: s.running,
            codeLen: s.code.length,
            thinkLen: s.thinking.length,
            error: s.error,
            previewError: s.previewError,
            metrics: s.metrics,
          }
        : 'no store',
      iframeLen: (() => {
        try {
          return iframe?.contentDocument?.body?.innerText?.length ?? 0
        } catch {
          return -1
        }
      })(),
    }
  })
  const sec = ((Date.now() - t0) / 1000).toFixed(0)
  marks.push(`${sec}s ${JSON.stringify(state.store)} pre=${state.codeLen}`)
  if (i === 3) await page.screenshot({ path: path.resolve(`${prefix}-streaming.png`) })
  if (state.store?.running === false) {
    await page.waitForTimeout(1500)
    await page.screenshot({ path: path.resolve(`${prefix}-done.png`) })
    console.log('生成结束，用时', sec, 's')
    const final = await page.evaluate(() => {
      const iframe = document.querySelector('iframe')
      return {
        store: window.__forge?.getState?.(),
        previewText: (() => {
          try {
            return iframe?.contentDocument?.body?.innerText?.slice(0, 500) ?? ''
          } catch (e) {
            return `ERR ${e.message}`
          }
        })(),
        previewHtmlLen: iframe?.contentDocument?.body?.innerHTML?.length ?? 0,
      }
    })
    console.log('最终状态:', JSON.stringify(final.store?.metrics), 'phase=', final.store?.phase)
    console.log('预览内容:', final.previewText.slice(0, 300).replace(/\n+/g, ' | '))
    console.log('预览 DOM 长度:', final.previewHtmlLen)
    break
  }
}

console.log(marks.filter((_, i) => i % 5 === 0 || i === marks.length - 1).join('\n'))
console.log('--- 控制台 ---')
console.log(logs.slice(-12).join('\n') || '(无)')
await browser.close()
