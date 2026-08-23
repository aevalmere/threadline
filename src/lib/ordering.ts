/**
 * Fractional list ordering — the arithmetic behind every drag-and-drop list.
 *
 * Extracted from `tasks.ts` in beta round 3, when the sidebar (channels,
 * forums) and the docs tree (collections, pages) became reorderable and needed
 * the same rule the kanban board has used since P2: a row dropped between two
 * neighbours takes the midpoint of their positions, and **one row is written
 * per drop**. Never renumber a whole list — that is N writes per drag against
 * the realtime budget (Non-negotiable 8), and two clients renumbering at once
 * disagree.
 *
 * `tasks.ts` re-exports all three names, so the board's imports are unchanged.
 * The sidebar imports from here directly: it has no business pulling task
 * types in to move a channel.
 */

/**
 * Gap left between consecutive positions so most drops midpoint cleanly.
 * float8 has 52 mantissa bits; halving the same gap needs ~50 consecutive
 * drops into one spot before precision runs out — acceptable at 5–30 users,
 * and a reorder writes a fresh position anyway.
 *
 * Matches the backfill step in 20260823001537_sidebar_and_docs_ordering.sql.
 */
export const POSITION_STEP = 1024

/** The least a row needs for this module to place it. */
export interface Positioned {
  position: number
}

/**
 * Position for a row dropped between `prev` and `next` (either side null at a
 * list edge, both null into an empty list). SPEC §1.6: never rewrite a whole
 * column on drop — one card, one new position.
 */
export function positionBetween(prev: number | null, next: number | null): number {
  if (prev === null && next === null) return POSITION_STEP
  if (prev === null) return (next as number) - POSITION_STEP
  if (next === null) return prev + POSITION_STEP
  return (prev + next) / 2
}

/** Append position for a new row at the bottom of a list. */
export function appendPosition(list: readonly Positioned[]): number {
  if (list.length === 0) return POSITION_STEP
  return Math.max(...list.map((t) => t.position)) + POSITION_STEP
}

/**
 * The position a row needs after being dragged from index `from` to index
 * `to` within one ordered list — the sortable-list counterpart to
 * `positionBetween`, which the kanban board calls with explicit neighbours.
 *
 * `to` is the destination index in the **final** array (what dnd-kit's
 * `arrayMove` semantics and its `newIndex` report), so the moved row is
 * removed before its neighbours are read. Getting that wrong is the classic
 * off-by-one that makes a downward drag land one short.
 *
 * Returns null for a no-op drop, which the caller should treat as "write
 * nothing" rather than as an error.
 */
export function positionForMove(
  list: readonly Positioned[],
  from: number,
  to: number,
): number | null {
  if (from === to) return null
  if (from < 0 || from >= list.length) return null
  if (to < 0 || to >= list.length) return null

  const without = list.filter((_, i) => i !== from)
  const prev = to > 0 ? (without[to - 1] ?? null) : null
  const next = without[to] ?? null
  return positionBetween(prev?.position ?? null, next?.position ?? null)
}

/** Ascending by position, then id — the tiebreak the migration's backfill uses. */
export function byPosition<T extends Positioned & { id: string }>(a: T, b: T): number {
  return a.position - b.position || a.id.localeCompare(b.id)
}
