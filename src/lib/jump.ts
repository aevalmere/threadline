/**
 * Where `?m=<id>` should take you — the decision behind a notification click.
 *
 * Pure and tested rather than inlined in an effect, because the interesting
 * case is invisible from inside one. `/channels/:channelId` renders the same
 * element for every id, so navigating from one channel to another **re-renders
 * without remounting**: for one commit, `channelId` is already the new channel
 * while `messages` still holds the old channel's rows and `loading` is still
 * false. An effect that consumed the parameter in that window would clear it
 * before the target could possibly exist, and the jump would silently never
 * happen — which is exactly the bug this function exists to make testable.
 *
 * Hence `loadedChannelId`: the channel whose page is actually in `messages`.
 * Until that matches, the answer is `wait` and the parameter must survive.
 */

export interface JumpCandidate {
  id: number
  thread_root_id: number | null
}

export type JumpDecision =
  /** No `?m=` at all. */
  | { status: 'idle' }
  /** This channel's page has not landed yet — keep the parameter and re-ask. */
  | { status: 'wait' }
  /** The page landed and the message is not in it — drop the parameter. */
  | { status: 'miss' }
  /**
   * The target is older than the loaded page and older pages exist — load one
   * and re-ask. The parameter survives; the caller owns the hunt's page cap.
   * Pulled forward from BACKLOG for P2: a task's "from #channel" chip usually
   * points at a message far older than the newest-50 page (DECISIONS #23).
   */
  | { status: 'page' }
  /**
   * Found it. `openThread` is the root to expand first when the target is a
   * reply, because a reply is only rendered inside an open thread.
   */
  | { status: 'hit'; id: number; openThread: number | null }

export function resolveJump(input: {
  jumpTo: string | null
  loading: boolean
  /** The channel the rows in `messages` belong to. */
  loadedChannelId: string | undefined
  /** The channel currently routed to. */
  channelId: string | undefined
  messages: readonly JumpCandidate[]
  /** Whether older pages exist beyond the loaded ones — gates `page`. */
  hasMore: boolean
}): JumpDecision {
  const { jumpTo, loading, loadedChannelId, channelId, messages, hasMore } = input

  if (!jumpTo) return { status: 'idle' }

  // The page in hand must be this channel's, and settled. Either half being
  // wrong means the target has not had its chance to appear.
  if (loading || !channelId || loadedChannelId !== channelId) return { status: 'wait' }

  const id = Number(jumpTo)
  if (!Number.isInteger(id)) return { status: 'miss' }

  const target = messages.find((m) => m.id === id)
  if (!target) {
    // Older than everything loaded, with older pages left: keep hunting.
    // Ids order messages (bigint identity — SPEC §2.1), so "older than the
    // page" is a plain comparison against the lowest loaded id.
    const lowest = messages.length > 0 ? Math.min(...messages.map((m) => m.id)) : null
    if (hasMore && lowest !== null && id < lowest) return { status: 'page' }
    // Genuinely absent: deleted, newer-but-gone, or the hunt has nowhere left
    // to look. Lands you in the channel and the parameter is dropped rather
    // than retrying forever.
    return { status: 'miss' }
  }

  return { status: 'hit', id, openThread: target.thread_root_id }
}
