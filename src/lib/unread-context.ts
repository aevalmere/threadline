import { createContext, useContext } from 'react'

import type { UnreadMessage } from '@/lib/unread'

export interface UnreadContextValue {
  /** Unread count for a channel — SPEC §1.4. */
  countFor: (channelId: string) => number
  /** The same, formatted for a badge, or null when there is nothing to show. */
  badgeFor: (channelId: string) => string | null
  /**
   * Record that the viewer has seen these messages.
   *
   * Takes the rows rather than a number so it can use the tested
   * `nextLastReadMessageId`, which never moves the pointer backwards. Writes
   * are batched (Non-negotiable 8); the local count clears immediately.
   */
  markRead: (channelId: string, messages: readonly UnreadMessage[]) => void
  /** True until the first pointer fetch settles. */
  loading: boolean
}

export const UnreadContext = createContext<UnreadContextValue | null>(null)

export function useUnread(): UnreadContextValue {
  const ctx = useContext(UnreadContext)
  if (!ctx) throw new Error('useUnread must be used inside <UnreadProvider>')
  return ctx
}
