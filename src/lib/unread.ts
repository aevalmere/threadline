/**
 * Unread-count calculation — SPEC.md §1.4.
 *
 * A never-break path (ROADMAP.md). Kept pure so it is testable without a
 * database: callers hand it rows they already hold in memory.
 *
 * Unread = messages with `id > last_read_message_id`, excluding the viewer's
 * own messages and soft-deleted rows. A null pointer means nothing has been
 * read yet, so everything counts.
 */

export interface UnreadMessage {
  id: number
  author_id: string
  deleted_at: string | null
}

export interface UnreadInput {
  messages: readonly UnreadMessage[]
  /** `channel_members.last_read_message_id` — null means never read. */
  lastReadMessageId: number | null
  /** The signed-in user; their own messages are never unread to them. */
  viewerId: string
}

export function unreadCount({
  messages,
  lastReadMessageId,
  viewerId,
}: UnreadInput): number {
  const floor = lastReadMessageId ?? 0
  let count = 0
  for (const m of messages) {
    if (m.id <= floor) continue
    if (m.deleted_at !== null) continue
    if (m.author_id === viewerId) continue
    count++
  }
  return count
}

export function hasUnread(input: UnreadInput): boolean {
  return unreadCount(input) > 0
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
