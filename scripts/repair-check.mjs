// 直接打 /api/repair：给一段会运行时崩掉的组件，看模型能不能改好
const broken = `import { useState } from 'react'

export default function App() {
  const [n, setN] = useState(0)
  const items = [1, 2, 3]
  return (
    <div className="p-8 text-white bg-zinc-900 min-h-screen">
      <h1 className="text-2xl">计数器</h1>
      <p>当前 {n}</p>
      <button onClick={() => setN(n + 1)} className="px-3 py-1 rounded bg-amber-500 text-black">
        加一
      </button>
      <ul>
        {items.map((it) => (
          <li key={it}>{it.toUpperCase()}</li>
        ))}
      </ul>
    </div>
  )
}
`
// 人为制造运行时错误：访问未定义变量
const withBug = broken.replace('{n + 1}', '{n + undefinedVar}')

const res = await fetch('http://127.0.0.1:8787/api/repair', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ code: withBug, error: 'ReferenceError: undefinedVar is not defined' }),
})
const json = await res.json()
console.log('状态', res.status)
if (json.error) {
  console.log('错误:', json.error)
} else {
  console.log('修复后的代码:\n')
  console.log(json.code.slice(0, 1200))
  console.log('\n还提到 undefinedVar 吗:', json.code.includes('undefinedVar'))
}
