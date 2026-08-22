/**
 * URL detection for chat text — SPEC §1.3's bodies are plain text, so links
 * must be found at render time, the same way mentions are. Pure and tested;
 * the components only map segments to elements.
 */

export interface UrlSegment {
  kind: 'text' | 'url'
  text: string
}

const URL_RE = /https?:\/\/\S+/gi
/** Trailing prose punctuation that reads as sentence, not address. */
const TRAILING_PUNCT = /[.,;:!?)\]}>'"]+$/

/**
 * Split a text run into plain and URL segments, in order. Trailing sentence
 * punctuation stays outside the link ("see https://x.com." links x.com).
 */
export function splitUrls(text: string): UrlSegment[] {
  const out: UrlSegment[] = []
  let last = 0
  for (const match of text.matchAll(URL_RE)) {
    const url = match[0].replace(TRAILING_PUNCT, '')
    if (url.length < 'http://x'.length) continue
    if (match.index > last) out.push({ kind: 'text', text: text.slice(last, match.index) })
    out.push({ kind: 'url', text: url })
    last = match.index + url.length
  }
  if (last < text.length) out.push({ kind: 'text', text: text.slice(last) })
  return out
}

/**
 * The app path of a URL on our own origin, or null for an external one —
 * internal links navigate in the SPA, external ones open a new tab.
 */
export function internalPath(url: string, origin: string): string | null {
  if (!url.toLowerCase().startsWith(origin.toLowerCase() + '/')) return null
  return url.slice(origin.length)
}
