import { chromium } from 'playwright'
import path from 'node:path'

const url = process.argv[2] ?? 'http://localhost:5173'
const out = process.argv[3] ?? 'shot.png'
const wait = Number(process.argv[4] ?? 4000)

const t0 = Date.now()
const log = (m) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s] ${m}`)

const browser = await chromium.launch()
log('launched')
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })

const logs = []
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`))
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`))
page.on('requestfailed', (r) => logs.push(`[reqfail] ${r.url()} ${r.failure()?.errorText}`))

log('goto...')
await page.goto(url, { waitUntil: 'commit', timeout: 20000 }).catch((e) => log(`goto err: ${e.message}`))
log('committed, waiting')
await page.waitForTimeout(wait)
log('waiting done')

const info = await page.evaluate(() => {
  const iframe = document.querySelector('iframe')
  let inner = null
  try {
    inner = iframe?.contentDocument?.body?.innerText?.slice(0, 300) ?? null
  } catch (e) {
    inner = `ERR ${e.message}`
  }
  return {
    title: document.title,
    rootChildren: document.getElementById('root')?.childElementCount ?? 0,
    hasIframe: Boolean(iframe),
    iframeText: inner,
    bodyText: document.body.innerText.slice(0, 300),
  }
})
log('evaluated')

await page.screenshot({ path: path.resolve(out) })
log('screenshot saved')

console.log('=== 页面信息 ===')
console.log(JSON.stringify(info, null, 2))
console.log('=== 控制台 ===')
console.log(logs.length ? logs.join('\n') : '(无输出)')

await browser.close()
log('closed')
