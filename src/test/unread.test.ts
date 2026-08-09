import { describe, expect, it } from 'vitest'

import {
  hasUnread,
  nextLastReadMessageId,
  unreadBadge,
  unreadCount,
  type UnreadMessage,
} from '@/lib/unread'

const ME = 'user-me'
const THEM = 'user-them'

function msg(
  id: number,
  author_id = THEM,
  deleted_at: string | null = null,
): UnreadMessage {
  return { id, author_id, deleted_at }
}

describe('unreadCount', () => {
  it('counts only messages after the pointer', () => {
    const messages = [msg(1), msg(2), msg(3), msg(4)]
    expect(unreadCount({ messages, lastReadMessageId: 2, viewerId: ME })).toBe(2)
  })

  it('treats a null pointer as everything unread', () => {
    const messages = [msg(1), msg(2), msg(3)]
    expect(unreadCount({ messages, lastReadMessageId: null, viewerId: ME })).toBe(3)
  })

  it('excludes the viewer own messages', () => {
    const messages = [msg(1, ME), msg(2, THEM), msg(3, ME), msg(4, THEM)]
    expect(unreadCount({ messages, lastReadMessageId: null, viewerId: ME })).toBe(2)
  })

  it('excludes soft-deleted messages', () => {
    const messages = [msg(1), msg(2, THEM, '2026-08-09T00:00:00Z'), msg(3)]
    expect(unreadCount({ messages, lastReadMessageId: null, viewerId: ME })).toBe(2)
  })

  it('is zero when the pointer is at or past the newest message', () => {
    const messages = [msg(1), msg(2), msg(3)]
    expect(unreadCount({ messages, lastReadMessageId: 3, viewerId: ME })).toBe(0)
    expect(unreadCount({ messages, lastReadMessageId: 99, viewerId: ME })).toBe(0)
  })

  it('is zero for an empty channel', () => {
    expect(unreadCount({ messages: [], lastReadMessageId: null, viewerId: ME })).toBe(0)
  })

  it('does not count the pointer message itself', () => {
    // The pointer is inclusive-read: id 2 has been read, so only 3 is unread.
    const messages = [msg(2), msg(3)]
    expect(unreadCount({ messages, lastReadMessageId: 2, viewerId: ME })).toBe(1)
  })
})

describe('hasUnread', () => {
  it('mirrors unreadCount > 0', () => {
    expect(hasUnread({ messages: [msg(5)], lastReadMessageId: 4, viewerId: ME })).toBe(
      true,
    )
    expect(hasUnread({ messages: [msg(5)], lastReadMessageId: 5, viewerId: ME })).toBe(
      false,
    )
  })
})

describe('nextLastReadMessageId', () => {
  it('advances to the highest id seen', () => {
    expect(nextLastReadMessageId([msg(4), msg(7), msg(5)], 3)).toBe(7)
  })

  it('includes the viewer own and deleted messages when advancing', () => {
    // The pointer marks a stream position, not a count of readable messages.
    const messages = [msg(8, ME), msg(9, THEM, '2026-08-09T00:00:00Z')]
    expect(nextLastReadMessageId(messages, 7)).toBe(9)
  })

  it('never moves backwards', () => {
    expect(nextLastReadMessageId([msg(2)], 10)).toBe(10)
  })

  it('sets the first pointer from null', () => {
    expect(nextLastReadMessageId([msg(1), msg(2)], null)).toBe(2)
  })

  it('leaves the pointer untouched for an empty batch', () => {
    expect(nextLastReadMessageId([], 5)).toBe(5)
    expect(nextLastReadMessageId([], null)).toBeNull()
  })
})

describe('unreadBadge', () => {
  it('hides at zero', () => {
    expect(unreadBadge(0)).toBeNull()
  })

  it('shows the count under the cap', () => {
    expect(unreadBadge(7)).toBe('7')
    expect(unreadBadge(99)).toBe('99')
  })

  it('caps the display', () => {
    expect(unreadBadge(100)).toBe('99+')
    expect(unreadBadge(5, 3)).toBe('3+')
  })
})
