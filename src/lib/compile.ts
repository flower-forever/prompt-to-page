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
