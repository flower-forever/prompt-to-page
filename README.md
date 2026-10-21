# prompt-to-page · 实时造物工坊

> 一句话，页面当场长出来。
> MiniMax M3.1 Flash 前端能力的现场演示 —— 200+ TPS 的流式代码，在浏览器里实时编译成能点的页面。

![demo](docs/demo.gif)

> 上图是「回放」模式：录制自一次真实调用（2228 个增量事件，82.3s），回放时时间轴被压缩到 18 秒。

<img src="docs/landing.png" width="820" alt="实时造物工坊界面">

| | |
|---|---|
| 在线体验 | `npm run dev` → http://localhost:5173 |
| 模型 | MiniMax-M3.1-Flash（1M 上下文 / 原生多模态 / 200+ TPS） |
| 成本 | 一次完整页面生成约 **¥0.008 ~ ¥0.02** |
| 技术栈 | React 19 · Tailwind v4 · Vite 8 · Hono(SSE) · sucrase |

---

## 这是什么

一个「观众自己打一句话，页面当场长出来」的网页：

1. 输入框里敲一句中文需求 → 回车；
2. 右侧代码流以 200+ TPS 的速度实时写出 React + Tailwind 代码；
3. 左侧预览区在几秒内渲染出**可交互**的成品页面（按钮能点、标签页能切）；
4. 底部 HUD 实时显示首字延迟、输出 token、TPS 和**这次生成花了多少钱**。

整个过程没有构建步骤：TSX 在浏览器里编译，React 运行时和 Tailwind v4 全部自托管，断网也能跑。

实测（`effort=low`）：

| 需求 | 首字 | 首码 | 成品 | 输出 | TPS | 成本 |
|---|---|---|---|---|---|---|
| 极简番茄钟 | 5.4s | 6.6s | **17.7s** | 1,832 tok | 222（峰值） | ¥0.0078 |
| 深色播客订阅页 | 1.1s | 1.8s | **39.6s** | 4,992 tok | 126 | ¥0.0195 |

成品是可交互的：按钮能点、标签页能切、折叠能展开。

## 快速开始

```bash
npm install
cp .env.example .env   # 填入 MINIMAX_API_KEY
npm run dev            # http://localhost:5173（vendor 会自动生成）
```

没有 key 也能玩：首屏直接渲染录制好的成品，点顶栏「▶ 回放」按原始时间轴回放一次真实生成。

生产部署：

```bash
npm run build && npm start   # 单进程同时提供 API 与静态资源，默认 8787
```

## 运行时数据流

```
用户输入 ──▶ /api/stream ──▶ MiniMax-M3.1-Flash ──▶ 流解析器 ──▶ 编译 ──▶ 全屏预览
 (SSE 代理)   (Hono)          thinking + text 双流    抽 ```tsx   (sucrase)   (iframe 沙箱)
                    ▲                                          节流 150ms
                    └──── 报错回喂：Agent 自己改代码 ────────────┘
```

- **SSE 代理**：密钥只留在服务端；把 Anthropic 兼容事件翻译成前端协议。
- **流解析器**：边收边从 ```` ```tsx ```` 围栏里抽代码，60ms 节流一次 state 更新。
- **编译器**：`sucrase` 在主线程把 TSX 转成 JS（改成绝对 URL 指向自托管的 React）。
- **沙箱**：`<iframe srcdoc>` + Tailwind v4 浏览器版，免构建出样式；运行时报错通过 `postMessage` 回传。

## 目录

```
live-forge/
├─ src/
│  ├─ components/     Preview 沙箱 / CodePanel 代码流 / Stage / Composer / Hud / ShareSheet
│  ├─ lib/
│  │  ├─ tokenize.ts  自研 JSX 感知词法分析（代码流上色 + canvas 画分享卡共用）
│  │  ├─ compile.ts   TSX → JS，改写裸模块说明符为自托管绝对地址
│  │  ├─ previewShell.ts  注入沙箱的 HTML
│  │  └─ shareCard.ts 1200×630 分享卡（纯 canvas，零依赖）
│  ├─ store.ts        zustand：流式状态机 + 指标 + 修复回路
├─ server/
│  ├─ index.ts        Hono：/api/stream (SSE) /api/repair /api/health /api/demos
│  └─ prompt.ts       输出契约（system prompt）
├─ shared/extract.ts  流式代码抽取（前后端共用）
├─ scripts/
│  ├─ dev.mjs         自写 dev runner（见下方备注）
│  ├─ record.ts       录制一次真实生成 → public/demos/*.json
│  ├─ capture.mjs     录屏转 GIF（README 用）
│  ├─ e2e.mjs / shot.mjs / ui-check.mjs   自动化验证
├─ public/demos/      录制好的回放件
└─ public/vendor/     构建产物（React 运行时 + Tailwind 浏览器版）
```

## 几个刻意的设计决定

**为什么不用 Sandpack。** 它的打包在远程 codesandbox.io 完成，国内首包常 3–8s 且会挂，而这个 demo 的核心就是「当场长出来」。改成自建沙箱后编译在本地、<50ms，且 React 运行时自托管成单个 bundle（保证只有一个 React 实例，否则 hooks 会炸），完全离线可用。

**输出契约要硬。** `server/prompt.ts` 里约束了：单个文件、`export default function App()`、禁止 import 第三方包、图标必须内联 SVG、只用 Tailwind 内置类、交互必须真实。契约越硬，产出越能直接跑。

**默认思考档是 `low`。** 实测 `max` 档会先思考 91 秒（19k 字符）才开始吐代码，演示节奏会垮；`low` 档首字 1.2s。档位在输入框右侧可实时切换。

**错误要闭环。** 沙箱里运行时抛错 → 错误堆栈回喂模型 → 模型改代码 → 重编译。最多自动修一次，仍失败则展示错误并允许手动「再修一次」。

**自己写 dev runner。** 这台 Windows 机器上 `concurrently` 拉起的 `tsx watch` 会秒退并吞掉输出（vite 随之被一起杀掉），所以 `scripts/dev.mjs` 用 `child_process` 自己 spawn 两个进程。

## 脚本

| 命令 | 作用 |
|---|---|
| `npm run dev` | 同时起 vite(5173) 与 API(8787)（自动先跑 vendor） |
| `npm run record -- "<prompt>" <id> [title]` | 录制一次真实生成，存成回放件 |
| `npm run capture` | 录屏并转 GIF（README 用） |
| `npm run e2e -- "<prompt>"` | 端到端验证：流式 → 编译 → 预览出图 |
| `npm run ui-check` | 分享卡 / 回放 / 演示模式 / 移动端 界面检查 |
| `npm run shot` | 截图 + 抓控制台错误 |
| `node scripts/repair-check.mjs` | 验证「报错 → 模型自己改」回路 |

## 已知边界

- 生成物限定为**单个 React 组件文件**。多文件工程要靠 1M 上下文另做一套装配，不在当前范围内。
- 预览沙箱是 `allow-scripts + allow-same-origin`，同源内容理论上可逃离沙箱；模型产出的代码可信，且本项目不落地敏感数据到前端。
- 沙箱内的 Tailwind 走浏览器版，产物页面若用到 Tailwind 之外的高级特性（插件、自定义主题）不会生效。
- 分享卡目前不含成品截图（canvas 抓不到跨文档的 iframe），只有 prompt + 代码片段 + 指标。
