import { tokenize, TOKEN_CLASS, type Segment } from './tokenize'

/** 把 token 序列渲染成 HTML（给代码流用） */
export function segmentsToHtml(segments: Segment[]): string {
  return segments
    .map((s) => `<span class="${TOKEN_CLASS[s.type]}">${escapeHtml(s.text)}</span>`)
    .join('')
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

export { tokenize }
export type { Segment }
