/**
 * 预览沙箱 —— 一段注入到 iframe 的 HTML。
 *
 * - Tailwind v4 浏览器版自托管 → 生成即刻有样式，免构建；
 * - React 运行时自托管 → 断网可用，且与用户代码共享同一个 React 实例；
 * - 编译在主线程完成，这里只负责 import + render + 错误上报。
 */
export function buildShell(origin: string): string {
  const runtime = `${origin}/vendor/react.js`
  const tailwind = `${origin}/vendor/tailwind.js`

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<base href="${origin}/" />
<script src="${tailwind}"></script>
<style>
  html, body, #root { height: 100%; }
  body {
    margin: 0;
    background: #0b0c0e;
    color: #e8ecf2;
    font-family: Inter, ui-sans-serif, system-ui, -apple-system, 'PingFang SC', 'Microsoft YaHei', sans-serif;
    -webkit-font-smoothing: antialiased;
  }
  *, *::before, *::after { box-sizing: border-box; }
  #boot {
    position: fixed; inset: 0; display: grid; place-items: center;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 12px; letter-spacing: .08em; color: #4b5563;
  }
</style>
</head>
<body>
<div id="root"><div id="boot">waiting for code…</div></div>
<script type="module">
import React, { createRoot } from ${JSON.stringify(runtime)};

const post = (m) => parent.postMessage(m, ${JSON.stringify(origin)});

window.addEventListener('error', (e) => {
  post({ type: 'preview-error', message: String(e.message || e.error), stack: e.error && e.error.stack });
});
window.addEventListener('unhandledrejection', (e) => {
  const r = e.reason;
  post({ type: 'preview-error', message: String((r && r.message) || r), stack: r && r.stack });
});

let root = null;

window.addEventListener('message', async (e) => {
  if (e.origin !== ${JSON.stringify(origin)}) return;
  const d = e.data;
  if (!d || d.type !== 'render') return;
  try {
    const url = URL.createObjectURL(new Blob([d.js], { type: 'text/javascript' }));
    const mod = await import(url);
    URL.revokeObjectURL(url);
    const Comp = mod.default || mod.App;
    if (typeof Comp !== 'function' && typeof Comp !== 'object') {
      throw new Error('组件缺少 default export');
    }
    if (!root) {
      const boot = document.getElementById('boot');
      if (boot) boot.remove();
      root = createRoot(document.getElementById('root'));
    }
    root.render(React.createElement(Comp));
    post({ type: 'preview-ready' });
  } catch (err) {
    post({ type: 'preview-error', message: String((err && err.message) || err), stack: err && err.stack });
  }
});

post({ type: 'preview-shell-ready' });
</script>
</body>
</html>`
}
