/**
 * 验证 GLSL uniform 静态检查：坏样本必须拦住、修复后必须放行、流式中途不误报。
 *   npm run shader-lint
 *
 * 为什么需要：模型漏写 `uniform vec2 u_resolution;` 时，组件里「着色器编译失败就 return」
 * 会把错误静默吞掉，预览只剩一张静止黑图。现有报错回路只抓 JS 运行时错误，
 * 抓不到 GLSL 编译失败，所以这类问题必须在编译阶段主动报出来。
 */
import fs from 'node:fs'
import path from 'node:path'
import { extractCode } from '../shared/extract'

// compileTsx 的 runtimeUrl 依赖 window
;(globalThis as unknown as { window: unknown }).window = {
  location: { origin: 'http://localhost:5173' },
}
const { compileTsx } = await import('../src/lib/compile')

const root = path.resolve(import.meta.dirname, '..')
const read = (p: string) => JSON.parse(fs.readFileSync(p, 'utf8'))

let failed = 0
const check = (name: string, ok: boolean, extra = '') => {
  if (ok) console.log(`✓ ${name}`)
  else {
    failed++
    console.error(`✗ ${name}${extra ? ` — ${extra}` : ''}`)
  }
}

// 真实录制出来的坏样本：模型确实犯过这个错
const bad = extractCode(read(path.join(root, 'scripts/fixtures/bad-shader.json')).code)

const r1 = await compileTsx(bad)
check('坏样本被拦住', r1.ok === false, JSON.stringify(r1).slice(0, 160))
if (!r1.ok) console.log(`  报错：${r1.error}`)

// 补上声明后必须放行，否则就是把模型逼死
const fixed = bad.replace('uniform int u_mode;', 'uniform int u_mode;\nuniform vec2 u_resolution;')
const r2 = await compileTsx(fixed)
check('补上声明后放行', r2.ok === true, r2.ok === true ? '' : r2.error)

// 流式中途：片段着色器字符串还没闭合时不该报错，否则生成过程中每帧都闪一次红
const cut = bad.indexOf('const fragmentShader')
const r3 = await compileTsx(bad.slice(0, cut + 60))
check('流式中途不误报', r3.ok === true || !r3.error.includes('未声明'), r3.ok === true ? '' : r3.error)

// 现有页面型录制件不受影响
for (const f of ['cyber-landing', 'pomodoro']) {
  const rec = read(path.join(root, 'public/demos', `${f}.json`))
  const r = await compileTsx(extractCode(rec.code))
  check(`${f} 不受影响`, r.ok === true, r.ok === true ? '' : r.error)
}

console.log(failed ? `✗ ${failed} 项失败` : '✓ GLSL 检查通过')
process.exit(failed ? 1 : 0)
