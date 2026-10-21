/**
 * 共享的代码抽取逻辑：模型可能先吐一段话再吐 ```tsx 代码块，
 * 流式过程中需要「边收边抽」，服务端修复流程则需要一次性抽取。
 */

export class CodeStream {
  private raw = ''

  push(chunk: string): string {
    this.raw += chunk
    return this.current()
  }

  get rawText(): string {
    return this.raw
  }

  /** 已经出现闭合围栏 → 说明模型写完了 */
  get complete(): boolean {
    const open = this.raw.indexOf('```')
    if (open === -1) return false
    const body = this.raw.slice(open + 3)
    const nl = body.indexOf('\n')
    if (nl === -1) return false
    return body.slice(nl + 1).includes('```')
  }

  current(): string {
    const open = this.raw.indexOf('```')
    if (open === -1) return ''
    const body = this.raw.slice(open + 3)
    const nl = body.indexOf('\n')
    if (nl === -1) return ''
    const content = body.slice(nl + 1)
    const close = content.indexOf('```')
    return (close === -1 ? content : content.slice(0, close)).replace(/\s+$/, '')
  }
}

/** 一次性抽取：返回围栏内的代码，没有围栏就原样返回 */
export function extractCode(text: string): string {
  const fence = /```(?:tsx|jsx|ts|js|javascript|typescript)?\s*\n([\s\S]*?)```/.exec(text)
  if (fence) return fence[1].trim()
  return text.trim()
}
