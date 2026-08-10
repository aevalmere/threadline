import { describe, expect, it } from 'vitest'

import {
  nextLastReadMessageId,
  reconcileUnread,
  unreadBadge,
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

describe('reconcileUnread', () => {
  const none = new Set<string>()

  it('passes server counts through when nothing is pending', () => {
    const out = reconcileUnread(
      [
        { channel_id: 'a', unread: 3 },
        { channel_id: 'b', unread: 0 },
      ],
      none,
    )
    expect(out.get('a')).toBe(3)
    expect(out.get('b')).toBe(0)
  })

  /**
   * The regression. The pointer write is debounced, so a refresh that resolves
   * first sees a stale pointer and reports the channel being read as unread —
   * and nothing would ever correct it.
   */
  it('pins a channel with an unwritten read to zero', () => {
    const out = reconcileUnread([{ channel_id: 'a', unread: 5 }], new Set(['a']))
    expect(out.get('a')).toBe(0)
  })

  it('only pins the pending channel, not its neighbours', () => {
    const out = reconcileUnread(
      [
        { channel_id: 'a', unread: 5 },
        { channel_id: 'b', unread: 7 },
      ],
      new Set(['a']),
    )
    expect(out.get('a')).toBe(0)
    expect(out.get('b')).toBe(7)
  })

  it('keeps every channel the server reported, so a read channel is not "unknown"', () => {
    const out = reconcileUnread(
      [
        { channel_id: 'a', unread: 0 },
        { channel_id: 'b', unread: 0 },
      ],
      none,
    )
    expect([...out.keys()].sort()).toEqual(['a', 'b'])
  })

  it('coerces a non-numeric count rather than propagating NaN', () => {
    const out = reconcileUnread(
      [{ channel_id: 'a', unread: undefined as unknown as number }],
      none,
    )
    expect(out.get('a')).toBe(0)
  })

  it('ignores a pending channel the server did not mention', () => {
    const out = reconcileUnread([{ channel_id: 'a', unread: 1 }], new Set(['zzz']))
    expect(out.get('a')).toBe(1)
    expect(out.has('zzz')).toBe(false)
  })
})
