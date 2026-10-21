/**
 * 极简 JSX/TS 词法分析器 —— 给「代码流」上色用。
 *
 * 不用 highlight.js 的原因：
 *  - 它没有 tsx 语言，JSX 标签基本不上色，而这正是代码流最该发亮的部分；
 *  - 它只能吐 HTML 字符串，分享卡要用 canvas 画，需要结构化 token。
 *
 * 输出是 token 数组，DOM 渲染和 canvas 绘制共用同一份数据。
 */

export type TokenType =
  | 'keyword'
  | 'string'
  | 'number'
  | 'func'
  | 'tag'
  | 'attr'
  | 'comment'
  | 'punct'
  | 'type'
  | 'plain'

export interface Segment {
  text: string
  type: TokenType
}

const KEYWORDS = new Set([
  'import', 'export', 'default', 'from', 'as', 'const', 'let', 'var', 'function', 'return',
  'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'break', 'continue', 'new', 'class',
  'extends', 'implements', 'interface', 'type', 'enum', 'namespace', 'declare', 'abstract',
  'public', 'private', 'protected', 'readonly', 'static', 'async', 'await', 'yield', 'typeof',
  'instanceof', 'in', 'of', 'keyof', 'satisfies', 'is', 'void', 'this', 'super', 'true',
  'false', 'null', 'undefined', 'try', 'catch', 'finally', 'throw', 'get', 'set', 'delete',
  'instanceof', 'never', 'unknown', 'any', 'string', 'number', 'boolean', 'object', 'symbol',
  'bigint', 'infer', 'asserts', 'require',
])

/** 出现这些名字时，`<xxx>` 判定为 JSX 标签而不是比较运算 */
const HTML_TAGS = new Set([
  'div', 'span', 'p', 'a', 'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'section',
  'header', 'footer', 'nav', 'main', 'aside', 'article', 'button', 'input', 'label', 'img',
  'table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th', 'form', 'select', 'option', 'optgroup',
  'svg', 'path', 'circle', 'rect', 'line', 'polyline', 'polygon', 'ellipse', 'g', 'defs', 'text',
  'tspan', 'linearGradient', 'radialGradient', 'stop', 'filter', 'feGaussianBlur', 'mask',
  'pattern', 'clipPath', 'br', 'hr', 'small', 'strong', 'em', 'pre', 'code', 'blockquote', 'dl',
  'dt', 'dd', 'figure', 'figcaption', 'canvas', 'progress', 'textarea', 'video', 'iframe',
  'picture', 'source', 'time', 'mark', 'sup', 'sub', 'abbr', 'caption', 'details', 'summary',
  'dialog', 'menu', 'template', 'slot', 'animate', 'set',
])

/** `<` 前面是这些字符时，允许出现 JSX */
const JSX_LEAD = new Set(['(', ',', '=', '{', '}', '[', ';', ':', '?', '>', '&', '|', '!', '+', '-', '~', '*'])

const isIdentStart = (c: string) => /[A-Za-z_$]/.test(c)
const isIdent = (c: string) => /[A-Za-z0-9_$]/.test(c)
const isDigit = (c: string) => /[0-9]/.test(c)

export function tokenize(code: string): Segment[] {
  const out: Segment[] = []
  let i = 0
  let lead = '' // 上一个有意义的字符，用来判断 JSX 上下文

  const push = (type: TokenType, text: string) => {
    if (!text) return
    out.push({ text, type })
    if (!/\s/.test(text)) lead = text.trim().slice(-1)
  }

  while (i < code.length) {
    const c = code[i]

    // 空白：原样保留，不更新 lead
    if (/\s/.test(c)) {
      let j = i
      while (j < code.length && /\s/.test(code[j])) j++
      out.push({ text: code.slice(i, j), type: 'plain' })
      i = j
      continue
    }

    // 注释
    if (c === '/' && code[i + 1] === '/') {
      const end = code.indexOf('\n', i)
      const stop = end === -1 ? code.length : end
      push('comment', code.slice(i, stop))
      i = stop
      continue
    }
    if (c === '/' && code[i + 1] === '*') {
      const end = code.indexOf('*/', i + 2)
      const stop = end === -1 ? code.length : end + 2
      push('comment', code.slice(i, stop))
      i = stop
      continue
    }

    // 字符串
    if (c === '"' || c === "'") {
      let j = i + 1
      while (j < code.length) {
        if (code[j] === '\\') {
          j += 2
          continue
        }
        if (code[j] === c) {
          j++
          break
        }
        j++
      }
      push('string', code.slice(i, j))
      i = j
      continue
    }

    // 模板字符串
    if (c === '`') {
      let j = i + 1
      while (j < code.length) {
        if (code[j] === '\\') {
          j += 2
          continue
        }
        if (code[j] === '`') {
          j++
          break
        }
        j++
      }
      push('string', code.slice(i, j))
      i = j
      continue
    }

    // JSX 标签
    if (c === '<' && (lead === '' || JSX_LEAD.has(lead)) && /[A-Za-z_$>]/.test(code[i + 1] ?? '')) {
      const name = /^<\/?([A-Za-z][\w.-]*)/.exec(code.slice(i))
      const tagName = name?.[1] ?? ''
      const looksJsx = /^[A-Z]/.test(tagName) || HTML_TAGS.has(tagName)
      if (looksJsx) {
        const res = scanTag(code, i)
        for (const seg of res.segments) push(seg.type, seg.text)
        i = res.end
        continue
      }
    }

    // 标识符 / 关键字
    if (isIdentStart(c)) {
      let j = i
      while (j < code.length && isIdent(code[j])) j++
      const word = code.slice(i, j)
      let k = j
      while (k < code.length && /\s/.test(code[k])) k++
      const next = code[k] ?? ''
      if (KEYWORDS.has(word)) push('keyword', word)
      else if (next === '(') push('func', word)
      else if (/^[A-Z]/.test(word)) push('type', word)
      else push('plain', word)
      i = j
      continue
    }

    // 数字
    if (isDigit(c)) {
      let j = i
      while (j < code.length && /[0-9a-fA-FxX._]/.test(code[j])) j++
      push('number', code.slice(i, j))
      i = j
      continue
    }

    // 标点
    let j = i
    while (j < code.length && /[{}()[\];,.:?!<>=+\-*/%&|^~]/.test(code[j])) j++
    if (j === i) j = i + 1 // 兜底：任何字符都要被吃掉一个，否则会死循环
    push('punct', code.slice(i, j))
    i = j
  }

  return out
}

/** 扫描一个 JSX 标签：<Tag attr="v" {...x} /> */
function scanTag(code: string, start: number): { segments: Segment[]; end: number } {
  const segments: Segment[] = []
  let i = start
  const add = (type: TokenType, text: string) => {
    if (text) segments.push({ text, type })
  }

  add('punct', '<')
  i++
  if (code[i] === '/') {
    add('punct', '/')
    i++
  }
  // 标签名
  let j = i
  while (j < code.length && /[\w.-]/.test(code[j])) j++
  add('tag', code.slice(i, j))
  i = j

  // 属性区
  while (i < code.length) {
    const c = code[i]
    if (c === '>') {
      add('punct', '>')
      i++
      break
    }
    if (c === '/' && code[i + 1] === '>') {
      add('punct', '/>')
      i += 2
      break
    }
    if (/\s/.test(c)) {
      let k = i
      while (k < code.length && /\s/.test(code[k])) k++
      add('plain', code.slice(i, k))
      i = k
      continue
    }
    if (c === '"' || c === "'") {
      let k = i + 1
      while (k < code.length) {
        if (code[k] === '\\') {
          k += 2
          continue
        }
        if (code[k] === c) {
          k++
          break
        }
        k++
      }
      add('string', code.slice(i, k))
      i = k
      continue
    }
    if (c === '{') {
      // 表达式：简单找到配对的 }
      let depth = 0
      let k = i
      while (k < code.length) {
        if (code[k] === '{') depth++
        else if (code[k] === '}') {
          depth--
          if (depth === 0) {
            k++
            break
          }
        }
        k++
      }
      add('plain', code.slice(i, k))
      i = k
      continue
    }
    // 属性名
    let k = i
    while (k < code.length && /[\w-]/.test(code[k])) k++
    if (k === i) {
      add('punct', code[i])
      i++
      continue
    }
    add('attr', code.slice(i, k))
    i = k
  }

  return { segments, end: i }
}

export const TOKEN_CLASS: Record<TokenType, string> = {
  keyword: 'tk',
  string: 'ts',
  number: 'tn',
  func: 'tf',
  tag: 'tt',
  attr: 'ta',
  comment: 'tc',
  punct: 'tp',
  type: 'tt',
  plain: 'td',
}

/** canvas 绘制用配色 */
export const TOKEN_COLOR: Record<TokenType, string> = {
  keyword: '#ff8fa3',
  string: '#a5e075',
  number: '#ffb86c',
  func: '#82aaff',
  tag: '#7fdbca',
  attr: '#89ddff',
  comment: '#5d6773',
  punct: '#6b7686',
  type: '#7fdbca',
  plain: '#d7dde5',
}
