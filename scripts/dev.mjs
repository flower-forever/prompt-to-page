/**
 * 极简 dev runner：同时拉起 vite 与 API 服务，带前缀输出、统一收尾。
 *
 * 为什么不用 concurrently：在这台 Windows 机器上，concurrently 拉起的 tsx watch
 * 会秒退且吞掉输出（vite 随之被一起杀掉），自己 spawn 更可控。
 */
import { spawn } from 'node:child_process'
import process from 'node:process'

const TASKS = [
  { name: 'web', color: '\x1b[36m', cmd: 'npx', args: ['vite'] },
  { name: 'api', color: '\x1b[35m', cmd: 'npx', args: ['tsx', 'watch', 'server/index.ts'] },
]

const RESET = '\x1b[0m'
const children = []
let shuttingDown = false

function prefix(name, color, chunk) {
  const text = chunk.toString()
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue
    process.stdout.write(`${color}[${name}]${RESET} ${line}\n`)
  }
}

function shutdown(code = 0) {
  if (shuttingDown) return
  shuttingDown = true
  for (const c of children) {
    try {
      c.kill()
    } catch {
      /* ignore */
    }
  }
  process.exit(code)
}

for (const task of TASKS) {
  const child = spawn(task.cmd, task.args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: true,
    env: process.env,
  })
  children.push(child)

  child.stdout.on('data', (c) => prefix(task.name, task.color, c))
  child.stderr.on('data', (c) => prefix(task.name, task.color, c))
  child.on('exit', (code) => {
    if (shuttingDown) return
    prefix(task.name, task.color, `进程退出（code ${code}）`)
    shutdown(code ?? 0)
  })
}

process.on('SIGINT', () => shutdown(0))
process.on('SIGTERM', () => shutdown(0))
