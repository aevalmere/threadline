/**
 * Read-pointer bookkeeping — SPEC.md §1.4.
 *
 * **Counting itself is no longer here.** It moved to `unread_counts()` in the
 * database (DECISIONS #18): a client can only count messages it has fetched,
 * so any in-memory version needs a window, and every choice of window is wrong
 * for some channel. What remains is the part that genuinely belongs on the
 * client — deciding where the pointer should move to, and how to render it.
 *
 * The counting rule is asserted against the live function by `scripts/seed.ts`,
 * which is the never-break path ROADMAP records for it.
 */

export interface UnreadMessage {
  id: number
  author_id: string
  deleted_at: string | null
}

/**
 * The pointer to persist after the viewer has seen `messages`.
 *
 * Advances to the highest id present — including the viewer's own and
 * soft-deleted rows, because the pointer marks a position in the stream, not
 * a count. Never moves backwards, so an out-of-order write can't resurrect
 * already-read messages.
 */
export function nextLastReadMessageId(
  messages: readonly UnreadMessage[],
  lastReadMessageId: number | null,
): number | null {
  if (messages.length === 0) return lastReadMessageId
  const highest = messages.reduce((max, m) => (m.id > max ? m.id : max), 0)
  if (lastReadMessageId === null) return highest
  return Math.max(highest, lastReadMessageId)
}

/**
 * Badge text for the sidebar. Caps the display, not the count — SPEC.md §1.4
 * says nothing about a cap, so this is presentation only.
 */
export function unreadBadge(count: number, cap = 99): string | null {
  if (count <= 0) return null
  return count > cap ? `${cap}+` : String(count)
}

/**
 * Apply server counts while respecting reads that have not been persisted yet.
 *
 * `unread_counts()` answers from `channel_members.last_read_message_id`, and
 * that pointer is written on a debounce (Non-negotiable 8). So a refresh can
 * resolve against a pointer that is *behind* what the viewer has actually
 * read, and hand back a non-zero count for the channel they are looking at.
 *
 * That is not a transient blip. Nothing re-triggers a refresh once the pointer
 * write lands — the subscription watches `messages`, not `channel_members` —
 * and `markRead` will not fire again while the highest loaded id is unchanged,
 * so the badge sticks for the rest of the session.
 *
 * A channel is pinned to 0 whenever the read this session has recorded is
 * ahead of what the database has **confirmed** — which covers a write that is
 * queued, one that is in flight, and one that failed and is waiting to retry.
 * Keying it on "queued" alone was not enough: the queue is emptied before the
 * upsert is awaited, so a sent-but-uncommitted write sat in no set at all and
 * left a phantom badge on the channel being read.
 */
export function reconcileUnread(
  serverCounts: readonly { channel_id: string; unread: number }[],
  pendingChannels: ReadonlySet<string>,
): Map<string, number> {
  const out = new Map<string, number>()
  for (const row of serverCounts) {
    out.set(row.channel_id, pendingChannels.has(row.channel_id) ? 0 : Number(row.unread) || 0)
  }
  return out
}
