/**
 * TSX → 可执行 JS。
 *
 * 关键点：把裸模块说明符改写成自托管的绝对地址，
 * 这样预览沙箱里不需要 import map，也不依赖任何 CDN —— 断网也能跑。
 */

type SucraseModule = typeof import('sucrase')

let sucrasePromise: Promise<SucraseModule> | null = null

function loadSucrase(): Promise<SucraseModule> {
  if (!sucrasePromise) sucrasePromise = import('sucrase').then((m) => m)
  return sucrasePromise
}

export type CompileResult = { ok: true; js: string } | { ok: false; error: string }

/** 取出像 GLSL 的模板字符串片段（含其起始偏移，便于报行号） */
function glslChunks(source: string): { code: string; offset: number }[] {
  const out: { code: string; offset: number }[] = []
  const re = /`([^`]*)`/g
  let m: RegExpExecArray | null
  while ((m = re.exec(source))) {
    if (/precision\s+(?:low|medium|high)p\s+float|gl_Position|gl_FragColor/.test(m[1])) {
      out.push({ code: m[1], offset: m.index + 1 })
    }
  }
  return out
}

/**
 * 检查 GLSL 里用到的 uniform 是否都声明过。
 *
 * 必要性：模型漏写 `uniform vec2 u_resolution;` 时片段着色器编译失败，
 * 而组件通常写成「编译不过就 return」，错误被静默吞掉 —— 预览只剩一张静止黑图。
 * 现有报错回路只抓 JS 运行时错误，抓不到这种，所以在编译阶段主动报出来，
 * 让它进「报错 → 模型自己改」的闭环。
 */
function checkShaderUniforms(source: string): string | null {
  for (const chunk of glslChunks(source)) {
    const declared = new Set<string>()
    const decl = /\b(?:uniform|attribute|varying)\s+\w+\s+([^;]+);/g
    let d: RegExpExecArray | null
    while ((d = decl.exec(chunk.code))) {
      for (const part of d[1].split(',')) {
        const name = /(\w+)\s*(?:\[[^\]]*\])?\s*$/.exec(part.trim())?.[1]
        if (name) declared.add(name)
      }
    }
    const used = [...chunk.code.matchAll(/\b(u_\w+)\b/g)].map((m) => m[1])
    const missing = [...new Set(used.filter((u) => !declared.has(u)))]
    if (!missing.length) continue

    const first = chunk.code.indexOf(missing[0])
    const line = source.slice(0, chunk.offset + Math.max(0, first)).split('\n').length
    return `着色器第 ${line} 行用到了未声明的 ${missing.join('、')}：GLSL 编译会失败。请补上对应的 uniform 声明（例如 uniform vec2 u_resolution;），并在 JS 里 getUniformLocation 后上传。`
  }
  return null
}

function runtimeUrl(): string {
  return new URL('/vendor/react.js', window.location.origin).href
}

/** react / react-dom / react/jsx-runtime 全部指向同一个自托管 bundle（保证只有一个 React 实例） */
function rewriteImports(code: string): string {
  return code.replace(/((?:from|import)\s*)(['"])(react[^'"]*)\2/g, (_m, pre, q) => {
    return `${pre}${q}${runtimeUrl()}${q}`
  })
}

function formatError(err: unknown): string {
  const e = err as { message?: string; loc?: { line: number; column: number } }
  if (e?.loc) return `第 ${e.loc.line} 行：${e.message ?? '语法错误'}`
  return e?.message ?? String(err)
}

export async function compileTsx(source: string): Promise<CompileResult> {
  if (!source.trim()) return { ok: false, error: '代码为空' }
  // 静态检查放在编译前：报错信息更准（行号对着源码，不是对着编译产物）
  const shaderIssue = checkShaderUniforms(source)
  if (shaderIssue) return { ok: false, error: shaderIssue }
  try {
    const { transform } = await loadSucrase()
    const { code } = transform(source, {
      transforms: ['typescript', 'jsx'],
      jsxRuntime: 'automatic',
      jsxImportSource: 'react',
      production: true,
    })
    return { ok: true, js: rewriteImports(code) }
  } catch (err) {
    return { ok: false, error: formatError(err) }
  }
}
