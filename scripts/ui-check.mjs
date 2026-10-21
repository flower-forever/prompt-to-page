/**
 * 分享卡 + 回放 + 演示模式 的界面验证。
 *   node scripts/ui-check.mjs
 */
import { chromium } from 'playwright'
import path from 'node:path'

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const logs = []
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') logs.push(`[${m.type()}] ${m.text()}`)
})
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`))

const fail = (msg) => {
  console.error(`✗ ${msg}`)
  if (logs.length) console.error(logs.slice(-8).join('\n'))
  process.exit(1)
}

// 顶栏用品牌标题来认：CodePanel 内部也有一个 <header>
const shell = () =>
  page.evaluate(() => ({
    top: document.body.innerText.includes('实时造物工坊'),
    composer: Boolean(document.querySelector('textarea')),
    exit: Boolean(document.querySelector('button[aria-label="退出演示模式（Esc）"]')),
  }))

await page.goto('http://localhost:5173', { waitUntil: 'commit' })
await page.waitForTimeout(3000)

// 1. 分享卡
await page.click('button:has-text("分享卡")')
await page.waitForTimeout(1200)
await page.screenshot({ path: path.resolve('ui-share.png') })
const share = await page.evaluate(() => {
  const img = document.querySelector('img[alt="分享卡预览"]')
  return { hasImg: Boolean(img), w: img?.naturalWidth, h: img?.naturalHeight }
})
console.log('分享卡:', JSON.stringify(share))
await page.click('button:has-text("关闭")')
await page.waitForTimeout(400)

// 2. 回放模式
await page.click('button:has-text("回放")')
await page.waitForTimeout(4000)
const replayState = await page.evaluate(() => {
  const s = window.__forge?.getState?.()
  return { phase: s?.phase, running: s?.running, codeLen: s?.code.length, source: s?.source }
})
console.log('回放 4s 后:', JSON.stringify(replayState))
await page.screenshot({ path: path.resolve('ui-replay.png') })

// 3. 演示模式（隐藏外壳）—— 重点验证「退得出来」
await page.waitForTimeout(2000)
await page.click('button:has-text("演示模式")')
await page.waitForTimeout(1000)
const cinema = await shell()
console.log('演示模式:', JSON.stringify(cinema))
await page.screenshot({ path: path.resolve('ui-cinema.png') })
if (cinema.top || cinema.composer) fail('演示模式应藏起顶栏和输入区')
// 演示模式里外壳全没了，没有可见出口就等于把用户锁死在里面
if (!cinema.exit) fail('演示模式缺少可点击的退出按钮')

await page.keyboard.press('Escape')
await page.waitForTimeout(800)
const afterEsc = await shell()
console.log('Esc 退出后:', JSON.stringify(afterEsc))
if (!afterEsc.top || !afterEsc.composer) fail('Esc 之后顶栏和输入区应恢复')
if (afterEsc.exit) fail('退出后退出按钮应消失')

// 再进一次，改用点按钮退出
await page.click('button:has-text("演示模式")')
await page.waitForTimeout(800)
if (!(await shell()).exit) fail('二次进入演示模式缺少退出按钮')
await page.click('button[aria-label="退出演示模式（Esc）"]')
await page.waitForTimeout(800)
const afterClick = await shell()
console.log('点退出后:', JSON.stringify(afterClick))
if (!afterClick.top || !afterClick.composer) fail('点退出按钮后顶栏和输入区应恢复')

// 4. 移动端
const mobile = await browser.newPage({ viewport: { width: 390, height: 844 } })
await mobile.goto('http://localhost:5173', { waitUntil: 'commit' })
await mobile.waitForTimeout(3000)
await mobile.screenshot({ path: path.resolve('ui-mobile.png') })
const overflow = await mobile.evaluate(() => ({
  scrollW: document.documentElement.scrollWidth,
  clientW: document.documentElement.clientWidth,
}))
console.log('移动端横向溢出:', JSON.stringify(overflow))

console.log('--- 控制台 ---')
console.log(logs.join('\n') || '(无)')
await browser.close()
