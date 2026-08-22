/**
 * Minimal BlockNote-shaped paragraphs from plain text, and back. Until P4's
 * real editor lands, every rich column (`tasks.description_rich`,
 * `posts.body_rich`) is written from a plain textarea through these — so P4
 * loads the same columns without a migration (SPEC §2.3, DECISIONS #23). One
 * block per line, empty lines preserved as empty paragraphs.
 */

export interface RichParagraph {
  type: 'paragraph'
  content: { type: 'text'; text: string; styles: Record<string, never> }[]
}

export function richFromPlain(text: string): RichParagraph[] | null {
  if (text.trim() === '') return null
  return text.split('\n').map((line) => ({
    type: 'paragraph',
    content: line === '' ? [] : [{ type: 'text', text: line, styles: {} }],
  }))
}

export function plainFromRich(rich: unknown): string {
  if (!Array.isArray(rich)) return ''
  return rich
    .map((block: { content?: { text?: string }[] }) =>
      Array.isArray(block?.content) ? block.content.map((c) => c?.text ?? '').join('') : '',
    )
    .join('\n')
}
