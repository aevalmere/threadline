/**
 * Consecutive-message grouping for the chat list.
 *
 * Runs of messages from one author inside a short window render under a single
 * name and avatar, the way every chat client does it. Presentation only — it
 * never changes, drops, or reorders a message.
 */

export const GROUP_WINDOW_MS = 5 * 60 * 1000

export interface GroupableMessage {
  id: number
  author_id: string
  created_at: string
}

export interface MessageGroup<T> {
  /** Stable across re-renders: the id of the group's first message. */
  key: number
  authorId: string
  messages: T[]
}

export function groupMessages<T extends GroupableMessage>(
  messages: readonly T[],
  windowMs: number = GROUP_WINDOW_MS,
): MessageGroup<T>[] {
  const groups: MessageGroup<T>[] = []

  for (const message of messages) {
    const current = groups[groups.length - 1]
    const previous = current?.messages[current.messages.length - 1]

    const continues =
      current !== undefined &&
      previous !== undefined &&
      current.authorId === message.author_id &&
      withinWindow(previous.created_at, message.created_at, windowMs)

    if (continues) {
      current.messages.push(message)
    } else {
      groups.push({ key: message.id, authorId: message.author_id, messages: [message] })
    }
  }

  return groups
}

function withinWindow(earlier: string, later: string, windowMs: number): boolean {
  const a = Date.parse(earlier)
  const b = Date.parse(later)
  // An unparseable timestamp must not silently merge unrelated messages.
  if (Number.isNaN(a) || Number.isNaN(b)) return false
  return Math.abs(b - a) <= windowMs
}
