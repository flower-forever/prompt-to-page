import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './index.css'
import { useForge } from './store'

if (import.meta.env.DEV) {
  // 开发期把 store 挂到 window 上，方便在控制台/自动化里观察状态
  ;(window as unknown as { __forge: typeof useForge }).__forge = useForge
}

const el = document.getElementById('root')
if (el) {
  createRoot(el).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}
