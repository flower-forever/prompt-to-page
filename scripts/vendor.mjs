/**
 * 把 React 运行时与 Tailwind 浏览器版打包成自托管的静态资源。
 *
 * 为什么要自己打包：
 *  1. 预览沙箱（iframe）里只能用绝对 URL 加载模块，自托管才能完全离线跑；
 *  2. React 只能有一份实例，否则 hooks 会炸 —— 所以 react / react-dom /
 *     react/jsx-runtime 必须打进同一个 bundle；
 *  3. Tailwind v4 的浏览器版是单文件 IIFE，直接注入沙箱即可免构建出样式。
 */
import { build } from 'esbuild'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const out = path.join(root, 'public', 'vendor')

await fs.rm(out, { recursive: true, force: true })
await fs.mkdir(out, { recursive: true })

// ── 1. React 全家桶（单一实例） ───────────────────────────────
await build({
  stdin: {
    contents: `
      import React, {
        Activity, Children, Component, Fragment, PureComponent, StrictMode, Suspense,
        cache, cloneElement, createContext, createElement, createRef, forwardRef,
        isValidElement, lazy, memo, startTransition, use, useActionState, useCallback,
        useContext, useDebugValue, useDeferredValue, useEffect, useId, useImperativeHandle,
        useLayoutEffect, useMemo, useOptimistic, useReducer, useRef, useState,
        useSyncExternalStore, useTransition, version
      } from 'react'
      import { jsx, jsxs } from 'react/jsx-runtime'
      import { createRoot, hydrateRoot } from 'react-dom/client'

      export {
        Activity, Children, Component, Fragment, PureComponent, StrictMode, Suspense,
        cache, cloneElement, createContext, createElement, createRef, forwardRef,
        isValidElement, lazy, memo, startTransition, use, useActionState, useCallback,
        useContext, useDebugValue, useDeferredValue, useEffect, useId, useImperativeHandle,
        useLayoutEffect, useMemo, useOptimistic, useReducer, useRef, useState,
        useSyncExternalStore, useTransition, version, jsx, jsxs, createRoot, hydrateRoot
      }
      export default React
    `,
    resolveDir: root,
    sourcefile: 'forge-runtime-entry.js',
    loader: 'js',
  },
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: ['es2020'],
  define: { 'process.env.NODE_ENV': '"production"' },
  minify: true,
  legalComments: 'none',
  outfile: path.join(out, 'react.js'),
})

// ── 2. Tailwind v4 浏览器版（免构建、运行时扫描 DOM） ─────────
const tailwindSrc = path.join(root, 'node_modules', '@tailwindcss', 'browser', 'dist', 'index.global.js')
await fs.copyFile(tailwindSrc, path.join(out, 'tailwind.js'))

const files = await fs.readdir(out)
const sizes = await Promise.all(
  files.map(async (f) => `${f.padEnd(14)} ${(await fs.stat(path.join(out, f))).size} B`),
)
console.log('[vendor] 已生成 public/vendor:')
console.log(sizes.map((s) => '  ' + s).join('\n'))
