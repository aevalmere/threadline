/**
 * The optimistic send queue — SPEC.md §1.3.
 *
 * `messages.id` is a server-assigned bigint identity, so a message the user has
 * just typed has no id yet. Pending sends therefore live in their own list
 * rather than in the message array behind a placeholder id: `mergeMessages`
 * sorts ascending by id, so a negative placeholder would sort a just-sent
 * message to the *top* of the scrollback (DECISIONS #2).
 *
 * Pure, so the reconciliation rules are unit-tested rather than click-tested.
 */

export interface PendingMessage {
  /** Client-generated, stable for the life of the entry. */
  key: string
  body: string
  authorId: string
  /**
   * The channel this was typed into. Entries outlive a channel switch so a
   * send that fails after the user has navigated away still has a visible
   * bubble — and a retry — when they come back.
   */
  channelId: string
  /**
   * Highest message id known when this was sent. Only rows *newer* than this
   * can be its confirmation, which is what keeps an identical older message
   * from cancelling it. An id comparison, not a clock — client and server
   * clocks disagree, ids do not (DECISIONS #2).
   */
  sinceId: number
  status: 'sending' | 'failed'
}

export interface ConfirmableMessage {
  id: number
  author_id: string
  body: string
}

/**
 * Drop pending entries that have come back from the server.
 *
 * Matching is greedy and one-to-one: each confirmed row cancels at most one
 * pending entry, so sending "on it" twice in a row leaves two bubbles until
 * two rows arrive, rather than both vanishing on the first.
 */
export function reconcilePending<T extends ConfirmableMessage>(
  pending: readonly PendingMessage[],
  confirmed: readonly T[],
): PendingMessage[] {
  if (pending.length === 0) return []

  const claimed = new Set<string>()

  for (const row of [...confirmed].sort((a, b) => a.id - b.id)) {
    const match = pending.find(
      (p) =>
        !claimed.has(p.key) &&
        p.authorId === row.author_id &&
        p.body === row.body &&
        row.id > p.sinceId,
    )
    if (match) claimed.add(match.key)
  }

  return pending.filter((p) => !claimed.has(p.key))
}

export interface ChannelScopedMessage extends ConfirmableMessage {
  channel_id: string | null
}

/**
 * Reconcile one channel's pending entries against one channel's rows.
 *
 * Both sides need the guard. Tagging entries with `channelId` is not enough on
 * its own: message ids come from a single global sequence, so a row loaded in
 * #general can carry the same author and body as an entry still pending in
 * #random *and* a higher id than its `sinceId`, and would claim it. Losing a
 * failed send that way is silent — the bubble, its Retry, and the user's unsent
 * text all vanish.
 *
 * Always returns a fresh array; the caller decides whether the result is worth
 * a re-render.
 *
 * **Only ever removes entries** — never replaces, reorders, restamps or appends
 * one. `useMessages` relies on that to treat an unchanged length as proof that
 * nothing changed and keep the previous state object. If this ever starts
 * rewriting an entry, that shortcut has to go with it.
 */
export function reconcilePendingForChannel(
  pending: readonly PendingMessage[],
  messages: readonly ChannelScopedMessage[],
  channelId: string,
): PendingMessage[] {
  const mine = pending.filter((p) => p.channelId === channelId)
  if (mine.length === 0) return [...pending]

  const here = messages.filter((m) => m.channel_id === channelId)
  if (here.length === 0) return [...pending]

  const kept = new Set(reconcilePending(mine, here).map((p) => p.key))
  return pending.filter((p) => p.channelId !== channelId || kept.has(p.key))
}

/** Flip one entry's status, leaving the rest untouched. */
export function markPending(
  pending: readonly PendingMessage[],
  key: string,
  status: PendingMessage['status'],
): PendingMessage[] {
  return pending.map((p) => (p.key === key ? { ...p, status } : p))
}

/** Remove one entry outright — used when a failed send is abandoned. */
export function dropPending(
  pending: readonly PendingMessage[],
  key: string,
): PendingMessage[] {
  return pending.filter((p) => p.key !== key)
}
