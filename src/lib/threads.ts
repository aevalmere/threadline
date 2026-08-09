/**
 * Thread shaping — SPEC.md §1.3.
 *
 * `messages` is one table doing three jobs. A top-level message has
 * `thread_root_id IS NULL`; a reply points at the top-level message it belongs
 * to. **Threads are one level deep** — replying to a reply attaches to the same
 * root, it never nests further.
 *
 * Pure, so the shaping rules are unit-tested rather than click-tested.
 */

export interface ThreadableMessage {
  id: number
  thread_root_id: number | null
}

/**
 * The `thread_root_id` a reply to `message` must carry.
 *
 * This is the one-level-deep rule in one line: replying to a root targets the
 * root, and replying to a reply targets that reply's root, never the reply.
 */
export function threadRootFor(message: ThreadableMessage): number {
  return message.thread_root_id ?? message.id
}

export interface SplitThreads<T> {
  /** What the main channel list renders, oldest first. */
  roots: T[]
  /** Replies keyed by root id, oldest first within each thread. */
  repliesByRoot: Map<number, T[]>
}

/**
 * Split a flat page of messages into top-level messages and their replies.
 *
 * A reply whose root is not in `messages` — its root scrolled out of the loaded
 * page — is promoted to the main list rather than filed under a root that is
 * not there. Hiding a message the server returned would be worse than showing
 * it slightly out of context, and it becomes a normal reply again once
 * scrollback loads its root.
 */
export function splitThreads<T extends ThreadableMessage>(
  messages: readonly T[],
): SplitThreads<T> {
  const present = new Set(messages.map((m) => m.id))
  const roots: T[] = []
  const repliesByRoot = new Map<number, T[]>()

  for (const message of messages) {
    const rootId = message.thread_root_id
    if (rootId === null || !present.has(rootId)) {
      roots.push(message)
      continue
    }
    const existing = repliesByRoot.get(rootId)
    if (existing) existing.push(message)
    else repliesByRoot.set(rootId, [message])
  }

  roots.sort((a, b) => a.id - b.id)
  for (const replies of repliesByRoot.values()) replies.sort((a, b) => a.id - b.id)

  return { roots, repliesByRoot }
}

/** How many replies a root has in the loaded page. */
export function replyCount<T extends ThreadableMessage>(
  split: SplitThreads<T>,
  rootId: number,
): number {
  return split.repliesByRoot.get(rootId)?.length ?? 0
}
