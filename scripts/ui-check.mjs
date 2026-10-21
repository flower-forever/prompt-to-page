/**
 * 分享卡 + 回放 + 演示模式 的界面验证。
 *   node scripts/ui-check.mjs
 */
import { chromium } from 'playwright'
import fs from 'node:fs'
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

// 2. 回放模式 —— 重点验证「代码面板跟得住」与「指标是录制真实值」
await page.click('button:has-text("回放")')
await page.waitForFunction(
  () => (document.querySelector('aside pre')?.textContent?.length ?? 0) > 50,
  undefined,
  { timeout: 30000 },
)

const panel = () =>
  page.evaluate(() => {
    const el = document.querySelector('aside .overflow-auto')
    if (!el) return null
    return {
      dist: Math.round(el.scrollHeight - el.scrollTop - el.clientHeight),
      scrollTop: Math.round(el.scrollTop),
      scrollable: el.scrollHeight > el.clientHeight + 10,
      codeLen: (document.querySelector('aside pre')?.textContent ?? '').length,
      hasJump: document.body.innerText.includes('跳到最新'),
    }
  })

// 内容必须已经溢出，否则「跟随」这件事根本无从验证
await page.waitForFunction(
  () => {
    const el = document.querySelector('aside .overflow-auto')
    return el && el.scrollHeight > el.clientHeight + 10
  },
  undefined,
  { timeout: 30000 },
)

let maxDist = 0
let samples = 0
for (let i = 0; i < 6; i++) {
  await page.waitForTimeout(1200)
  const p = await panel()
  if (!p) continue
  samples++
  maxDist = Math.max(maxDist, p.dist)
}
console.log(`回放跟随: 采样 ${samples} 次 · 最大距底部 ${maxDist}px`)
// 流式输出却要手动拉滚动条才能看到最新代码，是不合逻辑的
if (maxDist > 40) fail(`代码面板没有跟住最新代码（最大距底部 ${maxDist}px）`)
await page.screenshot({ path: path.resolve('ui-replay.png') })

// 用户主动上翻时必须让开，否则等于抢走滚动条
await page.evaluate(() => {
  document.querySelector('aside .overflow-auto').scrollTop = 0
})
await page.waitForTimeout(1500)
const scrolledUp = await panel()
console.log('上翻后:', JSON.stringify(scrolledUp))
if (scrolledUp.scrollTop > 200) fail('用户上翻后仍被拽回底部')
if (!scrolledUp.hasJump) fail('上翻后缺少「跳到最新」按钮')

await page.click('button:has-text("跳到最新")')
await page.waitForTimeout(1200)
const resumed = await panel()
console.log('跳到最新后:', JSON.stringify(resumed))
if (resumed.dist > 40) fail('点「跳到最新」后没有恢复跟随')

// 回放结束：HUD 必须落在录制时的真实数值上，而不是回放墙钟算出来的假数
await page.waitForFunction(() => document.body.innerText.includes('已就绪'), undefined, {
  timeout: 90000,
})
await page.waitForTimeout(1500)
const replayState = await page.evaluate(() => {
  const s = window.__forge?.getState?.()
  return {
    phase: s?.phase,
    running: s?.running,
    source: s?.source,
    elapsedMs: Math.round(s?.metrics?.elapsedMs ?? 0),
    outputTokens: s?.metrics?.outputTokens,
    tps: Math.round(s?.metrics?.tps ?? 0),
  }
})
console.log('回放结束:', JSON.stringify(replayState))
if (replayState.source !== 'replay') fail('回放结束后 source 应为 replay')

// 与录制件里的真实数据比对。
// 回放播的是 /api/demos 返回的第一件，所以从同一个接口取，别自己猜文件名：
// 这里若挑错文件，比对的就是另一个录制件，断言会静默失效。
const demoId = await page.evaluate(async () => {
  const res = await fetch('/api/demos')
  const json = await res.json()
  return json.demos?.[0]?.id
})
if (!demoId) fail('拿不到回放件 id，无法比对录制真实值')
const recorded = JSON.parse(fs.readFileSync(`public/demos/${demoId}.json`, 'utf8'))
const expectedMs = recorded.durationMs
const expectedTok = recorded.usage?.output ?? 0
const expectedTps = expectedMs > 0 ? expectedTok / (expectedMs / 1000) : 0
console.log(
  `录制真实(${demoId}): ${expectedMs}ms / ${expectedTok} tok / ${expectedTps.toFixed(1)} TPS`,
)
if (Math.abs(replayState.elapsedMs - expectedMs) > 500) {
  fail(`回放耗时应为录制真实值 ${expectedMs}ms，实际 ${replayState.elapsedMs}ms`)
}
if (Math.abs(replayState.outputTokens - expectedTok) > 1) {
  fail(`回放 token 应为录制真实值 ${expectedTok}，实际 ${replayState.outputTokens}`)
}
if (Math.abs(replayState.tps - expectedTps) / expectedTps > 0.05) {
  fail(`TPS 应为录制真实值 ${expectedTps.toFixed(1)}，实际 ${replayState.tps}（演示的核心数字不能是假的）`)
}

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
