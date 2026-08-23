/**
 * Pure doc-page helpers — SPEC.md §1.7 (pages, collections, the soft
 * edit-lock) and §2.3 (`collections`, `pages`).
 *
 * Decision/IO split, same as `tasks.ts` and `posts.ts`: payload shapes, the
 * edit-lock staleness rule, the collection-tree ordering, and the
 * links-from-document extraction live here as tested pure functions; the
 * hooks only await the writes that carry the results.
 */

import { byPosition } from '@/lib/ordering'

/** Explicit column lists — never select('*') (keeps mock and wire payloads honest). */
export const COLLECTION_COLUMNS = 'id,name,parent_id,position,created_at'
/** The list view never needs the document itself. */
export const PAGE_LIST_COLUMNS = 'id,collection_id,title,position,created_by,updated_at,created_at'
export const PAGE_COLUMNS =
  'id,collection_id,title,body_rich,position,created_by,updated_at,editing_user_id,editing_heartbeat_at,created_at'

export interface Collection {
  id: string
  name: string
  parent_id: string | null
  /** Order among siblings sharing this parent — fractional, src/lib/ordering.ts. */
  position: number
  created_at: string
}

/** A page as the list sees it — no document, no edit-lock columns. */
export interface PageMeta {
  id: string
  collection_id: string | null
  title: string
  /** Order within its collection — fractional, src/lib/ordering.ts. */
  position: number
  created_by: string | null
  updated_at: string
  created_at: string
}

/** A page as the editor sees it. */
export interface Page extends PageMeta {
  body_rich: unknown
  editing_user_id: string | null
  editing_heartbeat_at: string | null
}

/** What a page insert carries. `id`/timestamps come from the database. */
export function pageInsertPayload(opts: {
  collectionId: string | null
  createdBy: string
  title?: string
  /**
   * Order within the collection. Optional: the column carries an epoch
   * default that lands an unpositioned page at the bottom, so a caller that
   * has not read the collection's last position still inserts successfully.
   */
  position?: number
}): {
  collection_id: string | null
  title: string
  body_rich: null
  created_by: string
  position?: number
} {
  return {
    collection_id: opts.collectionId,
    title: opts.title?.trim() || 'Untitled',
    body_rich: null,
    created_by: opts.createdBy,
    ...(opts.position === undefined ? {} : { position: opts.position }),
  }
}

/**
 * The autosave patch. `updated_at` is stamped by the client on content saves
 * only — the migration deliberately has no updated_at trigger, because the
 * heartbeat below is also an UPDATE and must not count as an edit.
 */
export function savePatch(
  title: string,
  bodyRich: unknown,
  nowIso: string,
): { title: string; body_rich: unknown; updated_at: string } {
  return { title: title.trim() || 'Untitled', body_rich: bodyRich, updated_at: nowIso }
}

/**
 * Autosave latch (SPEC §1.7: 1s debounce). Latched-trailing like the unread
 * writes: the save fires 1s after the FIRST unsaved change — a timer that
 * reset on every keystroke would never fire under continuous typing.
 */
export const AUTOSAVE_DEBOUNCE_MS = 1_000

// --- The soft edit-lock (SPEC §1.7) -------------------------------------

/** Refresh the claim this often while editing. */
export const HEARTBEAT_INTERVAL_MS = 15_000
/** A claim older than this is stale — the editor left without releasing. */
export const HEARTBEAT_STALE_MS = 45_000
/** Readers re-fetch the page row this often to keep the banner honest. */
export const EDIT_LOCK_POLL_MS = 15_000

/** The claim/refresh write — touches only the two lock columns, never updated_at. */
export function heartbeatPatch(
  userId: string,
  nowIso: string,
): { editing_user_id: string; editing_heartbeat_at: string } {
  return { editing_user_id: userId, editing_heartbeat_at: nowIso }
}

/** The release write, for when the editor leaves the page. */
export function releasePatch(): {
  editing_user_id: null
  editing_heartbeat_at: null
} {
  return { editing_user_id: null, editing_heartbeat_at: null }
}

/**
 * Who the "someone is editing" banner should name: the claiming user's id, or
 * null for no banner. Self never sees their own claim, and a heartbeat older
 * than HEARTBEAT_STALE_MS means the editor left without releasing — the
 * banner must drop rather than name a ghost.
 */
export function editingBanner(
  page: Pick<Page, 'editing_user_id' | 'editing_heartbeat_at'>,
  meId: string | null,
  nowMs: number,
): string | null {
  if (page.editing_user_id === null || page.editing_heartbeat_at === null) return null
  if (page.editing_user_id === meId) return null
  const beat = Date.parse(page.editing_heartbeat_at)
  if (Number.isNaN(beat) || nowMs - beat > HEARTBEAT_STALE_MS) return null
  return page.editing_user_id
}

// --- Collections tree ----------------------------------------------------

export interface TreeRow {
  collection: Collection
  depth: number
}

/**
 * The tree as a flat render list: depth-first, siblings in dragged order.
 * Defensive on bad data — an unknown parent_id renders at the root instead of
 * vanishing, and a cycle (schema-legal: the FK only checks existence) is
 * broken by the visited set rather than looping forever.
 */
export function flattenTree(collections: readonly Collection[]): TreeRow[] {
  const byParent = new Map<string | null, Collection[]>()
  const ids = new Set(collections.map((c) => c.id))
  for (const c of collections) {
    const key = c.parent_id !== null && ids.has(c.parent_id) ? c.parent_id : null
    const list = byParent.get(key)
    if (list) list.push(c)
    else byParent.set(key, [c])
  }
  // Siblings sort by their dragged position, not by name (beta round 3). The
  // backfill seeded positions in the old alphabetical order, so the first
  // render after that migration looks exactly like the last render before it.
  for (const list of byParent.values()) list.sort(byPosition)

  const out: TreeRow[] = []
  const visited = new Set<string>()
  const walk = (parentId: string | null, depth: number) => {
    for (const c of byParent.get(parentId) ?? []) {
      if (visited.has(c.id)) continue
      visited.add(c.id)
      out.push({ collection: c, depth })
      walk(c.id, depth + 1)
    }
  }
  walk(null, 0)
  // A cycle detached from the root is unreachable by the walk; surface its
  // members at the root rather than hiding them.
  for (const c of collections) {
    if (!visited.has(c.id)) {
      visited.add(c.id)
      out.push({ collection: c, depth: 0 })
    }
  }
  return out
}

// --- Links derived from the document (SPEC §1.8) -------------------------

export type LinkTargetType = 'task' | 'message' | 'post' | 'page'

export interface LinkTarget {
  target_type: LinkTargetType
  target_id: string
}

/**
 * The internal entity an href points at, or null for an external or
 * unrecognized URL. Accepts app-relative hrefs and absolute ones on `origin`.
 * The URL shapes are the ones the app itself mints: /tasks?t=<uuid>,
 * /docs/<uuid>, /posts/<uuid>[?m=<id>], /channels/<uuid>?m=<id> — a ?m=
 * parameter wins over the page it rides on, because the link's subject is the
 * exact message, same as the SourceChip URLs it mirrors.
 */
export function linkTargetFromHref(href: string, origin: string): LinkTarget | null {
  let path = href
  if (/^[a-z][a-z0-9+.-]*:/i.test(href)) {
    // Absolute — only our own origin can carry an internal target.
    if (!href.toLowerCase().startsWith(origin.toLowerCase() + '/')) return null
    path = href.slice(origin.length)
  }
  if (!path.startsWith('/')) return null

  const q = path.indexOf('?')
  const pathname = q === -1 ? path : path.slice(0, q)
  const params = new URLSearchParams(q === -1 ? '' : path.slice(q + 1))
  const segments = pathname.split('/').filter((s) => s !== '')

  const m = params.get('m')
  if (m !== null && /^\d+$/.test(m)) {
    if (
      (segments[0] === 'channels' || segments[0] === 'posts') &&
      segments.length === 2
    ) {
      return { target_type: 'message', target_id: m }
    }
    return null
  }

  if (segments[0] === 'tasks' && segments.length === 1) {
    const t = params.get('t')
    return t !== null && t !== '' ? { target_type: 'task', target_id: t } : null
  }
  if (segments[0] === 'posts' && segments.length === 2) {
    return { target_type: 'post', target_id: segments[1] }
  }
  if (segments[0] === 'docs' && segments.length === 2) {
    return { target_type: 'page', target_id: segments[1] }
  }
  return null
}

interface LinkInline {
  type: 'link'
  href: string
}

function isLinkInline(value: unknown): value is LinkInline {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { type?: unknown }).type === 'link' &&
    typeof (value as { href?: unknown }).href === 'string'
  )
}

function collectHrefs(node: unknown, out: string[]): void {
  if (Array.isArray(node)) {
    for (const item of node) collectHrefs(item, out)
    return
  }
  if (typeof node !== 'object' || node === null) return
  const record = node as Record<string, unknown>
  if (isLinkInline(record)) out.push(record.href)
  // Blocks carry `content` (inline array, or a table-content object with
  // rows/cells) and `children`; table cells carry `content` again. Walking
  // every plausible container keeps the extractor honest against BlockNote
  // shapes we have not met yet — an unknown container yields nothing, never
  // throws.
  collectHrefs(record.content, out)
  collectHrefs(record.children, out)
  collectHrefs(record.rows, out)
  collectHrefs(record.cells, out)
}

/**
 * Every internal entity the document links to, deduped, in first-appearance
 * order. This is what the autosave diffs against the page's `links` rows —
 * the rows are derived from the document, so deleting a link's text removes
 * its edge on the next save (SPEC §1.8: integrity is app-enforced).
 */
export function linksFromDoc(bodyRich: unknown, origin: string): LinkTarget[] {
  const hrefs: string[] = []
  collectHrefs(bodyRich, hrefs)
  const seen = new Set<string>()
  const out: LinkTarget[] = []
  for (const href of hrefs) {
    const target = linkTargetFromHref(href, origin)
    if (target === null) continue
    const key = `${target.target_type}:${target.target_id}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(target)
  }
  return out
}

/**
 * The links row for a page referencing another entity. Message ids arrive
 * already stringified — they come out of the document's hrefs, not from a
 * bigint column, so no coercion happens here (cf. linkForTask, where it does).
 */
export function linkForPage(pageId: string, target: LinkTarget) {
  return {
    source_type: 'page',
    source_id: pageId,
    target_type: target.target_type,
    target_id: target.target_id,
    kind: 'references',
  } as const
}

/**
 * What a save must write and delete to make the page's stored edges equal the
 * document's links. `remove` is row ids so the delete is exact.
 */
export function linkDiff(
  current: readonly { id: string; target_type: string; target_id: string }[],
  want: readonly LinkTarget[],
): { add: LinkTarget[]; remove: string[] } {
  const wantKeys = new Set(want.map((t) => `${t.target_type}:${t.target_id}`))
  const haveKeys = new Set(current.map((r) => `${r.target_type}:${r.target_id}`))
  return {
    add: want.filter((t) => !haveKeys.has(`${t.target_type}:${t.target_id}`)),
    remove: current
      .filter((r) => !wantKeys.has(`${r.target_type}:${r.target_id}`))
      .map((r) => r.id),
  }
}
