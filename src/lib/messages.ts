/**
 * Message pagination and reconnect-resync query arguments — SPEC.md §1.5.
 *
 * A never-break path (ROADMAP.md). These builders are pure and return plain
 * argument objects; the caller feeds them to supabase-js. Keeping the query
 * *shape* separate from the network call is what makes it testable.
 *
 * Both operations are keyset scans on `messages.id`, which is a monotonic
 * bigint precisely so they can be (DECISIONS #2). Never paginate on
 * `created_at` — it ties under concurrent inserts.
 */

export const PAGE_SIZE = 50

/**
 * What a message stream hangs off — a chat channel or a forum post. One of
 * `messages`' two parent columns plus the parent's id (SPEC §1.3: exactly one
 * is set per row, CHECK-enforced). Carrying the *column name* rather than a
 * kind keeps every query site to one `.eq(parent.column, parent.id)` with no
 * mapping step to get wrong.
 */
export interface MessageParent {
  column: 'channel_id' | 'post_id'
  id: string
}

export function channelParent(id: string): MessageParent {
  return { column: 'channel_id', id }
}

export function postParent(id: string): MessageParent {
  return { column: 'post_id', id }
}

export function sameParent(a: MessageParent, b: MessageParent): boolean {
  return a.column === b.column && a.id === b.id
}

export interface PageQuery {
  parent: MessageParent
  /** Exclusive upper bound — the oldest id already held. Null on first page. */
  beforeId: number | null
  limit: number
  /** Newest-first on the wire; the caller reverses for display. */
  ascending: false
}

/**
 * One page of scrollback. Walks backwards from `beforeId`, so an infinite
 * scroll passes the oldest id it currently holds.
 */
export function pageQuery(
  parent: MessageParent,
  beforeId: number | null = null,
  limit: number = PAGE_SIZE,
): PageQuery {
  return { parent, beforeId, limit, ascending: false }
}

export interface ResyncQuery {
  parent: MessageParent
  /** Exclusive lower bound — the newest id already held. */
  afterId: number
  ascending: true
}

/**
 * Everything missed while disconnected. Runs on every channel join and every
 * reconnect, so a dropped websocket event is never data loss.
 */
export function resyncQuery(parent: MessageParent, afterId: number | null): ResyncQuery {
  return { parent, afterId: afterId ?? 0, ascending: true }
}

export interface IdentifiedMessage {
  id: number
}

/** Highest id held, i.e. the resync cursor. 0 when nothing is held. */
export function highestMessageId(messages: readonly IdentifiedMessage[]): number {
  let max = 0
  for (const m of messages) if (m.id > max) max = m.id
  return max
}

/** Lowest id held, i.e. the pagination cursor. Null when nothing is held. */
export function oldestMessageId(
  messages: readonly IdentifiedMessage[],
): number | null {
  if (messages.length === 0) return null
  let min = messages[0].id
  for (const m of messages) if (m.id < min) min = m.id
  return min
}

/**
 * Merge a fetched batch into what is already on screen.
 *
 * Realtime and resync overlap by design — the same row can arrive twice — so
 * this dedupes by id, prefers the incoming (fresher) copy, and returns
 * ascending order. Last-write-wins is correct here: the resync fetch always
 * reflects the table.
 */
export function mergeMessages<T extends IdentifiedMessage>(
  existing: readonly T[],
  incoming: readonly T[],
): T[] {
  const byId = new Map<number, T>()
  for (const m of existing) byId.set(m.id, m)
  for (const m of incoming) byId.set(m.id, m)
  return [...byId.values()].sort((a, b) => a.id - b.id)
}

/** A full page back means there is probably more scrollback. */
export function hasMorePages(received: number, limit: number = PAGE_SIZE): boolean {
  return received >= limit
}
