/**
 * Pure search helpers — SPEC.md §1.10, §3. The query builder here is a
 * never-break test path (ROADMAP): grouping, jump paths, and snippet
 * parsing are what stand between search_all()'s rows and the palette.
 */

export const SEARCH_DEBOUNCE_MS = 300
/** Below this, don't call — one letter matches everything and means nothing. */
export const SEARCH_MIN_LENGTH = 2

export type SearchEntityType = 'message' | 'post' | 'page' | 'task'

export interface SearchResult {
  entity_type: SearchEntityType
  entity_id: string
  parent_type: 'channel' | 'post' | null
  parent_id: string | null
  title: string
  snippet: string
  rank: number
}

/** Fixed group order for the palette, with headings. */
export const SEARCH_GROUPS: readonly { type: SearchEntityType; label: string }[] = [
  { type: 'message', label: 'Messages' },
  { type: 'post', label: 'Posts' },
  { type: 'page', label: 'Pages' },
  { type: 'task', label: 'Tasks' },
]

/** True when the query is worth sending. */
export function queryReady(q: string): boolean {
  return q.trim().length >= SEARCH_MIN_LENGTH
}

/**
 * Rows bucketed by entity type, rank order preserved within each bucket.
 * Unknown types are dropped rather than rendered under a missing heading.
 */
export function groupResults(
  rows: readonly SearchResult[],
): Map<SearchEntityType, SearchResult[]> {
  const known = new Set(SEARCH_GROUPS.map((g) => g.type))
  const grouped = new Map<SearchEntityType, SearchResult[]>()
  for (const row of rows) {
    if (!known.has(row.entity_type)) continue
    const list = grouped.get(row.entity_type)
    if (list) list.push(row)
    else grouped.set(row.entity_type, [row])
  }
  return grouped
}

/**
 * Where clicking a result lands, or null for a row that cannot be navigated
 * (unknown type, or a message hit missing its parent) — the palette skips
 * those rather than rendering a dead item.
 */
export function jumpPathFor(r: SearchResult): string | null {
  switch (r.entity_type) {
    case 'message':
      if (r.parent_id === null || r.parent_id === '') return null
      if (r.parent_type === 'channel') return `/channels/${r.parent_id}?m=${r.entity_id}`
      if (r.parent_type === 'post') return `/posts/${r.parent_id}?m=${r.entity_id}`
      return null
    case 'post':
      return `/posts/${r.entity_id}`
    case 'page':
      return `/docs/${r.entity_id}`
    case 'task':
      return `/tasks?t=${r.entity_id}`
    default:
      return null
  }
}

export interface SnippetSegment {
  text: string
  match: boolean
}

/**
 * ts_headline emits the matched terms between ⟦…⟧ markers (StartSel/StopSel
 * in the migration) — markers, not HTML, precisely so the snippet is never
 * injected as markup: the source text is user-authored, and default <b> tags
 * would force dangerouslySetInnerHTML. This parses the markers into segments
 * the palette renders as React nodes. Unbalanced markers degrade to plain
 * text of what remains.
 */
export function splitSnippet(snippet: string): SnippetSegment[] {
  const out: SnippetSegment[] = []
  let rest = snippet
  for (;;) {
    const start = rest.indexOf('⟦')
    if (start === -1) break
    const end = rest.indexOf('⟧', start + 1)
    if (end === -1) break
    if (start > 0) out.push({ text: rest.slice(0, start), match: false })
    out.push({ text: rest.slice(start + 1, end), match: true })
    rest = rest.slice(end + 1)
  }
  if (rest !== '') out.push({ text: rest.replace(/[⟦⟧]/g, ''), match: false })
  return out
}
