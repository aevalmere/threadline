/**
 * Pure forum-post helpers — SPEC.md §1.2 (forum channels), §2.3 (`posts`,
 * `tags`, `post_tags`).
 *
 * Decision/IO split, same as `tasks.ts`: payload shapes, tag normalization,
 * and the list-page folds live here as tested pure functions; `usePosts` only
 * awaits the writes that carry the results. Tags are workspace-global and
 * matched case-insensitively by normalized name — the name is the identity a
 * user types, the uuid is what the join table stores.
 */

import { richFromPlain } from './rich'

/** Explicit column lists — never select('*') (keeps mock and wire payloads honest). */
export const POST_COLUMNS = 'id,channel_id,author_id,title,body_rich,created_at'
export const TAG_COLUMNS = 'id,name,color'

export interface Post {
  id: string
  channel_id: string
  author_id: string
  title: string
  body_rich: unknown
  created_at: string
}

export interface Tag {
  id: string
  name: string
  color: string | null
}

/** What a post insert carries. `id`/`created_at` come from the database. */
export interface PostInsert {
  channel_id: string
  author_id: string
  title: string
  body_rich: unknown
}

export const TAG_NAME_MAX = 24

/**
 * The stored form of a tag name: lowercased, inner whitespace collapsed to
 * single hyphens, trimmed, hard-capped. Lowercase makes "Bug" and "bug" the
 * same tag without a case-insensitive index — the unique index on
 * `tags.name` then does the rest.
 */
export function normalizeTagName(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .slice(0, TAG_NAME_MAX)
}

/**
 * Tag names from the form's free-text input: comma-separated, normalized,
 * empties dropped, first occurrence wins on duplicates.
 */
export function parseTagInput(raw: string): string[] {
  const seen = new Set<string>()
  const names: string[] = []
  for (const part of raw.split(',')) {
    const name = normalizeTagName(part)
    if (name !== '' && !seen.has(name)) {
      seen.add(name)
      names.push(name)
    }
  }
  return names
}

/**
 * Display colors a new tag can be born with. Rendered as a small dot next to
 * the name — never as a text or background color, so contrast in either theme
 * is never a concern.
 */
export const TAG_PALETTE = [
  '#ef4444',
  '#f97316',
  '#f59e0b',
  '#10b981',
  '#14b8a6',
  '#3b82f6',
  '#8b5cf6',
  '#ec4899',
] as const

/**
 * Deterministic palette pick so the same tag name gets the same color on
 * every client that races to create it (the loser of the unique-index race
 * re-reads the winner's row, which agrees anyway). djb2 over the name.
 */
export function tagColor(name: string): string {
  let hash = 5381
  for (let i = 0; i < name.length; i++) {
    hash = ((hash << 5) + hash + name.charCodeAt(i)) >>> 0
  }
  return TAG_PALETTE[hash % TAG_PALETTE.length]
}

/** The post insert payload. Title is trimmed; the form refuses empty ones. */
export function postInsertPayload(opts: {
  channelId: string
  authorId: string
  title: string
  body: string
}): PostInsert {
  return {
    channel_id: opts.channelId,
    author_id: opts.authorId,
    title: opts.title.trim(),
    body_rich: richFromPlain(opts.body),
  }
}

/** The patch an edit writes — title and body only; tags diff separately. */
export function postPatch(opts: { title: string; body: string }): {
  title: string
  body_rich: unknown
} {
  return { title: opts.title.trim(), body_rich: richFromPlain(opts.body) }
}

/**
 * Which post_tags rows an edit must add and remove, given the tags a post
 * currently carries and the names the form now holds. Returned `add` is
 * names (they may not exist as tags yet); `remove` is tag ids.
 */
export function tagDiff(
  current: readonly Tag[],
  nextNames: readonly string[],
): { add: string[]; remove: string[] } {
  const have = new Set(current.map((t) => t.name))
  const want = new Set(nextNames)
  return {
    add: nextNames.filter((n) => !have.has(n)),
    remove: current.filter((t) => !want.has(t.name)).map((t) => t.id),
  }
}

/**
 * Fold one `messages.select('post_id')` result into per-post comment counts.
 * The query already excludes tombstones; a post with no comments is simply
 * absent from the map, so read with `?? 0`.
 */
export function commentCounts(
  rows: readonly { post_id: string | null }[],
): Map<string, number> {
  const counts = new Map<string, number>()
  for (const row of rows) {
    if (row.post_id === null) continue
    counts.set(row.post_id, (counts.get(row.post_id) ?? 0) + 1)
  }
  return counts
}

/**
 * Join `post_tags` rows against the fetched tags, per post, sorted by name so
 * chip order is stable. Rows pointing at tags the fetch did not return (a
 * concurrent delete) are dropped rather than rendered as holes.
 */
export function tagsByPost(
  postTags: readonly { post_id: string; tag_id: string }[],
  tags: readonly Tag[],
): Map<string, Tag[]> {
  const byId = new Map(tags.map((t) => [t.id, t]))
  const grouped = new Map<string, Tag[]>()
  for (const row of postTags) {
    const tag = byId.get(row.tag_id)
    if (!tag) continue
    const list = grouped.get(row.post_id)
    if (list) list.push(tag)
    else grouped.set(row.post_id, [tag])
  }
  for (const list of grouped.values()) list.sort((a, b) => a.name.localeCompare(b.name))
  return grouped
}

/**
 * The `?tag=` filter: posts carrying the named tag, or all posts when no
 * filter is set. Order is preserved from the input list.
 */
export function filterByTag<T extends { id: string }>(
  posts: readonly T[],
  byPost: Map<string, Tag[]>,
  tagName: string | null,
): T[] {
  if (tagName === null || tagName === '') return [...posts]
  return posts.filter((p) => (byPost.get(p.id) ?? []).some((t) => t.name === tagName))
}
